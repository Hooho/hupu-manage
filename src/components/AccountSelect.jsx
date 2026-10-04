// 账号平铺切换（不用下拉，直接列出所有账号，点点就切）
// props: items = [{value, label, avatar?}]，value / onValueChange
export default function AccountSelect({ items, value, onValueChange, disabled }) {
  if (!items || items.length === 0) return null
  return (
    <div className="account-tabs">
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            className={`account-tab${active ? ' active' : ''}`}
            onClick={() => onValueChange?.(item.value)}
            disabled={disabled}
            aria-pressed={active}
          >
            {item.avatar && <span className="avatar">{item.avatar}</span>}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
