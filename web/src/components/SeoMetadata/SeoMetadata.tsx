import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SITE_ORIGIN = 'https://0oq8he.site'
const DEFAULT_DESCRIPTION = 'Dashy 帮助个人创作者完成素材收集、选题分析、文章生成、排版预览和微信公众号草稿发布。'

interface RouteMetadata {
  title: string
  description: string
  robots: string
  canonicalPath: string
}

interface SeoMetadataProps {
  rootIsPrivate: boolean
}

const PRIVATE_ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/setup\/?$/, '初始化设置'],
  [/^\/editor\/[^/]+\/?$/, '文章编辑'],
  [/^\/preview\/[^/]+\/?$/, '文章预览'],
  [/^\/drafts\/?$/, '微信草稿'],
  [/^\/wechat\/materials\/?$/, '素材库'],
  [/^\/styles\/?$/, '样式管理'],
  [/^\/settings\/?$/, 'AI 配置'],
  [/^\/rag\/?$/, '知识库'],
  [/^\/token-usage\/?$/, '用量统计'],
  [/^\/prompts\/?$/, '提示词'],
  [/^\/cron\/?$/, '定时任务'],
  [/^\/(?:scores|insights)\/?$/, '数据看板'],
  [/^\/account\/?$/, '账号与发布'],
  [/^\/canvas\/?$/, '排版画布'],
  [/^\/admin\/?$/, '用户管理'],
  [/^\/monitoring\/?$/, '系统监控'],
]

function getRouteMetadata(pathname: string, isLoggedIn: boolean): RouteMetadata {
  if (pathname === '/') {
    if (isLoggedIn) {
      return {
        title: '创作工作台 | Dashy',
        description: DEFAULT_DESCRIPTION,
        robots: 'noindex, nofollow, noarchive',
        canonicalPath: '/',
      }
    }
    return {
      title: 'Dashy - AI 公众号写作与内容发布工作台',
      description: DEFAULT_DESCRIPTION,
      robots: 'index, follow',
      canonicalPath: '/',
    }
  }

  if (pathname === '/login') {
    return {
      title: '登录 | Dashy',
      description: '登录 Dashy，继续管理素材、文章、排版和公众号草稿。',
      robots: 'noindex, nofollow, noarchive',
      canonicalPath: '/login',
    }
  }

  if (pathname === '/register') {
    return {
      title: '注册 | Dashy',
      description: '注册 Dashy 内容创作工作台。',
      robots: 'noindex, nofollow, noarchive',
      canonicalPath: '/register',
    }
  }

  const privateRoute = PRIVATE_ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))
  if (privateRoute) {
    return {
      title: `${privateRoute[1]} | Dashy`,
      description: DEFAULT_DESCRIPTION,
      robots: 'noindex, nofollow, noarchive',
      canonicalPath: pathname,
    }
  }

  return {
    title: '页面不存在 | Dashy',
    description: DEFAULT_DESCRIPTION,
    robots: 'noindex, nofollow, noarchive',
    canonicalPath: pathname,
  }
}

function setNamedMeta(name: string, content: string): void {
  const element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (element) element.content = content
}

function setPropertyMeta(property: string, content: string): void {
  const element = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (element) element.content = content
}

export default function SeoMetadata({ rootIsPrivate }: SeoMetadataProps) {
  const { pathname } = useLocation()

  useEffect(() => {
    const metadata = getRouteMetadata(pathname, rootIsPrivate)
    const canonicalUrl = new URL(metadata.canonicalPath, SITE_ORIGIN).toString()

    document.title = metadata.title
    setNamedMeta('description', metadata.description)
    setNamedMeta('robots', metadata.robots)
    setNamedMeta('twitter:title', metadata.title)
    setNamedMeta('twitter:description', metadata.description)
    setNamedMeta('twitter:url', canonicalUrl)
    setPropertyMeta('og:title', metadata.title)
    setPropertyMeta('og:description', metadata.description)
    setPropertyMeta('og:url', canonicalUrl)

    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (canonical) canonical.href = canonicalUrl
  }, [pathname, rootIsPrivate])

  return null
}
