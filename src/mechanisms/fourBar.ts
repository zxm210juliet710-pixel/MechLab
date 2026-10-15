// ------------------------------------------------------------------
// 铰链四连杆机构（four-bar linkage）
// 坐标系（机构局部坐标，Y 向上）：
//   O4 = (0,0) 为曲柄固定铰，O2 = (L1, 0) 为摇杆固定铰（机架长度 L1）
//   曲柄长度 L2（主动件，绕 O4 整周转动），连杆长度 L3，摇杆长度 L4
//   曲柄转角 θ 时：
//     A = O4 + L2·(cosθ, sinθ)            （曲柄—连杆铰接点）
//     B = 以 A 为圆心 L3 为半径 与 以 O2 为圆心 L4 为半径 两圆的交点
//   恒有 |AB| = L3、|O2B| = L4、|O4A| = L2。
// 对满足格拉霍夫条件的曲柄摇杆机构（L2 为最短杆），固定取一个交汇支，
// B 在整周运动中连续变化、不会跳到另一支。
// 渲染、检查、导出共用本模块，保证各处几何一致。

import { FourBarParams } from '../types'
import { Pt } from '../geometry/gear'
import { MechSolid } from './crankSlider'
import { linkOutline } from './link'

// ---- 参数范围与默认值 ----
export const FB_LIMITS = {
  frameL: { min: 20, max: 300 },
  crankL: { min: 8, max: 120 },
  couplerL: { min: 20, max: 400 },
  rockerL: { min: 20, max: 400 },
  crankW: { min: 4, max: 40 },
  couplerW: { min: 4, max: 40 },
  rockerW: { min: 4, max: 40 },
  pinD: { min: 1, max: 20 },
  endD: { min: 6, max: 60 },
  shaftD: { min: 1, max: 30 },
  initialAngle: { min: 0, max: 360 },
  driverRpm: { min: -120, max: 120 },
}

export const DEFAULT_FOUR_BAR = {
  frameL: 100,
  crankL: 30,
  couplerL: 100,
  rockerL: 80,
  assembly: 1 as 1 | -1,
  showTrace: true,
  showArrow: true,
  // 实体尺寸：曲柄/摇杆含 Φ8.2 固定轴孔，默认杆宽 13、端头 Φ14，孔周留料 ≥ 2 mm
  pinD: 3.2,
  crankW: 13,
  couplerW: 8,
  rockerW: 13,
  endD: 14,
  shaftD: 8.2,
}

/** 实体尺寸解析（旧数据缺字段时回退默认；杆长中心距不受影响） */
export function fbDims(p: FourBarParams) {
  const pinD = p.pinD ?? 3.2
  return {
    crankW: p.crankW ?? 13,
    couplerW: p.couplerW ?? 8,
    rockerW: p.rockerW ?? 13,
    endD: p.endD ?? 14,
    pinR: pinD / 2,
    shaftR: (p.shaftD ?? 8.2) / 2,
    couplerHoleAR: (p.couplerHoleA ?? pinD) / 2,
    couplerHoleBR: (p.couplerHoleB ?? pinD) / 2,
  }
}

const FRAME_R = 11 // 固定铰轴承外半径
const GROUND_Y = -FRAME_R - 2 // 地面符号线高度
const ARC_STEPS = 12
const SWEEP_N = 72 // 整周扫描离散数

// ------------------------------------------------------------------
// 运动学求解
// ------------------------------------------------------------------

export interface FBSolveResult {
  theta: number
  O4: Pt
  O2: Pt
  A: Pt
  B: Pt
  /** 连杆中点（轨迹点） */
  M: Pt
  /** 两圆交点是否有效（当前姿态可装配） */
  valid: boolean
  reason: string | null
  /** |AB| 与目标 L3 的偏差 mm */
  errL3: number
  /** |O2B| 与目标 L4 的偏差 mm */
  errL4: number
  /** 摇杆当前摆角（相对 O2，°，0~360） */
  rockerDeg: number
}

export function solveFourBar(p: FourBarParams, thetaDeg: number): FBSolveResult {
  const theta = (thetaDeg * Math.PI) / 180
  const { frameL: L1, crankL: L2, couplerL: L3, rockerL: L4 } = p
  const O4: Pt = { x: 0, y: 0 }
  const O2: Pt = { x: L1, y: 0 }
  const A: Pt = { x: L2 * Math.cos(theta), y: L2 * Math.sin(theta) }

  const dx = O2.x - A.x
  const dy = O2.y - A.y
  const d = Math.hypot(dx, dy) || 1e-9
  const ux = dx / d
  const uy = dy / d
  // 从 A 指向 O2 方向上的弦高垂足
  const a = (L3 * L3 - L4 * L4 + d * d) / (2 * d)
  const h2 = L3 * L3 - a * a
  let valid = true
  let reason: string | null = null
  if (h2 < -1e-7) {
    valid = false
    reason = '当前角度下连杆与摇杆无法交汇：两杆长度之和够不到，或之差过小，请调整杆长。'
  }
  const h = Math.sqrt(Math.max(0, h2))
  const fx = A.x + a * ux
  const fy = A.y + a * uy
  // u=(ux,uy) 的法向 n=(-uy,ux)
  const B: Pt = {
    x: fx + p.assembly * h * (-uy),
    y: fy + p.assembly * h * ux,
  }
  const M: Pt = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }

  const errL3 = valid ? Math.abs(Math.hypot(B.x - A.x, B.y - A.y) - L3) : 0
  const errL4 = valid ? Math.abs(Math.hypot(B.x - O2.x, B.y - O2.y) - L4) : 0
  let rockerDeg = (Math.atan2(B.y - O2.y, B.x - O2.x) * 180) / Math.PI
  rockerDeg = ((rockerDeg % 360) + 360) % 360

  return { theta, O4, O2, A, B, M, valid, reason, errL3, errL4, rockerDeg }
}

// ------------------------------------------------------------------
// 格拉霍夫（Grashof）判别
// ------------------------------------------------------------------

export type GrashofType = 'crankRocker' | 'doubleCrank' | 'doubleRocker' | 'none'

export interface GrashofInfo {
  type: GrashofType
  /** 最短杆长度 */
  shortest: number
  /** 最长杆长度 */
  longest: number
  /** 其余两杆长度之和 */
  restSum: number
  /** 最短杆是哪一根：frame/crank/coupler/rocker */
  shortestLink: 'frame' | 'crank' | 'coupler' | 'rocker'
  /** 最短+最长 ≤ 其余两杆之和 */
  grashof: boolean
}

export function grashofInfo(p: FourBarParams): GrashofInfo {
  const links = [
    { key: 'frame' as const, v: p.frameL },
    { key: 'crank' as const, v: p.crankL },
    { key: 'coupler' as const, v: p.couplerL },
    { key: 'rocker' as const, v: p.rockerL },
  ]
  const shortest = Math.min(...links.map((l) => l.v))
  const longest = Math.max(...links.map((l) => l.v))
  const restSum = links.reduce((s, l) => s + l.v, 0) - shortest - longest
  const grashof = shortest + longest <= restSum + 1e-9
  // 最短杆不唯一时，只要曲柄属于最短杆之一，仍可整周转动
  const crankIsShortest = p.crankL <= shortest + 1e-9
  let type: GrashofType
  if (!grashof) {
    type = 'none'
  } else if (crankIsShortest) {
    type = 'crankRocker'
  } else if (p.frameL <= shortest + 1e-9) {
    type = 'doubleCrank'
  } else {
    type = 'doubleRocker'
  }
  return { type, shortest, longest, restSum, shortestLink: links.find((l) => l.v === shortest)!.key, grashof }
}

/** 整周扫描：返回各姿态求解，用于可装配性、杆长恒定、不跳支、摆角与轨迹计算 */
export function sweepFourBar(p: FourBarParams, n = SWEEP_N): FBSolveResult[] {
  const out: FBSolveResult[] = []
  for (let k = 0; k < n; k++) out.push(solveFourBar(p, (k / n) * 360))
  return out
}

/** 摇杆摆角（°）：整周内摇杆角的最大摆动幅度 */
export function rockerSwing(p: FourBarParams): number {
  const frames = sweepFourBar(p)
  if (!frames.every((f) => f.valid)) return NaN
  // 摇杆为往复摆动，相邻帧角度差不应跨过整周；定位到连续区间后取极差
  const deg = frames.map((f) => f.rockerDeg)
  let min = deg[0]
  let max = deg[0]
  let prev = deg[0]
  for (let i = 1; i < deg.length; i++) {
    let d = deg[i] - prev
    if (d > 180) d -= 360
    if (d < -180) d += 360
    const cont = prev + d
    min = Math.min(min, cont)
    max = Math.max(max, cont)
    prev = cont
  }
  return Math.abs(max - min)
}

/** 最小传动角（°，取 0~90 的等效锐角）：越接近 90° 传力性能越好 */
export function minTransmissionAngle(p: FourBarParams): number {
  let worst = 90
  for (const f of sweepFourBar(p)) {
    if (!f.valid) continue
    const d = Math.hypot(f.A.x - f.O2.x, f.A.y - f.O2.y)
    const cosMu = (p.couplerL * p.couplerL + p.rockerL * p.rockerL - d * d) /
      (2 * p.couplerL * p.rockerL)
    let mu = (Math.acos(Math.min(1, Math.max(-1, cosMu))) * 180) / Math.PI
    if (mu > 90) mu = 180 - mu
    worst = Math.min(worst, mu)
  }
  return worst
}

// ------------------------------------------------------------------
// 几何工具
// ------------------------------------------------------------------

function arc(c: Pt, r: number, a0: number, a1: number, steps = ARC_STEPS): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return pts
}

function circleOutline(c: Pt, r: number, steps = 48): Pt[] {
  return arc(c, r, 0, Math.PI * 2, steps)
}

// ------------------------------------------------------------------
// 完整机构几何
// ------------------------------------------------------------------

export interface FBGeometry {
  sol: FBSolveResult
  solids: {
    /** 曲柄固定铰轴承（O4） */
    bearingO4: MechSolid
    /** 摇杆固定铰轴承（O2） */
    bearingO2: MechSolid
    crank: MechSolid
    coupler: MechSolid
    rocker: MechSolid
  }
  /** 地面符号线（辅助显示，不导出） */
  ground: { x1: number; y1: number; x2: number; y2: number }
  /** 连杆中点整周轨迹（闭合折线，辅助） */
  tracePts: Pt[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export function fourBarGeometry(p: FourBarParams, thetaDeg: number): FBGeometry {
  const sol = solveFourBar(p, thetaDeg)
  const { O4, O2, A, B } = sol
  const dims = fbDims(p)

  const bearingO4: MechSolid = {
    outline: circleOutline(O4, FRAME_R),
    holes: [{ x: O4.x, y: O4.y, r: dims.shaftR, purpose: 'shaft' }],
  }
  const bearingO2: MechSolid = {
    outline: circleOutline(O2, FRAME_R),
    holes: [{ x: O2.x, y: O2.y, r: dims.shaftR, purpose: 'shaft' }],
  }
  const crank: MechSolid = {
    outline: linkOutline(O4, A, dims.endD, dims.crankW),
    holes: [
      { x: O4.x, y: O4.y, r: dims.shaftR, purpose: 'shaft' },
      { x: A.x, y: A.y, r: dims.pinR, purpose: 'pin' },
    ],
  }
  const coupler: MechSolid = {
    outline: linkOutline(A, B, dims.endD, dims.couplerW),
    holes: [
      { x: A.x, y: A.y, r: dims.couplerHoleAR, purpose: 'pin' },
      { x: B.x, y: B.y, r: dims.couplerHoleBR, purpose: 'pin' },
    ],
  }
  const rocker: MechSolid = {
    outline: linkOutline(B, O2, dims.endD, dims.rockerW),
    holes: [
      { x: B.x, y: B.y, r: dims.pinR, purpose: 'pin' },
      { x: O2.x, y: O2.y, r: dims.shaftR, purpose: 'shaft' },
    ],
  }

  // 地面符号：两个固定铰下方的阴影线（机架在二维图中的标准图示）
  const ground = { x1: -FRAME_R - 7, y1: GROUND_Y, x2: p.frameL + FRAME_R + 7, y2: GROUND_Y }

  // 连杆中点轨迹（整周闭合）
  const tracePts = sweepFourBar(p).map((f) => f.M)

  // 包围盒：固定件 + 整周扫描各铰接点（含杆宽余量）
  let minX = -FRAME_R - 7
  let maxX = p.frameL + FRAME_R + 7
  let minY = GROUND_Y - 4
  let maxY = FRAME_R
  const eat = (q: Pt, pad: number) => {
    minX = Math.min(minX, q.x - pad); maxX = Math.max(maxX, q.x + pad)
    minY = Math.min(minY, q.y - pad); maxY = Math.max(maxY, q.y + pad)
  }
  for (const f of sweepFourBar(p)) {
    eat(f.A, Math.max(dims.endD, dims.crankW) / 2)
    eat(f.B, Math.max(dims.endD, dims.rockerW) / 2)
  }

  return {
    sol,
    solids: { bearingO4, bearingO2, crank, coupler, rocker },
    ground,
    tracePts,
    bounds: { minX, minY, maxX, maxY },
  }
}

/** 机构静止包围盒（用于避让、框选、适应画布） */
export function fourBarBounds(p: FourBarParams): { minX: number; minY: number; maxX: number; maxY: number } {
  return fourBarGeometry(p, 0).bounds
}
