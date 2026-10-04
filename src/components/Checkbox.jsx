import * as RC from '@radix-ui/react-checkbox'
import { Check, Minus } from './icons.jsx'

// Radix Checkbox 封装：保留原生 onCheckedChange 接口
// 视觉：16x16 方框，checked 时填充 accent 色，显示对勾
export default function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  className = '',
  children
}) {
  return (
    <RC.Root
      className={`check ${className}`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <span className="check-box">
        <RC.Indicator className="check-indicator">
          {checked === 'indeterminate' ? <Minus /> : <Check />}
        </RC.Indicator>
      </span>
      {children}
    </RC.Root>
  )
}
