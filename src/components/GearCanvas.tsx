import { useEffect, useMemo, useRef, useState } from 'react'
import { editorStore, useEditor } from '../store/editor'
import { Gear, Mechanism } from '../types'
import { gearProfile, outlineToPath, gearDims } from '../geometry/gear'
import { runChecks } from '../geometry/checks'
import { computeSnap } from '../geometry/snap'
import { fitView, zoomBy, mechanismBoundsOf } from '../view'
import { SimBar } from './SimBar'
import { MechanismShape } from './MechanismShape'
import { RackPinionShape } from './RackPinionShape'
import { FourBarShape } from './FourBarShape'

interface Pt { x: number; y: number }

interface DragState {
  mode: 'entity' | 'pan' | 'box'
  startSX: number
  startSY: number
  initGears: Map<string, { x: number; y: number; rotation: number }>
  initMechs: Map<string, { x: number; y: number }>
  pointers: Map<number, Pt>
  pinched: boolean
  pinchDist: number
  pinchScale: number
  snapTargetId: string | null
}

function useProfilePath(g: Gear) {
  return useMemo(() => {
    const { outline, dims } = gearProfile(g.z, g.m, g.bore)
    let d = outlineToPath(outline)
    if (g.bore > 0) {
      const r = dims.boreR
      d += `M${r.toFixed(3)},0A${r.toFixed(3)},${r.toFixed(3)} 0 1,0 ${(-r).toFixed(3)},0`
      d += `A${r.toFixed(3)},${r.toFixed(3)} 0 1,0 ${r.toFixed(3)},0Z`
    }
    return d
  }, [g.z, g.m, g.bore])
}

export function GearCanvas() {
  const st = useEditor()
  const { doc, view, viewport } = st
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<DragState | null>(null)
  const spaceDown = useRef(false)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const checks = useMemo(
    () => runChecks(doc.gears, doc.mechanisms, doc.mfg.minWall),
    [doc.gears, doc.mechanisms, doc.mfg.minWall])

  const cx = viewport.w / 2
  const cy = viewport.h / 2
  const toScreen = (w: Pt): Pt => ({ x: cx + view.tx + w.x * view.scale, y: cy + view.ty - w.y * view.scale })

  // 初始化尺寸 & 首次适应画布
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      editorStore.setViewport(r.width, r.height)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const t = setTimeout(() => fitView(), 60)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 指针：齿轮 / 机构（统一为实体拖动，机构整体移动） ----
  const beginEntityDrag = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    e.stopPropagation()
    const s = editorStore.getState()
    if (e.shiftKey) {
      s.selection.includes(id)
        ? editorStore.setSelection(s.selection.filter((x) => x !== id))
        : editorStore.setSelection([...s.selection, id])
    } else if (!s.selection.includes(id)) {
      editorStore.setSelection([id])
    }
    const sel = editorStore.getState().selection
    const initGears = new Map<string, { x: number; y: number; rotation: number }>()
    const initMechs = new Map<string, { x: number; y: number }>()
    const doc0 = editorStore.getState().doc
    for (const sid of sel) {
      const gg = doc0.gears.find((x) => x.id === sid)
      if (gg) initGears.set(sid, { x: gg.x, y: gg.y, rotation: gg.rotation })
      const mm = doc0.mechanisms.find((x) => x.id === sid)
      if (mm) initMechs.set(sid, { x: mm.x, y: mm.y })
    }
    drag.current = {
      mode: 'entity', startSX: e.clientX, startSY: e.clientY, initGears, initMechs,
      pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
      pinched: false, pinchDist: 0, pinchScale: view.scale, snapTargetId: null,
    }
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      // 某些环境（合成事件）下指针尚未激活，忽略捕获失败，不影响拖动
    }
  }

  const onGearDown = (g: Gear, e: React.PointerEvent) => beginEntityDrag(g.id, e)
  const onMechDown = (m: Mechanism, e: React.PointerEvent) => beginEntityDrag(m.id, e)

  const onEntityMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.mode !== 'entity') return
    const rect = svgRef.current!.getBoundingClientRect()
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    d.pointers.set(e.pointerId, pos)

    if (d.pointers.size === 2) {
      // 双指缩放
      const [p1, p2] = [...d.pointers.values()]
      const distNow = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      if (!d.pinched) {
        d.pinched = true
        d.pinchDist = distNow
        d.pinchScale = view.scale
      } else {
        const ns = Math.min(60, Math.max(0.4, (d.pinchScale * distNow) / d.pinchDist))
        editorStore.setView({ scale: ns, tx: view.tx * (ns / view.scale), ty: view.ty * (ns / view.scale) })
      }
      return
    }
    if (d.pinched) return

    const dxWorld = (pos.x - (d.startSX - rect.left)) / view.scale
    const dyWorld = -(pos.y - (d.startSY - rect.top)) / view.scale
    if (!dragging) setDragging(true)
    editorStore.dragBegin()

    let nextGears = editorStore.getState().doc.gears.map((g) => {
      const o = d.initGears.get(g.id)
      return o ? { ...g, x: o.x + dxWorld, y: o.y + dyWorld } : g
    })
    const nextMechs = editorStore.getState().doc.mechanisms.map((m) => {
      const o = d.initMechs.get(m.id)
      return o ? { ...m, x: o.x + dxWorld, y: o.y + dyWorld } : m
    })

    // 仅拖动单个齿轮时执行自动吸附（机构不参与齿形吸附）
    d.snapTargetId = null
    if (editorStore.getState().snap && d.initGears.size === 1 && d.initMechs.size === 0) {
      const id = [...d.initGears.keys()][0]
      const moved = nextGears.find((g) => g.id === id)!
      const others = nextGears.filter((g) => g.id !== id)
      const snap = computeSnap(moved, others)
      if (snap) {
        nextGears = nextGears.map((g) => (g.id === id ? { ...g, x: snap.x, y: snap.y, rotation: snap.rotation } : g))
        d.snapTargetId = snap.targetId
      }
    }
    editorStore.dragMove(nextGears)
    editorStore.dragMoveMechanisms(nextMechs)
  }

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.pointers.delete(e.pointerId)
    if (d.pointers.size < 2) d.pinched = false
    if (d.pointers.size > 0 && d.mode === 'entity') return
    if (d.mode === 'entity') {
      editorStore.dragEnd()
      setDragging(false)
    }
    drag.current = null
  }

  // ---- 指针：背景（框选 / 平移） ----
  const onBgDown = (e: React.PointerEvent) => {
    if (e.button === 1 || st.tool === 'pan' || spaceDown.current) {
      drag.current = {
        mode: 'pan', startSX: e.clientX, startSY: e.clientY,
        initGears: new Map(), initMechs: new Map(),
        pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
        pinched: false, pinchDist: 0, pinchScale: view.scale, snapTargetId: null,
      }
      try {
        ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      } catch {
        // 忽略捕获失败
      }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    const rect = svgRef.current!.getBoundingClientRect()
    drag.current = {
      mode: 'box', startSX: e.clientX - rect.left, startSY: e.clientY - rect.top,
      initGears: new Map(), initMechs: new Map(),
      pointers: new Map(), pinched: false, pinchDist: 0, pinchScale: view.scale, snapTargetId: null,
    }
    if (!e.shiftKey) editorStore.setSelection([])
  }

  const onBgMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const rect = svgRef.current!.getBoundingClientRect()
    if (d.mode === 'pan') {
      const p = d.pointers.get(e.pointerId)
      if (!p) return
      editorStore.setView({ tx: view.tx + (e.clientX - rect.left - p.x), ty: view.ty + (e.clientY - rect.top - p.y) })
      d.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    } else if (d.mode === 'box') {
      setBox({ x0: d.startSX, y0: d.startSY, x1: e.clientX - rect.left, y1: e.clientY - rect.top })
    }
  }

  const onBgUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'box' && box) {
      const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1)
      const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1)
      const gearIds = doc.gears.filter((g) => {
        const s = toScreen(g)
        return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1
      }).map((g) => g.id)
      const mechIds = doc.mechanisms.filter((m) => {
        const b = mechanismBoundsOf(m)
        const s = toScreen({ x: m.x + (b.minX + b.maxX) / 2, y: m.y + (b.minY + b.maxY) / 2 })
        return s.x >= x0 && s.x <= x1 && s.y <= y1 && s.y >= y0
      }).map((m) => m.id)
      const ids = [...gearIds, ...mechIds]
      if (ids.length > 0) {
        const sel = e.shiftKey ? Array.from(new Set([...st.selection, ...ids])) : ids
        editorStore.setSelection(sel)
      }
      setBox(null)
    }
    drag.current = null
  }

  // ---- 滚轮缩放（以光标为锚点） ----
  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.0013)
    const ns = Math.min(60, Math.max(0.4, view.scale * factor))
    // 保持光标下世界点不动：sx = cx+tx+wx*s
    const wx = (mx - cx - view.tx) / view.scale
    const wy = -(my - cy - view.ty) / view.scale
    editorStore.setView({ scale: ns, tx: mx - cx - wx * ns, ty: my - cy + wy * ns })
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const gridMm = view.scale < 1.5 ? 50 : view.scale < 5 ? 10 : 5
  const gridPx = gridMm * view.scale

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      style={{
        backgroundColor: '#faf9f6',
        backgroundImage:
          `linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to bottom, var(--grid) 1px, transparent 1px)`,
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${((cx + view.tx) % gridPx + gridPx) % gridPx}px ${((cy + view.ty) % gridPx + gridPx) % gridPx}px`,
      }}
    >
      <svg
        ref={svgRef}
        className="mech-svg"
        onPointerDown={onBgDown}
        onPointerMove={onBgMove}
        onPointerUp={onBgUp}
        onWheel={onWheel}
        style={{ cursor: st.tool === 'pan' || spaceDown.current ? 'grab' : 'default' }}
      >
        {/* 关系连线（世界坐标，Y 翻转） */}
        <g transform={`translate(${cx + view.tx} ${cy + view.ty}) scale(${view.scale} ${-view.scale})`}>
          {checks.pairIssues.map((p) => {
            const ga = doc.gears.find((g) => g.id === p.a)!
            const gb = doc.gears.find((g) => g.id === p.b)!
            if (!ga || !gb) return null
            const hl = st.highlightPair &&
              ((st.highlightPair[0] === p.a && st.highlightPair[1] === p.b) ||
                (st.highlightPair[0] === p.b && st.highlightPair[1] === p.a))
            // 互不接触的无关齿轮对不画线
            if (p.severity === 'none') return null
            // 距离过远且不接触的对不画线，保持画面清爽
            const da = gearDims(ga.z, ga.m, ga.bore)
            const db = gearDims(gb.z, gb.m, gb.bore)
            if (p.distance > da.ra + db.ra + 24 && p.severity !== 'error') return null
            return (
              <line
                key={`${p.a}-${p.b}`}
                x1={ga.x} y1={ga.y} x2={gb.x} y2={gb.y}
                className={`rel-line rel-${p.severity}${hl ? ' rel-highlight' : ''}`}
              />
            )
          })}
          {doc.gears.map((g) => (
            <GearShape
              key={g.id}
              g={g}
              selected={st.selection.includes(g.id)}
              isDriver={doc.driverId === g.id}
              simAngle={st.simAngles[g.id] ?? 0}
              onDown={onGearDown}
              onMove={onEntityMove}
              onUp={endDrag}
              snapActive={dragging}
            />
          ))}
          {doc.mechanisms.map((m) => {
            const common = {
              m,
              selected: st.selection.includes(m.id),
              simAngle: st.simAngles[m.id] ?? 0,
              invalid: checks.mechIssues.some((i) => i.mechId === m.id && i.severity === 'error')
                || checks.mfgIssues.some((i) => i.mechId === m.id && i.severity === 'error'),
              onDown: onMechDown,
              onMove: onEntityMove,
              onUp: endDrag,
            }
            if (m.kind === 'rackPinion') return <RackPinionShape key={m.id} {...common} />
            if (m.kind === 'fourBar') return <FourBarShape key={m.id} {...common} />
            return <MechanismShape key={m.id} {...common} />
          })}
        </g>

        {/* 屏幕坐标覆盖层：文字标签与标记 */}
        <g>
          {doc.gears.map((g) => {
            const s = toScreen(g)
            const d = gearDims(g.z, g.m, g.bore)
            const selected = st.selection.includes(g.id)
            return (
              <g key={`lbl-${g.id}`} pointerEvents="none">
                <text x={s.x} y={s.y - d.ra * view.scale - 7} className="gear-label"
                  style={{ font: `${selected ? '700 ' : '600 '}${Math.max(10, Math.min(14, view.scale * 3.2))}px sans-serif` }}
                  fill={selected ? 'var(--orange-dark)' : '#3a362f'}>
                  {g.name}{doc.driverId === g.id ? '（主动轮）' : ''}
                </text>
                {selected && (
                  <text x={s.x} y={s.y + d.ra * view.scale + 16} className="gear-dim-label"
                    style={{ font: `${Math.max(9, Math.min(12, view.scale * 2.6))}px sans-serif` }}>
                    {`d=${(d.r * 2).toFixed(1)}　da=${(d.ra * 2).toFixed(1)}　df=${(d.rf * 2).toFixed(1)} mm`}
                  </text>
                )}
              </g>
            )
          })}
          {doc.mechanisms.map((m) => {
            const b = mechanismBoundsOf(m)
            const top = toScreen({ x: m.x + (b.minX + b.maxX) / 2, y: m.y + b.maxY })
            const selected = st.selection.includes(m.id)
            return (
              <text key={`mlbl-${m.id}`} x={top.x} y={top.y - 7} textAnchor="middle"
                className="gear-label" pointerEvents="none"
                style={{ font: `${selected ? '700 ' : '600 '}${Math.max(10, Math.min(14, view.scale * 3.2))}px sans-serif` }}
                fill={selected ? 'var(--orange-dark)' : '#3a362f'}>
                {m.name}（机构）
              </text>
            )
          })}
          {checks.pairIssues.map((p) => {
            if (p.severity === 'none' || (p.severity === 'ok' && !dragging)) return null
            const ga = doc.gears.find((g) => g.id === p.a)
            const gb = doc.gears.find((g) => g.id === p.b)
            if (!ga || !gb) return null
            const s1 = toScreen(ga), s2 = toScreen(gb)
            const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2
            const icon = p.severity === 'ok' ? '✓' : p.severity === 'warn' ? '!' : '×'
            const col = p.severity === 'ok' ? 'var(--green)' : p.severity === 'warn' ? 'var(--amber)' : 'var(--red)'
            const bg = p.severity === 'ok' ? '#eef8f1' : p.severity === 'warn' ? '#fdf6e9' : '#fdeeed'
            const text = `${icon} ${p.distance.toFixed(1)} mm`
            const wpx = text.length * 6.2 + 8
            return (
              <g key={`tag-${p.a}-${p.b}`} pointerEvents="none">
                <rect x={mx - wpx / 2} y={my - 9} width={wpx} height={18} rx={5} fill={bg} stroke={col} strokeWidth={0.8} />
                <text x={mx} y={my + 0.5} textAnchor="middle" dominantBaseline="middle"
                  style={{ font: '600 11px sans-serif', fill: col }}>{text}</text>
              </g>
            )
          })}
        </g>

        {box && <rect className="rubber" x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)}
          width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} />}
      </svg>

      {/* 缩放控件 */}
      <div className="zoom-chip">
        <button onClick={() => zoomBy(1 / 1.2)} title="缩小" aria-label="缩小">−</button>
        <span className="zoom-val">{view.scale.toFixed(1)}×</span>
        <button onClick={() => zoomBy(1.2)} title="放大" aria-label="放大">+</button>
        <button onClick={() => fitView()} title="适应画布" aria-label="适应画布" style={{ width: 28 }}>⤢</button>
      </div>

      {/* 运动模拟控制 */}
      <SimBar />

      {/* 吸附提示 */}
      {dragging && drag.current?.snapTargetId && (
        <div className="toast" style={{ top: 14 }}>
          已吸附到理论中心距，齿形相位自动对齐
        </div>
      )}
    </div>
  )
}

function GearShape(props: {
  g: Gear
  selected: boolean
  isDriver: boolean
  simAngle: number
  onDown: (g: Gear, e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
  snapActive: boolean
}) {
  const { g, selected, isDriver, simAngle } = props
  const d = useProfilePath(g)
  const dims = gearDims(g.z, g.m, g.bore)
  const rot = g.rotation + simAngle
  return (
    <g
      transform={`translate(${g.x} ${g.y}) rotate(${rot})`}
      className={`gear${selected ? ' selected' : ''}`}
      onPointerDown={(e) => props.onDown(g, e)}
      onPointerMove={props.onMove}
      onPointerUp={props.onUp}
    >
      {isDriver && (
        <circle r={dims.ra + 1.4} fill="none" stroke="var(--orange)" strokeWidth={0.35} strokeDasharray="1.2 0.9" />
      )}
      {selected && <circle className="pitch-circle" r={dims.r} />}
      <path className="gear-body" d={d} fillRule="evenodd" pointerEvents="none" />
      {/* 轴心标记 */}
      <line className="center-cross" x1={-1.6} y1={0} x2={1.6} y2={0} pointerEvents="none" />
      <line className="center-cross" x1={0} y1={-1.6} x2={0} y2={1.6} pointerEvents="none" />
      <circle className="center-dot" r={0.55} pointerEvents="none" />
      {/* 扩大拾取区域 */}
      <circle className="gear-hit" r={dims.ra} />
    </g>
  )
}
