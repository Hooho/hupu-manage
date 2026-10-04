// 回帖列表骨架屏
export function ReplySkeleton() {
  return (
    <div className="reply">
      <span
        className="skeleton"
        style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }}
      />
      <div className="reply-body">
        <span className="skeleton" style={{ width: '85%', height: 14 }} />
        <span
          className="skeleton"
          style={{ width: '35%', height: 12, marginTop: 10, display: 'block' }}
        />
      </div>
      <span className="skeleton" style={{ width: 48, height: 24, flexShrink: 0 }} />
    </div>
  )
}

// 记录卡片骨架屏
export function RecordSkeleton() {
  return (
    <div className="reply">
      <div className="reply-body">
        <span className="skeleton" style={{ width: '90%', height: 14 }} />
        <span
          className="skeleton"
          style={{ width: '50%', height: 12, marginTop: 10, display: 'block' }}
        />
      </div>
    </div>
  )
}

// 账号卡片骨架屏
export function AccountSkeleton() {
  return (
    <div className="account">
      <span
        className="skeleton"
        style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }}
      />
      <div className="account-body">
        <span className="skeleton" style={{ width: 120, height: 14 }} />
        <span
          className="skeleton"
          style={{ width: 220, height: 12, marginTop: 8, display: 'block' }}
        />
      </div>
      <span className="skeleton" style={{ width: 80, height: 24 }} />
    </div>
  )
}
