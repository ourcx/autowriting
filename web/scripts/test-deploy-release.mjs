#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "../..")
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "autowriting-deploy-test-"))
const RELEASE_DIR = join(TEMP_ROOT, "release")
const SERVER_DIR = join(TEMP_ROOT, "server")
const ARCHIVE = join(TEMP_ROOT, "autowriting-release.tar.gz")

function run(command, args, cwd = REPO_ROOT) {
  execFileSync(command, args, { cwd, stdio: "pipe" })
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function applyRelease({ staging, serverDir, fallbackManagedFiles = [] }) {
  const newManifest = new Set(readFileSync(join(staging, ".deploy-manifest"), "utf8").trim().split("\n"))
  const currentManifest = join(serverDir, ".deploy-manifest")
  const managedFiles = existsSync(currentManifest)
    ? readFileSync(currentManifest, "utf8").trim().split("\n")
    : fallbackManagedFiles
  for (const managedFile of managedFiles) {
    if (
      !managedFile
      || managedFile.startsWith("web/data/")
      || managedFile.startsWith("公众号写作/drafts/")
      || managedFile.startsWith("logs/")
      || managedFile.startsWith("web/logs/")
    ) continue
    if (!newManifest.has(managedFile)) {
      rmSync(join(serverDir, managedFile), { force: true })
    }
  }
  run("cp", ["-a", `${staging}/.`, `${serverDir}/`])
}

try {
  mkdirSync(RELEASE_DIR, { recursive: true })
  mkdirSync(SERVER_DIR, { recursive: true })
  run("git", [
    "archive",
    "--format=tar",
    "HEAD",
    "-o",
    join(TEMP_ROOT, "source.tar"),
    "--",
    ".",
    ":(exclude)node_modules",
    ":(exclude)web/node_modules",
    ":(exclude)web/dist",
    ":(exclude)web/data",
    ":(exclude)公众号写作/drafts",
    ":(exclude)logs",
    ":(exclude)web/logs",
  ])
  run("tar", ["-xf", join(TEMP_ROOT, "source.tar"), "-C", RELEASE_DIR])

  rmSync(join(RELEASE_DIR, ".env"), { force: true })
  rmSync(join(RELEASE_DIR, "web/.env"), { force: true })

  mkdirSync(join(RELEASE_DIR, "web/dist"), { recursive: true })
  writeFileSync(join(RELEASE_DIR, "web/dist/index.html"), "release-dist")
  writeFileSync(join(RELEASE_DIR, ".deploy-revision"), "test-revision\n")

  const releaseFiles = []
  const output = execFileSync("find", [".", "-type", "f", "-print"], {
    cwd: RELEASE_DIR,
    encoding: "utf8",
  })
  for (const path of output.trim().split("\n").filter(Boolean)) {
    releaseFiles.push(path.replace(/^\.\//, ""))
  }
  releaseFiles.sort()
  writeFileSync(join(RELEASE_DIR, ".deploy-manifest"), releaseFiles.join("\n") + "\n")
  run("tar", ["-czf", ARCHIVE, "-C", RELEASE_DIR, "."])

  mkdirSync(join(SERVER_DIR, "web/data"), { recursive: true })
  mkdirSync(join(SERVER_DIR, "公众号写作/drafts"), { recursive: true })
  mkdirSync(join(SERVER_DIR, "logs"), { recursive: true })
  mkdirSync(join(SERVER_DIR, "web/logs"), { recursive: true })
  writeFileSync(join(SERVER_DIR, "web/data/app.db"), "production-db")
  writeFileSync(join(SERVER_DIR, "公众号写作/drafts/article.md"), "production-draft")
  writeFileSync(join(SERVER_DIR, "logs/app.log"), "production-log")
  writeFileSync(join(SERVER_DIR, "web/logs/pm2.log"), "production-pm2-log")
  writeFileSync(join(SERVER_DIR, ".env"), "ROOT_SECRET=preserve")
  mkdirSync(join(SERVER_DIR, "web"), { recursive: true })
  writeFileSync(join(SERVER_DIR, "web/.env"), "WEB_SECRET=preserve")
  writeFileSync(join(SERVER_DIR, "web/server.ts"), "dirty-server-code")
  writeFileSync(join(SERVER_DIR, "obsolete.txt"), "remove-me")

  const protectedFiles = [
    "web/data/app.db",
    "公众号写作/drafts/article.md",
    "logs/app.log",
    "web/logs/pm2.log",
    ".env",
    "web/.env",
  ]
  const before = new Map(protectedFiles.map((path) => [path, hash(join(SERVER_DIR, path))]))

  const staging = join(TEMP_ROOT, "staging")
  mkdirSync(staging, { recursive: true })
  run("tar", ["-xzf", ARCHIVE, "-C", staging])

  for (const forbidden of ["web/data", "公众号写作/drafts", "logs", "web/logs", ".env", "web/.env"]) {
    if (existsSync(join(staging, forbidden))) {
      throw new Error(`release contains protected path: ${forbidden}`)
    }
  }

  applyRelease({
    staging,
    serverDir: SERVER_DIR,
    fallbackManagedFiles: [
      "web/server.ts",
      "obsolete.txt",
      "web/data/app.db",
      "公众号写作/drafts/article.md",
      "logs/app.log",
      "web/logs/pm2.log",
    ],
  })

  for (const path of protectedFiles) {
    if (hash(join(SERVER_DIR, path)) !== before.get(path)) {
      throw new Error(`protected file changed: ${path}`)
    }
  }
  if (readFileSync(join(SERVER_DIR, "web/server.ts"), "utf8") === "dirty-server-code") {
    throw new Error("dirty server source was not replaced")
  }
  if (existsSync(join(SERVER_DIR, "obsolete.txt"))) {
    throw new Error("obsolete managed file was not removed")
  }

  writeFileSync(join(SERVER_DIR, "obsolete-second.txt"), "remove-me-too")
  writeFileSync(
    join(SERVER_DIR, ".deploy-manifest"),
    readFileSync(join(SERVER_DIR, ".deploy-manifest"), "utf8") + "obsolete-second.txt\n",
  )
  applyRelease({ staging, serverDir: SERVER_DIR })
  if (existsSync(join(SERVER_DIR, "obsolete-second.txt"))) {
    throw new Error("manifest-managed obsolete file was not removed")
  }
  for (const path of protectedFiles) {
    if (hash(join(SERVER_DIR, path)) !== before.get(path)) {
      throw new Error(`protected file changed on manifest deploy: ${path}`)
    }
  }

  process.stdout.write("deploy release simulation passed\n")
} finally {
  rmSync(TEMP_ROOT, { recursive: true, force: true })
}
