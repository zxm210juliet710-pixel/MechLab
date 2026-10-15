// 曲柄滑块机构的画布渲染：机架 / 曲柄 / 连杆 / 滑块 / 运动副 / 导轨 / 轨迹 / 方向箭头
// 几何全部来自运动学模块，组件只负责绘制与指针拾取
import { useMemo } from 'react'
import { Mechanism, CrankSliderParams } from '../types'
import { crankSliderGeometry, MechSolid } from '../mechanisms/crankSlider'
import { outlineToPath } from '../geometry/gear'

/** 实体（外轮廓 + 圆孔）转 SVG path，孔用 evenodd 挖空 */
export function solidToPath(s: MechSolid): string {
  let d = outlineToPath(s.outline)
  for (const h of s.holes) {
    d += `M${(h.x + h.r).toFixed(3)},${h.y.toFixed(3)}`
    d += `A${h.r.toFixed(3)},${h.r.toFixed(3)} 0 1,0 ${(h.x - h.r).toFixed(3)},${h.y.toFixed(3)}`
    d += `A${h.r.toFixed(3)},${h.r.toFixed(3)} 0 1,0 ${(h.x + h.r).toFixed(3)},${h.y.toFixed(3)}Z`
  }
  return d
}

/** 旋转方向弧形箭头（绕圆指定方位，rpm 正负决定箭头方向） */
export function RotationArrow({ r, rpm, centerDeg = 90 }: { r: number; rpm: number; centerDeg?: number }) {
  if (Math.abs(rpm) < 1e-9) return null
  const R = r + 7
  const dir = rpm > 0 ? 1 : -1
  // Y 向上坐标：弧关于指定方位角，向角度增大方向扫 50°
  const a0 = (centerDeg - 25 * dir) * (Math.PI / 180)
  const a1 = (centerDeg + 25 * dir) * (Math.PI / 180)
  const p0 = { x: R * Math.cos(a0), y: R * Math.sin(a0) }
  const p1 = { x: R * Math.cos(a1), y: R * Math.sin(a1) }
  // 切向（角度增加方向）与径向
  const tx = -Math.sin(a1)
  const ty = Math.cos(a1)
  const nx = -Math.cos(a1)
  const ny = -Math.sin(a1)
  const wing1 = { x: p1.x - 3.2 * tx + 2.4 * nx, y: p1.y - 3.2 * ty + 2.4 * ny }
  const wing2 = { x: p1.x - 3.2 * tx - 2.4 * nx, y: p1.y - 3.2 * ty - 2.4 * ny }
  return (
    <g className="mech-arrow" pointerEvents="none">
      <path d={`M${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${R},${R} 0 0 ${dir > 0 ? 1 : 0} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`}
        fill="none" strokeWidth={0.9} markerEnd="none" />
      <polygon points={`${p1.x},${p1.y} ${wing1.x},${wing1.y} ${wing2.x},${wing2.y}`} />
    </g>
  )
}

export function MechanismShape(props: {
  m: Mechanism
  selected: boolean
  simAngle: number
  invalid: boolean
  onDown: (m: Mechanism, e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  const { m, selected, simAngle, invalid } = props
  const p = m.params as CrankSliderParams
  const theta = m.initialAngle + simAngle
  const geom = useMemo(
    () => crankSliderGeometry(p, theta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.crankR, p.rodL, p.blockW, p.blockH, p.axisSign, theta,
      p.rodW, p.pinD, p.crankW, p.endD, p.shaftD, p.rodHoleA, p.rodHoleB],
  )
  const { solids, rails, trace } = geom

  const paths = useMemo(() => ({
    frameBase: solidToPath(solids.frameBase),
    frameBearing: solidToPath(solids.frameBearing),
    crank: solidToPath(solids.crank),
    rod: solidToPath(solids.rod),
    block: solidToPath(solids.block),
  }), [solids])

  // 地面阴影线范围（固定件标准图示）
  const basePts = solids.frameBase.outline
  const groundY = Math.min(...basePts.map((q) => q.y))
  const groundX1 = Math.min(...basePts.map((q) => q.x)) - 2
  const groundX2 = Math.max(...basePts.map((q) => q.x)) + 2
  const hatch: string[] = []
  for (let x = groundX1; x <= groundX2 - 4; x += 6) {
    hatch.push(`M${x},${groundY}l4,-4`)
  }

  const hit = (
    <g className="mech-hit" style={{ cursor: 'pointer' }}
      onPointerDown={(e) => props.onDown(m, e)}
      onPointerMove={props.onMove}
      onPointerUp={props.onUp}>
      {/* 透明拾取区：各实体零件 */}
      <path d={paths.frameBase} fill="transparent" stroke="none" />
      <path d={paths.frameBearing} fill="transparent" stroke="none" />
      <path d={paths.crank} fill="transparent" stroke="none" />
      <path d={paths.rod} fill="transparent" stroke="none" />
      <path d={paths.block} fill="transparent" stroke="none" />
      {/* 导轨也可拾取 */}
      {rails.map((r, i) => (
        <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
          stroke="transparent" strokeWidth={9} />
      ))}
    </g>
  )

  return (
    <g transform={`translate(${m.x} ${m.y})`}
      className={`mech${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}`}
      role="button" aria-label={`${m.name}（机构整体，可拖动）`}>
      {/* 地面阴影（固定件标识，辅助显示不导出） */}
      <path className="mech-ground" d={hatch.join('')} pointerEvents="none" />

      {/* 导轨 */}
      {rails.map((r, i) => (
        <g key={i} pointerEvents="none">
          <line className="mech-rail" x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
          <line className="mech-rail-cap" x1={r.x1} y1={r.y1 - 3} x2={r.x1} y2={r.y1 + 3} />
          <line className="mech-rail-cap" x1={r.x2} y1={r.y1 - 3} x2={r.x2} y2={r.y1 + 3} />
        </g>
      ))}

      {/* 滑块行程轨迹 */}
      {p.showTrace && (
        <g pointerEvents="none">
          <line className="mech-trace" x1={trace.x1} y1={0} x2={trace.x2} y2={0} />
          <line className="mech-trace-cap" x1={trace.x1} y1={-4} x2={trace.x1} y2={4} />
          <line className="mech-trace-cap" x1={trace.x2} y1={-4} x2={trace.x2} y2={4} />
        </g>
      )}

      {/* 固定机架 */}
      <path className="mech-frame" d={paths.frameBase} fillRule="evenodd" pointerEvents="none" />
      <path className="mech-frame" d={paths.frameBearing} fillRule="evenodd" pointerEvents="none" />

      {/* 曲柄（主动件，橙色） */}
      <path className="mech-crank" d={paths.crank} fillRule="evenodd" pointerEvents="none" />
      {/* 连杆 */}
      <path className="mech-rod" d={paths.rod} fillRule="evenodd" pointerEvents="none" />
      {/* 滑块 */}
      <path className="mech-block" d={paths.block} fillRule="evenodd" pointerEvents="none" />

      {/* 转动副：固定铰 O 用同心方框符号，活动销 A/B 用实心圆点 */}
      <g className="mech-joints" pointerEvents="none">
        <rect x={-2.4} y={-2.4} width={4.8} height={4.8} className="joint-fixed" />
        <circle cx={geom.sol.A.x} cy={geom.sol.A.y} r={1.7} className="joint-pin" />
        <circle cx={geom.sol.B.x} cy={geom.sol.B.y} r={1.7} className="joint-pin" />
      </g>

      {/* 运动方向箭头 */}
      {p.showArrow && <RotationArrow r={p.crankR} rpm={m.driverRpm} />}

      {/* 选中包围框 */}
      {selected && (
        <rect className="mech-bbox"
          x={geom.bounds.minX - 2} y={geom.bounds.minY - 2}
          width={geom.bounds.maxX - geom.bounds.minX + 4}
          height={geom.bounds.maxY - geom.bounds.minY + 4}
          rx={3} pointerEvents="none" />
      )}

      {hit}
    </g>
  )
}
