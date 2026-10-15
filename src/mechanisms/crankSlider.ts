// 曲柄滑块机构：真实运动学求解 + 零件几何生成
// ------------------------------------------------------------------
// 坐标系（机构局部坐标，原点 O 为曲柄固定铰，导轨沿 X 轴，Y 向上）：
//   曲柄长度 r、连杆长度 L、曲柄转角 θ：
//     A = (r·cosθ, r·sinθ)
//     B = (r·cosθ + s·√(L² − r²·sin²θ), 0)，s = ±1 为滑块装配方向
//   恒有 |AB| = L、B 始终在导轨轴线上，滑块只做直线往复运动。
// 渲染、检查、导出共用本模块输出，保证各模块几何一致。

import { CrankSliderParams } from '../types'
import { linkOutline } from './link'

export interface Pt {
  x: number
  y: number
}

/** 孔的用途：固定轴孔 / 铰接销孔 / 安装孔 / 齿轮中心孔 */
export type HolePurpose = 'shaft' | 'pin' | 'mount' | 'bore'

export interface Circle {
  x: number
  y: number
  r: number
  purpose?: HolePurpose
}

/** 可导出/可渲染的实体零件：闭合外轮廓 + 真实内孔 */
export interface MechSolid {
  outline: Pt[]
  holes: Circle[]
}

// ---- 参数范围与默认值 ----
export const CS_LIMITS = {
  crankR: { min: 8, max: 120 },
  rodL: { min: 10, max: 400 },
  blockW: { min: 10, max: 160 },
  blockH: { min: 6, max: 100 },
  rodW: { min: 4, max: 40 },
  crankW: { min: 4, max: 40 },
  pinD: { min: 1, max: 20 },
  endD: { min: 6, max: 60 },
  shaftD: { min: 1, max: 30 },
  initialAngle: { min: 0, max: 360 },
  driverRpm: { min: -120, max: 120 },
}

export const DEFAULT_CRANK_SLIDER = {
  crankR: 30,
  rodL: 80,
  blockW: 40,
  blockH: 24,
  axisSign: 1 as 1 | -1,
  showTrace: true,
  showArrow: true,
  // 实体尺寸（可在高级参数中精细调整）
  // 默认保证 Φ8.2 轴孔四周留料 ≥ 2 mm：端头 Φ14（r7−r4.1=2.9）、曲柄宽 13（半宽6.5−r4.1=2.4）
  rodW: 8,
  pinD: 3.2,
  crankW: 13,
  endD: 14,
  shaftD: 8.2,
}

/** 实体尺寸解析（旧数据缺字段时回退默认，不改变中心距等运动学尺寸） */
export function csDims(p: CrankSliderParams) {
  const pinD = p.pinD ?? 3.2
  return {
    crankW: p.crankW ?? 13,
    rodW: p.rodW ?? 8,
    endD: p.endD ?? 14,
    pinR: pinD / 2,
    shaftR: (p.shaftD ?? 8.2) / 2,
    rodHoleAR: (p.rodHoleA ?? pinD) / 2,
    rodHoleBR: (p.rodHoleB ?? pinD) / 2,
  }
}

// 固定的结构尺寸（mm）
const FRAME_R = 11 // 机架轴承外半径
const BASE_BOTTOM = -34 // 机架底板底面
const RAIL_GAP = 4 // 导轨与滑块的间隙
const ARC_STEPS = 12

// ------------------------------------------------------------------
// 运动学求解
// ------------------------------------------------------------------

export interface CSSolveResult {
  theta: number
  O: Pt
  A: Pt
  B: Pt
  /** 根号内是否为有效值 */
  valid: boolean
  /** 无效或需提示时的原因 */
  reason: string | null
  /** 实际 |AB| 与目标杆长 L 的偏差（mm，应≈0） */
  rodError: number
  /** 滑块当前位置（沿导轨坐标） */
  blockX: number
  /** 滑块行程区间 */
  strokeRange: [number, number]
  /** 行程长度（=2r） */
  stroke: number
}

export function solveCrankSlider(p: CrankSliderParams, thetaDeg: number): CSSolveResult {
  const theta = (thetaDeg * Math.PI) / 180
  const r = p.crankR
  const L = p.rodL
  const O: Pt = { x: 0, y: 0 }

  let valid = true
  let reason: string | null = null
  if (!(L >= r)) {
    valid = false
    reason = '连杆长度必须不小于曲柄长度，否则曲柄无法转过一周。'
  }

  const sin = Math.sin(theta)
  const cos = Math.cos(theta)
  const radicand = L * L - r * r * sin * sin
  const root = radicand >= 0 ? Math.sqrt(radicand) : 0
  if (radicand < 0) {
    valid = false
    reason = '当前角度下连杆长度不足，机构无法到达该位置。'
  }

  const A: Pt = { x: r * cos, y: r * sin }
  const blockX = r * cos + p.axisSign * root
  const B: Pt = { x: blockX, y: 0 }
  const rodError = Math.abs(Math.hypot(B.x - A.x, B.y - A.y) - L)

  // 行程区间：θ=0 与 θ=π 对应两个极限位置
  const far = r + L
  const near = L - r
  const strokeRange: [number, number] = p.axisSign === 1 ? [near, far] : [-far, -near]

  return {
    theta, O, A, B, valid, reason, rodError, blockX,
    strokeRange,
    stroke: 2 * r,
  }
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

/** 圆头杆（胶囊形）闭合轮廓：两端为半圆，中心连线 P1→P2，杆宽 w */
function barOutline(p1: Pt, p2: Pt, w: number): Pt[] {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // 法向
  const nx = -uy
  const ny = ux
  const hw = w / 2
  const s1p: Pt = { x: p1.x + nx * hw, y: p1.y + ny * hw }
  const s2p: Pt = { x: p2.x + nx * hw, y: p2.y + ny * hw }
  const ang = Math.atan2(uy, ux)
  // P2 端半圆（+法向 → −法向，绕 P2）；两端点与 s2p/s2m 重合，切片时排除
  const cap2 = arc(p2, hw, ang + Math.PI / 2, ang - Math.PI / 2)
  const s2m: Pt = { x: p2.x - nx * hw, y: p2.y - ny * hw }
  const s1m: Pt = { x: p1.x - nx * hw, y: p1.y - ny * hw }
  // P1 端半圆（−法向 → +法向），末端即首点，采用隐式闭合不重复列出
  const cap1 = arc(p1, hw, ang - Math.PI / 2, ang - Math.PI * 1.5)
  return [s1p, s2p, ...cap2.slice(1, -1), s2m, s1m, ...cap1.slice(1, -1)]
}

function circleOutline(c: Pt, r: number, steps = 48): Pt[] {
  return arc(c, r, 0, Math.PI * 2, steps)
}

/** 机架底板 + 加强肋轮廓（固定件）：底板与梯形肋板并集的简单闭合多边形 */
function frameBaseOutline(): Pt[] {
  // 底板：宽 46，厚 6（y=-30..-36）；肋板：梯形连接轴承座（顶 y=-10）
  const ribTop = -FRAME_R + 1
  return [
    { x: -23, y: -36 },
    { x: 23, y: -36 },
    { x: 23, y: -30 },
    { x: 13, y: -30 },
    { x: 9, y: ribTop },
    { x: -9, y: ribTop },
    { x: -13, y: -30 },
    { x: -23, y: -30 },
    { x: -23, y: -36 }, // 显式回到起点，构成闭合环
  ]
}

// ------------------------------------------------------------------
// 完整机构几何
// ------------------------------------------------------------------

export interface CSGeometry {
  sol: CSSolveResult
  /** 实体零件（局部坐标，可直接导出） */
  solids: {
    frameBase: MechSolid
    frameBearing: MechSolid
    crank: MechSolid
    rod: MechSolid
    block: MechSolid
  }
  /** 直线导轨：两条平行线段 */
  rails: [{ x1: number; y1: number; x2: number; y2: number }, { x1: number; y1: number; x2: number; y2: number }]
  /** 地面阴影线（辅助显示，不导出） */
  ground: Pt
  /** 滑块行程轨迹（辅助） */
  trace: { x1: number; x2: number }
  /** 曲柄销扫过圆半径（辅助） */
  crankCircleR: number
  /** 当前姿态下实体是否存在明显干涉（铰接点正常接触不计） */
  interference: boolean
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** 线段（无限延长线概念不用）与矩形相交：返回线段上落在矩形内的参数区间 t∈[0,1] */
function segmentInRect(p1: Pt, p2: Pt, rx0: number, ry0: number, rx1: number, ry1: number): [number, number] | null {
  // Liang–Barsky
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!clip(-dx, p1.x - rx0)) return null
  if (!clip(dx, rx1 - p1.x)) return null
  if (!clip(-dy, p1.y - ry0)) return null
  if (!clip(dy, ry1 - p1.y)) return null
  return [t0, t1]
}

export function crankSliderGeometry(p: CrankSliderParams, thetaDeg: number): CSGeometry {
  const sol = solveCrankSlider(p, thetaDeg)
  const { O, A, B } = sol
  const dims = csDims(p)

  // 曲柄：圆头连杆外形（端头 endD、杆身 crankW），O 为固定轴孔、A 为铰接销孔
  const crank: MechSolid = {
    outline: linkOutline(O, A, dims.endD, dims.crankW),
    holes: [
      { x: O.x, y: O.y, r: dims.shaftR, purpose: 'shaft' },
      { x: A.x, y: A.y, r: dims.pinR, purpose: 'pin' },
    ],
  }
  // 连杆：两端铰接销孔（高级参数可令两端孔径不同）
  const rod: MechSolid = {
    outline: linkOutline(A, B, dims.endD, dims.rodW),
    holes: [
      { x: A.x, y: A.y, r: dims.rodHoleAR, purpose: 'pin' },
      { x: B.x, y: B.y, r: dims.rodHoleBR, purpose: 'pin' },
    ],
  }
  // 滑块：圆头矩形（胶囊），长度 blockW、宽 blockH，端部半圆；销孔与连杆 B 端同销
  const straight = Math.max(0, p.blockW - p.blockH) / 2
  const u = p.axisSign >= 0 ? 1 : -1
  const block: MechSolid = {
    outline: barOutline(
      { x: B.x - u * straight, y: 0 },
      { x: B.x + u * straight, y: 0 },
      p.blockH,
    ),
    holes: [{ x: B.x, y: B.y, r: dims.rodHoleBR, purpose: 'pin' }],
  }

  const frameBearing: MechSolid = {
    outline: circleOutline(O, FRAME_R),
    holes: [{ x: 0, y: 0, r: dims.shaftR, purpose: 'shaft' }],
  }
  const frameBase: MechSolid = { outline: frameBaseOutline(), holes: [] }

  // 导轨：覆盖整个行程并留余量
  const margin = 16
  const railX1 = sol.strokeRange[0] - p.blockW / 2 - margin
  const railX2 = sol.strokeRange[1] + p.blockW / 2 + margin
  const railY = p.blockH / 2 + RAIL_GAP
  const rails: CSGeometry['rails'] = [
    { x1: railX1, y1: railY, x2: railX2, y2: railY },
    { x1: railX1, y1: -railY, x2: railX2, y2: -railY },
  ]

  // 干涉检查：离散 64 个姿态，检查曲柄杆身（除 O/A 铰接区外）是否穿入滑块矩形
  let interference = false
  if (sol.valid) {
    const tol = dims.crankW // 允许曲柄头 + 铰接区域进入滑块的容差
    const bx0 = -p.blockW / 2
    const bx1 = p.blockW / 2
    const by0 = -p.blockH / 2
    const by1 = p.blockH / 2
    for (let k = 0; k < 64; k++) {
      const th = (k / 64) * Math.PI * 2
      const Ak: Pt = { x: p.crankR * Math.cos(th), y: p.crankR * Math.sin(th) }
      const root = Math.sqrt(Math.max(0, p.rodL * p.rodL - p.crankR * p.crankR * Math.sin(th) ** 2))
      const bk = p.crankR * Math.cos(th) + p.axisSign * root
      // 滑块矩形在世界（局部）坐标
      const hit = segmentInRect(O, Ak, bk + bx0, by0, bk + bx1, by1)
      if (hit) {
        const enterT = hit[0] // 杆从 O 出发首次进入滑块的参数
        const distFromO = enterT * p.crankR
        const distFromA = p.crankR - distFromO
        // O 在滑块外时，只有 A 端附近（铰接处）进入是允许的
        const oInside = O.x >= bk + bx0 && O.x <= bk + bx1 && O.y >= by0 && O.y <= by1
        if (!oInside && distFromA > tol) {
          interference = true
          break
        }
      }
    }
  }

  const bounds = {
    minX: Math.min(railX1, -FRAME_R, -p.crankR),
    maxX: Math.max(railX2, FRAME_R, p.crankR),
    minY: Math.min(BASE_BOTTOM, -railY, -p.crankR),
    maxY: Math.max(railY, p.crankR),
  }

  return {
    sol,
    solids: { frameBase, frameBearing, crank, rod, block },
    rails,
    ground: { x: -23, y: BASE_BOTTOM },
    trace: { x1: sol.strokeRange[0], x2: sol.strokeRange[1] },
    crankCircleR: p.crankR,
    interference,
    bounds,
  }
}

/** 机构包围盒（世界坐标），用于框选与适应画布 */
export function mechanismBounds(p: CrankSliderParams) {
  const g = crankSliderGeometry(p, 0)
  return g.bounds
}
