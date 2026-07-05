/**
 * SQLite 数据库模块（better-sqlite3）
 * 替代 .cache/*.json 文件存储
 */
import Database from "better-sqlite3"
import bcrypt from "bcryptjs"
import fs from "fs"
import path from "path"
import { DATA_DIR } from "./config.ts"
import type {
  DbUserRow, DbCoverCacheRow, DbCoverHistoryRow, DbImageRow,
  DbPublishRow, DbAnalysisRow, DbTemplateRow, DbPromptRow,
  DbPromptVersionRow, DbTokenUsageRow, DbCronJobRow, DbCronLogRow,
  DbArticleScoreRow,
  CoverCache, CoverHistoryItem, ImageItem, StyleTemplate,
  Prompt, PromptVersion, AnalysisResult,
  ArticleScore, CronJob, CronLog,
} from "./types.ts"

// ── 初始化 ────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

// ── 向后兼容：自动迁移旧 .cache/ 目录下的数据到 web/data/ ─────────────────

/**
 * 如果旧的 .cache/app.db 存在且新位置不存在 app.db，自动复制迁移。
 * 同时迁移 uploads 目录和 covers 目录。
 */
function migrateFromLegacyCache(): void {
  const legacyCacheDir = path.join(DATA_DIR, "..", "..", ".cache")
  // 相对于 web/server/ 计算旧 .cache 路径（即 web/../.cache = 项目根/.cache）
  // 但实际上 config.ts 改了 DATA_DIR 为 web/data/，所以要找到旧位置
  const oldDbPath = path.join(legacyCacheDir, "app.db")
  const newDbPath = path.join(DATA_DIR, "app.db")
  const oldUploads = path.join(legacyCacheDir, "uploads")
  const newUploads = path.join(DATA_DIR, "uploads")
  const oldCovers = path.join(legacyCacheDir, "covers")
  const newCovers = path.join(DATA_DIR, "covers")

  // 迁移数据库文件
  if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
    fs.copyFileSync(oldDbPath, newDbPath)
    console.log(`[DB] 已从旧 .cache/ 迁移数据库到 data/：${oldDbPath} → ${newDbPath}`)
  }

  // 迁移 uploads 目录
  if (fs.existsSync(oldUploads) && !fs.existsSync(newUploads)) {
    fs.cpSync(oldUploads, newUploads, { recursive: true })
    console.log(`[DB] 已从旧 .cache/ 迁移 uploads 目录：${oldUploads} → ${newUploads}`)
  }

  // 迁移 covers 缓存目录
  if (fs.existsSync(oldCovers) && !fs.existsSync(newCovers)) {
    fs.cpSync(oldCovers, newCovers, { recursive: true })
    console.log(`[DB] 已从旧 .cache/ 迁移 covers 目录：${oldCovers} → ${newCovers}`)
  }
}

migrateFromLegacyCache()

const DB_PATH = path.join(DATA_DIR, "app.db")
export const db = new Database(DB_PATH)

// WAL 模式：读写并发更好
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

// ── 建表 ──────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    disabled     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cover_cache (
    cache_key   TEXT PRIMARY KEY,
    image_url   TEXT NOT NULL,
    metadata    TEXT NOT NULL,
    cached_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cover_history (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    title       TEXT NOT NULL,
    style       TEXT,
    color       TEXT,
    provider    TEXT,
    image_url   TEXT NOT NULL,
    cache_key   TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS image_library (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    title       TEXT NOT NULL,
    category    TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    provider    TEXT,
    image_url   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploaded_images (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'image/png',
    size        INTEGER NOT NULL DEFAULT 0,
    article_id  TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publish_history (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT,
    cover_image TEXT,
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT,
    article_id      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    scores          TEXT NOT NULL,
    strengths       TEXT NOT NULL,
    issues          TEXT NOT NULL,
    style_match     TEXT NOT NULL,
    top_suggestion  TEXT,
    rag_count       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS style_templates (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    accent_color TEXT,
    css          TEXT NOT NULL,
    is_builtin   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    description  TEXT,
    content      TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    tags         TEXT NOT NULL DEFAULT '[]',
    is_builtin   INTEGER NOT NULL DEFAULT 0,
    usage_count  INTEGER NOT NULL DEFAULT 0,
    replaces_id  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_versions (
    id           TEXT PRIMARY KEY,
    prompt_id    TEXT NOT NULL,
    version      INTEGER NOT NULL,
    content      TEXT NOT NULL,
    change_note  TEXT,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS token_usage (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id     TEXT,
    user_id        TEXT,
    operation      TEXT NOT NULL,
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    total_tokens   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    cron_expr       TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    topic           TEXT,
    style_prompt    TEXT,
    cover_prompt    TEXT,
    ai_config       TEXT NOT NULL DEFAULT '{}',
    wx_app_id       TEXT,
    wx_app_secret   TEXT,
    last_run_at     TEXT,
    next_run_at     TEXT,
    run_count       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS article_scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    article_id  TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT 'wechat',
    views       INTEGER,
    shares      INTEGER,
    likes       INTEGER,
    comments    INTEGER,
    composite   REAL,
    note        TEXT,
    scored_at   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(user_id, article_id, platform)
  );

  CREATE TABLE IF NOT EXISTS cron_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    topic           TEXT,
    article_title   TEXT,
    article_id      TEXT,
    media_id        TEXT,
    steps           TEXT NOT NULL DEFAULT '[]',
    error_msg       TEXT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
  );
`)

// ── 创建索引 ──────────────────────────────────────────────────────────────────

function createIndexes(): void {
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cover_history_user ON cover_history(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cover_history_created ON cover_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_image_library_user ON image_library(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_image_library_tags ON image_library(tags);
      CREATE INDEX IF NOT EXISTS idx_uploaded_images_article ON uploaded_images(article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analyses_user_article ON analyses(user_id, article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analyses_article ON analyses(article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_token_usage_article ON token_usage(article_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
      CREATE INDEX IF NOT EXISTS idx_prompts_tags ON prompts(tags);
      CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_user ON cron_jobs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON cron_logs(job_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_logs_user ON cron_logs(user_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_scores_user ON article_scores(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_article_scores_article ON article_scores(user_id, article_id);
    `)
  } catch (e: unknown) {
    console.warn("[DB] 创建索引失败:", (e as Error).message)
  }
}

// ── 迁移旧 JSON 文件数据 ─────────────────────────────────────────────────────

function addMissingColumns(): void {
  try {
    const coverHistoryInfo = db.prepare("PRAGMA table_info(cover_history)").all() as Array<{ name: string }>
    if (!coverHistoryInfo.some((col) => col.name === "user_id")) {
      db.exec("ALTER TABLE cover_history ADD COLUMN user_id TEXT")
      console.log("[DB] 添加 cover_history.user_id 列")
    }

    const imageLibraryInfo = db.prepare("PRAGMA table_info(image_library)").all() as Array<{ name: string }>
    if (!imageLibraryInfo.some((col) => col.name === "user_id")) {
      db.exec("ALTER TABLE image_library ADD COLUMN user_id TEXT")
      console.log("[DB] 添加 image_library.user_id 列")
    }

    const analysesInfo = db.prepare("PRAGMA table_info(analyses)").all() as Array<{ name: string }>
    if (!analysesInfo.some((col) => col.name === "user_id")) {
      db.exec("ALTER TABLE analyses ADD COLUMN user_id TEXT")
      console.log("[DB] 添加 analyses.user_id 列")
    }

    const promptsInfo = db.prepare("PRAGMA table_info(prompts)").all() as Array<{ name: string }>
    if (!promptsInfo.some((col) => col.name === "replaces_id")) {
      db.exec("ALTER TABLE prompts ADD COLUMN replaces_id TEXT")
      console.log("[DB] 添加 prompts.replaces_id 列")
    }

    const scoresInfo = db.prepare("PRAGMA table_info(article_scores)").all() as Array<{ name: string }>
    if (scoresInfo.length > 0 && !scoresInfo.some((col) => col.name === "comments")) {
      db.exec("ALTER TABLE article_scores ADD COLUMN comments INTEGER")
      console.log("[DB] 添加 article_scores.comments 列")
    }
  } catch (e: unknown) {
    console.warn("[DB] 添加缺失列失败:", (e as Error).message)
  }
}

interface LegacyCoverHistory {
  id: string
  title?: string
  style?: string
  color?: string
  provider?: string
  imageUrl?: string
  cacheKey?: string
  createdAt?: string
}

interface LegacyImage {
  id: string
  title?: string
  category?: string
  tags?: string[]
  provider?: string
  imageUrl?: string
  createdAt?: string
  updatedAt?: string
}

interface LegacyPublish {
  id: string
  title?: string
  status?: string
  createdAt?: string
}

interface LegacyCoverCache {
  imageUrl?: string
  metadata?: Record<string, unknown>
  cachedAt?: string
}

function migrateIfNeeded(): void {
  const legacyFiles = {
    cover_history: path.join(DATA_DIR, "cover_history.json"),
    images: path.join(DATA_DIR, "images_metadata.json"),
    publish: path.join(DATA_DIR, "publish_history.json"),
  }

  // cover_history
  if (fs.existsSync(legacyFiles.cover_history)) {
    const count = (db.prepare("SELECT COUNT(*) as c FROM cover_history").get() as { c: number }).c
    if (count === 0) {
      try {
        const history: LegacyCoverHistory[] = JSON.parse(fs.readFileSync(legacyFiles.cover_history, "utf-8"))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO cover_history (id, title, style, color, provider, image_url, cache_key, created_at)
          VALUES (@id, @title, @style, @color, @provider, @image_url, @cache_key, @created_at)
        `)
        const many = db.transaction((rows: LegacyCoverHistory[]) => rows.forEach((r) => ins.run({
          id: r.id,
          title: r.title || "",
          style: r.style || "",
          color: r.color || "",
          provider: r.provider || "",
          image_url: r.imageUrl || "",
          cache_key: r.cacheKey || "",
          created_at: r.createdAt || new Date().toISOString(),
        })))
        many(history)
        console.log(`[DB] 迁移 cover_history：${history.length} 条`)
      } catch (e: unknown) {
        console.warn("[DB] cover_history 迁移失败:", (e as Error).message)
      }
    }
  }

  // images_metadata.json
  if (fs.existsSync(legacyFiles.images)) {
    const count = (db.prepare("SELECT COUNT(*) as c FROM image_library").get() as { c: number }).c
    if (count === 0) {
      try {
        const images: LegacyImage[] = JSON.parse(fs.readFileSync(legacyFiles.images, "utf-8"))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO image_library (id, title, category, tags, provider, image_url, created_at, updated_at)
          VALUES (@id, @title, @category, @tags, @provider, @image_url, @created_at, @updated_at)
        `)
        const many = db.transaction((rows: LegacyImage[]) => rows.forEach((r) => ins.run({
          id: r.id,
          title: r.title || "",
          category: r.category || "",
          tags: JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
          provider: r.provider || "",
          image_url: r.imageUrl || "",
          created_at: r.createdAt || new Date().toISOString(),
          updated_at: r.updatedAt || new Date().toISOString(),
        })))
        many(images)
        console.log(`[DB] 迁移 image_library：${images.length} 条`)
      } catch (e: unknown) {
        console.warn("[DB] image_library 迁移失败:", (e as Error).message)
      }
    }
  }

  // publish_history.json
  if (fs.existsSync(legacyFiles.publish)) {
    const count = (db.prepare("SELECT COUNT(*) as c FROM publish_history").get() as { c: number }).c
    if (count === 0) {
      try {
        const history: LegacyPublish[] = JSON.parse(fs.readFileSync(legacyFiles.publish, "utf-8"))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO publish_history (id, title, status, created_at)
          VALUES (@id, @title, @status, @created_at)
        `)
        const many = db.transaction((rows: LegacyPublish[]) => rows.forEach((r) => ins.run({
          id: r.id,
          title: r.title || "",
          status: r.status || "draft",
          created_at: r.createdAt || new Date().toISOString(),
        })))
        many(history)
        console.log(`[DB] 迁移 publish_history：${history.length} 条`)
      } catch (e: unknown) {
        console.warn("[DB] publish_history 迁移失败:", (e as Error).message)
      }
    }
  }

  // cover_cache
  const coversDir = path.join(DATA_DIR, "covers")
  if (fs.existsSync(coversDir)) {
    const count = (db.prepare("SELECT COUNT(*) as c FROM cover_cache").get() as { c: number }).c
    if (count === 0) {
      try {
        const files = fs.readdirSync(coversDir).filter((f) => f.endsWith(".json"))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO cover_cache (cache_key, image_url, metadata, cached_at)
          VALUES (@cache_key, @image_url, @metadata, @cached_at)
        `)
        const many = db.transaction((items: Array<{ cache_key: string; image_url: string; metadata: string; cached_at: string }>) => items.forEach((i) => ins.run(i)))
        const items: Array<{ cache_key: string; image_url: string; metadata: string; cached_at: string }> = []
        for (const f of files) {
          try {
            const data: LegacyCoverCache = JSON.parse(fs.readFileSync(path.join(coversDir, f), "utf-8"))
            items.push({
              cache_key: f.replace(".json", ""),
              image_url: data.imageUrl || "",
              metadata: JSON.stringify(data.metadata || {}),
              cached_at: data.cachedAt || new Date().toISOString(),
            })
          } catch { /* skip */ }
        }
        many(items)
        console.log(`[DB] 迁移 cover_cache：${items.length} 条`)
      } catch (e: unknown) {
        console.warn("[DB] cover_cache 迁移失败:", (e as Error).message)
      }
    }
  }
}

addMissingColumns()
createIndexes()
migrateIfNeeded()

// ── 初始化 admin 账号 ─────────────────────────────────────────────────────────

function seedAdminUser(): void {
  const existing = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get() as { id: string } | undefined
  if (existing) return

  const hash = bcrypt.hashSync("admin123", 10)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, disabled, created_at)
    VALUES (?, ?, ?, 'admin', 0, ?)
  `).run("admin", "admin", hash, new Date().toISOString())
  console.log("[DB] 已创建默认管理员账号 admin / admin123，请登录后立即修改密码")
}

seedAdminUser()

// ── Users API ─────────────────────────────────────────────────────────────────

export function findUserByUsername(username: string): DbUserRow | null {
  return (db.prepare("SELECT * FROM users WHERE username = ?").get(username) as DbUserRow) || null
}

export function findUserById(id: string): DbUserRow | null {
  return (db.prepare("SELECT id, username, role, disabled, created_at FROM users WHERE id = ?").get(id) as DbUserRow) || null
}

export function createUser(id: string, username: string, passwordHash: string, role = "user"): void {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, disabled, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, username, passwordHash, role, new Date().toISOString())
}

export function listUsers(): DbUserRow[] {
  return db.prepare("SELECT id, username, role, disabled, created_at FROM users ORDER BY created_at ASC").all() as DbUserRow[]
}

export function setUserDisabled(id: string, disabled: boolean): void {
  db.prepare("UPDATE users SET disabled=? WHERE id=?").run(disabled ? 1 : 0, id)
}

export function updateUserPassword(id: string, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash, id)
}

export function deleteUser(id: string): void {
  db.prepare("DELETE FROM users WHERE id=?").run(id)
}

// ── 预编译语句 ────────────────────────────────────────────────────────────────

const stmts = {
  insertPrompt: db.prepare(`
    INSERT OR REPLACE INTO prompts (id, name, category, description, content, version, tags, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listPrompts: db.prepare("SELECT * FROM prompts ORDER BY category, created_at DESC"),
  getPrompt: db.prepare("SELECT * FROM prompts WHERE id = ?"),
  deletePrompt: db.prepare("DELETE FROM prompts WHERE id = ? AND is_builtin = 0"),
  updatePromptContent: db.prepare("UPDATE prompts SET content = ?, version = version + 1, updated_at = ? WHERE id = ?"),
  updatePromptUsage: db.prepare("UPDATE prompts SET usage_count = usage_count + 1 WHERE id = ?"),
  listPromptsByCategory: db.prepare("SELECT * FROM prompts WHERE category = ? ORDER BY created_at DESC"),

  insertPromptVersion: db.prepare(`
    INSERT INTO prompt_versions (id, prompt_id, version, content, change_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listPromptVersions: db.prepare("SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC"),
  getPromptVersion: db.prepare("SELECT * FROM prompt_versions WHERE prompt_id = ? AND version = ?"),

  getCoverCache: db.prepare("SELECT image_url, metadata, cached_at FROM cover_cache WHERE cache_key = ?"),
  setCoverCache: db.prepare(`
    INSERT OR REPLACE INTO cover_cache (cache_key, image_url, metadata, cached_at)
    VALUES (?, ?, ?, ?)
  `),
  countCoverCache: db.prepare("SELECT COUNT(*) as c FROM cover_cache"),

  insertCoverHistory: db.prepare(`
    INSERT INTO cover_history (id, title, style, color, provider, image_url, cache_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listCoverHistory: db.prepare("SELECT * FROM cover_history ORDER BY created_at DESC LIMIT 200"),
  deleteCoverHistory: db.prepare("DELETE FROM cover_history WHERE id = ?"),
  clearCoverHistory: db.prepare("DELETE FROM cover_history"),

  insertImage: db.prepare(`
    INSERT OR REPLACE INTO image_library (id, title, category, tags, provider, image_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listImages: db.prepare("SELECT * FROM image_library ORDER BY created_at DESC"),
  deleteImage: db.prepare("DELETE FROM image_library WHERE id = ?"),
  updateImage: db.prepare(`
    UPDATE image_library SET title=?, category=?, tags=?, updated_at=? WHERE id=?
  `),

  insertPublish: db.prepare(`
    INSERT OR REPLACE INTO publish_history (id, title, content, cover_image, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listPublish: db.prepare("SELECT id, title, status, created_at FROM publish_history ORDER BY created_at DESC LIMIT 100"),
  deletePublish: db.prepare("DELETE FROM publish_history WHERE id = ?"),
  getPublishById: db.prepare("SELECT * FROM publish_history WHERE id = ?"),

  insertAnalysis: db.prepare(`
    INSERT INTO analyses (article_id, created_at, scores, strengths, issues, style_match, top_suggestion, rag_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listAnalyses: db.prepare(`
    SELECT id, article_id, created_at, scores, top_suggestion, rag_count
    FROM analyses WHERE article_id = ? ORDER BY created_at DESC LIMIT 20
  `),
  getLatestAnalysis: db.prepare(`
    SELECT * FROM analyses WHERE article_id = ? ORDER BY created_at DESC LIMIT 1
  `),

  insertTemplate: db.prepare(`
    INSERT OR REPLACE INTO style_templates (id, name, description, accent_color, css, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listTemplates: db.prepare("SELECT * FROM style_templates ORDER BY is_builtin DESC, created_at ASC"),
  deleteTemplate: db.prepare("DELETE FROM style_templates WHERE id = ? AND is_builtin = 0"),
  getTemplate: db.prepare("SELECT * FROM style_templates WHERE id = ?"),

  getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
  setSetting: db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  `),
  getAllSettings: db.prepare("SELECT key, value FROM settings"),
}

// ── 封面缓存 ──────────────────────────────────────────────────────────────────

export function getCoverCache(cacheKey: string): CoverCache | null {
  const row = stmts.getCoverCache.get(cacheKey) as DbCoverCacheRow | undefined
  if (!row) return null
  return { imageUrl: row.image_url, metadata: JSON.parse(row.metadata), cachedAt: row.cached_at }
}

export function setCoverCache(cacheKey: string, imageUrl: string, metadata: Record<string, unknown>): void {
  stmts.setCoverCache.run(cacheKey, imageUrl, JSON.stringify(metadata), new Date().toISOString())
}

export function getCoverCacheCount(): number {
  return (stmts.countCoverCache.get() as { c: number }).c
}

// ── 封面历史 ──────────────────────────────────────────────────────────────────

export function addCoverHistory(title: string, style: string, color: string, provider: string, imageUrl: string, cacheKey: string): CoverHistoryItem {
  const id = Date.now().toString()
  const now = new Date().toISOString()
  stmts.insertCoverHistory.run(id, title, style, color, provider, imageUrl, cacheKey, now)
  return { id, title, style, color, provider, imageUrl, cacheKey, createdAt: now }
}

export function listCoverHistory(): CoverHistoryItem[] {
  return (stmts.listCoverHistory.all() as DbCoverHistoryRow[]).map((r) => ({
    id: r.id, title: r.title, style: r.style, color: r.color,
    provider: r.provider, imageUrl: r.image_url, cacheKey: r.cache_key,
    createdAt: r.created_at,
  }))
}

export function deleteCoverHistory(id: string): void {
  stmts.deleteCoverHistory.run(id)
}

export function clearCoverHistory(): void {
  stmts.clearCoverHistory.run()
}

// ── 图片库 ────────────────────────────────────────────────────────────────────

export function addImageToLibrary(imageUrl: string, title: string, category: string, tags: string[], provider: string): ImageItem {
  const id = Date.now().toString()
  const now = new Date().toISOString()
  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])
  stmts.insertImage.run(id, title, category, tagsJson, provider, imageUrl, now, now)
  return { id, title, category, tags: Array.isArray(tags) ? tags : [], provider, imageUrl, createdAt: now, updatedAt: now }
}

export function listImages({ category, tags }: { category?: string; tags?: string[] } = {}): ImageItem[] {
  let rows = stmts.listImages.all() as DbImageRow[]
  if (category) rows = rows.filter((r) => r.category === category)
  if (tags?.length) rows = rows.filter((r) => {
    const t: string[] = JSON.parse(r.tags || "[]")
    return tags.some((tag) => t.includes(tag))
  })
  return rows.map((r) => ({
    id: r.id, title: r.title, category: r.category,
    tags: JSON.parse(r.tags || "[]") as string[], provider: r.provider,
    imageUrl: r.image_url, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function deleteImage(id: string): void {
  stmts.deleteImage.run(id)
}

export function updateImage(id: string, { title, category, tags }: { title: string; category: string; tags: string[] }): ImageItem | null {
  stmts.updateImage.run(title, category, JSON.stringify(Array.isArray(tags) ? tags : []), new Date().toISOString(), id)
  const row = db.prepare("SELECT * FROM image_library WHERE id = ?").get(id) as DbImageRow | undefined
  if (!row) return null
  return { id: row.id, title: row.title, category: row.category, tags: JSON.parse(row.tags || "[]") as string[], provider: row.provider, imageUrl: row.image_url, createdAt: row.created_at, updatedAt: row.updated_at }
}

// ── 发布历史 ──────────────────────────────────────────────────────────────────

export function addPublishHistory(title: string, content: string | null, coverImage: string | null) {
  const id = Date.now().toString()
  const now = new Date().toISOString()
  stmts.insertPublish.run(id, title, content || "", coverImage || "", "draft", now)
  return { id, title, content, coverImage, status: "draft", createdAt: now }
}

export function listPublishHistory() {
  return (stmts.listPublish.all() as DbPublishRow[]).map((r) => ({
    id: r.id, title: r.title, status: r.status, createdAt: r.created_at,
  }))
}

export function deletePublishHistory(id: string): void {
  stmts.deletePublish.run(id)
}

export function getPublishById(id: string) {
  const row = stmts.getPublishById.get(id) as DbPublishRow | undefined
  if (!row) return null
  return { id: row.id, title: row.title, content: row.content, coverImage: row.cover_image, status: row.status, createdAt: row.created_at }
}

// ── 分析结果 ──────────────────────────────────────────────────────────────────

export function saveAnalysis(articleId: string, result: AnalysisResult): void {
  const now = new Date().toISOString()
  stmts.insertAnalysis.run(
    articleId, now,
    JSON.stringify(result.scores || {}),
    JSON.stringify(result.strengths || []),
    JSON.stringify(result.issues || []),
    JSON.stringify(result.styleMatch || {}),
    result.topSuggestion || "",
    result.ragCount || 0,
  )
}

export function getLatestAnalysis(articleId: string): AnalysisResult | null {
  const row = stmts.getLatestAnalysis.get(articleId) as DbAnalysisRow | undefined
  if (!row) return null
  return {
    id: row.id, articleId: row.article_id, createdAt: row.created_at,
    scores: JSON.parse(row.scores),
    strengths: JSON.parse(row.strengths),
    issues: JSON.parse(row.issues),
    styleMatch: JSON.parse(row.style_match),
    topSuggestion: row.top_suggestion || "",
    ragCount: row.rag_count,
  }
}

export function listAnalyses(articleId: string) {
  return (stmts.listAnalyses.all(articleId) as DbAnalysisRow[]).map((r) => ({
    id: r.id, articleId: r.article_id, createdAt: r.created_at,
    scores: JSON.parse(r.scores),
    topSuggestion: r.top_suggestion,
    ragCount: r.rag_count,
  }))
}

// ── CSS 模板 ──────────────────────────────────────────────────────────────────

export function upsertTemplate(t: StyleTemplate): void {
  stmts.insertTemplate.run(
    t.id, t.name, t.desc || "", t.accentColor || "",
    t.css, t.isBuiltin ? 1 : 0, t.createdAt || Date.now(), t.updatedAt || Date.now(),
  )
}

export function listTemplates(): StyleTemplate[] {
  return (stmts.listTemplates.all() as DbTemplateRow[]).map((r) => ({
    id: r.id, name: r.name, desc: r.description || "", accentColor: r.accent_color || "",
    css: r.css, isBuiltin: r.is_builtin === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function deleteTemplate(id: string): void {
  stmts.deleteTemplate.run(id)
}

export function getTemplate(id: string): StyleTemplate | null {
  const row = stmts.getTemplate.get(id) as DbTemplateRow | undefined
  if (!row) return null
  return { id: row.id, name: row.name, desc: row.description || "", accentColor: row.accent_color || "", css: row.css, isBuiltin: row.is_builtin === 1, createdAt: row.created_at, updatedAt: row.updated_at }
}

// ── 设置（键值对） ────────────────────────────────────────────────────────────

export function getSetting(key: string): unknown {
  const row = stmts.getSetting.get(key) as { value: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}

export function setSetting(key: string, value: unknown): void {
  stmts.setSetting.run(key, JSON.stringify(value), new Date().toISOString())
}

export function getAllSettings(): Record<string, unknown> {
  const rows = stmts.getAllSettings.all() as Array<{ key: string; value: string }>
  return Object.fromEntries(rows.map((r) => {
    try { return [r.key, JSON.parse(r.value)] } catch { return [r.key, r.value] }
  }))
}

// ── Token 使用统计 ────────────────────────────────────────────────────────────

interface TokenUsageInput {
  articleId?: string
  userId?: string
  operation: string
  model: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export function recordTokenUsage({ articleId, userId, operation, model, inputTokens = 0, outputTokens = 0, totalTokens = 0 }: TokenUsageInput): void {
  try {
    db.prepare(`
      INSERT INTO token_usage (article_id, user_id, operation, model, input_tokens, output_tokens, total_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      articleId || null,
      userId || null,
      operation,
      model,
      inputTokens,
      outputTokens,
      totalTokens || (inputTokens + outputTokens),
      new Date().toISOString(),
    )
  } catch (e: unknown) {
    console.warn("[DB] token_usage 写入失败:", (e as Error).message)
  }
}

interface TokenUsageByOperation {
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  call_count: number
}

interface TokenUsageByDay {
  day: string
  total_tokens: number
  call_count: number
}

interface TokenUsageTotals {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  call_count: number
  active_days: number
}

export function getTokenUsageSummary(userId: string, days = 30): { byOperation: TokenUsageByOperation[]; byDay: TokenUsageByDay[]; totals: TokenUsageTotals } {
  const byOperation = db.prepare(`
    SELECT operation, model,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(total_tokens) AS total_tokens,
           COUNT(*) AS call_count
    FROM token_usage
    WHERE user_id = ?
      AND created_at >= datetime('now', ? || ' days')
    GROUP BY operation, model
    ORDER BY total_tokens DESC
  `).all(userId, `-${days}`) as TokenUsageByOperation[]

  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) AS day,
           SUM(total_tokens) AS total_tokens,
           COUNT(*) AS call_count
    FROM token_usage
    WHERE user_id = ?
      AND created_at >= datetime('now', ? || ' days')
    GROUP BY day
    ORDER BY day ASC
  `).all(userId, `-${days}`) as TokenUsageByDay[]

  const totals = db.prepare(`
    SELECT SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(total_tokens) AS total_tokens,
           COUNT(*) AS call_count,
           COUNT(DISTINCT DATE(created_at)) AS active_days
    FROM token_usage
    WHERE user_id = ?
      AND created_at >= datetime('now', ? || ' days')
  `).get(userId, `-${days}`) as TokenUsageTotals

  return { byOperation, byDay, totals }
}

// ── 上传图片管理 ──────────────────────────────────────────────────────────────

interface UploadImageInput {
  id: string
  filename: string
  originalName: string
  mimeType?: string
  size?: number
  articleId?: string
}

interface UploadImageRow {
  id: string
  filename: string
  original_name: string
  mime_type: string
  size: number
  article_id: string | null
  created_at: string
}

export function addUploadedImage({ id, filename, originalName, mimeType, size, articleId }: UploadImageInput) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO uploaded_images (id, filename, original_name, mime_type, size, article_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, filename, originalName, mimeType || "image/png", size || 0, articleId || null, now)
  return { id, filename, originalName, mimeType, size, articleId, createdAt: now }
}

export function listUploadedImages({ articleId }: { articleId?: string } = {}) {
  if (articleId) {
    return (db.prepare("SELECT * FROM uploaded_images WHERE article_id = ? ORDER BY created_at DESC").all(articleId) as UploadImageRow[])
      .map((r) => ({ id: r.id, filename: r.filename, originalName: r.original_name, mimeType: r.mime_type, size: r.size, articleId: r.article_id, createdAt: r.created_at }))
  }
  return (db.prepare("SELECT * FROM uploaded_images ORDER BY created_at DESC LIMIT 200").all() as UploadImageRow[])
    .map((r) => ({ id: r.id, filename: r.filename, originalName: r.original_name, mimeType: r.mime_type, size: r.size, articleId: r.article_id, createdAt: r.created_at }))
}

export function deleteUploadedImage(id: string): string | null {
  const row = db.prepare("SELECT filename FROM uploaded_images WHERE id = ?").get(id) as { filename: string } | undefined
  db.prepare("DELETE FROM uploaded_images WHERE id = ?").run(id)
  return row ? row.filename : null
}

// ── 提示词管理 ────────────────────────────────────────────────────────────────

interface UpsertPromptInput {
  id: string
  name: string
  category: string
  description?: string
  content: string
  tags?: string[]
  isBuiltin?: boolean
}

export function upsertPrompt({ id, name, category, description, content, tags = [], isBuiltin = false }: UpsertPromptInput) {
  const now = new Date().toISOString()
  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])
  stmts.insertPrompt.run(id, name, category, description || "", content, 1, tagsJson, isBuiltin ? 1 : 0, now, now)
  return { id, name, category, description, content, version: 1, tags, isBuiltin, usageCount: 0, createdAt: now, updatedAt: now }
}

function parseTags(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return raw.split(",").map((t) => t.trim()).filter(Boolean)
  }
}

export function listPrompts(): Prompt[] {
  return (stmts.listPrompts.all() as DbPromptRow[]).map((r) => ({
    id: r.id, name: r.name, category: r.category, description: r.description || "",
    content: r.content, version: r.version, tags: parseTags(r.tags),
    isBuiltin: r.is_builtin === 1, usageCount: r.usage_count, replacesId: r.replaces_id || null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function listPromptsByCategory(category: string): Prompt[] {
  return (stmts.listPromptsByCategory.all(category) as DbPromptRow[]).map((r) => ({
    id: r.id, name: r.name, category: r.category, description: r.description || "",
    content: r.content, version: r.version, tags: parseTags(r.tags),
    isBuiltin: r.is_builtin === 1, usageCount: r.usage_count, replacesId: r.replaces_id || null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function getPrompt(id: string): Prompt | null {
  const row = stmts.getPrompt.get(id) as DbPromptRow | undefined
  if (!row) return null
  return {
    id: row.id, name: row.name, category: row.category, description: row.description || "",
    content: row.content, version: row.version, tags: parseTags(row.tags),
    isBuiltin: row.is_builtin === 1, usageCount: row.usage_count, replacesId: row.replaces_id || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function updatePromptContent(id: string, content: string, changeNote = ""): Prompt | null {
  const prompt = stmts.getPrompt.get(id) as DbPromptRow | undefined
  if (!prompt) return null

  const versionId = `${id}_v${prompt.version}`
  stmts.insertPromptVersion.run(versionId, id, prompt.version, prompt.content, changeNote, new Date().toISOString())

  const now = new Date().toISOString()
  stmts.updatePromptContent.run(content, now, id)

  return getPrompt(id)
}

export function deletePrompt(id: string): void {
  stmts.deletePrompt.run(id)
}

export function recordPromptUsage(id: string): void {
  stmts.updatePromptUsage.run(id)
}

export function listPromptVersions(promptId: string): PromptVersion[] {
  return (stmts.listPromptVersions.all(promptId) as DbPromptVersionRow[]).map((r) => ({
    id: r.id, promptId: r.prompt_id, version: r.version,
    content: r.content, changeNote: r.change_note, createdAt: r.created_at,
  }))
}

export function getPromptVersion(promptId: string, version: number): PromptVersion | null {
  const row = stmts.getPromptVersion.get(promptId, version) as DbPromptVersionRow | undefined
  if (!row) return null
  return {
    id: row.id, promptId: row.prompt_id, version: row.version,
    content: row.content, changeNote: row.change_note, createdAt: row.created_at,
  }
}

export function getEffectivePrompt(builtinId: string): { id: string; content: string; isReplacement: boolean } | null {
  const replacement = db.prepare(
    "SELECT * FROM prompts WHERE replaces_id = ? LIMIT 1"
  ).get(builtinId) as DbPromptRow | undefined

  if (replacement) {
    return {
      id: replacement.id,
      content: replacement.content,
      isReplacement: true,
    }
  }

  const builtin = stmts.getPrompt.get(builtinId) as DbPromptRow | undefined
  if (!builtin) return null

  return {
    id: builtin.id,
    content: builtin.content,
    isReplacement: false,
  }
}

// ── 文章评分 ──────────────────────────────────────────────────────────────────

interface SaveArticleScoreInput {
  userId: string
  articleId: string
  title: string
  platform?: string
  views?: number | null
  shares?: number | null
  likes?: number | null
  comments?: number | null
  composite?: number | null
  note?: string | null
}

function _mapScoreRow(row: DbArticleScoreRow): ArticleScore {
  return {
    id: row.id,
    userId: row.user_id,
    articleId: row.article_id,
    title: row.title,
    platform: row.platform as "wechat" | "toutiao",
    views: row.views,
    shares: row.shares,
    likes: row.likes,
    comments: row.comments,
    composite: row.composite,
    note: row.note,
    scoredAt: row.scored_at,
    createdAt: row.created_at,
  }
}

export function saveArticleScore({ userId, articleId, title, platform = "wechat", views, shares, likes, comments, composite, note }: SaveArticleScoreInput): ArticleScore | null {
  const now = new Date().toISOString()

  let calcComposite = composite
  if (calcComposite == null) {
    const v = Math.min((views || 0) / 10000, 1) * 40
    const l = Math.min((likes || 0) / 500, 1) * 30
    const s = Math.min((shares || 0) / 200, 1) * 20
    const c = Math.min((comments || 0) / 100, 1) * 10
    calcComposite = parseFloat((v + l + s + c).toFixed(1))
  }

  db.prepare(`
    INSERT INTO article_scores (user_id, article_id, title, platform, views, shares, likes, comments, composite, note, scored_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_id, platform) DO UPDATE SET
      title      = excluded.title,
      views      = excluded.views,
      shares     = excluded.shares,
      likes      = excluded.likes,
      comments   = excluded.comments,
      composite  = excluded.composite,
      note       = excluded.note,
      scored_at  = excluded.scored_at
  `).run(
    userId, articleId, title || "", platform,
    views ?? null, shares ?? null, likes ?? null, comments ?? null,
    calcComposite, note || null, now, now
  )

  return getArticleScore(userId, articleId, platform)
}

export function getArticleScore(userId: string, articleId: string, platform = "wechat"): ArticleScore | null {
  const row = db.prepare(
    "SELECT * FROM article_scores WHERE user_id=? AND article_id=? AND platform=?"
  ).get(userId, articleId, platform) as DbArticleScoreRow | undefined
  if (!row) return null
  return _mapScoreRow(row)
}

export function getArticleScores(userId: string, articleId: string): ArticleScore[] {
  return (db.prepare(
    "SELECT * FROM article_scores WHERE user_id=? AND article_id=? ORDER BY platform"
  ).all(userId, articleId) as DbArticleScoreRow[]).map(_mapScoreRow)
}

export function listArticleScores(userId: string): ArticleScore[] {
  return (db.prepare(
    "SELECT * FROM article_scores WHERE user_id=? ORDER BY composite DESC, created_at DESC"
  ).all(userId) as DbArticleScoreRow[]).map(_mapScoreRow)
}

export function deleteArticleScore(userId: string, articleId: string, platform: string): void {
  db.prepare(
    "DELETE FROM article_scores WHERE user_id=? AND article_id=? AND platform=?"
  ).run(userId, articleId, platform)
}

export function getExampleArticles(userId: string, { goodThreshold = 70, badThreshold = 30, maxEach = 3 }: {
  goodThreshold?: number
  badThreshold?: number
  maxEach?: number
} = {}): { good: ArticleScore[]; bad: ArticleScore[] } {
  const good = (db.prepare(`
    SELECT * FROM article_scores
    WHERE user_id=? AND composite >= ?
    ORDER BY composite DESC LIMIT ?
  `).all(userId, goodThreshold, maxEach) as DbArticleScoreRow[]).map(_mapScoreRow)

  const bad = (db.prepare(`
    SELECT * FROM article_scores
    WHERE user_id=? AND composite <= ?
    ORDER BY composite ASC LIMIT ?
  `).all(userId, badThreshold, maxEach) as DbArticleScoreRow[]).map(_mapScoreRow)

  return { good, bad }
}

// ── Cron 任务管理 ─────────────────────────────────────────────────────────────

export function listCronJobs(userId: string): CronJob[] {
  return (db.prepare("SELECT * FROM cron_jobs WHERE user_id = ? ORDER BY created_at DESC").all(userId) as DbCronJobRow[]).map((r) => ({
    id: r.id, userId: r.user_id, name: r.name, cronExpr: r.cron_expr,
    enabled: r.enabled === 1, topic: r.topic, stylePrompt: r.style_prompt,
    coverPrompt: r.cover_prompt,
    aiConfig: (() => { try { return JSON.parse(r.ai_config) as Record<string, unknown> } catch { return {} } })(),
    wxAppId: r.wx_app_id, wxAppSecret: r.wx_app_secret,
    lastRunAt: r.last_run_at, nextRunAt: r.next_run_at,
    runCount: r.run_count, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function getCronJob(id: string): CronJob | null {
  const r = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as DbCronJobRow | undefined
  if (!r) return null
  return {
    id: r.id, userId: r.user_id, name: r.name, cronExpr: r.cron_expr,
    enabled: r.enabled === 1, topic: r.topic, stylePrompt: r.style_prompt,
    coverPrompt: r.cover_prompt,
    aiConfig: (() => { try { return JSON.parse(r.ai_config) as Record<string, unknown> } catch { return {} } })(),
    wxAppId: r.wx_app_id, wxAppSecret: r.wx_app_secret,
    lastRunAt: r.last_run_at, nextRunAt: r.next_run_at,
    runCount: r.run_count, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function createCronJob({ id, userId, name, cronExpr, enabled = true, topic, stylePrompt, coverPrompt, aiConfig = {}, wxAppId, wxAppSecret, nextRunAt }: {
  id: string
  userId: string
  name: string
  cronExpr: string
  enabled?: boolean
  topic?: string | null
  stylePrompt?: string | null
  coverPrompt?: string | null
  aiConfig?: Record<string, unknown>
  wxAppId?: string | null
  wxAppSecret?: string | null
  nextRunAt?: string | null
}): CronJob | null {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO cron_jobs (id, user_id, name, cron_expr, enabled, topic, style_prompt, cover_prompt, ai_config, wx_app_id, wx_app_secret, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, cronExpr, enabled ? 1 : 0, topic || null, stylePrompt || null, coverPrompt || null, JSON.stringify(aiConfig), wxAppId || null, wxAppSecret || null, nextRunAt || null, now, now)
  return getCronJob(id)
}

export function updateCronJob(id: string, update: {
  name?: string
  cronExpr?: string
  enabled?: boolean
  topic?: string | null
  stylePrompt?: string | null
  coverPrompt?: string | null
  aiConfig?: Record<string, unknown>
  wxAppId?: string | null
  wxAppSecret?: string | null
  nextRunAt?: string | null
}): CronJob | null {
  const now = new Date().toISOString()
  const fields: string[] = []
  const vals: unknown[] = []
  if (update.name !== undefined) { fields.push("name = ?"); vals.push(update.name) }
  if (update.cronExpr !== undefined) { fields.push("cron_expr = ?"); vals.push(update.cronExpr) }
  if (update.enabled !== undefined) { fields.push("enabled = ?"); vals.push(update.enabled ? 1 : 0) }
  if (update.topic !== undefined) { fields.push("topic = ?"); vals.push(update.topic || null) }
  if (update.stylePrompt !== undefined) { fields.push("style_prompt = ?"); vals.push(update.stylePrompt || null) }
  if (update.coverPrompt !== undefined) { fields.push("cover_prompt = ?"); vals.push(update.coverPrompt || null) }
  if (update.aiConfig !== undefined) { fields.push("ai_config = ?"); vals.push(JSON.stringify(update.aiConfig)) }
  if (update.wxAppId !== undefined) { fields.push("wx_app_id = ?"); vals.push(update.wxAppId || null) }
  if (update.wxAppSecret !== undefined) { fields.push("wx_app_secret = ?"); vals.push(update.wxAppSecret || null) }
  if (update.nextRunAt !== undefined) { fields.push("next_run_at = ?"); vals.push(update.nextRunAt || null) }
  fields.push("updated_at = ?"); vals.push(now)
  vals.push(id)
  if (fields.length > 1) db.prepare(`UPDATE cron_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...vals)
  return getCronJob(id)
}

export function deleteCronJob(id: string): void {
  db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id)
}

export function updateCronJobRunStats(id: string, { lastRunAt, nextRunAt, runCount }: { lastRunAt: string; nextRunAt: string | null; runCount: number }): void {
  db.prepare("UPDATE cron_jobs SET last_run_at = ?, next_run_at = ?, run_count = ?, updated_at = ? WHERE id = ?")
    .run(lastRunAt, nextRunAt, runCount, new Date().toISOString(), id)
}

// ── Cron 执行日志 ─────────────────────────────────────────────────────────────

export function createCronLog({ jobId, userId, topic }: { jobId: string; userId: string; topic?: string | null }): number {
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO cron_logs (job_id, user_id, status, topic, steps, started_at)
    VALUES (?, ?, 'running', ?, '[]', ?)
  `).run(jobId, userId, topic || null, now)
  return Number(result.lastInsertRowid)
}

export function updateCronLog(logId: number, update: {
  status?: string
  topic?: string | null
  articleTitle?: string | null
  articleId?: string | null
  mediaId?: string | null
  steps?: unknown[]
  errorMsg?: string | null
  finishedAt?: string | null
}): void {
  const fields: string[] = []
  const vals: unknown[] = []
  if (update.status !== undefined) { fields.push("status = ?"); vals.push(update.status) }
  if (update.topic !== undefined) { fields.push("topic = ?"); vals.push(update.topic) }
  if (update.articleTitle !== undefined) { fields.push("article_title = ?"); vals.push(update.articleTitle) }
  if (update.articleId !== undefined) { fields.push("article_id = ?"); vals.push(update.articleId) }
  if (update.mediaId !== undefined) { fields.push("media_id = ?"); vals.push(update.mediaId) }
  if (update.steps !== undefined) { fields.push("steps = ?"); vals.push(JSON.stringify(update.steps)) }
  if (update.errorMsg !== undefined) { fields.push("error_msg = ?"); vals.push(update.errorMsg) }
  if (update.finishedAt !== undefined) { fields.push("finished_at = ?"); vals.push(update.finishedAt) }
  if (!fields.length) return
  vals.push(logId)
  db.prepare(`UPDATE cron_logs SET ${fields.join(", ")} WHERE id = ?`).run(...vals)
}

export function listCronLogs(jobId: string, limit = 20): CronLog[] {
  return (db.prepare("SELECT * FROM cron_logs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?").all(jobId, limit) as DbCronLogRow[]).map((r) => ({
    id: r.id, jobId: r.job_id, userId: r.user_id, status: r.status as "running" | "success" | "error",
    topic: r.topic, articleTitle: r.article_title, articleId: r.article_id, mediaId: r.media_id,
    steps: (() => { try { return JSON.parse(r.steps) as CronLog["steps"] } catch { return [] } })(),
    errorMsg: r.error_msg, startedAt: r.started_at, finishedAt: r.finished_at,
  })) as CronLog[]
}

export function listAllCronLogs(userId: string, limit = 50): CronLog[] {
  return (db.prepare("SELECT * FROM cron_logs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?").all(userId, limit) as DbCronLogRow[]).map((r) => ({
    id: r.id, jobId: r.job_id, userId: r.user_id, status: r.status as "running" | "success" | "error",
    topic: r.topic, articleTitle: r.article_title, articleId: r.article_id, mediaId: r.media_id,
    steps: (() => { try { return JSON.parse(r.steps) as CronLog["steps"] } catch { return [] } })(),
    errorMsg: r.error_msg, startedAt: r.started_at, finishedAt: r.finished_at,
  })) as CronLog[]
}

console.log(`[DB] SQLite 已连接：${DB_PATH}`)
