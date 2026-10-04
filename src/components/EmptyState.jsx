// 通用空状态
export default function EmptyState({ title, hint }) {
  return (
    <div className="empty">
      {title && <div className="empty-title">{title}</div>}
      {hint && <div>{hint}</div>}
    </div>
  )
}
