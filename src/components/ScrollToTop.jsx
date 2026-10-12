// 回到顶部浮动按钮
// - 滚动超过 300px 时显示在右下角
// - 点击 smooth scroll 到 viewport 顶部
// - 全站通用（任何页面都能用），挂在 App 根
import { useState, useEffect } from 'react'

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll() // 初始化一次（刷新页面 scrollY 可能非 0）
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null
  return (
    <button
      type="button"
      className="scroll-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      title="回到顶部"
      aria-label="回到顶部"
    >
      ↑
    </button>
  )
}
