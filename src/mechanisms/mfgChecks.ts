// 加工合理性检查：基于真实实体几何（孔位、壁厚、轮廓闭合、齿条安装孔等）
// 与运动学检查（mechChecks.ts）分开：运动正常不等于可以安全加工。
import { Mechanism, MechIssue, CrankSliderParams, RackPinionParams, FourBarParams } from '../types'
import { crankSliderGeometry, csDims, CS_LIMITS } from './crankSlider'
import { rackPinionGeometry, rackDims, rackMountHoles, RP_LIMITS } from './rackPinion'
import { fourBarGeometry, fbDims, FB_LIMITS } from './fourBar'
import { validateSolidGeometry } from './link'

function inRange(v: number, min: number, max: number) {
  return Number.isFinite(v) && v >= min && v <= max
}

/** 对单个机构执行加工检查 */
export function checkManufacturing(m: Mechanism, minWall: number): MechIssue[] {
  if (m.kind === 'crankSlider') return checkCS(m, minWall)
  if (m.kind === 'rackPinion') return checkRP(m, minWall)
  return checkFB(m, minWall)
}

function collect(m: Mechanism, label: string, solid: Parameters<typeof validateSolidGeometry>[0], minWall: number, out: MechIssue[]) {
  for (const i of validateSolidGeometry(solid, minWall)) {
    out.push({ mechId: m.id, severity: i.severity, message: `${m.name}：${label}：${i.message}` })
  }
}

/** 壁厚提示：端头半径 − 孔半径 = 单边材料厚度 */
function wallWarn(m: Mechanism, out: MechIssue[], part: string, outerR: number, holeR: number, minWall: number) {
  const wall = outerR - holeR
  if (wall < -1e-6) {
    out.push({ mechId: m.id, severity: 'error', message: `${m.name}：${part}的连接孔比端头还大，外轮廓会被切穿，请增大端头外径或减小孔径。` })
  } else if (wall < minWall - 1e-6) {
    out.push({ mechId: m.id, severity: 'warn', message: `${m.name}：${part}孔周材料最薄处约 ${Math.max(0, wall).toFixed(1)} mm（建议不少于 ${minWall} mm），切割后端头容易裂开。` })
  }
}

/** 杆身宽度提示：杆身需在孔两侧各保留 minWall 材料 */
function webWarn(m: Mechanism, out: MechIssue[], part: string, bodyW: number, holeD: number, minWall: number) {
  if (bodyW < holeD + 2 * minWall - 1e-6) {
    out.push({ mechId: m.id, severity: 'warn', message: `${m.name}：${part}杆身宽度 ${bodyW} mm 相对于 ${holeD} mm 的孔偏窄，建议杆身宽度不小于孔径 + ${2 * minWall} mm。` })
  }
}

// ------------------------------------------------------------------
// 曲柄滑块
// ------------------------------------------------------------------

function checkCS(m: Mechanism, minWall: number): MechIssue[] {
  const out: MechIssue[] = []
  const p = m.params as CrankSliderParams
  const dims = csDims(p)
  const L = CS_LIMITS

  // 旧数据缺新增字段时按默认值参与检查（与几何解析器 csDims 一致）
  const pinD = p.pinD ?? 3.2
  const shaftD = p.shaftD ?? 8.2
  const holeAD = p.rodHoleA ?? pinD
  const holeBD = p.rodHoleB ?? pinD
  const numRanges: Array<[number, { min: number; max: number }, string]> = [
    [p.blockW, L.blockW, '滑块长度'],
    [p.blockH, L.blockH, '滑块宽度'],
    [dims.rodW, L.rodW, '连杆杆身宽度'],
    [dims.crankW, L.crankW, '曲柄杆身宽度'],
    [pinD, L.pinD, '连接孔直径'],
    [dims.endD, L.endD, '连接头外径'],
    [shaftD, L.shaftD, '固定轴孔直径'],
  ]
  for (const [v, lim, name] of numRanges) {
    if (!inRange(v, lim.min, lim.max)) {
      out.push({ mechId: m.id, severity: 'error', message: `${m.name}：${name}需在 ${lim.min}～${lim.max} mm 之间。` })
    }
  }
  for (const [v, name] of [[p.rodHoleA, '连杆第一端孔径'], [p.rodHoleB, '连杆第二端孔径']] as Array<[number | undefined, string]>) {
    if (v !== undefined && !inRange(v, L.pinD.min, L.endD.max)) {
      out.push({ mechId: m.id, severity: 'error', message: `${m.name}：${name}需为 ${L.pinD.min}～${L.endD.max} mm 之间的正数。` })
    }
  }
  if (out.some((i) => i.severity === 'error')) return out

  // 端头/杆身与孔的关系（运动学中心距不参与加工判断）
  wallWarn(m, out, '曲柄固定端', dims.endD / 2, dims.shaftR, minWall)
  wallWarn(m, out, '曲柄销端', dims.endD / 2, dims.pinR, minWall)
  wallWarn(m, out, '连杆端头', dims.endD / 2, Math.max(dims.rodHoleAR, dims.rodHoleBR), minWall)
  webWarn(m, out, '曲柄', dims.crankW, Math.max(pinD, shaftD), minWall)
  webWarn(m, out, '连杆', dims.rodW, Math.max(holeAD, holeBD), minWall)
  if (p.blockW < pinD + 2 * minWall - 1e-6) {
    out.push({ mechId: m.id, severity: 'warn', message: `${m.name}：滑块长度 ${p.blockW} mm 相对于销孔偏小，建议滑块长度不小于孔径 + ${2 * minWall} mm。` })
  }

  // 基于真实实体的几何校验（孔在轮廓内、孔周材料、轮廓闭合、零长度线段）
  const g = crankSliderGeometry(p, m.initialAngle)
  collect(m, '机架底板', g.solids.frameBase, minWall, out)
  collect(m, '固定铰支座', g.solids.frameBearing, minWall, out)
  collect(m, '曲柄', g.solids.crank, minWall, out)
  collect(m, '连杆', g.solids.rod, minWall, out)
  collect(m, '滑块', g.solids.block, minWall, out)
  return out
}

// ------------------------------------------------------------------
// 齿轮齿条
// ------------------------------------------------------------------

function checkRP(m: Mechanism, minWall: number): MechIssue[] {
  const out: MechIssue[] = []
  const p = m.params as RackPinionParams
  const L = RP_LIMITS

  // 旧数据缺新增字段时按默认值参与检查（与几何解析器 rackDims/rackMountHoles 一致）
  const bodyW = rackDims(p).body
  const mountD = p.mountD ?? 3.2
  const mountCount = p.mountCount ?? 2
  const mountSpacing = p.mountSpacing ?? 60
  if (!inRange(bodyW, L.rackBodyW.min, L.rackBodyW.max)) {
    out.push({ mechId: m.id, severity: 'error', message: `${m.name}：齿条基体宽度需在 ${L.rackBodyW.min}～${L.rackBodyW.max} mm 之间。` })
  }
  if (!inRange(mountD, L.mountD.min, L.mountD.max)) {
    out.push({ mechId: m.id, severity: 'error', message: `${m.name}：安装孔直径需在 0～${L.mountD.max} mm 之间（0 表示不打孔）。` })
  }
  if (!Number.isInteger(mountCount) || !inRange(mountCount, L.mountCount.min, L.mountCount.max)) {
    out.push({ mechId: m.id, severity: 'error', message: `${m.name}：安装孔数量需为 ${L.mountCount.min}～${L.mountCount.max} 之间的整数。` })
  }
  if (!inRange(mountSpacing, L.mountSpacing.min, L.mountSpacing.max)) {
    out.push({ mechId: m.id, severity: 'error', message: `${m.name}：安装孔间距需在 ${L.mountSpacing.min}～${L.mountSpacing.max} mm 之间。` })
  }
  if (out.some((i) => i.severity === 'error')) return out

  // 安装孔与齿条本体/端部/齿形区的关系（齿形本身只由模数决定）
  const holes = rackMountHoles(p)
  if (holes.length > 0) {
    const { body } = rackDims(p)
    const band = body / 2 - mountD / 2 // 孔边到齿根线与背面的单边距离
    if (band < minWall - 1e-6) {
      out.push({ mechId: m.id, severity: 'warn', message: `${m.name}：安装孔直径 ${mountD} mm 对 ${body} mm 宽的齿条基体偏大，孔到齿根或背面仅剩约 ${Math.max(0, band).toFixed(1)} mm 材料，请减小孔径或加宽基体。` })
    }
    for (const h of holes) {
      const endMargin = p.rackL / 2 - Math.abs(h.x) - h.r
      if (endMargin < -1e-6) {
        out.push({ mechId: m.id, severity: 'error', message: `${m.name}：位于 x=${h.x.toFixed(1)} mm 的安装孔已超出齿条端部，请减小孔间距/孔数量或加长齿条。` })
      } else if (endMargin < minWall - 1e-6) {
        out.push({ mechId: m.id, severity: 'warn', message: `${m.name}：最外侧安装孔距齿条端部仅剩约 ${Math.max(0, endMargin).toFixed(1)} mm，建议不少于 ${minWall} mm。` })
      }
    }
  }

  // 齿轮中心孔不能大过齿根（真实齿形实体会进一步做孔内切穿校验）
  const maxBore = p.m * (p.z - 2.5) - 2
  if (p.bore > maxBore) {
    out.push({ mechId: m.id, severity: 'error', message: `${m.name}：齿轮中心孔直径 ${p.bore} mm 过大，会切穿齿根，请不大于 ${maxBore.toFixed(1)} mm。` })
  }

  const g = rackPinionGeometry(p, m.initialAngle)
  collect(m, '齿轮', g.solids.pinion, minWall, out)
  collect(m, '齿条', g.solids.rack, minWall, out)
  collect(m, '齿轮轴支座', g.solids.frameBearing, minWall, out)
  collect(m, '支座底板', g.solids.frameBase, minWall, out)
  return out
}

// ------------------------------------------------------------------
// 四连杆
// ------------------------------------------------------------------

function checkFB(m: Mechanism, minWall: number): MechIssue[] {
  const out: MechIssue[] = []
  const p = m.params as FourBarParams
  const dims = fbDims(p)
  const L = FB_LIMITS

  // 旧数据缺新增字段时按默认值参与检查（与几何解析器 fbDims 一致）
  const pinD = p.pinD ?? 3.2
  const shaftD = p.shaftD ?? 8.2
  const holeAD = p.couplerHoleA ?? pinD
  const holeBD = p.couplerHoleB ?? pinD
  const numRanges: Array<[number, { min: number; max: number }, string]> = [
    [dims.crankW, L.crankW, '曲柄杆身宽度'],
    [dims.couplerW, L.couplerW, '连杆杆身宽度'],
    [dims.rockerW, L.rockerW, '摇杆杆身宽度'],
    [pinD, L.pinD, '连接孔直径'],
    [dims.endD, L.endD, '连接头外径'],
    [shaftD, L.shaftD, '固定轴孔直径'],
  ]
  for (const [v, lim, name] of numRanges) {
    if (!inRange(v, lim.min, lim.max)) {
      out.push({ mechId: m.id, severity: 'error', message: `${m.name}：${name}需在 ${lim.min}～${lim.max} mm 之间。` })
    }
  }
  for (const [v, name] of [[p.couplerHoleA, '连杆第一端孔径'], [p.couplerHoleB, '连杆第二端孔径']] as Array<[number | undefined, string]>) {
    if (v !== undefined && !inRange(v, L.pinD.min, L.endD.max)) {
      out.push({ mechId: m.id, severity: 'error', message: `${m.name}：${name}需为 ${L.pinD.min}～${L.endD.max} mm 之间的正数。` })
    }
  }
  if (out.some((i) => i.severity === 'error')) return out

  wallWarn(m, out, '曲柄端头', dims.endD / 2, Math.max(dims.shaftR, dims.pinR), minWall)
  wallWarn(m, out, '连杆端头', dims.endD / 2, Math.max(dims.couplerHoleAR, dims.couplerHoleBR), minWall)
  wallWarn(m, out, '摇杆端头', dims.endD / 2, Math.max(dims.shaftR, dims.pinR), minWall)
  webWarn(m, out, '曲柄', dims.crankW, Math.max(pinD, shaftD), minWall)
  webWarn(m, out, '连杆', dims.couplerW, Math.max(holeAD, holeBD), minWall)
  webWarn(m, out, '摇杆', dims.rockerW, Math.max(pinD, shaftD), minWall)

  const g = fourBarGeometry(p, m.initialAngle)
  collect(m, '曲柄固定铰支座', g.solids.bearingO4, minWall, out)
  collect(m, '摇杆固定铰支座', g.solids.bearingO2, minWall, out)
  collect(m, '曲柄', g.solids.crank, minWall, out)
  collect(m, '连杆', g.solids.coupler, minWall, out)
  collect(m, '摇杆', g.solids.rocker, minWall, out)
  return out
}
