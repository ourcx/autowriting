/**
 * 提示词管理 API
 * 提供提示词的 CRUD、版本管理、分类管理等功能
 */
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  upsertPrompt, listPrompts, listPromptsByCategory, getPrompt,
  updatePromptContent, deletePrompt, recordPromptUsage,
  listPromptVersions, getPromptVersion, db,
} from '../db.js'

const router = express.Router()

// ── 获取所有提示词 ────────────────────────────────────────────────────────────

router.get('/list', (req, res) => {
  try {
    const prompts = listPrompts()
    res.json({ success: true, data: prompts })
  } catch (e) {
    console.error('[Prompts] 获取提示词列表失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 按分类获取提示词 ──────────────────────────────────────────────────────────

router.get('/category/:category', (req, res) => {
  try {
    const { category } = req.params
    const prompts = listPromptsByCategory(category)
    res.json({ success: true, data: prompts })
  } catch (e) {
    console.error('[Prompts] 按分类获取提示词失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 获取单个提示词 ────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const { id } = req.params
    const prompt = getPrompt(id)
    if (!prompt) {
      return res.status(404).json({ success: false, error: '提示词不存在' })
    }
    // 记录使用
    recordPromptUsage(id)
    res.json({ success: true, data: prompt })
  } catch (e) {
    console.error('[Prompts] 获取提示词失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 创建提示词 ────────────────────────────────────────────────────────────────

router.post('/create', (req, res) => {
  try {
    const { name, category, description, content, tags } = req.body
    
    if (!name || !category || !content) {
      return res.status(400).json({ success: false, error: '缺少必要字段：name, category, content' })
    }
    
    const id = uuidv4()
    const prompt = upsertPrompt({
      id,
      name,
      category,
      description: description || '',
      content,
      tags: tags || [],
      isBuiltin: false,
    })
    
    res.json({ success: true, data: prompt })
  } catch (e) {
    console.error('[Prompts] 创建提示词失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 更新提示词内容 ────────────────────────────────────────────────────────────

router.post('/:id/update', (req, res) => {
  try {
    const { id } = req.params
    const { content, changeNote } = req.body
    
    if (!content) {
      return res.status(400).json({ success: false, error: '缺少必要字段：content' })
    }
    
    const prompt = getPrompt(id)
    if (!prompt) {
      return res.status(404).json({ success: false, error: '提示词不存在' })
    }
    
    if (prompt.isBuiltin) {
      return res.status(403).json({ success: false, error: '内置提示词不能修改' })
    }
    
    const updated = updatePromptContent(id, content, changeNote || '')
    res.json({ success: true, data: updated })
  } catch (e) {
    console.error('[Prompts] 更新提示词失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 删除提示词 ────────────────────────────────────────────────────────────────

router.post('/:id/delete', (req, res) => {
  try {
    const { id } = req.params
    
    const prompt = getPrompt(id)
    if (!prompt) {
      return res.status(404).json({ success: false, error: '提示词不存在' })
    }
    
    if (prompt.isBuiltin) {
      return res.status(403).json({ success: false, error: '内置提示词不能删除' })
    }
    
    deletePrompt(id)
    res.json({ success: true, message: '提示词已删除' })
  } catch (e) {
    console.error('[Prompts] 删除提示词失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 获取版本历史 ──────────────────────────────────────────────────────────────

router.get('/:id/versions', (req, res) => {
  try {
    const { id } = req.params
    const versions = listPromptVersions(id)
    res.json({ success: true, data: versions })
  } catch (e) {
    console.error('[Prompts] 获取版本历史失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 获取特定版本 ──────────────────────────────────────────────────────────────

router.get('/:id/versions/:version', (req, res) => {
  try {
    const { id, version } = req.params
    const versionData = getPromptVersion(id, parseInt(version))
    if (!versionData) {
      return res.status(404).json({ success: false, error: '版本不存在' })
    }
    res.json({ success: true, data: versionData })
  } catch (e) {
    console.error('[Prompts] 获取版本失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 恢复到特定版本 ────────────────────────────────────────────────────────────

router.post('/:id/restore/:version', (req, res) => {
  try {
    const { id, version } = req.params
    
    const prompt = getPrompt(id)
    if (!prompt) {
      return res.status(404).json({ success: false, error: '提示词不存在' })
    }
    
    if (prompt.isBuiltin) {
      return res.status(403).json({ success: false, error: '内置提示词不能修改' })
    }
    
    const versionData = getPromptVersion(id, parseInt(version))
    if (!versionData) {
      return res.status(404).json({ success: false, error: '版本不存在' })
    }
    
    const updated = updatePromptContent(id, versionData.content, `恢复到版本 ${version}`)
    res.json({ success: true, data: updated })
  } catch (e) {
    console.error('[Prompts] 恢复版本失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 设置为替换提示词 ──────────────────────────────────────────────────────────

router.post('/:id/set-as-replacement/:builtinId', (req, res) => {
  try {
    const { id, builtinId } = req.params
    
    const prompt = getPrompt(id)
    if (!prompt) {
      return res.status(404).json({ success: false, error: '提示词不存在' })
    }
    
    if (prompt.isBuiltin) {
      return res.status(403).json({ success: false, error: '内置提示词不能作为替换' })
    }
    
    const builtinPrompt = getPrompt(builtinId)
    if (!builtinPrompt) {
      return res.status(404).json({ success: false, error: '内置提示词不存在' })
    }
    
    if (!builtinPrompt.isBuiltin) {
      return res.status(403).json({ success: false, error: '目标必须是内置提示词' })
    }
    
    // 更新提示词的 replaces_id
    db.prepare('UPDATE prompts SET replaces_id = ? WHERE id = ?').run(builtinId, id)
    
    const updated = getPrompt(id)
    res.json({ success: true, data: updated })
  } catch (e) {
    console.error('[Prompts] 设置替换失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 取消替换 ──────────────────────────────────────────────────────────────────

router.post('/:id/unset-replacement', (req, res) => {
  try {
    const { id } = req.params
    
    const prompt = getPrompt(id)
    if (!prompt) {
      return res.status(404).json({ success: false, error: '提示词不存在' })
    }
    
    if (!prompt.replacesId) {
      return res.status(400).json({ success: false, error: '该提示词未设置为替换' })
    }
    
    // 清除 replaces_id
    db.prepare('UPDATE prompts SET replaces_id = NULL WHERE id = ?').run(id)
    
    const updated = getPrompt(id)
    res.json({ success: true, data: updated })
  } catch (e) {
    console.error('[Prompts] 取消替换失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 获取替换提示词 ────────────────────────────────────────────────────────────

router.get('/replacement/:builtinId', (req, res) => {
  try {
    const { builtinId } = req.params
    
    // 查找替换该内置提示词的自定义提示词
    const replacement = db.prepare('SELECT * FROM prompts WHERE replaces_id = ?').get(builtinId)
    
    if (!replacement) {
      return res.json({ success: true, data: null })
    }
    
    res.json({ success: true, data: replacement })
  } catch (e) {
    console.error('[Prompts] 获取替换提示词失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 获取提示词统计 ────────────────────────────────────────────────────────────

router.get('/stats/summary', (req, res) => {
  try {
    const prompts = listPrompts()
    
    // 按分类统计
    const byCategory = {}
    const byBuiltin = { builtin: 0, custom: 0 }
    let totalUsage = 0
    
    prompts.forEach(p => {
      if (!byCategory[p.category]) {
        byCategory[p.category] = { count: 0, totalUsage: 0 }
      }
      byCategory[p.category].count++
      byCategory[p.category].totalUsage += p.usageCount
      
      if (p.isBuiltin) {
        byBuiltin.builtin++
      } else {
        byBuiltin.custom++
      }
      
      totalUsage += p.usageCount
    })
    
    res.json({
      success: true,
      data: {
        total: prompts.length,
        byCategory,
        byBuiltin,
        totalUsage,
        topPrompts: prompts.sort((a, b) => b.usageCount - a.usageCount).slice(0, 10),
      },
    })
  } catch (e) {
    console.error('[Prompts] 获取统计失败:', e.message)
    res.status(500).json({ success: false, error: e.message })
  }
})

export default router
