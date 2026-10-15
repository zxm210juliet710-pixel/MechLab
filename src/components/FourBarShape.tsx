// 铰链四连杆机构画布渲染：固定铰轴承 / 曲柄 / 连杆 / 摇杆 / 转动副 / 地面符号 / 连杆轨迹 / 方向箭头
// 几何全部来自 fourBar 模块，组件只负责绘制与指针拾取
import { useMemo } from 'react'
import { Mechanism, FourBarParams } from '../types'
import { fourBarGeometry } from '../mechanisms/fourBar'
import { solidToPath, RotationArrow } from './MechanismShape'

export function FourBarShape(props: {
  m: Mechanism
  selected: boolean
  simAngle: number
  invalid: boolean
  onDown: (m: Mechanism, e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  const { m, selected, simAngle, invalid } = props
  const p = m.params as FourBarParams
  const theta = m.initialAngle + simAngle
  const geom = useMemo(
    () => fourBarGeometry(p, theta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.frameL, p.crankL, p.couplerL, p.rockerL, p.assembly, theta,
      p.pinD, p.crankW, p.couplerW, p.rockerW, p.endD, p.shaftD, p.couplerHoleA, p.couplerHoleB],
  )
  const { solids, ground, sol } = geom

  const paths = useMemo(() => ({
    bearingO4: solidToPath(solids.bearingO4),
    bearingO2: solidToPath(solids.bearingO2),
    crank: solidToPath(solids.crank),
    coupler: solidToPath(solids.coupler),
    rocker: solidToPath(solids.rocker),
  }), [solids])

  // 连杆中点整周轨迹（闭合多边形）
  const tracePoints = useMemo(
    () => geom.tracePts.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '),
    [geom.tracePts],
  )

  // 地面阴影线：两固定铰下方
  const hatch: string[] = []
  for (let x = ground.x1; x <= ground.x2 - 4; x += 6) {
    hatch.push(`M${x},${ground.y1}l4,-4`)
  }

  const hit = (
    <g className="mech-hit" style={{ cursor: 'pointer' }}
      onPointerDown={(e) => props.onDown(m, e)}
      onPointerMove={props.onMove}
      onPointerUp={props.onUp}>
      <path d={paths.bearingO4} fill="transparent" stroke="none" />
      <path d={paths.bearingO2} fill="transparent" stroke="none" />
      <path d={paths.crank} fill="transparent" stroke="none" />
      <path d={paths.coupler} fill="transparent" stroke="none" />
      <path d={paths.rocker} fill="transparent" stroke="none" />
    </g>
  )

  return (
    <g transform={`translate(${m.x} ${m.y})`}
      className={`mech${selected ? ' selected' : ''}${invalid ? ' invalid' : ''}`}
      role="button" aria-label={`${m.name}（机构整体，可拖动）`}>
      {/* 地面符号（机架标识，辅助显示不导出） */}
      <path className="mech-ground" d={hatch.join('')} pointerEvents="none" />
      <line className="mech-ground" x1={ground.x1} y1={ground.y1} x2={ground.x2} y2={ground.y2} pointerEvents="none" />

      {/* 连杆中点整周轨迹 */}
      {p.showTrace && (
        <polygon className="mech-trace" points={tracePoints} fill="none" pointerEvents="none" />
      )}

      {/* 固定铰轴承（机架） */}
      <path className="mech-frame" d={paths.bearingO4} fillRule="evenodd" pointerEvents="none" />
      <path className="mech-frame" d={paths.bearingO2} fillRule="evenodd" pointerEvents="none" />

      {/* 摇杆（从动件） */}
      <path className="mech-rocker" d={paths.rocker} fillRule="evenodd" pointerEvents="none" />
      {/* 连杆 */}
      <path className="mech-rod" d={paths.coupler} fillRule="evenodd" pointerEvents="none" />
      {/* 曲柄（主动件，橙色） */}
      <path className="mech-crank" d={paths.crank} fillRule="evenodd" pointerEvents="none" />

      {/* 转动副：固定铰用同心方框符号，活动销 A/B 用实心圆点 */}
      <g className="mech-joints" pointerEvents="none">
        <rect x={sol.O4.x - 2.4} y={sol.O4.y - 2.4} width={4.8} height={4.8} className="joint-fixed" />
        <rect x={sol.O2.x - 2.4} y={sol.O2.y - 2.4} width={4.8} height={4.8} className="joint-fixed" />
        <circle cx={sol.A.x} cy={sol.A.y} r={1.7} className="joint-pin" />
        <circle cx={sol.B.x} cy={sol.B.y} r={1.7} className="joint-pin" />
      </g>

      {/* 曲柄旋转方向箭头 */}
      {p.showArrow && <RotationArrow r={p.crankL} rpm={m.driverRpm} />}

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
