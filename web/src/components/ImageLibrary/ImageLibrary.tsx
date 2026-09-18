import React, { useState, useEffect } from 'react'
import { showConfirm } from '../Toast/Toast'
import { fetchJson } from '../../utils/apiHelpers'
import './ImageLibrary.css'

interface ImageItem {
  id: string
  title: string
  category: string
  tags: string[]
  provider: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

interface ImageLibraryProps {
  onImageSelect?: (image: ImageItem) => void
}

interface ImageStats {
  totalImages: number
  categories: number
  providers: number
}

export const ImageLibrary: React.FC<ImageLibraryProps> = ({ onImageSelect }) => {
  const [images, setImages] = useState<ImageItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<ImageStats | null>(null)

  // 加载图片库
  useEffect(() => {
    loadImages()
    loadCategories()
    loadTags()
    loadStats()
  }, [])

  // 当分类或标签改变时重新加载
  useEffect(() => {
    loadImages()
  }, [selectedCategory, selectedTags])

  const loadImages = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (selectedCategory) params.append('category', selectedCategory)
      if (selectedTags.length > 0) params.append('tags', selectedTags.join(','))

      setImages(await fetchJson<ImageItem[]>(`/api/images?${params}`))
    } catch (error) {
      console.error('Error loading images:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCategories = async () => {
    try {
      setCategories(await fetchJson<string[]>('/api/images/categories'))
    } catch (error) {
      console.error('Error loading categories:', error)
    }
  }

  const loadTags = async () => {
    try {
      setAllTags(await fetchJson<string[]>('/api/images/tags'))
    } catch (error) {
      console.error('Error loading tags:', error)
    }
  }

  const loadStats = async () => {
    try {
      setStats(await fetchJson<ImageStats>('/api/images/stats'))
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  const handleDeleteImage = (id: string) => {
    showConfirm({
      message: '确定要删除这张图片吗？',
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await fetchJson(`/api/images/${id}`, { method: 'DELETE' })
          loadImages()
          loadStats()
        } catch (error) {
          console.error('Error deleting image:', error)
        }
      },
    })
  }

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  return (
    <div className="image-library">
      <div className="library-header">
        <h3>图片库</h3>
        {stats && (
          <div className="library-stats">
            <span>总计: {stats.totalImages} 张</span>
            <span>分类: {stats.categories} 个</span>
            <span>来源: {stats.providers} 个</span>
          </div>
        )}
      </div>

      {/* 筛选器 */}
      <div className="library-filters">
        <div className="filter-section">
          <h4>分类</h4>
          <div className="filter-options">
            <button
              className={`filter-btn ${!selectedCategory ? 'active' : ''}`}
              onClick={() => setSelectedCategory(null)}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`filter-btn ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="filter-section">
            <h4>标签</h4>
            <div className="filter-tags">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  className={`tag-btn ${selectedTags.includes(tag) ? 'active' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 图片网格 */}
      {loading ? (
        <div className="library-loading">加载中...</div>
      ) : images.length === 0 ? (
        <div className="library-empty">
          <p>暂无图片</p>
          <span>生成或上传图片后会显示在这里</span>
        </div>
      ) : (
        <div className="images-grid">
          {images.map((image) => (
            <div key={image.id} className="image-card">
              <div className="image-preview">
                <img
                  src={image.imageUrl}
                  alt={image.title}
                  onClick={() => onImageSelect?.(image)}
                />
                <div className="image-overlay">
                  <button
                    className="btn-delete"
                    onClick={() => handleDeleteImage(image.id)}
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <div className="image-info">
                <h5>{image.title}</h5>
                <p className="image-category">{image.category}</p>
                {image.tags.length > 0 && (
                  <div className="image-tags">
                    {image.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className="image-provider">{image.provider}</p>
                <p className="image-date">
                  {new Date(image.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageLibrary
