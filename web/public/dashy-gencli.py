#!/usr/bin/env python3
"""Run the local Dashy cover companion. Requires Python 3.9 and gencli."""
import argparse
import hmac
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import site
import subprocess
import sys
import tempfile
import threading
from urllib.parse import urlsplit

PORT = 18472
HOST = f"127.0.0.1:{PORT}"
SITE = "https://0oq8he.site"
MAX_IMAGE = 10 * 1024 * 1024
IMAGE_TYPES = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
]


def find_cli():
    candidates = [shutil.which("gencli"),
                  str(Path(site.USER_BASE) / "bin" / "gencli"),
                  str(Path.home() / "Library/Python/3.9/bin/gencli")]
    for candidate in dict.fromkeys(candidates):
        if not candidate or not Path(candidate).is_file():
            continue
        # macOS 环境迁移后 pip 的入口可能还指向已卸载的 Python。
        with open(candidate, "rb") as script:
            python_entry = b"python" in script.readline(512) and os.access(candidate, os.X_OK)
        commands = [[candidate], [sys.executable, candidate]] if python_entry else [[candidate]]
        for command in commands:
            try:
                check = subprocess.run(command + ["--version"], capture_output=True, timeout=5)
                if check.returncode == 0 and b"gencli" in check.stdout:
                    return command
            except (OSError, subprocess.TimeoutExpired):
                pass
    return None


def generate(cli, prompt):
    with tempfile.TemporaryDirectory(prefix="dashy-cover-") as directory:
        base = Path(directory)
        text = base / "prompt.txt"
        text.write_text(prompt, encoding="utf-8")
        output = base / "image"
        output.mkdir()
        # 只接收文本，命令、模型、参数和输出路径由本机客户端决定。
        subprocess.run(cli + ["image", "--prompt-file", str(text), "--model", "gpt-image-2",
                              "--ratio", "16:9", "--out", str(output), "--timeout", "170"],
                       cwd=base, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=400, check=True)
        for image in sorted(output.iterdir()):
            if image.is_symlink() or not image.is_file() or not 0 < image.stat().st_size <= MAX_IMAGE:
                continue
            binary = image.read_bytes()
            for magic, media_type in IMAGE_TYPES:
                if binary.startswith(magic):
                    return binary, media_type
            if binary.startswith(b"RIFF") and binary[8:12] == b"WEBP":
                return binary, "image/webp"
    raise ValueError("No usable image")


def serve(cli, origin, code):
    busy = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        timeout = 10

        def log_message(self, *_):
            pass

        def reply(self, status, data=b"", media_type="application/json"):
            self.send_response(status)
            if self.headers.get("Origin") == origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Type", media_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def error(self, status, message):
            self.reply(status, json.dumps({"error": message}).encode("utf-8"))

        def permitted(self):
            if self.headers.get("Host") == HOST and self.headers.get("Origin") == origin:
                return True
            self.error(403, "本机客户端仅接受已配对站点的请求。")
            return False

        def do_OPTIONS(self):
            if not self.permitted():
                return
            if self.path not in ("/status", "/generate"):
                self.error(404, "未知路径。")
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Dashy-Pairing")
            self.end_headers()

        def do_POST(self):
            if not self.permitted():
                return
            if not hmac.compare_digest(self.headers.get("X-Dashy-Pairing", "").encode("utf-8"), code.encode("ascii")):
                self.error(401, "配对码不匹配，请使用本机终端显示的新配对码。")
                return
            if self.path == "/status":
                self.reply(200, b'{"ready":true}')
                return
            if self.path != "/generate":
                self.error(404, "未知路径。")
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 40_000 or self.headers.get("Content-Type") != "application/json":
                    raise ValueError()
                data = json.loads(self.rfile.read(size))
                prompt = data["prompt"].strip() if isinstance(data, dict) and set(data) == {"prompt"} else ""
                if not prompt or len(prompt) > 4000:
                    raise ValueError()
            except (ValueError, AttributeError, TypeError, OSError):
                self.error(400, "提示词须为 1–4000 字。")
                return
            if not busy.acquire(blocking=False):
                self.error(409, "本机已有封面正在生成。")
                return
            try:
                binary, media_type = generate(cli, prompt)
                self.reply(200, binary, media_type)
            except subprocess.TimeoutExpired:
                self.error(504, "本机 Gen CLI 等待生图超时。")
            except (OSError, subprocess.CalledProcessError, ValueError):
                self.error(502, "Gen CLI 没有返回可用图片。请检查本机登录状态及模型可用性。")
            finally:
                busy.release()

    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as server:
        print(f"Dashy Gen CLI 已启动。请在 {origin} 的「AI 配置 → 封面」填入配对码。", flush=True)
        print(f"配对码：{code}", flush=True)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=SITE, help="仅供本机开发：指定本机网页的 HTTP origin")
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if args.origin != SITE and not (
        origin.scheme == "http" and origin.hostname in ("127.0.0.1", "localhost")
        and args.origin == f"http://{origin.netloc}" and not origin.username and not origin.password
    ):
        parser.error("只支持官方站点或本机开发页面。")
    cli = find_cli()
    if cli is None:
        parser.error("找不到可运行的 gencli。请先在本机终端检查 gencli --version。")
    try:
        serve(cli, args.origin, secrets.token_urlsafe(24))
    except KeyboardInterrupt:
        pass
    except OSError as exc:
        parser.exit(1, f"无法监听本机端口 {PORT}：{exc}\n")


if __name__ == "__main__":
    main()
