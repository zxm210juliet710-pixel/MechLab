// 参数校验、啮合检查与几何碰撞检查
import { Gear, Mechanism, CheckResult, PairIssue, GearIssue, Severity, DEFAULT_MANUFACTURING } from '../types'
import { gearDims, idealDistance, normAngle, phaseResidual } from './gear'
import { checkMechanism } from '../mechanisms/mechChecks'
import { checkManufacturing } from '../mechanisms/mfgChecks'

export const Z_MIN = 8
export const Z_MAX = 300
export const M_MIN = 0.5
export const M_MAX = 10
export const T_MIN = 0.5
export const T_MAX = 50
export const BORE_MAX = 200

/** 中心距“良好啮合”相对容差 */
const DIST_OK = 0.01
/** 中心距“可接受/接近”相对容差 */
const DIST_WARN = 0.05
/** 齿形相位对齐容差（弧度，约 2°） */
const PHASE_TOL = 0.035

function dist(g1: Gear, g2: Gear): number {
  return Math.hypot(g2.x - g1.x, g2.y - g1.y)
}

/** 校验单个齿轮参数 */
export function validateGear(g: Gear): GearIssue[] {
  const issues: GearIssue[] = []
  const push = (severity: Severity, message: string) => issues.push({ gearId: g.id, severity, message })

  if (!Number.isFinite(g.z) || !Number.isInteger(g.z)) {
    push('error', `${g.name}：齿数必须是正整数。`)
    return issues // 后续尺寸计算依赖齿数，直接返回
  }
  if (g.z < Z_MIN || g.z > Z_MAX) {
    push('error', `${g.name}：齿数允许范围为 ${Z_MIN}～${Z_MAX} 齿（标准不根切直齿轮一般不少于 17 齿）。`)
  }
  if (!Number.isFinite(g.m) || g.m < M_MIN || g.m > M_MAX) {
    push('error', `${g.name}：模数需在 ${M_MIN}～${M_MAX} mm 之间。`)
    return issues
  }
  if (!Number.isFinite(g.thickness) || g.thickness < T_MIN || g.thickness > T_MAX) {
    push('error', `${g.name}：厚度需在 ${T_MIN}～${T_MAX} mm 之间且为正数。`)
  }
  if (!Number.isFinite(g.bore) || g.bore < 0 || g.bore > BORE_MAX) {
    push('error', `${g.name}：中心孔直径需在 0～${BORE_MAX} mm 之间（0 表示无孔）。`)
  }

  const d = gearDims(g.z, g.m, g.bore)
  if (!(d.ra > 0) || !(d.rf > 0)) {
    push('error', `${g.name}：当前参数无法生成有效齿轮轮廓，请增大齿数或模数。`)
    return issues
  }
  if (d.undercut) {
    push('warn', `${g.name}：齿数少于 17，标准刀具加工时齿根可能出现根切，承载能力下降，仅建议用于演示。`)
  }
  if (g.bore > 0) {
    const rootD = d.rf * 2
    if (g.bore >= rootD) {
      push('error', `${g.name}：中心孔直径 ${fmt(g.bore)} mm 已达到或超过齿根圆直径 ${fmt(rootD)} mm，齿轮将被切穿。`)
    } else if (rootD - g.bore < g.m) {
      push('warn', `${g.name}：中心孔与齿根之间的壁厚小于 1 个模数，切割后轮缘可能偏薄。`)
    }
  }
  return issues
}

/**
 * 计算外啮合齿形相位残差。
 * 正常外啮合时：一个齿轮以“齿中线”对准对方中心，另一个以“齿槽中线”对准。
 * 返回最小残差（弧度），越小对齐越好。
 */
export function meshPhaseResidual(g1: Gear, g2: Gear): number {
  const phi = Math.atan2(g2.y - g1.y, g2.x - g1.x)
  const b1 = normAngle(phi - (g1.rotation * Math.PI) / 180)
  const b2 = normAngle(phi + Math.PI - (g2.rotation * Math.PI) / 180)
  const p1 = (2 * Math.PI) / g1.z
  const p2 = (2 * Math.PI) / g2.z
  const rA = phaseResidual(b1, 0, p1) + phaseResidual(b2, p2 / 2, p2)
  const rB = phaseResidual(b1, p1 / 2, p1) + phaseResidual(b2, 0, p2)
  return Math.min(rA, rB)
}

/** 检查一对齿轮，返回单条综合结果 */
export function checkPair(g1: Gear, g2: Gear): PairIssue {
  const c = dist(g1, g2)
  const d1 = gearDims(g1.z, g1.m, g1.bore)
  const d2 = gearDims(g2.z, g2.m, g2.bore)
  const sameModule = Math.abs(g1.m - g2.m) < 1e-9
  const a = idealDistance(g1.z, g2.z, g1.m)

  const base = { a: g1.id, b: g2.id, distance: c, idealDistance: sameModule ? a : undefined }

  // 完全重合
  if (c < 1e-6) {
    return { ...base, severity: 'error', meshing: false, message: `${g1.name} 与 ${g2.name} 中心完全重合，请移开其中一个。` }
  }

  // 互不接触的齿轮对不构成任何关系：齿顶圆间隙超过基于尺寸的容差时，
  // 既不能啮合也不会干涉（多齿轮传动链中的非相邻齿轮即属此类）。
  const nearTol = sameModule
    ? Math.max(g1.m, 0.15 * (d1.r + d2.r))
    : Math.max(g1.m, g2.m, 0.15 * (d1.r + d2.r))
  if (c - (d1.ra + d2.ra) > nearTol) {
    return {
      ...base,
      idealDistance: undefined,
      severity: 'none',
      meshing: false,
      message: `${g1.name} 与 ${g2.name} 互不接触，没有啮合关系。`,
    }
  }

  // 实体重叠（齿根圆相交即必然干涉，正常啮合也不会发生）
  const bodyOverlap = c < d1.rf + d2.rf - 1e-6
  if (bodyOverlap) {
    return {
      ...base,
      severity: 'error',
      meshing: false,
      message: sameModule
        ? `${g1.name} 与 ${g2.name} 实体严重重叠（中心距 ${fmt(c)} mm，理论中心距 ${fmt(a)} mm）。`
        : `${g1.name} 与 ${g2.name} 模数不同且实体发生重叠，无法使用。`,
    }
  }

  if (!sameModule) {
    const touch = c < d1.ra + d2.ra - 1e-6
    return {
      ...base,
      idealDistance: undefined,
      severity: touch ? 'error' : 'warn',
      meshing: false,
      message: touch
        ? `${g1.name}（模数 ${fmt(g1.m)}）与 ${g2.name}（模数 ${fmt(g2.m)}）模数不同且轮廓相交，无法啮合。`
        : `${g1.name}（模数 ${fmt(g1.m)}）与 ${g2.name}（模数 ${fmt(g2.m)}）模数不同，无法正常啮合。`,
    }
  }

  const rel = Math.abs(c - a) / a
  const phase = meshPhaseResidual(g1, g2)
  const phaseOk = phase <= PHASE_TOL

  if (rel <= DIST_OK) {
    if (phaseOk) {
      return { ...base, severity: 'ok', meshing: true, message: `${g1.name} 与 ${g2.name} 参数一致，中心距与齿形相位均符合啮合条件。` }
    }
    return {
      ...base,
      severity: 'warn',
      meshing: false,
      message: `${g1.name} 与 ${g2.name} 中心距正确（${fmt(c)} mm），但齿形相位尚未对齐，转动时可能齿顶相顶，可使用“自动吸附啮合”对齐。`,
    }
  }

  if (rel <= DIST_WARN) {
    const dir = c > a ? '偏大' : '偏小'
    return {
      ...base,
      severity: 'warn',
      meshing: false,
      message: `${g1.name} 与 ${g2.name} 中心距${dir}：当前 ${fmt(c)} mm，理论 ${fmt(a)} mm（偏差 ${(rel * 100).toFixed(1)}%），可能产生异响或卡滞。`,
    }
  }

  // 偏差较大
  if (c < a) {
    return {
      ...base,
      severity: 'error',
      meshing: false,
      message: `${g1.name} 与 ${g2.name} 距离过近：当前中心距 ${fmt(c)} mm，理论中心距 ${fmt(a)} mm，请调整位置。`,
    }
  }
  const addendumTouch = c < d1.ra + d2.ra - 1e-6
  return {
    ...base,
    severity: addendumTouch ? 'warn' : 'error',
    meshing: false,
    message: addendumTouch
      ? `${g1.name} 与 ${g2.name} 距离接近但齿顶轻微接触：当前 ${fmt(c)} mm，理论 ${fmt(a)} mm。`
      : `${g1.name} 与 ${g2.name} 距离过远：当前中心距 ${fmt(c)} mm，理论中心距 ${fmt(a)} mm，无法啮合。`,
  }
}

/** 对画布上全部齿轮与机构执行检查（minWall 为孔周最小材料厚度，来自项目加工设置） */
export function runChecks(
  gears: Gear[],
  mechanisms: Mechanism[] = [],
  minWall: number = DEFAULT_MANUFACTURING.minWall,
): CheckResult {
  const gearIssues: GearIssue[] = []
  const pairIssues: PairIssue[] = []
  const mechIssues = mechanisms.flatMap(checkMechanism)
  const mfgIssues = mechanisms.flatMap((m) => checkManufacturing(m, minWall))
  const meshGraph: Record<string, string[]> = {}

  for (const g of gears) {
    gearIssues.push(...validateGear(g))
    meshGraph[g.id] = []
  }

  for (let i = 0; i < gears.length; i++) {
    for (let j = i + 1; j < gears.length; j++) {
      const r = checkPair(gears[i], gears[j])
      // 无关齿轮对（互不接触）不进入问题列表与啮合图
      if (r.severity === 'none') continue
      pairIssues.push(r)
      if (r.meshing) {
        meshGraph[gears[i].id].push(gears[j].id)
        meshGraph[gears[j].id].push(gears[i].id)
      }
    }
  }
  return { gearIssues, pairIssues, mechIssues, mfgIssues, meshGraph }
}

export function worstSeverity(result: CheckResult): Severity | null {
  let worst: Severity | null = null
  const rank: Record<Severity, number> = { none: 0, ok: 1, warn: 2, error: 3 }
  for (const i of result.gearIssues) if (!worst || rank[i.severity] > rank[worst]) worst = i.severity
  for (const i of result.pairIssues) if (!worst || rank[i.severity] > rank[worst]) worst = i.severity
  for (const i of result.mechIssues) if (!worst || rank[i.severity] > rank[worst]) worst = i.severity
  for (const i of result.mfgIssues) if (!worst || rank[i.severity] > rank[worst]) worst = i.severity
  return worst
}

export function fmt(v: number): string {
  return (Math.round(v * 1000) / 1000).toString()
}
