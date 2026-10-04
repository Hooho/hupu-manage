import * as Progress from '@radix-ui/react-progress'

// Radix Progress 封装：薄条进度
export default function ProgressBar({ value = 0, max = 100, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span className="progress">
      <Progress.Root className="ProgressRoot" value={pct}>
        <Progress.Indicator
          className="ProgressIndicator"
          style={{ transform: `translateX(-${100 - pct}%)` }}
        />
      </Progress.Root>
      {label && <span>{label}</span>}
    </span>
  )
}
