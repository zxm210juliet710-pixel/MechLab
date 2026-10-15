// 机构运动学检查：参数范围、杆长闭环约束、格拉霍夫条件、传动角与运动干涉。
// 孔/壁厚/轮廓等加工可行性检查见 mfgChecks.ts，两类检查分开显示。
import { Mechanism, MechIssue, Severity, CrankSliderParams, RackPinionParams, FourBarParams } from '../types'
import { crankSliderGeometry, solveCrankSlider, CS_LIMITS } from './crankSlider'
import { solveRackPinion, RP_LIMITS } from './rackPinion'
import { solveFourBar, grashofInfo, minTransmissionAngle, FB_LIMITS } from './fourBar'

function inRange(v: number, min: number, max: number) {
  return Number.isFinite(v) && v >= min && v <= max
}

/** 检查单个曲柄滑块机构 */
export function checkCrankSlider(m: Mechanism): MechIssue[] {
  const issues: MechIssue[] = []
  const push = (severity: Severity, message: string) =>
    issues.push({ mechId: m.id, severity, message })
  const p = m.params as CrankSliderParams

  if (!inRange(p.crankR, CS_LIMITS.crankR.min, CS_LIMITS.crankR.max)) {
    push('error', `${m.name}：曲柄长度需在 ${CS_LIMITS.crankR.min}～${CS_LIMITS.crankR.max} mm 之间。`)
  }
  if (!inRange(p.rodL, CS_LIMITS.rodL.min, CS_LIMITS.rodL.max)) {
    push('error', `${m.name}：连杆长度需在 ${CS_LIMITS.rodL.min}～${CS_LIMITS.rodL.max} mm 之间。`)
  }
  if (issues.some((i) => i.severity === 'error')) return issues // 运动学参数非法时不再做闭环检查

  // 曲柄存在条件：对心曲柄滑块要求 L ≥ r，否则无法整周转动
  if (p.rodL < p.crankR) {
    push('error', `${m.name}：连杆长度（${p.rodL} mm）小于曲柄长度（${p.crankR} mm），曲柄不能连续转动，请加长连杆或缩短曲柄。`)
    return issues
  }
  // 死点性能提示：L 越接近 r，θ≈90° 附近传动越费力
  if (p.rodL < 1.2 * p.crankR) {
    push('warn', `${m.name}：连杆长度接近曲柄长度，机构在极限位置附近传动较费力，建议连杆不短于曲柄的 1.2 倍。`)
  }

  // 运动学恒等校验：整周 64 个姿态下杆长必须保持不变、根号始终有效
  let maxRodError = 0
  for (let k = 0; k < 64; k++) {
    const s = solveCrankSlider(p, (k / 64) * 360)
    if (!s.valid) {
      push('error', `${m.name}：${s.reason ?? '机构在部分角度无法成立。'}`)
      break
    }
    maxRodError = Math.max(maxRodError, s.rodError)
  }
  if (maxRodError > 1e-6) {
    push('error', `${m.name}：运动过程中连杆长度发生变化（计算偏差 ${maxRodError.toFixed(4)} mm），请检查参数。`)
  }

  // 实体干涉（排除铰接点正常接触）
  const g = crankSliderGeometry(p, m.initialAngle)
  if (g.interference) {
    push('warn', `${m.name}：当前尺寸下曲柄在部分角度会与滑块实体发生非铰接区域的干涉，建议减小曲柄长度或增大滑块尺寸。`)
  }

  return issues
}

/** 检查单个齿轮齿条机构 */
export function checkRackPinion(m: Mechanism): MechIssue[] {
  const issues: MechIssue[] = []
  const push = (severity: Severity, message: string) =>
    issues.push({ mechId: m.id, severity, message })
  const p = m.params as RackPinionParams

  const inR = (v: number, lim: { min: number; max: number }) =>
    Number.isFinite(v) && v >= lim.min && v <= lim.max

  if (!inR(p.z, RP_LIMITS.z)) push('error', `${m.name}：齿轮齿数需在 ${RP_LIMITS.z.min}～${RP_LIMITS.z.max} 之间。`)
  if (!inR(p.m, RP_LIMITS.m)) push('error', `${m.name}：模数需在 ${RP_LIMITS.m.min}～${RP_LIMITS.m.max} mm 之间。`)
  if (!inR(p.rackL, RP_LIMITS.rackL)) push('error', `${m.name}：齿条长度需在 ${RP_LIMITS.rackL.min}～${RP_LIMITS.rackL.max} mm 之间。`)
  if (!inR(p.travel, RP_LIMITS.travel)) push('error', `${m.name}：单侧行程需在 0～${RP_LIMITS.travel.max} mm 之间。`)
  if (issues.some((i) => i.severity === 'error')) return issues

  // 齿数过少根切提示（与独立齿轮一致，z<17）
  if (p.z < 17) {
    push('warn', `${m.name}：齿轮齿数少于 17，标准刀具加工会发生根切，仅用于演示可以接受。`)
  }

  const pitch = Math.PI * p.m
  // 齿条长度至少容纳 5 个完整齿
  if (p.rackL < pitch * 5) {
    push('error', `${m.name}：齿条长度 ${p.rackL} mm 不足 5 个齿距（齿距 ${pitch.toFixed(2)} mm），请加长齿条。`)
  }

  const sol = solveRackPinion(p, m.initialAngle)
  // 齿形匹配：齿条齿距必须等于齿轮 πm（本实现齿条齿距直接由模数派生，恒成立，
  // 仍做数值断言并展示，防止后续扩展时两者脱钩）
  if (Math.abs(sol.pitch - pitch) > 1e-9) {
    push('error', `${m.name}：齿条齿距（${sol.pitch.toFixed(3)} mm）与齿轮模数要求的齿距（${pitch.toFixed(3)} mm）不一致，不能正常啮合。`)
  }
  // 初始姿态是否已超出有效行程
  if (Math.abs(sol.s) > p.travel + 1e-9) {
    push('warn', `${m.name}：初始角度下齿条已超出有效行程（位移 ${sol.s.toFixed(1)} mm，允许 ±${p.travel} mm），模拟时齿条会滑出导轨，请减小初始角度或增大行程。`)
  }

  return issues
}

/** 检查单个四连杆机构 */
export function checkFourBar(m: Mechanism): MechIssue[] {
  const issues: MechIssue[] = []
  const push = (severity: Severity, message: string) =>
    issues.push({ mechId: m.id, severity, message })
  const p = m.params as FourBarParams
  const L = FB_LIMITS

  const inR = (v: number, lim: { min: number; max: number }) =>
    Number.isFinite(v) && v >= lim.min && v <= lim.max
  if (!inR(p.frameL, L.frameL)) push('error', `${m.name}：机架长度需在 ${L.frameL.min}～${L.frameL.max} mm 之间。`)
  if (!inR(p.crankL, L.crankL)) push('error', `${m.name}：曲柄长度需在 ${L.crankL.min}～${L.crankL.max} mm 之间。`)
  if (!inR(p.couplerL, L.couplerL)) push('error', `${m.name}：连杆长度需在 ${L.couplerL.min}～${L.couplerL.max} mm 之间。`)
  if (!inR(p.rockerL, L.rockerL)) push('error', `${m.name}：摇杆长度需在 ${L.rockerL.min}～${L.rockerL.max} mm 之间。`)
  if (issues.some((i) => i.severity === 'error')) return issues

  // 两个固定铰轴承（外半径 11 mm）不能重叠
  if (p.frameL < 22) {
    push('error', `${m.name}：机架长度 ${p.frameL} mm 过小，两个固定铰轴承会重叠，请不小于 22 mm。`)
    return issues
  }

  // 格拉霍夫条件：曲柄必须能整周转动
  const g = grashofInfo(p)
  if (!g.grashof) {
    push('error', `${m.name}：当前杆长不满足格拉霍夫条件（最短杆 ${g.shortest} mm + 最长杆 ${g.longest} mm > 其余两杆之和 ${g.restSum} mm），没有任何杆能整周转动，请加长连杆/摇杆或缩短曲柄。`)
    return issues
  }
  if (g.type !== 'crankRocker') {
    const typeCN = g.type === 'doubleCrank' ? '双曲柄机构' : '双摇杆机构'
    push('error', `${m.name}：当前杆长组成的是${typeCN}，本机构要求曲柄为最短杆（曲柄摇杆机构）才能由曲柄连续转动驱动，请缩短曲柄长度。`)
    return issues
  }

  // 整周 72 姿态：可装配、杆长恒定、求解不跳支
  const n = 72
  let maxErr = 0
  let prevB: { x: number; y: number } | null = null
  let jump = 0
  for (let k = 0; k <= n; k++) {
    const s = solveFourBar(p, (k / n) * 360)
    if (!s.valid) {
      push('error', `${m.name}：${s.reason ?? '机构在部分角度无法装配。'}`)
      break
    }
    maxErr = Math.max(maxErr, s.errL3, s.errL4)
    if (prevB) jump = Math.max(jump, Math.hypot(s.B.x - prevB.x, s.B.y - prevB.y))
    prevB = s.B
  }
  if (maxErr > 1e-6) {
    push('error', `${m.name}：运动过程中杆长发生变化（计算偏差 ${maxErr.toFixed(4)} mm），请检查参数。`)
  }
  // 单步（5°）正常运动远小于杆长；若位移超过杆长和的 1/4，说明在两支之间跳变
  if (jump > (p.couplerL + p.rockerL) / 4) {
    push('error', `${m.name}：求解过程中连杆与摇杆在两个装配位置之间跳变，请调整杆长使机构在整周内唯一连续。`)
  }

  // 传动角：越小传力越费力，习惯上不宜小于约 40°，小于 20° 给出警告
  const mu = minTransmissionAngle(p)
  if (Number.isFinite(mu) && mu < 20) {
    push('warn', `${m.name}：最小传动角仅 ${mu.toFixed(1)}°，机构在极限位置附近传动较费力，建议增大摇杆或连杆长度使传动角不小于 40°。`)
  }

  return issues
}

/** 机构检查分发（按机构类型） */
export function checkMechanism(m: Mechanism): MechIssue[] {
  if (m.kind === 'crankSlider') return checkCrankSlider(m)
  if (m.kind === 'rackPinion') return checkRackPinion(m)
  if (m.kind === 'fourBar') return checkFourBar(m)
  return []
}
