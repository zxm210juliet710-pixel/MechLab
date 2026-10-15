// 多齿轮运动学：沿确认啮合关系传播角速度
// 外啮合方向相反；ω从动 = −ω主动 × z主动/z从动
import { Gear } from '../types'

export interface MotionResult {
  /** 各齿轮角速度（度/秒，含方向） */
  omega: Record<string, number>
  /** 未被接入传动链的齿轮 id */
  disconnected: string[]
  /** 约束矛盾说明（如环路传动比不一致） */
  conflict: string | null
}

/**
 * @param driverId 主动轮
 * @param driverRpm 主动轮转速（转/分，正数）
 * @param meshGraph 啮合图（仅包含检查通过的啮合对）
 */
export function computeMotion(
  gears: Gear[],
  driverId: string | null,
  driverRpm: number,
  meshGraph: Record<string, string[]>,
): MotionResult {
  const omega: Record<string, number> = {}
  const zOf: Record<string, number> = {}
  for (const g of gears) zOf[g.id] = g.z

  const conflict = null
  if (!driverId || zOf[driverId] === undefined) {
    return { omega, disconnected: gears.map((g) => g.id), conflict }
  }

  omega[driverId] = driverRpm * 360 / 60 // 度/秒
  const queue = [driverId]
  const conflictPairs: string[] = []

  while (queue.length) {
    const cur = queue.shift()!
    for (const next of meshGraph[cur] ?? []) {
      // 外啮合：方向取反，转速按齿数反比
      const expected = -omega[cur] * (zOf[cur] / zOf[next])
      if (omega[next] === undefined) {
        omega[next] = expected
        queue.push(next)
      } else if (Math.abs(omega[next] - expected) > 1e-6) {
        // 同一齿轮被两条路径赋了不同转速（如 3 个齿轮两两啮合的死环）
        const key = [cur, next].sort().join('|')
        if (!conflictPairs.includes(key)) conflictPairs.push(key)
      }
    }
  }

  const disconnected = gears.filter((g) => omega[g.id] === undefined).map((g) => g.id)
  let conflictMsg: string | null = null
  if (conflictPairs.length > 0) {
    conflictMsg = '传动链中存在互相矛盾的运动约束（例如三个齿轮两两啮合形成死环），该组齿轮无法同时转动，请调整结构。'
  }
  return { omega, disconnected, conflict: conflictMsg }
}
