// ------------------------------------------------------------------
// 齿轮齿条机构（rack & pinion）
// 坐标系（机构局部坐标，齿轮中心 O 为原点，Y 向上）：
//   齿轮参数：模数 m、齿数 z，分度圆半径 rp = m·z/2，压力角 α = 20°
//   齿条齿距 p = π·m（与齿轮同一模数体系，齿廓为渐开线在齿数→∞ 时的
//   极限——直线齿廓），齿顶高 ha=m，齿根高 hf=1.25m。
//   齿轮转过 θ（rad，逆时针为正）时齿条位移：
//     s = −side · rp · θ
//   （上侧啮合点在齿轮顶部，逆时针时点速度向左；下侧相反。）
//   装配相位 phase = π·m·(z−2)/4，使 θ=0 时啮合点处轮齿与齿槽严格对齐。
// 渲染、检查、导出共用本模块，保证各处几何一致。

import { RackPinionParams } from '../types'
import { gearProfile, Pt } from '../geometry/gear'
import { MechSolid, Circle } from './crankSlider'

// ---- 参数范围与默认值 ----
export const RP_LIMITS = {
  z: { min: 8, max: 150 },
  m: { min: 0.5, max: 8 },
  bore: { min: 0, max: 60 },
  rackL: { min: 30, max: 600 },
  travel: { min: 0, max: 400 },
  rackBodyW: { min: 4, max: 60 },
  mountD: { min: 0, max: 20 },
  mountCount: { min: 0, max: 6 },
  mountSpacing: { min: 10, max: 400 },
  initialAngle: { min: 0, max: 360 },
  driverRpm: { min: -120, max: 120 },
}

export const DEFAULT_RACK_PINION = {
  z: 20,
  m: 2,
  bore: 5,
  rackL: 120,
  travel: 60,
  rackSide: 1 as 1 | -1,
  showTrace: true,
  showArrow: true,
  // 实体尺寸
  rackBodyW: 8,
  mountD: 3.2,
  mountCount: 2,
  mountSpacing: 60,
}

const PRESSURE_ANGLE = (20 * Math.PI) / 180 // 标准压力角 20°
const FRAME_R = 11 // 齿轮轴轴承外半径
const SHAFT_R = 4.2 // 主轴孔半径
const FRAME_GAP = 10 // 支座与齿顶圆的间距
const RAIL_GAP = 3
const ARC_STEPS = 12

// ------------------------------------------------------------------
// 运动学求解
// ------------------------------------------------------------------

export interface RPSolveResult {
  theta: number // 齿轮当前转角（rad）
  rp: number // 分度圆半径 mm
  pitch: number // 齿条齿距 p = πm mm
  /** 齿条沿导轨的位移 mm（相对装配零位） */
  s: number
  /** 齿条装配相位（世界 X 方向常数偏移） */
  phase: number
  /** 节线世界 Y 坐标 */
  pitchLineY: number
  /** 齿条中点当前世界 X */
  rackCx: number
  valid: boolean
  reason: string | null
}

export function solveRackPinion(p: RackPinionParams, thetaDeg: number): RPSolveResult {
  const theta = (thetaDeg * Math.PI) / 180
  const rp = (p.m * p.z) / 2
  const pitch = Math.PI * p.m
  const s = -p.rackSide * rp * theta
  const phase = (Math.PI * p.m * (p.z - 2)) / 4
  const pitchLineY = p.rackSide * rp
  const rackCx = s + phase

  let valid = true
  let reason: string | null = null
  if (!(p.m > 0) || !(p.z >= 2)) {
    valid = false
    reason = '齿轮模数或齿数无效，无法组成齿轮齿条机构。'
  }

  return { theta, rp, pitch, s, phase, pitchLineY, rackCx, valid, reason }
}

// ------------------------------------------------------------------
// 齿条齿形（直线齿廓，渐开线齿条的标准几何）
// ------------------------------------------------------------------

/** 齿条结构尺寸（齿高只由模数决定，基体宽度是独立的实体尺寸，不影响齿形） */
export function rackDims(p: RackPinionParams) {
  const ha = p.m // 齿顶高
  const hf = 1.25 * p.m // 齿根高
  const body = p.rackBodyW ?? Math.max(2 * p.m, 6) // 基体宽度（用户参数，旧数据回退）
  return { ha, hf, body, totalH: hf + body }
}

/**
 * 齿条安装孔（局部坐标，真实开孔）：沿齿条基体中线均布。
 * n 个孔以齿条中心对称排列，相邻孔间距 mountSpacing；直径 0 或数量 0 时无孔。
 */
export function rackMountHoles(p: RackPinionParams): Circle[] {
  // 旧数据缺字段时回退默认（与 mfgChecks 解析一致：默认 2 个 Φ3.2 对称安装孔）
  const n = Math.max(0, Math.round(p.mountCount ?? 2))
  const d = p.mountD ?? 3.2
  if (n < 1 || !(d > 0)) return []
  const { hf, body } = rackDims(p)
  const spacing = p.mountSpacing ?? 60
  const out: Circle[] = []
  for (let k = 0; k < n; k++) {
    out.push({ x: (k - (n - 1) / 2) * spacing, y: hf + body / 2, r: d / 2, purpose: 'mount' })
  }
  return out
}

/**
 * 齿条齿面（朝齿轮一侧）在局部坐标 x 处的 y 值。
 * 局部坐标：节线 y=0，齿朝向 −Y；齿厚中点位于 x = k·p（与 rackOutline 齿列同一约定）。
 */
function rackProfileY(x: number, pitch: number, ha: number, hf: number): number {
  const tanA = Math.tan(PRESSURE_ANGLE)
  // 相对最近齿厚中点（整数倍齿距处）的距离 0..p/2
  const u = ((x % pitch) + pitch) % pitch // 0..p
  const d = Math.min(u, pitch - u)
  const rootHalf = pitch / 4 + hf * tanA // 齿根处齿半宽
  const tipHalf = pitch / 4 - ha * tanA // 齿顶处齿半宽
  if (d <= tipHalf) return -ha
  if (d < rootHalf) return (d - pitch / 4) / tanA
  return hf
}

/** 齿条实体轮廓（局部坐标）：带真实梯形齿的长条 */
function rackOutline(p: RackPinionParams): Pt[] {
  const pitch = Math.PI * p.m
  const { ha, hf, body } = rackDims(p)
  const L = p.rackL
  const x0 = -L / 2
  const x1 = L / 2
  const rootHalf = pitch / 4 + hf * Math.tan(PRESSURE_ANGLE)
  const tipHalf = pitch / 4 - ha * Math.tan(PRESSURE_ANGLE)

  // 齿面折线（从左到右）
  const toothed: Pt[] = [{ x: x0, y: rackProfileY(x0, pitch, ha, hf) }]
  const kFirst = Math.ceil((x0 - rootHalf) / pitch)
  const kLast = Math.floor((x1 + rootHalf) / pitch)
  for (let k = kFirst; k <= kLast; k++) {
    const kx = k * pitch
    const pts: Pt[] = [
      { x: kx - rootHalf, y: hf },
      { x: kx - tipHalf, y: -ha },
      { x: kx + tipHalf, y: -ha },
      { x: kx + rootHalf, y: hf },
    ]
    for (const q of pts) {
      if (q.x > x0 + 1e-9 && q.x < x1 - 1e-9) toothed.push(q)
    }
  }
  toothed.push({ x: x1, y: rackProfileY(x1, pitch, ha, hf) })

  // 本体背面与端部封闭
  return [
    ...toothed,
    { x: x1, y: hf + body },
    { x: x0, y: hf + body },
    { x: x0, y: toothed[0].y },
  ]
}

/** 局部齿条点 → 世界坐标 */
function rackToWorld(pt: Pt, sol: RPSolveResult, side: 1 | -1): Pt {
  return { x: pt.x + sol.rackCx, y: side * pt.y + sol.pitchLineY }
}

// ------------------------------------------------------------------
// 支座（固定齿轮轴，位于齿条对侧）
// ------------------------------------------------------------------

function circleOutline(c: Pt, r: number, steps = 48): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return pts
}

/** 支座底板与支杆轮廓（位于齿条对侧） */
function frameOutline(p: RackPinionParams, rp: number): MechSolid {
  const side = -p.rackSide // 支座在齿条对侧
  const bottom = side * (rp + FRAME_R + FRAME_GAP + 18)
  const neckY = side * (rp + FRAME_R + 2)
  const outline = [
    { x: -14, y: bottom },
    { x: 14, y: bottom },
    { x: 14, y: bottom - side * 6 },
    { x: 8, y: bottom - side * 6 },
    { x: 5, y: neckY },
    { x: -5, y: neckY },
    { x: -8, y: bottom - side * 6 },
    { x: -14, y: bottom - side * 6 },
    { x: -14, y: bottom },
  ]
  return { outline, holes: [] }
}

// ------------------------------------------------------------------
// 完整机构几何
// ------------------------------------------------------------------

export interface RPGeometry {
  sol: RPSolveResult
  solids: {
    pinion: MechSolid
    rack: MechSolid
    frameBearing: MechSolid
    frameBase: MechSolid
  }
  /** 齿条直线导轨：两条平行线（世界坐标） */
  rails: [{ x1: number; y1: number; x2: number; y2: number }, { x1: number; y1: number; x2: number; y2: number }]
  /** 地面阴影线端点（辅助显示） */
  ground: { x: number; y: number }
  /** 齿条移动轨迹（辅助） */
  trace: { x1: number; x2: number; y: number }
  /** 干涉（齿轮齿条啮合为设计接触，恒无额外干涉） */
  interference: boolean
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export function rackPinionGeometry(p: RackPinionParams, thetaDeg: number): RPGeometry {
  const sol = solveRackPinion(p, thetaDeg)
  const side = p.rackSide
  const { hf, body } = rackDims(p)

  // 齿轮（绕 O 旋转到当前姿态角；齿厚中点初始位于 +X 轴）
  const { outline } = gearProfile(p.z, p.m, p.bore)
  const ct = Math.cos(sol.theta)
  const st = Math.sin(sol.theta)
  const pinionOutline = outline.map((q) => ({ x: q.x * ct - q.y * st, y: q.x * st + q.y * ct }))
  const pinionHoles: Circle[] = p.bore > 0 ? [{ x: 0, y: 0, r: p.bore / 2, purpose: 'bore' }] : []
  const pinion: MechSolid = { outline: pinionOutline, holes: pinionHoles }

  // 齿条（局部 → 世界）：安装孔为真实内轮廓，随齿条一起平移
  const rackLocal = rackOutline(p)
  const rack: MechSolid = {
    outline: rackLocal.map((q) => rackToWorld(q, sol, side)),
    holes: rackMountHoles(p).map((h) => {
      const w = rackToWorld({ x: h.x, y: h.y }, sol, side)
      return { ...h, x: w.x, y: w.y }
    }),
  }

  // 轴承座与底板
  const frameBearing: MechSolid = {
    outline: circleOutline({ x: 0, y: 0 }, FRAME_R, ARC_STEPS * 4),
    holes: [{ x: 0, y: 0, r: SHAFT_R, purpose: 'shaft' }],
  }
  const frameBase = frameOutline(p, sol.rp)

  // 导轨：齿条本体背面外侧两条平行线，覆盖行程
  const railLen = p.rackL / 2 + p.travel + 12
  const railBaseY = sol.pitchLineY + side * (hf + body)
  const rails: RPGeometry['rails'] = [
    { x1: -railLen, y1: railBaseY + side * RAIL_GAP, x2: railLen, y2: railBaseY + side * RAIL_GAP },
    { x1: -railLen, y1: railBaseY + side * (RAIL_GAP + 5), x2: railLen, y2: railBaseY + side * (RAIL_GAP + 5) },
  ]

  // 轨迹：齿条本体中线在 ±travel 范围内的移动轨迹
  const traceLine = { x1: sol.phase - p.travel, x2: sol.phase + p.travel, y: sol.pitchLineY + side * (hf + body / 2) }

  const ground = { x: 14, y: -p.rackSide * (sol.rp + FRAME_R + FRAME_GAP + 24) }

  // 包围盒
  const pts: Pt[] = [
    ...pinion.outline,
    ...rack.outline,
    ...frameBase.outline,
    { x: -sol.rp - FRAME_R, y: 0 }, { x: sol.rp + FRAME_R, y: 0 },
  ]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const q of pts) {
    minX = Math.min(minX, q.x); minY = Math.min(minY, q.y)
    maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y)
  }

  return {
    sol,
    solids: { pinion, rack, frameBearing, frameBase },
    rails,
    ground,
    trace: { x1: traceLine.x1, x2: traceLine.x2, y: traceLine.y },
    interference: false,
    bounds: { minX, minY, maxX, maxY },
  }
}

/** 机构静止包围盒（用于避让、框选、适应画布）：取若干姿态合并 */
export function rackBounds(p: RackPinionParams): { minX: number; minY: number; maxX: number; maxY: number } {
  let b = rackPinionGeometry(p, 0).bounds
  // 行程范围内齿条滑到两端的包围盒
  const ext = p.travel
  b = { minX: b.minX - ext, maxX: b.maxX + ext, minY: b.minY, maxY: b.maxY }
  return b
}
