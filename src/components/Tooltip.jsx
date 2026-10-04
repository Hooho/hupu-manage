import * as Tooltip from '@radix-ui/react-tooltip'

// Radix Tooltip 封装
export default function TooltipProvider({ children, content, side = 'top' }) {
  if (!content) return children
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="TooltipContent" side={side} sideOffset={4}>
          {content}
          <Tooltip.Arrow className="TooltipArrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
