// 渐开线标准直齿圆柱齿轮几何生成
// ------------------------------------------------------------------
// 采用真实渐开线齿形：
//   分度圆 d = m*z，基圆 db = d*cos(α)，齿顶圆 da = m*(z+2)，
//   齿根圆 df = m*(z-2.5)，标准压力角 α = 20°。
// 齿侧为基圆展开的渐开线；齿顶为齿顶圆弧；齿间为齿根圆弧。
// 基圆以下（齿数较少时）采用径向直线连接齿根圆作为工程近似，
// 真实刀具加工时该区域为延伸渐开线等距线（齿根过渡曲线/根切区域）。
// 输出闭合二维轮廓，画布渲染、检查与 SVG/DXF 导出共用同一份数据。

export interface Pt {
  x: number
  y: number
}

export interface GearDims {
  /** 分度圆半径 */
  r: number
  /** 基圆半径 */
  rb: number
  /** 齿顶圆半径 */
  ra: number
  /** 齿根圆半径 */
  rf: number
  /** 中心孔半径 */
  boreR: number
  /** 压力角（弧度） */
  alpha: number
  /** 是否可能根切（标准刀具 z < 17） */
  undercut: boolean
}

export const PRESSURE_ANGLE_DEG = 20
export const UNDERCUT_TEETH = 17

export function gearDims(z: number, m: number, bore: number): GearDims {
  const alpha = (PRESSURE_ANGLE_DEG * Math.PI) / 180
  const r = (m * z) / 2
  return {
    r,
    rb: r * Math.cos(alpha),
    ra: (m * (z + 2)) / 2,
    rf: (m * (z - 2.5)) / 2,
    boreR: bore / 2,
    alpha,
    undercut: z < UNDERCUT_TEETH,
  }
}

/** 渐开线展开角 inv(α) = tan α − α */
function inv(alpha: number): number {
  return Math.tan(alpha) - alpha
}

/**
 * 生成单侧渐开线齿侧上的点（局部坐标，齿厚中心位于 +X 轴）。
 * 齿侧极角 θ = offset − inv(α(ρ))：齿根处齿厚更大、齿顶处收窄，符合真实齿形。
 * @param offset 齿侧角偏移 δ = π/(2z) + inv(α)，使齿侧在分度圆处通过半齿厚点
 * @param sign 1 = 右侧（+角度侧），-1 = 左侧
 */
function involuteFlank(
  rb: number,
  rhoStart: number,
  rhoEnd: number,
  offset: number,
  n: number,
  sign: 1 | -1,
): Pt[] {
  const pts: Pt[] = []
  const a0 = Math.acos(Math.min(1, rb / rhoStart))
  const a1 = Math.acos(Math.min(1, rb / rhoEnd))
  for (let i = 0; i <= n; i++) {
    const ai = a0 + ((a1 - a0) * i) / n
    const rho = rb / Math.cos(ai)
    const theta = sign * (offset - (Math.tan(ai) - ai))
    pts.push({ x: rho * Math.cos(theta), y: rho * Math.sin(theta) })
  }
  return pts
}

/** 圆弧上的采样点（局部坐标，角度从 a0 到 a1，逆时针） */
function arcPoints(r: number, a0: number, a1: number, maxStepDeg = 2.5): Pt[] {
  const span = a1 - a0
  const steps = Math.max(1, Math.ceil((Math.abs(span) * 180) / Math.PI / maxStepDeg))
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (span * i) / steps
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) })
  }
  return pts
}

export interface GearProfile {
  /** 闭合外轮廓（局部坐标，逆时针） */
  outline: Pt[]
  dims: GearDims
  /** 齿距角（弧度） */
  pitchAngle: number
}

/**
 * 生成完整齿轮闭合外轮廓（局部坐标，原点为齿轮中心，+X 为第一个齿的中线）。
 */
export function gearProfile(z: number, m: number, bore: number, samples = 14): GearProfile {
  const dims = gearDims(z, m, bore)
  const { rb, ra, rf, alpha } = dims
  const pitch = (2 * Math.PI) / z

  // 分度圆处半齿厚角 π/(2z)；渐开线偏移 δ 使齿侧恰好通过该点
  const delta = Math.PI / (2 * z) + inv(alpha)
  // 齿根圆高于基圆时（z 较多），渐开线从齿根圆开始
  const rhoStart = Math.max(rb, rf)
  const aStart = Math.acos(Math.min(1, rb / rhoStart))
  // 齿侧在起始半径处的极角
  const flankBase = delta - (rhoStart > rb ? inv(aStart) : 0)
  // 齿顶处齿侧极角
  const aa = Math.acos(Math.min(1, rb / ra))
  const flankTip = delta - inv(aa)

  const outline: Pt[] = []
  const rotateTo = (p: Pt, c: number): Pt => {
    const cs = Math.cos(c)
    const sn = Math.sin(c)
    return { x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs }
  }

  for (let k = 0; k < z; k++) {
    const c = k * pitch
    const rootStart = c - pitch + flankBase
    const rootEnd = c - flankBase

    // 齿根圆弧
    if (rootEnd - rootStart > 1e-9) {
      outline.push(...arcPoints(rf, rootStart, rootEnd).slice(outline.length === 0 ? 0 : 1))
    }
    // 径向直线 rf → rb
    if (rf < rb) {
      outline.push({ x: rb * Math.cos(rootEnd), y: rb * Math.sin(rootEnd) })
    }
    // 左齿侧（局部负角度侧）：rhoStart → ra
    const left = involuteFlank(rb, rhoStart, ra, delta, samples, -1).slice(1).map((p) => rotateTo(p, c))
    outline.push(...left)
    // 齿顶圆弧
    outline.push(...arcPoints(ra, c - flankTip, c + flankTip).slice(1))
    // 右齿侧：ra → rhoStart
    const right = involuteFlank(rb, rhoStart, ra, delta, samples, 1)
      .reverse()
      .slice(1)
      .map((p) => rotateTo(p, c))
    outline.push(...right)
    // 径向直线 rb → rf
    if (rf < rb) {
      outline.push({ x: rf * Math.cos(c + flankBase), y: rf * Math.sin(c + flankBase) })
    }
  }

  return { outline, dims, pitchAngle: pitch }
}

/** 轮廓点数组转 SVG path 的 d 字符串（Y 向上的数学坐标，调用方负责翻转） */
export function outlineToPath(pts: Pt[], close = true): string {
  if (pts.length === 0) return ''
  let d = `M${pts[0].x.toFixed(3)},${pts[0].y.toFixed(3)}`
  for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(3)},${pts[i].y.toFixed(3)}`
  if (close) d += 'Z'
  return d
}

// ------------------------------------------------------------------
// 啮合几何辅助
// ------------------------------------------------------------------

/** 理论中心距 mm */
export function idealDistance(z1: number, z2: number, m: number): number {
  return (m * (z1 + z2)) / 2
}

/** 把角度规整到 [0, 2π) */
export function normAngle(a: number): number {
  const t = (2 * Math.PI)
  return ((a % t) + t) % t
}

/** 两个角按周期对齐的最小残差（绝对值，0~周期/2） */
export function phaseResidual(a: number, b: number, period: number): number {
  let d = Math.abs(normAngle(a - b)) % period
  if (d > period / 2) d = period - d
  return d
}
