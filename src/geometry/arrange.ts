// 自动排列：按模数分组，沿齿/槽网格方向贪心排成无重叠且真正可啮合的传动链
import { Gear } from '../types'
import { gearDims, idealDistance, normAngle } from './gear'

/** 优先方向（相对锚齿轮朝向，弧度）：水平优先，其次斜向、垂直 */
const PREFERRED = [0, 0.6, -0.6, 1.2, -1.2, Math.PI, 2.0, -2.0]

export function arrangeGears(gears: Gear[]): Gear[] {
  if (gears.length === 0) return []

  const groups = new Map<number, Gear[]>()
  for (const g of gears) {
    const key = Math.round(g.m * 1000)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(g)
  }

  const placed: Gear[] = []
  const result: Gear[] = []
  let rowY = 0

  for (const [, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
    )
    let parent: Gear | null = null

    for (const g of sorted) {
      if (!parent) {
        const ng: Gear = { ...g, x: 0, y: rowY, rotation: 0 }
        placed.push(ng)
        result.push(ng)
        parent = ng
        continue
      }

      const a = idealDistance(parent.z, g.z, parent.m)
      const rotP = (parent.rotation * Math.PI) / 180
      const halfPitch = Math.PI / parent.z
      // 候选方向：锚齿轮齿/槽网格上的全部方向，按优先方向排序
      const cand: { k: number; phi: number }[] = []
      for (let k = -parent.z; k <= parent.z; k++) {
        cand.push({ k, phi: normAngle(rotP + k * halfPitch) })
      }
      cand.sort((u, v) => {
        const score = (phi: number) => {
          let best = Math.PI
          for (const p of PREFERRED) {
            let d = Math.abs(normAngle(phi - p))
            if (d > Math.PI) d = 2 * Math.PI - d
            best = Math.min(best, d)
          }
          return best
        }
        return score(u.phi) - score(v.phi)
      })

      let chosen: { x: number; y: number; rot: number } | null = null
      for (const { k, phi } of cand) {
        const x = parent.x + a * Math.cos(phi)
        const y = parent.y + a * Math.sin(phi)
        const dg = gearDims(g.z, g.m, g.bore)
        const ok = placed.every((p) => {
          if (p.id === parent!.id) return true
          const dp = gearDims(p.z, p.m, p.bore)
          return Math.hypot(p.x - x, p.y - y) >= dg.ra + dp.ra + 0.5
        })
        if (!ok) continue
        // k 偶数锚齿轮出齿 → 子齿轮出槽；奇数反之
        const pitchC = (2 * Math.PI) / g.z
        const localRole = k % 2 === 0 ? pitchC / 2 : 0
        const rotRad = normAngle(phi + Math.PI - localRole)
        chosen = { x, y, rot: (rotRad * 180) / Math.PI }
        break
      }

      if (!chosen) {
        chosen = { x: 0, y: rowY - 80, rot: 0 }
        rowY -= 80
      }

      const ng: Gear = { ...g, x: chosen.x, y: chosen.y, rotation: chosen.rot }
      placed.push(ng)
      result.push(ng)
      parent = ng
    }

    rowY -= 100
  }

  return gears.map((g) => result.find((r) => r.id === g.id) ?? g)
}
