/**
 * PrivateRoute — 未登录时跳转到 /login，初始化中显示空白
 */
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/useAuth'

interface Props {
  children: React.ReactNode
  requireAdmin?: boolean
}

export default function PrivateRoute({ children, requireAdmin = false }: Props) {
  const { isLoggedIn, isAdmin, initialized } = useAuth()

  // token 验证尚未完成（首次刷新），先不渲染
  if (!initialized) return null

  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (requireAdmin && !isAdmin) return <Navigate to="/" replace />

  return <>{children}</>
}
