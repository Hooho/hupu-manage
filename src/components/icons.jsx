// 内联 SVG 图标库（避免引入图标库）
// 颜色通过 currentColor 继承；stroke-width 默认 1.6
const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
}

export function Check(props) {
  return (
    <svg {...baseProps} width="10" height="10" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function Minus(props) {
  return (
    <svg {...baseProps} width="10" height="10" {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function Chevron(props) {
  return (
    <svg {...baseProps} width="12" height="12" {...props}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function Refresh(props) {
  return (
    <svg {...baseProps} width="14" height="14" {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  )
}

export function Trash(props) {
  return (
    <svg {...baseProps} width="14" height="14" {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export function Plus(props) {
  return (
    <svg {...baseProps} width="14" height="14" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function Download(props) {
  return (
    <svg {...baseProps} width="14" height="14" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

export function BasketballLogo(props) {
  // 虎扑红篮球 logo
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="currentColor"
        stroke="currentColor"
      />
      <path
        d="M3 12c4 2 8 2 12 0s4 0 6 0"
        stroke="#ffffff"
        strokeOpacity="0.85"
      />
      <path d="M12 2.5c2.6 3 2.6 16 0 19" stroke="#ffffff" strokeOpacity="0.85" />
      <path d="M12 2.5c-2.6 3-2.6 16 0 19" stroke="#ffffff" strokeOpacity="0.85" />
    </svg>
  )
}

export function AlertTriangle(props) {
  return (
    <svg {...baseProps} width="14" height="14" {...props}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  )
}
