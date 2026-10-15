// 拖动自动吸附：对齐理论中心距，并吸附到可啮合的齿/槽方向，同时自动计算齿形相位
import { Gear } from '../types'
import { idealDistance, normAngle } from './gear'

export interface SnapResult {
  x: number
  y: number
  rotation: number
  targetId: string
}

/**
 * 判断拖动中的齿轮是否应吸附到某个同模数齿轮。
 * 正确外啮合要求：中心距 = 理论值，且中心连线指向锚齿轮的齿或齿槽中线
 * （以锚齿轮半齿距角为周期），拖动齿轮以相反角色对准。
 */
export function computeSnap(dragged: Gear, others: Gear[]): SnapResult | null {
  let best: SnapResult | null = null
  let bestScore = Infinity

  for (const o of others) {
    if (Math.abs(o.m - dragged.m) > 1e-9) continue
    const dx = dragged.x - o.x
    const dy = dragged.y - o.y
    const c = Math.hypot(dx, dy)
    if (c < 1e-6) continue

    const a = idealDistance(dragged.z, o.z, dragged.m)
    const radTol = Math.max(3, 0.12 * a)
    const radErr = Math.abs(c - a)
    if (radErr > radTol) continue

    // 锚齿轮的齿/槽方向网格：以半齿距角为周期
    const rotA = (o.rotation * Math.PI) / 180
    const halfPitch = Math.PI / o.z
    const phiRaw = Math.atan2(dy, dx)
    const k = Math.round(normAngle(phiRaw - rotA) / halfPitch)
    const phi = normAngle(rotA + k * halfPitch)
    let angErr = normAngle(phiRaw - phi)
    if (angErr > Math.PI) angErr -= 2 * Math.PI
    const angTol = 0.07 // 约 4°
    if (Math.abs(angErr) > angTol) continue

    const x = o.x + a * Math.cos(phi)
    const y = o.y + a * Math.sin(phi)

    // k 偶数：锚齿轮以齿对准 → 拖动齿轮以齿槽对准；奇数反之
    const pitchD = (2 * Math.PI) / dragged.z
    const localRole = k % 2 === 0 ? pitchD / 2 : 0
    let rotRad = normAngle(phi + Math.PI - localRole)
    const cur = normAngle((dragged.rotation * Math.PI) / 180)
    while (rotRad - cur > Math.PI) rotRad -= 2 * Math.PI
    while (rotRad - cur < -Math.PI) rotRad += 2 * Math.PI

    const score = radErr / radTol + Math.abs(angErr) / angTol
    if (score < bestScore) {
      best = { x, y, rotation: (rotRad * 180) / Math.PI, targetId: o.id }
      bestScore = score
    }
  }
  return best
}
