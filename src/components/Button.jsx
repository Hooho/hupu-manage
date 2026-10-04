// 通用按钮（封装 className 拼接，省去每个地方写拼接逻辑）
export default function Button({
  variant = 'default',
  size,
  icon,
  className = '',
  children,
  ...rest
}) {
  const cls = [
    'btn',
    variant === 'primary' && 'primary',
    variant === 'danger' && 'danger',
    variant === 'ghost' && 'ghost',
    size === 'sm' && 'sm',
    icon && 'icon',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}
