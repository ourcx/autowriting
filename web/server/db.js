/**
 * SQLite 数据库模块（better-sqlite3）
 * 替代 .cache/*.json 文件存储
 *
 * 表：
 *   users           用户账号（id/username/password_hash/role/disabled/created_at）
 *   cover_cache     封面缓存（替代 .cache/covers/*.json）
 *   cover_history   封面生成历史（替代 cover_history.json）
 *   image_library   图片库元数据（替代 images_metadata.json）
 *   publish_history 发布历史（替代 publish_history.json）
 *   analyses        AI 分析结果（新增）
 *   style_templates CSS 模板（替代 localStorage wx-style-templates-v1）
 *   settings        键值配置（替代 localStorage wx-ai-config-v1）
 */
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import { DATA_DIR } from './config.js'

// ── 初始化 ────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = path.join(DATA_DIR, 'app.db')
export const db = new Database(DB_PATH)

// WAL 模式：读写并发更好
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── 建表 ──────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    disabled     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cover_cache (
    cache_key   TEXT PRIMARY KEY,
    image_url   TEXT NOT NULL,
    metadata    TEXT NOT NULL,   -- JSON
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
    tags        TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
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
    scores          TEXT NOT NULL,   -- JSON: { overall, style, structure, actionability, originality }
    strengths       TEXT NOT NULL,   -- JSON 数组
    issues          TEXT NOT NULL,   -- JSON 数组
    style_match     TEXT NOT NULL,   -- JSON: { score, note }
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

  CREATE TABLE IF NOT EXISTS token_usage (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id     TEXT,
    user_id        TEXT,
    operation      TEXT NOT NULL,   -- 'generate' | 'analyze' | 'edit' | 'outline' | 'refine' | 'style'
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    total_tokens   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  );
`)

// ── 创建索引（分离出来，避免与表创建冲突） ──────────────────────────────────────

function createIndexes() {
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
    `)
  } catch (e) {
    console.warn('[DB] 创建索引失败:', e.message)
  }
}

// ── 迁移旧 JSON 文件数据（首次运行时执行一次） ───────────────────────────────

// 添加缺失的列（如果表已存在但列不存在）
function addMissingColumns() {
  try {
    // 检查 cover_history 是否有 user_id 列
    const coverHistoryInfo = db.prepare("PRAGMA table_info(cover_history)").all()
    const hasUserIdInCoverHistory = coverHistoryInfo.some(col => col.name === 'user_id')
    if (!hasUserIdInCoverHistory) {
      db.exec("ALTER TABLE cover_history ADD COLUMN user_id TEXT")
      console.log('[DB] 添加 cover_history.user_id 列')
    }

    // 检查 image_library 是否有 user_id 列
    const imageLibraryInfo = db.prepare("PRAGMA table_info(image_library)").all()
    const hasUserIdInImageLibrary = imageLibraryInfo.some(col => col.name === 'user_id')
    if (!hasUserIdInImageLibrary) {
      db.exec("ALTER TABLE image_library ADD COLUMN user_id TEXT")
      console.log('[DB] 添加 image_library.user_id 列')
    }

    // 检查 analyses 是否有 user_id 列
    const analysesInfo = db.prepare("PRAGMA table_info(analyses)").all()
    const hasUserIdInAnalyses = analysesInfo.some(col => col.name === 'user_id')
    if (!hasUserIdInAnalyses) {
      db.exec("ALTER TABLE analyses ADD COLUMN user_id TEXT")
      console.log('[DB] 添加 analyses.user_id 列')
    }
  } catch (e) {
    console.warn('[DB] 添加缺失列失败:', e.message)
  }
}

function migrateIfNeeded() {
  const legacyFiles = {
    cover_history: path.join(DATA_DIR, 'cover_history.json'),
    images:        path.join(DATA_DIR, 'images_metadata.json'),
    publish:       path.join(DATA_DIR, 'publish_history.json'),
  }

  // cover_history
  if (fs.existsSync(legacyFiles.cover_history)) {
    const count = db.prepare('SELECT COUNT(*) as c FROM cover_history').get().c
    if (count === 0) {
      try {
        const history = JSON.parse(fs.readFileSync(legacyFiles.cover_history, 'utf-8'))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO cover_history (id, title, style, color, provider, image_url, cache_key, created_at)
          VALUES (@id, @title, @style, @color, @provider, @image_url, @cache_key, @created_at)
        `)
        const many = db.transaction((rows) => rows.forEach(r => ins.run({
          id:        r.id,
          title:     r.title || '',
          style:     r.style || '',
          color:     r.color || '',
          provider:  r.provider || '',
          image_url: r.imageUrl || '',
          cache_key: r.cacheKey || '',
          created_at: r.createdAt || new Date().toISOString(),
        })))
        many(history)
        console.log(`[DB] 迁移 cover_history：${history.length} 条`)
      } catch (e) {
        console.warn('[DB] cover_history 迁移失败:', e.message)
      }
    }
  }

  // images_metadata.json
  if (fs.existsSync(legacyFiles.images)) {
    const count = db.prepare('SELECT COUNT(*) as c FROM image_library').get().c
    if (count === 0) {
      try {
        const images = JSON.parse(fs.readFileSync(legacyFiles.images, 'utf-8'))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO image_library (id, title, category, tags, provider, image_url, created_at, updated_at)
          VALUES (@id, @title, @category, @tags, @provider, @image_url, @created_at, @updated_at)
        `)
        const many = db.transaction((rows) => rows.forEach(r => ins.run({
          id:         r.id,
          title:      r.title || '',
          category:   r.category || '',
          tags:       JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
          provider:   r.provider || '',
          image_url:  r.imageUrl || '',
          created_at: r.createdAt || new Date().toISOString(),
          updated_at: r.updatedAt || new Date().toISOString(),
        })))
        many(images)
        console.log(`[DB] 迁移 image_library：${images.length} 条`)
      } catch (e) {
        console.warn('[DB] image_library 迁移失败:', e.message)
      }
    }
  }

  // publish_history.json
  if (fs.existsSync(legacyFiles.publish)) {
    const count = db.prepare('SELECT COUNT(*) as c FROM publish_history').get().c
    if (count === 0) {
      try {
        const history = JSON.parse(fs.readFileSync(legacyFiles.publish, 'utf-8'))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO publish_history (id, title, status, created_at)
          VALUES (@id, @title, @status, @created_at)
        `)
        const many = db.transaction((rows) => rows.forEach(r => ins.run({
          id:         r.id,
          title:      r.title || '',
          status:     r.status || 'draft',
          created_at: r.createdAt || new Date().toISOString(),
        })))
        many(history)
        console.log(`[DB] 迁移 publish_history：${history.length} 条`)
      } catch (e) {
        console.warn('[DB] publish_history 迁移失败:', e.message)
      }
    }
  }

  // cover_cache：.cache/covers/*.json → cover_cache 表
  const coversDir = path.join(DATA_DIR, 'covers')
  if (fs.existsSync(coversDir)) {
    const count = db.prepare('SELECT COUNT(*) as c FROM cover_cache').get().c
    if (count === 0) {
      try {
        const files = fs.readdirSync(coversDir).filter(f => f.endsWith('.json'))
        const ins = db.prepare(`
          INSERT OR IGNORE INTO cover_cache (cache_key, image_url, metadata, cached_at)
          VALUES (@cache_key, @image_url, @metadata, @cached_at)
        `)
        const many = db.transaction((items) => items.forEach(i => ins.run(i)))
        const items = []
        for (const f of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(coversDir, f), 'utf-8'))
            items.push({
              cache_key: f.replace('.json', ''),
              image_url: data.imageUrl || '',
              metadata:  JSON.stringify(data.metadata || {}),
              cached_at: data.cachedAt || new Date().toISOString(),
            })
          } catch {}
        }
        many(items)
        console.log(`[DB] 迁移 cover_cache：${items.length} 条`)
      } catch (e) {
        console.warn('[DB] cover_cache 迁移失败:', e.message)
      }
    }
  }
}

// 先添加缺失的列，再创建索引，最后进行数据迁移
addMissingColumns()
createIndexes()
migrateIfNeeded()

// ── 初始化 admin 账号（首次启动时创建） ──────────────────────────────────────
function seedAdminUser() {
  const existing = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()
  if (existing) return

  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, disabled, created_at)
    VALUES (?, ?, ?, 'admin', 0, ?)
  `).run('admin', 'admin', hash, new Date().toISOString())
  console.log('[DB] 已创建默认管理员账号 admin / admin123，请登录后立即修改密码')
}

seedAdminUser()

// ── Users API ─────────────────────────────────────────────────────────────────

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null
}

export function findUserById(id) {
  return db.prepare('SELECT id, username, role, disabled, created_at FROM users WHERE id = ?').get(id) || null
}

export function createUser(id, username, passwordHash, role = 'user') {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, disabled, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, username, passwordHash, role, new Date().toISOString())
}

export function listUsers() {
  return db.prepare('SELECT id, username, role, disabled, created_at FROM users ORDER BY created_at ASC').all()
}

export function setUserDisabled(id, disabled) {
  db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id)
}

export function updateUserPassword(id, passwordHash) {
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, id)
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id=?').run(id)
}

// ── 封面缓存 API ──────────────────────────────────────────────────────────────

const stmts = {
  // cover_cache
  getCoverCache: db.prepare('SELECT image_url, metadata, cached_at FROM cover_cache WHERE cache_key = ?'),
  setCoverCache: db.prepare(`
    INSERT OR REPLACE INTO cover_cache (cache_key, image_url, metadata, cached_at)
    VALUES (?, ?, ?, ?)
  `),
  countCoverCache: db.prepare('SELECT COUNT(*) as c FROM cover_cache'),

  // cover_history
  insertCoverHistory: db.prepare(`
    INSERT INTO cover_history (id, title, style, color, provider, image_url, cache_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listCoverHistory: db.prepare('SELECT * FROM cover_history ORDER BY created_at DESC LIMIT 200'),
  deleteCoverHistory: db.prepare('DELETE FROM cover_history WHERE id = ?'),
  clearCoverHistory: db.prepare('DELETE FROM cover_history'),

  // image_library
  insertImage: db.prepare(`
    INSERT OR REPLACE INTO image_library (id, title, category, tags, provider, image_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listImages: db.prepare('SELECT * FROM image_library ORDER BY created_at DESC'),
  deleteImage: db.prepare('DELETE FROM image_library WHERE id = ?'),
  updateImage: db.prepare(`
    UPDATE image_library SET title=?, category=?, tags=?, updated_at=? WHERE id=?
  `),

  // publish_history
  insertPublish: db.prepare(`
    INSERT OR REPLACE INTO publish_history (id, title, content, cover_image, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listPublish: db.prepare('SELECT id, title, status, created_at FROM publish_history ORDER BY created_at DESC LIMIT 100'),
  deletePublish: db.prepare('DELETE FROM publish_history WHERE id = ?'),
  getPublishById: db.prepare('SELECT * FROM publish_history WHERE id = ?'),

  // analyses
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

  // style_templates
  insertTemplate: db.prepare(`
    INSERT OR REPLACE INTO style_templates (id, name, description, accent_color, css, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listTemplates: db.prepare('SELECT * FROM style_templates ORDER BY is_builtin DESC, created_at ASC'),
  deleteTemplate: db.prepare('DELETE FROM style_templates WHERE id = ? AND is_builtin = 0'),
  getTemplate: db.prepare('SELECT * FROM style_templates WHERE id = ?'),

  // settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  `),
  getAllSettings: db.prepare('SELECT key, value FROM settings'),
}

// ── 封面缓存 ──────────────────────────────────────────────────────────────────

export function getCoverCache(cacheKey) {
  const row = stmts.getCoverCache.get(cacheKey)
  if (!row) return null
  return { imageUrl: row.image_url, metadata: JSON.parse(row.metadata), cachedAt: row.cached_at }
}

export function setCoverCache(cacheKey, imageUrl, metadata) {
  stmts.setCoverCache.run(cacheKey, imageUrl, JSON.stringify(metadata), new Date().toISOString())
}

export function getCoverCacheCount() {
  return stmts.countCoverCache.get().c
}

// ── 封面历史 ──────────────────────────────────────────────────────────────────

export function addCoverHistory(title, style, color, provider, imageUrl, cacheKey) {
  const id = Date.now().toString()
  const now = new Date().toISOString()
  stmts.insertCoverHistory.run(id, title, style, color, provider, imageUrl, cacheKey, now)
  return { id, title, style, color, provider, imageUrl, cacheKey, createdAt: now }
}

export function listCoverHistory() {
  return stmts.listCoverHistory.all().map(r => ({
    id: r.id, title: r.title, style: r.style, color: r.color,
    provider: r.provider, imageUrl: r.image_url, cacheKey: r.cache_key,
    createdAt: r.created_at,
  }))
}

export function deleteCoverHistory(id) {
  stmts.deleteCoverHistory.run(id)
}

export function clearCoverHistory() {
  stmts.clearCoverHistory.run()
}

// ── 图片库 ────────────────────────────────────────────────────────────────────

export function addImageToLibrary(imageUrl, title, category, tags, provider) {
  const id = Date.now().toString()
  const now = new Date().toISOString()
  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [])
  stmts.insertImage.run(id, title, category, tagsJson, provider, imageUrl, now, now)
  return { id, title, category, tags: Array.isArray(tags) ? tags : [], provider, imageUrl, createdAt: now, updatedAt: now }
}

export function listImages({ category, tags } = {}) {
  let rows = stmts.listImages.all()
  if (category) rows = rows.filter(r => r.category === category)
  if (tags?.length) rows = rows.filter(r => {
    const t = JSON.parse(r.tags || '[]')
    return tags.some(tag => t.includes(tag))
  })
  return rows.map(r => ({
    id: r.id, title: r.title, category: r.category,
    tags: JSON.parse(r.tags || '[]'), provider: r.provider,
    imageUrl: r.image_url, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function deleteImage(id) {
  stmts.deleteImage.run(id)
}

export function updateImage(id, { title, category, tags }) {
  stmts.updateImage.run(title, category, JSON.stringify(Array.isArray(tags) ? tags : []), new Date().toISOString(), id)
  const row = db.prepare('SELECT * FROM image_library WHERE id = ?').get(id)
  if (!row) return null
  return { id: row.id, title: row.title, category: row.category, tags: JSON.parse(row.tags || '[]'), provider: row.provider, imageUrl: row.image_url, createdAt: row.created_at, updatedAt: row.updated_at }
}

// ── 发布历史 ──────────────────────────────────────────────────────────────────

export function addPublishHistory(title, content, coverImage) {
  const id = Date.now().toString()
  const now = new Date().toISOString()
  stmts.insertPublish.run(id, title, content || '', coverImage || '', 'draft', now)
  return { id, title, content, coverImage, status: 'draft', createdAt: now }
}

export function listPublishHistory() {
  return stmts.listPublish.all().map(r => ({
    id: r.id, title: r.title, status: r.status, createdAt: r.created_at,
  }))
}

export function deletePublishHistory(id) {
  stmts.deletePublish.run(id)
}

export function getPublishById(id) {
  const row = stmts.getPublishById.get(id)
  if (!row) return null
  return { id: row.id, title: row.title, content: row.content, coverImage: row.cover_image, status: row.status, createdAt: row.created_at }
}

// ── 分析结果 ──────────────────────────────────────────────────────────────────

export function saveAnalysis(articleId, result) {
  const now = new Date().toISOString()
  stmts.insertAnalysis.run(
    articleId, now,
    JSON.stringify(result.scores || {}),
    JSON.stringify(result.strengths || []),
    JSON.stringify(result.issues || []),
    JSON.stringify(result.styleMatch || {}),
    result.topSuggestion || '',
    result.ragCount || 0,
  )
}

export function getLatestAnalysis(articleId) {
  const row = stmts.getLatestAnalysis.get(articleId)
  if (!row) return null
  return {
    id: row.id, articleId: row.article_id, createdAt: row.created_at,
    scores:       JSON.parse(row.scores),
    strengths:    JSON.parse(row.strengths),
    issues:       JSON.parse(row.issues),
    styleMatch:   JSON.parse(row.style_match),
    topSuggestion: row.top_suggestion,
    ragCount:     row.rag_count,
  }
}

export function listAnalyses(articleId) {
  return stmts.listAnalyses.all(articleId).map(r => ({
    id: r.id, articleId: r.article_id, createdAt: r.created_at,
    scores: JSON.parse(r.scores),
    topSuggestion: r.top_suggestion,
    ragCount: r.rag_count,
  }))
}

// ── CSS 模板 ──────────────────────────────────────────────────────────────────

export function upsertTemplate(t) {
  stmts.insertTemplate.run(
    t.id, t.name, t.description || t.desc || '', t.accentColor || t.accent_color || '',
    t.css, t.isBuiltin ? 1 : 0, t.createdAt || Date.now(), t.updatedAt || Date.now(),
  )
}

export function listTemplates() {
  return stmts.listTemplates.all().map(r => ({
    id: r.id, name: r.name, desc: r.description, accentColor: r.accent_color,
    css: r.css, isBuiltin: r.is_builtin === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

export function deleteTemplate(id) {
  stmts.deleteTemplate.run(id)
}

export function getTemplate(id) {
  const row = stmts.getTemplate.get(id)
  if (!row) return null
  return { id: row.id, name: row.name, desc: row.description, accentColor: row.accent_color, css: row.css, isBuiltin: row.is_builtin === 1, createdAt: row.created_at, updatedAt: row.updated_at }
}

// ── 设置（键值对） ────────────────────────────────────────────────────────────

export function getSetting(key) {
  const row = stmts.getSetting.get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}

export function setSetting(key, value) {
  stmts.setSetting.run(key, JSON.stringify(value), new Date().toISOString())
}

export function getAllSettings() {
  const rows = stmts.getAllSettings.all()
  return Object.fromEntries(rows.map(r => {
    try { return [r.key, JSON.parse(r.value)] } catch { return [r.key, r.value] }
  }))
}

// ── Token 使用统计 ────────────────────────────────────────────────────────────

/**
 * 记录一次 LLM 调用的 token 消耗
 * @param {object} opts
 * @param {string} [opts.articleId]
 * @param {string} [opts.userId]
 * @param {string}  opts.operation  - 'generate'|'analyze'|'edit'|'outline'|'refine'|'style'
 * @param {string}  opts.model
 * @param {number} [opts.inputTokens]
 * @param {number} [opts.outputTokens]
 * @param {number} [opts.totalTokens]
 */
export function recordTokenUsage({ articleId, userId, operation, model, inputTokens = 0, outputTokens = 0, totalTokens = 0 }) {
  try {
    db.prepare(`
      INSERT INTO token_usage (article_id, user_id, operation, model, input_tokens, output_tokens, total_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      articleId || null,
      userId    || null,
      operation,
      model,
      inputTokens,
      outputTokens,
      totalTokens || (inputTokens + outputTokens),
      new Date().toISOString(),
    )
  } catch (e) {
    console.warn('[DB] token_usage 写入失败:', e.message)
  }
}

/**
 * 查询用户的 token 使用汇总
 */
export function getTokenUsageSummary(userId, days = 30) {
  // 按操作类型+模型汇总
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
  `).all(userId, `-${days}`)

  // 按天汇总（最近 days 天，用于趋势图）
  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) AS day,
           SUM(total_tokens) AS total_tokens,
           COUNT(*) AS call_count
    FROM token_usage
    WHERE user_id = ?
      AND created_at >= datetime('now', ? || ' days')
    GROUP BY day
    ORDER BY day ASC
  `).all(userId, `-${days}`)

  // 总计
  const totals = db.prepare(`
    SELECT SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(total_tokens) AS total_tokens,
           COUNT(*) AS call_count,
           COUNT(DISTINCT DATE(created_at)) AS active_days
    FROM token_usage
    WHERE user_id = ?
      AND created_at >= datetime('now', ? || ' days')
  `).get(userId, `-${days}`)

  return { byOperation, byDay, totals }
}

// ── 上传图片管理 ──────────────────────────────────────────────────────────────

export function addUploadedImage({ id, filename, originalName, mimeType, size, articleId }) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO uploaded_images (id, filename, original_name, mime_type, size, article_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, filename, originalName, mimeType || 'image/png', size || 0, articleId || null, now)
  return { id, filename, originalName, mimeType, size, articleId, createdAt: now }
}

export function listUploadedImages({ articleId } = {}) {
  if (articleId) {
    return db.prepare('SELECT * FROM uploaded_images WHERE article_id = ? ORDER BY created_at DESC').all(articleId)
      .map(r => ({ id: r.id, filename: r.filename, originalName: r.original_name, mimeType: r.mime_type, size: r.size, articleId: r.article_id, createdAt: r.created_at }))
  }
  return db.prepare('SELECT * FROM uploaded_images ORDER BY created_at DESC LIMIT 200').all()
    .map(r => ({ id: r.id, filename: r.filename, originalName: r.original_name, mimeType: r.mime_type, size: r.size, articleId: r.article_id, createdAt: r.created_at }))
}

export function deleteUploadedImage(id) {
  const row = db.prepare('SELECT filename FROM uploaded_images WHERE id = ?').get(id)
  db.prepare('DELETE FROM uploaded_images WHERE id = ?').run(id)
  return row ? row.filename : null
}

console.log(`[DB] SQLite 已连接：${DB_PATH}`)
