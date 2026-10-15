// 齿轮齿条机构画布渲染：几何全部来自 rackPinion 模块，组件只负责绘制与拾取
import { useMemo } from 'react'
import { Mechanism, RackPinionParams } from '../types'
import { rackPinionGeometry, rackDims } from '../mechanisms/rackPinion'
import { solidToPath, RotationArrow } from './MechanismShape'

/** 齿条直线运动方向箭头（画在齿条背面外侧） */
function LinearArrow(props: { x: number; y: number; dirX: number }) {
  const { x, y, dirX } = props
  const L = 13
  const x0 = x - dirX * L / 2
  const x1 = x + dirX * L / 2
  const wing = 3.4
  return (
    <g className="mech-arrow" pointerEvents="none">
      <line x1={x0} y1={y} x2={x1} y2={y} strokeWidth={0.9} />
      <polygon points={`${x1},${y} ${x1 - dirX * wing},${y - wing * 0.7} ${x1 - dirX * wing},${y + wing * 0.7}`} />
    </g>
  )
}

export function RackPinionShape(props: {
  m: Mechanism
  selected: boolean
  simAngle: number
  invalid: boolean
  onDown: (m: Mechanism, e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  const { m, selected, simAngle, invalid } = props
  const p = m.params as RackPinionParams
  const theta = m.initialAngle + simAngle
  const geom = useMemo(
    () => rackPinionGeometry(p, theta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.z, p.m, p.bore, p.rackL, p.travel, p.rackSide, theta,
      p.rackBodyW, p.mountD, p.mountCount, p.mountSpacing],
  )
  const { solids, rails, trace, sol } = geom

  const paths = useMemo(() => ({
    pinion: solidToPath(solids.pinion),
    rack: solidToPath(solids.rack),
    frameBearing: solidToPath(solids.frameBearing),
    frameBase: solidToPath(solids.frameBase),
  }), [solids])

  // 地面阴影（支座底板在齿条对侧）
  const basePts = solids.frameBase.outline
  const groundY = p.rackSide === 1
    ? Math.min(...basePts.map((q) => q.y))
    : Math.max(...basePts.map((q) => q.y))
  const groundX1 = Math.min(...basePts.map((q) => q.x)) - 2
  const groundX2 = Math.max(...basePts.map((q) => q.x)) + 2
  const hatch: string[] = []
  for (let x = groundX1; x <= groundX2 - 4; x += 6) {
    hatch.push(`M${x},${groundY}l4,${p.rackSide === 1 ? -4 : 4}`)
  }

  const { hf, body } = rackDims(p)
  // 齿条直动方向：s = −side·rp·θ，转速为正时移动方向为 −side·X
  const dirX = -p.rackSide * (m.driverRpm > 0 ? 1 : m.driverRpm < 0 ? -1 : 0)
  const arrowY = sol.pitchLineY + p.rackSide * (hf + body + 10)

  const hit = (
    <g className="mech-hit" style={{ cursor: 'pointer' }}
      onPointerDown={(e) => props.onDown(m, e)}
      onPointerMove={props.onMove}
      onPointerUp={props.onUp}>
      <path d={paths.pinion} fill="transparent" stroke="none" />
      <path d={paths.rack} fill="transparent" stroke="none" />
      <path d={paths.frameBase} fill="transparent" stroke="none" />
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
      {/* 地面阴影（固定件标识） */}
      <path className="mech-ground" d={hatch.join('')} pointerEvents="none" />

      {/* 齿条直线导轨 */}
      {rails.map((r, i) => (
        <g key={i} pointerEvents="none">
          <line className="mech-rail" x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
          <line className="mech-rail-cap" x1={r.x1} y1={r.y1 - 3} x2={r.x1} y2={r.y1 + 3} />
          <line className="mech-rail-cap" x1={r.x2} y1={r.y1 - 3} x2={r.x2} y2={r.y1 + 3} />
        </g>
      ))}

      {/* 齿条移动轨迹 */}
      {p.showTrace && (
        <g pointerEvents="none">
          <line className="mech-trace" x1={trace.x1} y1={trace.y} x2={trace.x2} y2={trace.y} />
          <line className="mech-trace-cap" x1={trace.x1} y1={trace.y - 4} x2={trace.x1} y2={trace.y + 4} />
          <line className="mech-trace-cap" x1={trace.x2} y1={trace.y - 4} x2={trace.x2} y2={trace.y + 4} />
        </g>
      )}

      {/* 固定支座（齿轮轴） */}
      <path className="mech-frame" d={paths.frameBase} fillRule="evenodd" pointerEvents="none" />
      <path className="mech-frame" d={paths.frameBearing} fillRule="evenodd" pointerEvents="none" />

      {/* 齿条（真实梯形齿廓） */}
      <path className="mech-rack" d={paths.rack} fillRule="evenodd" pointerEvents="none" />
      {/* 齿轮（渐开线齿形） */}
      <path className="mech-pinion" d={paths.pinion} fillRule="evenodd" pointerEvents="none" />

      {/* 转动副：齿轮固定轴 */}
      <g className="mech-joints" pointerEvents="none">
        <rect x={-2.4} y={-2.4} width={4.8} height={4.8} className="joint-fixed" />
      </g>

      {/* 运动方向箭头：齿轮旋转（画在齿条对侧）+ 齿条直动 */}
      {p.showArrow && (
        <>
          <RotationArrow r={sol.rp} rpm={m.driverRpm} centerDeg={p.rackSide === 1 ? -90 : 90} />
          {dirX !== 0 && <LinearArrow x={0} y={arrowY} dirX={dirX} />}
        </>
      )}

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
