import { useCallback, useRef, useState } from 'react'
import { HELP } from '../help'

interface Props {
  helpKey: keyof typeof HELP | string
  label?: string
}

/** 悬停 / 键盘聚焦 / 触屏点击均可用的中文解释气泡 */
export function HelpTip({ helpKey }: Props) {
  const text = HELP[helpKey] ?? ''
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(r.left, window.innerWidth - 280), y: r.bottom + 8 })
  }, [])
  const hide = useCallback(() => setPos(null), [])

  if (!text) return null
  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        className="help-dot"
        aria-label="查看解释"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // 触屏点击切换显示
          e.stopPropagation()
          if (pos) hide()
          else show()
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); pos ? hide() : show() } }}
      >
        ?
      </span>
      {pos && (
        <div className="tip-pop" style={{ left: pos.x, top: pos.y }} role="tooltip">
          {text}
        </div>
      )}
    </>
  )
}
