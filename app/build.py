#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包脚本 - 生成可执行文件

使用方法：
    python build.py

会在 dist/ 目录生成：
    - Windows: autowriting.exe
    - macOS: autowriting (可执行文件)
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def main():
    print("=" * 50)
    print("  AI 自动写作工具 - 打包脚本")
    print("=" * 50)
    
    # 获取当前目录
    current_dir = Path(__file__).parent
    main_script = current_dir / "autowriting.py"
    
    if not main_script.exists():
        print("错误: 找不到 autowriting.py")
        sys.exit(1)
    
    # 检查并安装 pyinstaller
    print("\n检查 PyInstaller...")
    try:
        import PyInstaller
        print(f"✓ PyInstaller 已安装 (版本: {PyInstaller.__version__})")
    except ImportError:
        print("正在安装 PyInstaller...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)
    
    # 清理旧的构建文件
    print("\n清理旧文件...")
    for dir_name in ["build", "dist"]:
        dir_path = current_dir / dir_name
        if dir_path.exists():
            shutil.rmtree(dir_path)
    
    spec_file = current_dir / "autowriting.spec"
    if spec_file.exists():
        spec_file.unlink()
    
    # 执行打包
    print("\n开始打包...")
    print("-" * 50)
    
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",                    # 打包成单个文件
        "--name", "autowriting",        # 可执行文件名称
        "--console",                    # 控制台应用
        "--clean",                      # 清理临时文件
        str(main_script)
    ]
    
    result = subprocess.run(cmd, cwd=str(current_dir))
    
    if result.returncode == 0:
        print("-" * 50)
        print("\n✓ 打包成功！")
        
        dist_dir = current_dir / "dist"
        if sys.platform == "win32":
            exe_file = dist_dir / "autowriting.exe"
        else:
            exe_file = dist_dir / "autowriting"
        
        if exe_file.exists():
            size_mb = exe_file.stat().st_size / (1024 * 1024)
            print(f"\n输出文件: {exe_file}")
            print(f"文件大小: {size_mb:.1f} MB")
            
            print("\n使用方法：")
            if sys.platform == "win32":
                print("  1. 将 autowriting.exe 复制到任意目录")
                print("  2. 双击运行或在命令行执行")
                print("  3. 按照菜单提示操作")
            else:
                print("  1. 将 autowriting 复制到任意目录")
                print("  2. 在终端运行: ./autowriting")
                print("  3. 按照菜单提示操作")
    else:
        print("\n✗ 打包失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
