import { NavLink } from 'react-router-dom'
import { BasketballLogo } from './icons.jsx'

const items = [
  { to: '/', label: '回帖', end: true },
  { to: '/results', label: '记录', end: false },
  { to: '/settings', label: '设置', end: false }
]

// 顶部品牌 + 导航胶囊
export default function Topbar() {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-logo" style={{ color: 'var(--accent)' }}>
          <BasketballLogo />
        </span>
        <span>虎扑管理</span>
      </div>
      <nav className="nav-tabs">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="right">v1.0 · 精致化</div>
    </div>
  )
}
