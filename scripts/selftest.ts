// 几何与导出自检：npx esbuild scripts/selftest.ts --bundle --format=esm --outfile=...
import { gearDims, gearProfile, idealDistance } from '../src/geometry/gear'
import { meshPhaseResidual, checkPair, runChecks } from '../src/geometry/checks'
import { computeMotion } from '../src/geometry/motion'
import { buildSVG } from '../src/export/svg'
import { buildDXF } from '../src/export/dxf'
import { collectScene } from '../src/export/entities'
import { editorStore } from '../src/store/editor'
import { Gear, Mechanism, CrankSliderParams, RackPinionParams, FourBarParams } from '../src/types'
import { solveCrankSlider, crankSliderGeometry, csDims, DEFAULT_CRANK_SLIDER } from '../src/mechanisms/crankSlider'
import { solveRackPinion, rackPinionGeometry, rackMountHoles, DEFAULT_RACK_PINION } from '../src/mechanisms/rackPinion'
import {
  solveFourBar, fourBarGeometry, fbDims, DEFAULT_FOUR_BAR,
  grashofInfo, rockerSwing, minTransmissionAngle,
} from '../src/mechanisms/fourBar'
import { checkCrankSlider, checkRackPinion, checkFourBar } from '../src/mechanisms/mechChecks'
import { checkManufacturing } from '../src/mechanisms/mfgChecks'
import { linkOutline, validateSolidGeometry } from '../src/mechanisms/link'
import { preExportCheck } from '../src/export'

let pass = 0
let fail = 0
function assert(cond: boolean, name: string, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✕ ${name} ${extra}`) }
}
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

/**
 * 实体轮廓可闭合性：同时接受两种标准写法——
 *   隐式闭合（圆头杆 linkOutline，末点不重复首点，wrap 边为真实杆肩边）
 *   显式闭合（圆 0→2π、多边形末点=首点，wrap 边重合）
 * 要求：所有点有限；内部相邻边不允许零长度/重复点。
 */
function outlineClosable(points: { x: number; y: number }[]): boolean {
  if (points.length < 3) return false
  if (!points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return false
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    if (!(len > 1e-7) || !Number.isFinite(len)) return false
  }
  return Number.isFinite(Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y))
}

// ---------- 测试一：尺寸公式 ----------
console.log('测试一：m=2, z=20 齿轮尺寸')
const d = gearDims(20, 2, 5)
assert(approx(d.r * 2, 40), '分度圆直径 d = 40 mm')
assert(approx(d.ra * 2, 44), '齿顶圆直径 da = 44 mm')
assert(approx(d.rf * 2, 35), '齿根圆直径 df = 35 mm')
assert(approx(d.rb * 2, 40 * Math.cos((20 * Math.PI) / 180), 1e-9), '基圆直径 db = d·cos20°')

// 轮廓有效性
const prof = gearProfile(20, 2, 5)
assert(prof.outline.length > 600, `外轮廓采样点充足（${prof.outline.length} 点）`)
const allFinite = prof.outline.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
assert(allFinite, '轮廓无 NaN/Infinity')
const radiiOK = prof.outline.every((p) => {
  const r = Math.hypot(p.x, p.y)
  return r >= d.rf - 1e-6 && r <= d.ra + 1e-6
})
assert(radiiOK, '所有轮廓点均在齿根圆与齿顶圆之间')
const first = prof.outline[0]
const last = prof.outline[prof.outline.length - 1]
assert(Math.hypot(first.x - last.x, first.y - last.y) < 0.2, '轮廓首尾闭合（间距 <0.2 mm）')

// 齿数 8 与 60 也应生成有效轮廓
for (const z of [8, 16, 17, 60, 120]) {
  const p = gearProfile(z, 2, 3)
  const ok = p.outline.length > 100 && p.outline.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))
  assert(ok, `z=${z} 轮廓有效（${p.outline.length} 点）`)
}

// ---------- 测试二：啮合与传动比 ----------
console.log('测试二：z20 + z40 齿轮副')
const g1: Gear = { id: 'g1', name: '齿轮 1', z: 20, m: 2, thickness: 3, bore: 5, x: -30, y: 0, rotation: 0 }
const g2: Gear = {
  id: 'g2', name: '齿轮 2', z: 40, m: 2, thickness: 3, bore: 5, x: 30, y: 0,
  rotation: (((Math.PI - Math.PI / 40) * 180) / Math.PI),
}
assert(approx(idealDistance(20, 40, 2), 60), '理论中心距 a = 60 mm')
assert(approx(40 / 20, 2), '传动比绝对值 i = 2')
const pair = checkPair(g1, g2)
assert(pair.meshing && pair.severity === 'ok', `检查判定为正常啮合（${pair.message}）`)
assert(meshPhaseResidual(g1, g2) < 0.035, '齿形相位对齐（残差 < 2°）')

const checks = runChecks([g1, g2])
const motion = computeMotion([g1, g2], 'g1', 30, checks.meshGraph)
assert(approx(motion.omega.g1, 180), '主动轮角速度 = 180 °/s（30 r/min）')
assert(approx(motion.omega.g2, -90), '从动轮角速度 = −90 °/s（转速减半且方向相反）')
assert(motion.disconnected.length === 0 && motion.conflict === null, '传动链无断开、无矛盾')

// ---------- 错误场景 ----------
console.log('错误与警告场景')
const bad: Gear = { ...g2, id: 'g3', x: 30, y: 0, m: 2.5 }
const rDiffM = checkPair(g1, bad)
assert(rDiffM.severity === 'error' && !rDiffM.meshing, '模数不同且重叠 → 错误')
const far: Gear = { ...g2, id: 'g4', x: 200, y: 0 }
const rFar = checkPair(g1, far)
assert(rFar.severity === 'none' && !rFar.meshing, '相距很远、互不接触 → 无关系（不报错）')
// 不同模数且相距很远同样属于无关对
const farDiffM: Gear = { ...g2, id: 'g4b', x: 200, y: 0, m: 3 }
assert(checkPair(g1, farDiffM).severity === 'none', '不同模数但互不接触 → 无关系（不报错）')
// 规格示例：z20/z20 中心距 45 mm（理论 40），齿顶圆几乎接触 → 仍应报错
const near45: Gear = { ...g1, id: 'g4c', x: 15, y: 0 }
const r45 = checkPair(g1, near45)
assert(r45.severity === 'error' && r45.message.includes('45'), '凑近但中心距错误（45/40 mm）→ 错误')

// 三齿轮传动链：非相邻的首尾齿轮相距 120 mm，不应被误报
const chain: Gear[] = [
  g1,
  g2,
  { id: 'g3', name: '齿轮 3', z: 20, m: 2, thickness: 3, bore: 5, x: 90, y: 0, rotation: 0 },
]
const chainChecks = runChecks(chain)
assert(!chainChecks.pairIssues.some((p) => p.severity === 'error'), '三齿轮链无错误（首尾远离不报错）')
assert(!chainChecks.pairIssues.some((p) => (p.a === 'g1' && p.b === 'g3')), '无关齿轮对不进入问题列表')
assert(chainChecks.pairIssues.some((p) => p.meshing), '相邻齿轮对仍正常判定啮合')
const nearOnly: Gear = { ...g2, id: 'g5', x: 30, y: 0, rotation: 0 }
const rPhase = checkPair(g1, nearOnly)
assert(rPhase.severity === 'warn' && !rPhase.meshing, '距离正确但相位未对齐 → 警告')
const g8: Gear = { id: 'g8', name: 'x', z: 8, m: 2, thickness: 3, bore: 5, x: 0, y: 200, rotation: 0 }
const val = runChecks([g8]).gearIssues
assert(val.some((i) => i.severity === 'warn' && i.message.includes('根切')), 'z=8 提示根切警告')

// ---------- 测试三：三齿轮导出 ----------
console.log('测试三：三齿轮 SVG / DXF 导出')
const three: Gear[] = [
  g1,
  g2,
  { id: 'g3', name: '齿轮 3', z: 20, m: 2, thickness: 3, bore: 5, x: 30, y: 60, rotation: 0 },
]
const svg = buildSVG(three)
const dxf = buildDXF(three)

assert(svg.includes('width="') && svg.includes('mm'), 'SVG 尺寸单位为 mm')
assert(svg.includes('viewBox="0 0'), 'SVG 含有效 viewBox')
const pathCount = (svg.match(/<path /g) ?? []).length
assert(pathCount === 3, `SVG 包含 3 个齿轮路径（实际 ${pathCount}）`)
assert(!svg.includes('<circle') && !svg.includes('网格'), 'SVG 不含界面元素')
assert((svg.match(/fill-rule="evenodd"/g) ?? []).length === 3, '每个齿轮内孔以 evenodd 挖空')
const mW = svg.match(/width="([\d.]+)mm"/)
const mH = svg.match(/height="([\d.]+)mm"/)
assert(!!mW && Number(mW[1]) > 100, `SVG 宽度合理（${mW?.[1]} mm）`)
assert(!!mH && Number(mH[1]) > 100, `SVG 高度合理（${mH?.[1]} mm）`)
// 齿顶不能被圆代替：外轮廓由大量 M/L 小线段组成（内孔弧不含 M/L 指令）
const segMatch = svg.match(/<path d="([^"]+)"/)
if (segMatch) {
  const tokens = [...segMatch[1].matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)]
    .map((t) => [t[1], Number(t[2]), Number(t[3])] as [string, number, number])
  let maxStep = 0
  let prev: [number, number] | null = null
  for (const [cmd, x, y] of tokens) {
    if (cmd === 'M') { prev = [x, y]; continue } // M 开始新子路径，不计跳跃
    if (prev) maxStep = Math.max(maxStep, Math.hypot(x - prev[0], y - prev[1]))
    prev = [x, y]
  }
  assert(tokens.length > 600, `外轮廓线段数 ${tokens.length} 充足`)
  assert(maxStep < 1.5, `轮廓最大离散步长 ${maxStep.toFixed(3)} < 1.5 mm（非圆代替）`)
}

assert(dxf.includes('AC1009'), 'DXF 版本为 R12 (AC1009)')
assert(dxf.includes('$INSUNITS'), 'DXF 声明单位')
const polyCount = (dxf.match(/^POLYLINE$/gm) ?? []).length
assert(polyCount === 3, `DXF 含 3 条闭合 POLYLINE（实际 ${polyCount}）`)
const circleCount = (dxf.match(/^CIRCLE$/gm) ?? []).length
assert(circleCount === 3, `DXF 含 3 个中心孔 CIRCLE（实际 ${circleCount}）`)
const vertexCount = (dxf.match(/^VERTEX$/gm) ?? []).length
assert(vertexCount > 1800, `DXF 顶点数充足（${vertexCount}），无明显锯齿`)
assert(!/NaN|Infinity/.test(dxf) && !/NaN|Infinity/.test(svg), '导出文件无 NaN/Infinity')
// 位置保留：g3 中心 (30,60) 附近应出现坐标 30.000 / 60.000
assert(dxf.includes('\n30.000\n') && dxf.includes('\n60.000\n'), 'DXF 保留齿轮 3 的世界坐标 (30, 60)')

// ---------- 测试四：撤销 / 重做历史 ----------
console.log('测试四：编辑器历史（撤销/重做、手势合并）')
const zOf = (id: string) => editorStore.getState().doc.gears.find((g) => g.id === id)!.z
const nGears = () => editorStore.getState().doc.gears.length

// 连续调参（滑块/输入手势）合并为一条历史
editorStore.beginGesture()
editorStore.updateGearLive('g1', { z: 21 })
editorStore.updateGearLive('g1', { z: 22 })
editorStore.updateGearLive('g1', { z: 24 })
editorStore.commitGesture()
assert(editorStore.getState().canUndo && !editorStore.getState().canRedo, '调参提交后可撤销、重做不可用')
assert(zOf('g1') === 24, '当前齿数为 24')
editorStore.undo()
assert(zOf('g1') === 20, '撤销后齿数恢复 20')
assert(editorStore.getState().canRedo, '撤销后重做可用')
editorStore.redo()
assert(zOf('g1') === 24, '重做后齿数回到 24')

// 无实际修改的手势不产生历史
const canUndoBefore = editorStore.getState().canUndo
editorStore.beginGesture()
editorStore.commitGesture()
assert(editorStore.getState().canUndo === canUndoBefore, '无修改手势不产生历史记录')

// 添加齿轮的撤销/重做
const count0 = nGears()
editorStore.addGear()
assert(nGears() === count0 + 1, `添加齿轮后数量为 ${nGears()}`)
editorStore.undo()
assert(nGears() === count0, '撤销添加后齿轮移除')
editorStore.redo()
assert(nGears() === count0 + 1, '重做添加后齿轮恢复')
// 还原现场
editorStore.undo()

// 新操作会清空重做栈
editorStore.updateGear('g1', { z: 26 })
assert(!editorStore.getState().canRedo, '新提交后重做栈清空')
editorStore.undo()
assert(zOf('g1') === 24, '撤销一步参数修改恢复 24')
editorStore.undo()
assert(zOf('g1') === 20, '再撤销一步恢复初始 20')

// ---------- 测试五：曲柄滑块运动学 ----------
console.log('测试五：曲柄滑块机构运动学（r=30, L=80）')
const csP: CrankSliderParams = { ...DEFAULT_CRANK_SLIDER }
const s0 = solveCrankSlider(csP, 0)
assert(s0.valid && approx(s0.blockX, 110), 'θ=0° 滑块位置 x = r + L = 110 mm')
assert(approx(s0.A.x, 30) && approx(s0.A.y, 0) && approx(s0.B.x, 110) && approx(s0.B.y, 0),
  'θ=0° 曲柄销 A=(30,0)、滑块销 B=(110,0)')
const s90 = solveCrankSlider(csP, 90)
assert(approx(s90.blockX, Math.sqrt(80 * 80 - 30 * 30), 1e-9),
  'θ=90° 滑块位置 x = √(L²−r²) ≈ 74.162 mm')
assert(approx(s90.A.x, 0) && approx(s90.A.y, 30), 'θ=90° 曲柄销 A=(0,30)')
const s180 = solveCrankSlider(csP, 180)
assert(approx(s180.blockX, 50), 'θ=180° 滑块位置 x = L − r = 50 mm（近止点）')
assert(approx(s0.stroke, 60) && approx(s0.strokeRange[0], 50) && approx(s0.strokeRange[1], 110),
  '滑块行程 = 2r = 60 mm，行程区间 [50, 110]')

// 整周 64 姿态：杆长恒定、坐标有限、滑块不出导轨范围
let maxErr = 0
let allPosesValid = true
let allFiniteCS = true
for (let k = 0; k < 64; k++) {
  const s = solveCrankSlider(csP, (k / 64) * 360)
  if (!s.valid) allPosesValid = false
  maxErr = Math.max(maxErr, s.rodError)
  if (![s.O, s.A, s.B].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) allFiniteCS = false
  if (s.blockX < s.strokeRange[0] - 1e-9 || s.blockX > s.strokeRange[1] + 1e-9) allPosesValid = false
}
assert(allPosesValid, '整周 64 姿态均有效，滑块始终在行程区间内')
assert(maxErr < 1e-9, `全程连杆长度保持 L=80 mm（最大偏差 ${maxErr.toExponential(2)}）`)
assert(allFiniteCS, '全部铰接点坐标有限（无 NaN/Infinity）')

// 反向装配（axisSign=-1）：关于 O 镜像
const csPMirror: CrankSliderParams = { ...csP, axisSign: -1 }
const sm0 = solveCrankSlider(csPMirror, 0)
const sm180 = solveCrankSlider(csPMirror, 180)
assert(approx(sm0.blockX, -50) && approx(sm180.blockX, -110), '反向装配时滑块位置镜像（θ=0° → −50，θ=180° → −110 mm）')
assert(approx(sm0.strokeRange[0], -110) && approx(sm0.strokeRange[1], -50), '反向装配行程区间 [-110, -50]')
assert(sm0.rodError < 1e-9, '反向装配连杆长度同样恒定')

// 非法参数：L < r，曲柄不能整周转动
const badCS: CrankSliderParams = { ...csP, crankR: 50, rodL: 30 }
const sBad = solveCrankSlider(badCS, 90)
assert(!sBad.valid && !!sBad.reason && sBad.reason.includes('连杆'), 'L<r 时返回无效状态与中文原因')

// ---------- 测试六：机构几何与检查 ----------
console.log('测试六：曲柄滑块几何实体与约束检查')
const geom = crankSliderGeometry(csP, 45)
const solidList = [geom.solids.frameBase, geom.solids.frameBearing, geom.solids.crank, geom.solids.rod, geom.solids.block]
assert(solidList.every((s) => s.outline.length >= 8), '五个实体零件（机架/轴承座/曲柄/连杆/滑块）均有闭合轮廓')
assert(solidList.every((s) => s.outline.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))),
  '实体轮廓坐标全部有限')
assert(solidList.every((s) => outlineClosable(s.outline)),
  '所有实体轮廓可闭合（圆头杆隐式闭合，含 wrap 闭合边无零长度段）')
const holeCount = solidList.reduce((n, s) => n + s.holes.length, 0)
assert(holeCount === 6, `连接孔共 6 个（主轴孔 2 + 铰接销孔 4，实际 ${holeCount}）`)
assert(solidList.slice(2).every((s) => s.holes.length >= 1), '曲柄/连杆/滑块均带销孔')
assert(geom.rails.length === 2 && geom.rails.every((r) => approx(r.y1, r.y2)), '两条水平直线导轨')
assert(approx(geom.trace.x1, 50) && approx(geom.trace.x2, 110), '轨迹范围与滑块行程一致 [50, 110]')
assert(Number.isFinite(geom.bounds.minX) && geom.bounds.maxX > geom.bounds.minX, '机构包围盒有效')

const mkMech = (params: CrankSliderParams): Mechanism => ({
  id: 'mtest', kind: 'crankSlider', name: '测试机构', x: 0, y: 0,
  initialAngle: 45, driverRpm: 30, params,
})
const issuesOK = checkCrankSlider(mkMech(csP))
assert(!issuesOK.some((i) => i.severity === 'error'), '默认参数检查无错误')
const issuesBad = checkCrankSlider(mkMech(badCS))
assert(issuesBad.some((i) => i.severity === 'error' && i.message.includes('连杆')), 'L<r 检查报红色错误并给出中文建议')
const issuesTight: CrankSliderParams = { ...csP, crankR: 30, rodL: 32 }
assert(checkCrankSlider(mkMech(issuesTight)).some((i) => i.severity === 'warn'), 'L<1.2r 给出橙色警告')
const issuesSmallBlock = checkManufacturing(mkMech({ ...csP, blockH: 2 }), 2)
assert(issuesSmallBlock.some((i) => i.severity === 'error' && i.message.includes('滑块')),
  '加工检查：滑块宽度低于允许范围（< 6 mm）→ 红色错误')
const mixedChecks = runChecks([], [mkMech(badCS)])
assert(mixedChecks.mechIssues.some((i) => i.mechId === 'mtest' && i.severity === 'error'),
  'runChecks 汇总机构问题（mechIssues 含本机构 id）')

// ---------- 测试七：机构 SVG / DXF 导出 ----------
console.log('测试七：曲柄滑块 SVG / DXF 导出（世界坐标 mm）')
const mExp: Mechanism = { ...mkMech(csP), id: 'mexp', x: 120, y: 60 }
const svgM = buildSVG([], [mExp])
const dxfM = buildDXF([], [mExp])
const mPathCount = (svgM.match(/<path /g) ?? []).length
assert(mPathCount === 5, `SVG 含 5 个机构实体路径（实际 ${mPathCount}）`)
assert((svgM.match(/fill-rule="evenodd"/g) ?? []).length === 5, '5 个实体均以 evenodd 处理销孔')
assert(!svgM.includes('<line'), '默认导出不含导轨/轨迹等辅助线')
assert(!/NaN|Infinity/.test(svgM) && !/NaN|Infinity/.test(dxfM), '机构导出无 NaN/Infinity')
const mPolyCount = (dxfM.match(/^POLYLINE$/gm) ?? []).length
const mCircleCount = (dxfM.match(/^CIRCLE$/gm) ?? []).length
assert(mPolyCount === 5, `DXF 含 5 条零件 POLYLINE（实际 ${mPolyCount}）`)
assert(mCircleCount === 6, `DXF 含 6 个连接孔 CIRCLE（实际 ${mCircleCount}）`)
assert((dxfM.match(/^LINE$/gm) ?? []).length === 0, '默认 DXF 无辅助 LINE')
assert(dxfM.includes('AC1009') && dxfM.includes('$INSUNITS'), '机构 DXF 仍为合法 R12 且声明单位')
// 主轴孔位于机构原点，世界坐标 (120, 60)
assert(dxfM.includes('\n120.000\n') && dxfM.includes('\n60.000\n'), 'DXF 正确应用机构平移（主轴孔世界坐标 120, 60）')

// 含辅助线选项
const svgAux = buildSVG([], [mExp], { includeAuxiliaries: true, includeTrace: true })
const dxfAux = buildDXF([], [mExp], { includeAuxiliaries: true, includeTrace: true })
assert(svgAux.includes('<line') && svgAux.includes('stroke-dasharray'), '勾选辅助线后 SVG 含导轨线与虚线轨迹')
assert((dxfAux.match(/^LINE$/gm) ?? []).length === 3, '勾选辅助线后 DXF 含 3 条 LINE（2 导轨 + 1 轨迹）')
assert(dxfAux.includes('\nAUX\n') && dxfAux.includes('\nTRACE\n'), '辅助线位于 AUX/TRACE 独立图层')

// 齿轮与机构混合场景
const sceneMix = collectScene([g1], [mExp], { includeAuxiliaries: false, includeTrace: false })
assert(sceneMix.solids.length === 6, '混合场景实体数 = 1 齿轮 + 5 机构实体')
const svgMix = buildSVG([g1], [mExp])
assert((svgMix.match(/<path /g) ?? []).length === 6, '混合场景 SVG 含 6 条实体路径')

// ---------- 测试八：机构的撤销 / 重做 ----------
console.log('测试八：机构增删改与历史')
const nMech = () => editorStore.getState().doc.mechanisms.length
const nBase = nMech()
editorStore.addMechanism('crankSlider')
assert(nMech() === nBase + 1, `添加机构后数量为 ${nMech()}`)
const added = editorStore.getState().doc.mechanisms[nMech() - 1]
assert(added.kind === 'crankSlider' && added.params.crankR === DEFAULT_CRANK_SLIDER.crankR,
  '新机构为曲柄滑块且带默认参数')
editorStore.undo()
assert(nMech() === nBase, '撤销添加后机构移除')
editorStore.redo()
assert(nMech() === nBase + 1, '重做添加后机构恢复')
const mid = editorStore.getState().doc.mechanisms[nMech() - 1].id
const crankROf = () => editorStore.getState().doc.mechanisms.find((x) => x.id === mid)!.params.crankR
editorStore.updateMechanism(mid, { params: { crankR: 45 } })
assert(crankROf() === 45, '机构参数修改生效（曲柄长度 45 mm）')
editorStore.undo()
assert(crankROf() === DEFAULT_CRANK_SLIDER.crankR, '撤销后机构参数恢复默认')
editorStore.redo()
assert(crankROf() === 45, '重做后机构参数回到 45 mm')
// 复制完整机构
editorStore.setSelection([mid])
editorStore.duplicateSelected()
assert(nMech() === nBase + 2, `复制后机构数量为 ${nMech()}（完整机构整体复制）`)
const copyM = editorStore.getState().doc.mechanisms.find((x) => x.id !== mid && x.params.crankR === 45)
assert(!!copyM && copyM.kind === 'crankSlider', '副本保留机构类型与参数')
// 删除机构（含其内部约束的清理体现为整体移除）
editorStore.setSelection([mid, copyM!.id])
editorStore.deleteSelected()
assert(nMech() === nBase, '删除选中机构后数量恢复')
editorStore.undo()
assert(nMech() === nBase + 2, '撤销删除后两个机构恢复（历史完整）')
editorStore.redo()
assert(nMech() === nBase, '重做删除后机构再次移除')

// ---------- 测试九：齿轮齿条运动学 ----------
console.log('测试九：齿轮齿条机构运动学（z=20, m=2, rp=20）')
const rpP: RackPinionParams = { ...DEFAULT_RACK_PINION }
const rp0 = solveRackPinion(rpP, 0)
assert(rp0.valid && approx(rp0.rp, 20), '分度圆半径 rp = m·z/2 = 20 mm')
assert(approx(rp0.pitch, 2 * Math.PI, 1e-9), '齿条齿距 p = πm ≈ 6.283 mm')
assert(approx(rp0.s, 0) && approx(rp0.pitchLineY, 20), 'θ=0 位移为 0，节线在齿轮上方 y=20 mm')
const rp90 = solveRackPinion(rpP, 90)
assert(approx(rp90.s, -10 * Math.PI, 1e-9), 'θ=90°（上侧装配）s = −rp·θ = −31.416 mm')
const rp90d = solveRackPinion({ ...rpP, rackSide: -1 }, 90)
assert(approx(rp90d.s, 10 * Math.PI, 1e-9) && approx(rp90d.pitchLineY, -20),
  '下侧装配时 s 反号（+31.416 mm），节线 y=−20 mm')
const rp360 = solveRackPinion(rpP, 360)
assert(approx(rp360.s, -40 * Math.PI, 1e-9), 'θ=360° s = −2π·rp = −125.664 mm（一整圈一个周长）')
const rpm90 = solveRackPinion(rpP, -90)
assert(approx(rpm90.s, 10 * Math.PI, 1e-9), '反转 90° 位移反号 +31.416 mm')
// 相位：θ=0 齿条中点位于 phase = πm(z−2)/4
assert(approx(rp0.phase, 9 * Math.PI, 1e-9) && approx(rp0.rackCx, 9 * Math.PI, 1e-9),
  '装配相位 phase = πm(z−2)/4 = 28.274 mm')
assert(approx(rp90.rackCx, 9 * Math.PI - 10 * Math.PI, 1e-9), 'θ=90° 齿条中心 = phase + s = −3.142 mm')

// 整周多姿态：位移严格线性 s = −side·rp·θ，坐标有限
let rpLinear = true
let rpFinite = true
for (let k = 0; k < 72; k++) {
  const deg = (k / 72) * 360
  const r = solveRackPinion(rpP, deg)
  if (!approx(r.s, -20 * (deg * Math.PI / 180), 1e-9)) rpLinear = false
  if (![r.s, r.phase, r.rackCx, r.pitchLineY].every(Number.isFinite)) rpFinite = false
}
assert(rpLinear, '72 个姿态下 s = r·Δθ 严格成立（无跳变）')
assert(rpFinite, '全部运动学量有限（无 NaN/Infinity）')

// 共轭装配：齿轮顶点齿/槽必须与齿条槽/齿互补（奇、偶齿数均验证）
const modPer = (x: number, per: number) => ((x % per) + per) % per
const signedNear = (x: number, per: number) => {
  const d = modPer(x, per)
  return d <= per / 2 ? d : d - per
}
for (const z of [17, 18, 19, 20, 21, 22, 40]) {
  const pp: RackPinionParams = { ...rpP, z }
  const r = solveRackPinion(pp, 0)
  // 齿轮最近齿中心在接触切线方向的有符号偏移（齿中心角 k·2π/z，顶点 π/2）
  const sg = signedNear((r.pitch * z) / 4, r.pitch)
  // 齿条最近齿中心相对接触点 x=0 的有符号偏移（齿中心位于 rackCx+k·p）
  const sr = signedNear(r.phase, r.pitch)
  let dd = modPer(sr - sg, r.pitch)
  dd = Math.min(dd, r.pitch - dd)
  assert(approx(dd, r.pitch / 2, 1e-9), `z=${z}：顶点齿轮齿/槽与齿条槽/齿严格互补（错半个齿距）`)
}
// 默认 z=20：顶点恰为齿中心，接触点齿条恰为齿槽
{
  const sg = signedNear((rp0.pitch * 20) / 4, rp0.pitch)
  const sr = signedNear(rp0.phase, rp0.pitch)
  assert(approx(Math.abs(sg), 0, 1e-9), 'z=20 齿轮顶点为齿厚中心')
  assert(approx(Math.abs(sr), rp0.pitch / 2, 1e-9), 'z=20 接触点齿条为齿槽中心')
}

// ---------- 测试十：齿条几何实体 ----------
console.log('测试十：齿轮齿条几何实体（真实梯形齿廓）')
const rpGeom = rackPinionGeometry(rpP, 0)
const rpSolids = [rpGeom.solids.pinion, rpGeom.solids.rack, rpGeom.solids.frameBearing, rpGeom.solids.frameBase]
assert(rpSolids.every((s) => s.outline.length >= 8), '四个实体零件（齿轮/齿条/轴承座/底板）均有闭合轮廓')
assert(rpSolids.every((s) => s.outline.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))),
  '齿条机构实体坐标全部有限')
assert(rpSolids.every((s) => {
  const a = s.outline[0]
  const b = s.outline[s.outline.length - 1]
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
}), '所有实体轮廓首尾闭合')

// 齿条：齿顶 y=18（节线 20 − 齿顶高 2），齿根 y=22.5，本体背面 y=30.5（齿高只由模数决定）
const rackPts = rpGeom.solids.rack.outline
assert(approx(Math.min(...rackPts.map((q) => q.y)), 18, 1e-9), '齿条齿顶位于节线下方 m=2 mm（y=18）')
assert(approx(Math.max(...rackPts.map((q) => q.y)), 30.5, 1e-9), '齿条本体背面 y=30.5（齿根 2.5 + 基体宽 8）')
const tipPts = rackPts.filter((q) => approx(q.y, 18, 1e-9))
const rootPts = rackPts.filter((q) => approx(q.y, 22.5, 1e-9))
assert(tipPts.length >= 20 && rootPts.length >= 20,
  `齿顶/齿根折线点各 ≥20（实际齿顶 ${tipPts.length}、齿根 ${rootPts.length}），为交替梯形齿而非矩形冒充`)
// 齿按齿距周期排列：齿顶点 x 聚类（齿顶两点为一对），簇数 ≈ L/p
const tipXs = [...new Set(tipPts.map((q) => q.x.toFixed(6)))].map(Number).sort((a, b) => a - b)
const clusters: number[] = []
for (const x of tipXs) {
  if (clusters.length === 0 || Math.abs(x - clusters[clusters.length - 1]) > rp0.pitch / 2) clusters.push(x)
  else clusters[clusters.length - 1] = (clusters[clusters.length - 1] + x) / 2
}
const teethExpected = rpP.rackL / rp0.pitch
assert(clusters.length >= teethExpected - 2 && clusters.length <= teethExpected + 2,
  `齿条齿数约 ${teethExpected.toFixed(1)}（聚类 ${clusters.length} 个）`)
assert(clusters.length >= 5, '齿条至少含 5 个完整齿（与检查规则一致）')
{
  const gaps = clusters.slice(1).map((x, i) => x - clusters[i])
  assert(gaps.every((g) => approx(g, rp0.pitch, 1e-6)), '相邻齿间距严格等于齿距 πm')
}

// 齿条整体随 s 平移：θ=0→90° 轮廓质心 x 变化 = s 的变化
const meanX = (pts: { x: number }[]) => pts.reduce((a, q) => a + q.x, 0) / pts.length
const rpGeom90 = rackPinionGeometry(rpP, 90)
assert(approx(meanX(rpGeom90.solids.rack.outline) - meanX(rpGeom.solids.rack.outline), rp90.s, 1e-9),
  'θ=0→90° 齿条整体平移量等于 s（−31.416 mm）')

// 齿轮轮廓：所有点在齿根/齿顶圆之间，姿态随 θ 旋转
const dimsRP = rpGeom.solids.pinion.outline.every((q) => {
  const r = Math.hypot(q.x, q.y)
  return r >= 17.5 - 1e-6 && r <= 22 + 1e-6
})
assert(dimsRP, '齿轮轮廓点均在齿根圆 17.5 与齿顶圆 22 之间')
assert(approx(rpGeom.solids.pinion.holes[0].r, 2.5, 1e-9), '齿轮带中心孔 r=2.5 mm')
// 齿条安装孔：默认 2 个对称真实开孔（Φ3.2），位于基体中线并随齿条平移
const locMount = rackMountHoles(rpP)
assert(locMount.length === 2
  && approx(locMount[0].x, -60 / 2, 1e-9) && approx(locMount[1].x, 60 / 2, 1e-9)
  && approx(locMount[0].y, 2.5 + 8 / 2, 1e-9) && approx(locMount[0].r, 1.6, 1e-9),
  '齿条局部安装孔：2 个、间距 60 mm 对称、孔心 y=齿根2.5+半宽4=6.5、r=1.6')
const wMount = rpGeom.solids.rack.holes
assert(wMount.length === 2
  && approx(wMount[0].x, rp0.phase - 30, 1e-6) && approx(wMount[1].x, rp0.phase + 30, 1e-6)
  && approx(wMount[0].y, 26.5, 1e-9) && approx(wMount[0].r, 1.6, 1e-9),
  '安装孔为真实内轮廓并随齿条变换到世界坐标（y=节线20+6.5=26.5）')
// 旧数据缺安装孔字段时回退默认 2 孔
const legacyRP0 = { ...rpP } as Partial<RackPinionParams>
delete legacyRP0.rackBodyW; delete legacyRP0.mountD; delete legacyRP0.mountCount; delete legacyRP0.mountSpacing
assert(rackMountHoles(legacyRP0 as RackPinionParams).length === 2, '旧齿条数据缺字段时安装孔回退默认（2 个）')
{
  const c = Math.cos(-Math.PI / 2)
  const sn = Math.sin(-Math.PI / 2)
  let maxd = 0
  const a0 = rpGeom.solids.pinion.outline
  const a90 = rpGeom90.solids.pinion.outline
  for (let i = 0; i < Math.min(a0.length, a90.length); i++) {
    const bx = a90[i].x * c - a90[i].y * sn
    const by = a90[i].x * sn + a90[i].y * c
    maxd = Math.max(maxd, Math.hypot(bx - a0[i].x, by - a0[i].y))
  }
  assert(maxd < 1e-9, `θ=90° 齿轮轮廓恰为 θ=0 轮廓旋转 90°（最大偏差 ${maxd.toExponential(2)}）`)
}
// 轴承座：外圆 r≈11、主轴孔 4.2；导轨两条水平线，长度覆盖行程
assert(approx(Math.max(...rpGeom.solids.frameBearing.outline.map((q) => Math.hypot(q.x, q.y))), 11, 1e-6),
  '固定轴承座外圆半径 11 mm')
assert(approx(rpGeom.solids.frameBearing.holes[0].r, 4.2, 1e-9), '轴承座主轴孔 r=4.2 mm')
assert(rpGeom.rails.length === 2 && rpGeom.rails.every((r) => approx(r.y1, r.y2)), '齿条机构两条水平导轨')
assert(approx(rpGeom.rails[0].x2 - rpGeom.rails[0].x1, rpP.rackL + 2 * rpP.travel + 24, 1e-9),
  '导轨长度覆盖齿条全长与双侧行程')
assert(approx(rpGeom.trace.x2 - rpGeom.trace.x1, 2 * rpP.travel, 1e-9), '轨迹长度 = 2 × 单侧行程')
assert(Number.isFinite(rpGeom.bounds.minX) && rpGeom.bounds.maxX > rpGeom.bounds.minX, '齿条机构包围盒有效')

// ---------- 测试十一：齿条检查与导出 ----------
console.log('测试十一：齿轮齿条检查与 SVG / DXF 导出')
const mkRp = (params: RackPinionParams, initialAngle = 0): Mechanism => ({
  id: 'mrtest', kind: 'rackPinion', name: '测试齿条机构', x: 0, y: 0,
  initialAngle, driverRpm: 30, params,
})
assert(!checkRackPinion(mkRp(rpP)).some((i) => i.severity === 'error'), '默认齿条参数检查无错误')
assert(checkRackPinion(mkRp({ ...rpP, z: 12 })).some((i) => i.severity === 'warn' && i.message.includes('根切')),
  'z=12 齿轮提示根切警告')
assert(checkManufacturing(mkRp({ ...rpP, bore: 60 }), 2).some((i) => i.severity === 'error' && i.message.includes('孔')),
  '加工检查：齿轮中心孔过大切穿齿根（Φ60 > 允许 Φ33）→ 红色错误')
assert(checkRackPinion(mkRp({ ...rpP, rackL: 30 })).some((i) => i.severity === 'error' && i.message.includes('齿')),
  '齿条不足 5 个齿距 → 错误')
assert(checkRackPinion(mkRp(rpP, 180)).some((i) => i.severity === 'warn' && i.message.includes('行程')),
  '初始角度位移超出行程 → 警告')
assert(runChecks([], [mkRp({ ...rpP, rackL: 30 })]).mechIssues.some((i) => i.mechId === 'mrtest' && i.severity === 'error'),
  'runChecks 汇总齿条机构检查结果（非法参数时 mechIssues 含本机构错误）')

const rpExp: Mechanism = { ...mkRp(rpP), id: 'mrexp', x: 120, y: 60 }
const sceneRP = collectScene([], [rpExp])
assert(sceneRP.solids.length === 4, '齿条机构导出场景含 4 个实体')
const svgRP = buildSVG([], [rpExp])
const dxfRP = buildDXF([], [rpExp])
assert((svgRP.match(/<path /g) ?? []).length === 4, `齿条机构 SVG 含 4 条实体路径（实际 ${(svgRP.match(/<path /g) ?? []).length}）`)
assert(!svgRP.includes('<line'), '默认导出不含导轨/轨迹辅助线')
assert(!/NaN|Infinity/.test(svgRP) && !/NaN|Infinity/.test(dxfRP), '齿条导出无 NaN/Infinity')
assert((dxfRP.match(/^POLYLINE$/gm) ?? []).length === 4, 'DXF 含 4 条零件 POLYLINE')
assert((dxfRP.match(/^CIRCLE$/gm) ?? []).length === 4,
  'DXF 含 4 个真实孔 CIRCLE（齿轮中心孔 1 + 齿条安装孔 2 + 轴承主轴孔 1）')
assert(dxfRP.includes('\n120.000\n') && dxfRP.includes('\n60.000\n'), 'DXF 应用机构平移（齿轮中心孔世界坐标 120, 60）')
const dxfRPAux = buildDXF([], [rpExp], { includeAuxiliaries: true, includeTrace: true })
assert((dxfRPAux.match(/^LINE$/gm) ?? []).length === 3, '勾选辅助线后 DXF 含 3 条 LINE（2 导轨 + 1 轨迹）')
assert(dxfRPAux.includes('\nAUX\n') && dxfRPAux.includes('\nTRACE\n'), '齿条辅助线位于 AUX/TRACE 图层')
const sceneRPMix = collectScene([g1], [rpExp], { includeAuxiliaries: false, includeTrace: false })
assert(sceneRPMix.solids.length === 5, '齿轮 + 齿条机构混合场景实体数 = 1 + 4')
// 辅助轨迹随机构平移：场景世界坐标 y = m.y + 局部轨迹 y
const sceneTrace = collectScene([], [rpExp], { includeAuxiliaries: false, includeTrace: true })
const tr = sceneTrace.auxiliaries.find((a) => a.kind === 'trace')!
assert(approx(tr.y1, 60 + rpGeom.trace.y, 1e-9) && approx(tr.x1, 120 + rpGeom.trace.x1, 1e-9),
  '轨迹辅助线使用世界坐标（含机构平移）')

// ---------- 测试十二：齿条机构的增删改与历史 ----------
console.log('测试十二：齿轮齿条机构的增删改与历史')
const nBaseRP = nMech()
editorStore.addMechanism('rackPinion')
assert(nMech() === nBaseRP + 1, `添加齿条机构后数量为 ${nMech()}`)
const addedRP = editorStore.getState().doc.mechanisms[nMech() - 1]
assert(addedRP.kind === 'rackPinion' && addedRP.params.z === DEFAULT_RACK_PINION.z,
  '新机构为齿轮齿条且带默认参数')
editorStore.undo()
assert(nMech() === nBaseRP, '撤销添加后齿条机构移除')
editorStore.redo()
assert(nMech() === nBaseRP + 1, '重做添加后齿条机构恢复')
const rpId = editorStore.getState().doc.mechanisms[nMech() - 1].id
const zOfRP = () => {
  const mm = editorStore.getState().doc.mechanisms.find((x) => x.id === rpId)!
  return (mm.params as RackPinionParams).z
}
editorStore.updateMechanism(rpId, { params: { z: 36 } })
assert(zOfRP() === 36, '齿条机构齿轮齿数修改生效（z=36）')
editorStore.undo()
assert(zOfRP() === DEFAULT_RACK_PINION.z, '撤销后齿数恢复默认 20')
editorStore.redo()
assert(zOfRP() === 36, '重做后齿数回到 36')
editorStore.setSelection([rpId])
editorStore.duplicateSelected()
assert(nMech() === nBaseRP + 2, `复制后机构数量为 ${nMech()}`)
const rpCopy = editorStore.getState().doc.mechanisms.find((x) => x.id !== rpId && x.kind === 'rackPinion')
assert(!!rpCopy && (rpCopy.params as RackPinionParams).z === 36, '副本保留齿条机构类型与参数')
editorStore.setSelection([rpId, rpCopy!.id])
editorStore.deleteSelected()
assert(nMech() === nBaseRP, '删除选中齿条机构后数量恢复')
editorStore.undo()
assert(nMech() === nBaseRP + 2, '撤销删除后两个齿条机构恢复')
editorStore.redo()
assert(nMech() === nBaseRP, '重做删除后齿条机构再次移除')

// ---------- 测试十三：四连杆运动学 ----------
console.log('测试十三：四连杆机构运动学（L1=100, L2=30, L3=100, L4=80）')
const fbP: FourBarParams = { ...DEFAULT_FOUR_BAR }
const fbG = grashofInfo(fbP)
assert(fbG.grashof && fbG.type === 'crankRocker',
  `默认杆长满足格拉霍夫条件且为曲柄摇杆机构（30+100=${fbG.shortest + fbG.longest} ≤ ${fbG.restSum}）`)

const fb0 = solveFourBar(fbP, 0)
assert(fb0.valid, 'θ=0 姿态可装配（两圆有交点）')
assert(approx(fb0.A.x, 30, 1e-9) && approx(fb0.A.y, 0, 1e-9), 'θ=0 时 A = (30, 0)')
assert(approx(fb0.errL3, 0, 1e-9) && approx(fb0.errL4, 0, 1e-9), 'θ=0 时 |AB|=L3、|O2B|=L4（偏差为 0）')
assert(fb0.B.y > 0, '装配方式 +1：摇杆在机架线上方交汇（B.y > 0）')

// 整周 72 姿态：全部可装配、三杆长度恒定、坐标有限、不跳支、首尾闭合
let fbMaxErr = 0
let fbJump = 0
let fbFinite = true
let prevB: { x: number; y: number } | null = null
for (let k = 0; k <= 72; k++) {
  const s = solveFourBar(fbP, (k / 72) * 360)
  if (!s.valid) { fbFinite = false; break }
  fbMaxErr = Math.max(fbMaxErr, s.errL3, s.errL4)
  const o4a = Math.hypot(s.A.x - s.O4.x, s.A.y - s.O4.y)
  if (!approx(o4a, 30, 1e-9)) fbMaxErr = Math.max(fbMaxErr, Math.abs(o4a - 30))
  if (prevB) fbJump = Math.max(fbJump, Math.hypot(s.B.x - prevB.x, s.B.y - prevB.y))
  if (![s.A.x, s.A.y, s.B.x, s.B.y].every(Number.isFinite)) fbFinite = false
  prevB = k === 72 ? prevB : s.B
}
assert(fbFinite, '整周 73 个姿态全部可装配且坐标有限')
assert(fbMaxErr < 1e-6, `运动中各杆长度恒定（最大偏差 ${fbMaxErr.toExponential(2)} mm）`)
assert(fbJump < (fbP.couplerL + fbP.rockerL) / 4,
  `相邻姿态 B 点连续不跳支（最大单步位移 ${fbJump.toFixed(2)} mm）`)
const fbClose = solveFourBar(fbP, 360)
assert(approx(Math.hypot(fbClose.B.x - fb0.B.x, fbClose.B.y - fb0.B.y), 0, 1e-9),
  'θ=360° 与 θ=0 姿态重合（周期闭合，无累积漂移）')

// 镜像装配：assembly=−1 在 −θ 处的解与 assembly=+1 在 θ 处的解关于机架线镜像
let mirrorOK = true
for (let k = 0; k < 24; k++) {
  const deg = (k / 24) * 360
  const up = solveFourBar(fbP, deg)
  const dn = solveFourBar({ ...fbP, assembly: -1 }, -deg)
  if (!approx(up.B.y, -dn.B.y, 1e-9) || !approx(up.B.x, dn.B.x, 1e-9)) mirrorOK = false
}
assert(mirrorOK, '下交汇装配与上交汇装配严格镜像（θ 反号时 B 点 y 反号、x 相同）')

// 反向旋转只改变角度推进方向，姿态仍连续
const fbNeg = solveFourBar(fbP, -45)
assert(fbNeg.valid && approx(Math.hypot(fbNeg.B.x - fbNeg.O2.x, fbNeg.B.y - fbNeg.O2.y), 80, 1e-9),
  '负角度姿态同样有效且杆长恒定')

// 不满足曲柄存在条件：L2=90，摇杆 80 更短
const fbNoCrank = grashofInfo({ ...fbP, crankL: 90 })
assert(fbNoCrank.type !== 'crankRocker', '曲柄不是最短杆时判别为非曲柄摇杆机构')
// 无法整周装配：L3=L4=40，d_max=130 > 80
const fbBad: FourBarParams = { ...fbP, couplerL: 40, rockerL: 40 }
assert(!solveFourBar(fbBad, 180).valid, '杆长不足时 θ=180° 姿态不可装配（返回无效而非 NaN）')
assert(Number.isFinite(solveFourBar(fbBad, 180).B.x), '无效姿态下坐标仍为有限数（画布不会崩溃）')

const fbSwing = rockerSwing(fbP)
assert(Number.isFinite(fbSwing) && fbSwing > 20 && fbSwing < 120,
  `默认杆长摇杆摆角为有限合理值（${fbSwing.toFixed(1)}°）`)
const fbMu = minTransmissionAngle(fbP)
assert(Number.isFinite(fbMu) && fbMu > 30, `默认杆长最小传动角 ${fbMu.toFixed(1)}°（传力性能良好）`)

// ---------- 测试十四：四连杆几何实体 ----------
console.log('测试十四：四连杆几何实体（5 个零件 + 连杆轨迹）')
const fbGeom = fourBarGeometry(fbP, 45)
const fbSolids = [
  fbGeom.solids.bearingO4, fbGeom.solids.bearingO2,
  fbGeom.solids.crank, fbGeom.solids.coupler, fbGeom.solids.rocker,
]
assert(fbSolids.length === 5 && fbSolids.every((s) => s.outline.length >= 8),
  '五个实体零件（2 固定铰轴承 / 曲柄 / 连杆 / 摇杆）均有闭合轮廓')
assert(fbSolids.every((s) => s.outline.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))),
  '四连杆实体坐标全部有限')
assert(fbSolids.every((s) => outlineClosable(s.outline)),
  '所有实体轮廓可闭合（三根活动杆为圆头杆隐式闭合）')

// 孔：曲柄（轴孔 Φ8.2 + 销孔 Φ3.2）、连杆（两销孔 Φ3.2）、摇杆（销孔 Φ3.2 + 轴孔 Φ8.2）、两轴承（轴孔 Φ8.2）
const holeRs = fbSolids.flatMap((s) => s.holes.map((h) => h.r)).sort((a, b) => a - b)
assert(holeRs.length === 8 && approx(holeRs[0], 1.6) && approx(holeRs[3], 1.6)
  && approx(holeRs[4], 4.1) && approx(holeRs[7], 4.1),
  `共 8 个连接孔（4 销孔 r=1.6（Φ3.2） + 4 轴孔 r=4.1（Φ8.2），实际 ${holeRs.join(',')}）`)
assert(approx(Math.max(...fbGeom.solids.bearingO2.outline.map((q) => Math.hypot(q.x - 100, q.y))), 11, 1e-6),
  'O2 固定铰轴承外圆半径 11 mm、圆心位于 (100, 0)')
// 当前姿态下各杆两端孔中心距等于杆长
const distHoles = (s: { holes: { x: number; y: number }[] }) =>
  Math.hypot(s.holes[0].x - s.holes[1].x, s.holes[0].y - s.holes[1].y)
assert(approx(distHoles(fbGeom.solids.crank), 30, 1e-9), '曲柄两孔中心距 = 30 mm')
assert(approx(distHoles(fbGeom.solids.coupler), 100, 1e-9), '连杆两孔中心距 = 100 mm')
assert(approx(distHoles(fbGeom.solids.rocker), 80, 1e-9), '摇杆两孔中心距 = 80 mm')

// 连杆中点轨迹：72 点离散（polygon/导出时首尾 wrap 闭合），每点恰为对应姿态 A/B 中点
assert(fbGeom.tracePts.length === 72, `轨迹含 72 个离散点（实际 ${fbGeom.tracePts.length}）`)
assert(approx(Math.hypot(
  fbGeom.tracePts[0].x - solveFourBar(fbP, 360).M.x,
  fbGeom.tracePts[0].y - solveFourBar(fbP, 360).M.y), 0, 1e-9), '轨迹在 360° 处回到 0° 起点（闭合曲线）')
assert(Math.hypot(
  fbGeom.tracePts[0].x - fbGeom.tracePts[71].x,
  fbGeom.tracePts[0].y - fbGeom.tracePts[71].y) < (fbP.couplerL + fbP.rockerL) / 4,
  '末点（355°）与起点（0°）只差一个采样步长（由 polygon 首尾封闭）')
{
  const s24 = solveFourBar(fbP, 120)
  const t24 = fbGeom.tracePts[24]
  assert(approx(t24.x, (s24.A.x + s24.B.x) / 2, 1e-9) && approx(t24.y, (s24.A.y + s24.B.y) / 2, 1e-9),
    '轨迹点为对应姿态连杆中点（A、B 中点）')
}
assert(Number.isFinite(fbGeom.bounds.minX) && fbGeom.bounds.maxX > fbGeom.bounds.minX
  && fbGeom.bounds.maxY > fbGeom.bounds.minY, '四连杆包围盒有效')
assert(fbGeom.bounds.minX <= -11 && fbGeom.bounds.maxX >= 111, '包围盒覆盖两个固定铰（0 与 100 mm）')

// ---------- 测试十五：四连杆检查、导出与历史 ----------
console.log('测试十五：四连杆检查、SVG / DXF 导出与增删改历史')
const mkFb = (params: FourBarParams, initialAngle = 0): Mechanism => ({
  id: 'mfbtest', kind: 'fourBar', name: '测试四连杆', x: 0, y: 0,
  initialAngle, driverRpm: 30, params,
})
assert(!checkFourBar(mkFb(fbP)).some((i) => i.severity === 'error'), '默认四连杆参数检查无错误')
assert(checkFourBar(mkFb({ ...fbP, crankL: 90 })).some((i) => i.severity === 'error' && i.message.includes('曲柄')),
  '曲柄非最短杆（摇杆 80 更短）→ 错误（提示缩短曲柄）')
assert(checkFourBar(mkFb({ ...fbP, frameL: 20 })).some((i) => i.severity === 'error' && i.message.includes('轴承')),
  '机架过短两轴承重叠 → 错误')
assert(checkFourBar(mkFb(fbBad)).some((i) => i.severity === 'error'),
  '整周不可装配的杆长 → 错误')
assert(checkFourBar(mkFb({ ...fbP, crankL: 50, couplerL: 70, rockerL: 80 }))
  .some((i) => i.severity === 'warn' && i.message.includes('传动角')),
  '最小传动角过小 → 警告')
assert(runChecks([], [mkFb({ ...fbP, crankL: 90 })]).mechIssues
  .some((i) => i.mechId === 'mfbtest' && i.severity === 'error'),
  'runChecks 汇总四连杆检查结果')

const fbExp: Mechanism = { ...mkFb(fbP, 45), id: 'mfbexp', x: 200, y: -40 }
const sceneFB = collectScene([], [fbExp])
assert(sceneFB.solids.length === 5, '四连杆导出场景含 5 个实体')
const svgFB = buildSVG([], [fbExp])
const dxfFB = buildDXF([], [fbExp])
assert((svgFB.match(/<path /g) ?? []).length === 5, '四连杆 SVG 含 5 条实体路径')
assert(!svgFB.includes('<line') && !svgFB.includes('<polygon'), '默认导出不包含轨迹等辅助线')
assert(!/NaN|Infinity/.test(svgFB) && !/NaN|Infinity/.test(dxfFB), '四连杆导出无 NaN/Infinity')
assert((dxfFB.match(/^POLYLINE$/gm) ?? []).length === 5, 'DXF 含 5 条零件 POLYLINE')
assert((dxfFB.match(/^CIRCLE$/gm) ?? []).length === 8, 'DXF 含 8 个孔 CIRCLE（4 销孔 + 4 轴孔）')
assert(dxfFB.includes('\n200.000\n') && dxfFB.includes('\n-40.000\n'), 'DXF 应用机构平移（世界坐标 200, -40）')
const dxfFBTrace = buildDXF([], [fbExp], { includeAuxiliaries: false, includeTrace: true })
assert((dxfFBTrace.match(/^LINE$/gm) ?? []).length === 72, '勾选轨迹后 DXF 含 72 段闭合轨迹 LINE')
assert(dxfFBTrace.includes('\nTRACE\n'), '四连杆轨迹位于 TRACE 图层')
const sceneFBMix = collectScene([g1], [fbExp])
assert(sceneFBMix.solids.length === 6, '齿轮 + 四连杆混合场景实体数 = 1 + 5')

// 增删改与历史
const nBaseFB = nMech()
editorStore.addMechanism('fourBar')
assert(nMech() === nBaseFB + 1, `添加四连杆后数量为 ${nMech()}`)
const addedFB = editorStore.getState().doc.mechanisms[nMech() - 1]
assert(addedFB.kind === 'fourBar' && addedFB.name.includes('四连杆')
  && addedFB.params.frameL === DEFAULT_FOUR_BAR.frameL,
  '新机构为四连杆、名称正确且带默认参数')
editorStore.undo()
assert(nMech() === nBaseFB, '撤销添加后四连杆移除')
editorStore.redo()
assert(nMech() === nBaseFB + 1, '重做添加后四连杆恢复')
const fbId = editorStore.getState().doc.mechanisms[nMech() - 1].id
const l1Of = () => (editorStore.getState().doc.mechanisms.find((x) => x.id === fbId)!.params as FourBarParams).frameL
editorStore.updateMechanism(fbId, { params: { frameL: 130 } })
assert(l1Of() === 130, '机架长度修改生效（130 mm）')
editorStore.undo()
assert(l1Of() === DEFAULT_FOUR_BAR.frameL, '撤销后机架长度恢复默认 100 mm')
editorStore.redo()
assert(l1Of() === 130, '重做后机架长度回到 130 mm')
editorStore.setSelection([fbId])
editorStore.duplicateSelected()
assert(nMech() === nBaseFB + 2, `复制后机构数量为 ${nMech()}`)
const fbCopy = editorStore.getState().doc.mechanisms.find((x) => x.id !== fbId && x.kind === 'fourBar')
assert(!!fbCopy && (fbCopy.params as FourBarParams).frameL === 130, '副本保留四连杆类型与参数')
editorStore.setSelection([fbId, fbCopy!.id])
editorStore.deleteSelected()
assert(nMech() === nBaseFB, '删除选中四连杆后数量恢复')
editorStore.undo()
assert(nMech() === nBaseFB + 2, '撤销删除后两个四连杆恢复')
editorStore.redo()
assert(nMech() === nBaseFB, '重做删除后四连杆再次移除')

// ---------- 测试十六：V2.1 实体尺寸 / 真实开孔 / 加工设置 ----------
console.log('测试十六：轻量化尺寸编辑与加工设置系统')

// 默认实体尺寸（公称销 3 / 轴 8 mm + 默认直径间隙 0.2 mm）
const csD = csDims(csP)
assert(approx(csD.pinR, 1.6) && approx(csD.shaftR, 4.1) && csD.endD === 14 && csD.rodW === 8 && csD.crankW === 13,
  '曲柄滑块默认实体尺寸：销孔 Φ3.2、轴孔 Φ8.2、端头 Φ14、杆宽 8/13 mm（轴孔四周留料 ≥2）')
const fbD = fbDims(fbP)
assert(approx(fbD.pinR, 1.6) && approx(fbD.shaftR, 4.1) && fbD.couplerW === 8 && fbD.crankW === 13 && fbD.rockerW === 13 && fbD.endD === 14,
  '四连杆默认实体尺寸：销孔 Φ3.2、轴孔 Φ8.2、端头 Φ14、连杆 8 / 曲柄摇杆 13 mm')
// 默认参数全部机构加工检查必须无红色错误（默认即可制造）
assert(!checkManufacturing(mkMech(csP), 2).some((i) => i.severity === 'error'), '默认曲柄滑块加工检查无错误')
assert(!checkManufacturing(mkRp(rpP), 2).some((i) => i.severity === 'error'), '默认齿轮齿条加工检查无错误')
assert(!checkManufacturing(mkFb(fbP), 2).some((i) => i.severity === 'error'), '默认四连杆加工检查无错误')

// 旧项目兼容：删除全部新增实体字段后回退默认，几何有效、检查无错误
const legacyCS = { ...csP } as Partial<CrankSliderParams>
delete legacyCS.rodW; delete legacyCS.pinD; delete legacyCS.crankW; delete legacyCS.endD; delete legacyCS.shaftD
assert(outlineClosable(crankSliderGeometry(legacyCS as CrankSliderParams, 45).solids.rod.outline),
  '旧曲柄滑块数据缺实体尺寸字段时回退默认，连杆轮廓仍有效')
assert(!checkManufacturing(mkMech(legacyCS as CrankSliderParams), 2).some((i) => i.severity === 'error'),
  '旧曲柄滑块数据加工检查无错误')
const legacyFB = { ...fbP } as Partial<FourBarParams>
delete legacyFB.pinD; delete legacyFB.crankW; delete legacyFB.couplerW; delete legacyFB.rockerW
delete legacyFB.endD; delete legacyFB.shaftD
assert(!checkManufacturing(mkFb(legacyFB as FourBarParams), 2).some((i) => i.severity === 'error'),
  '旧四连杆数据加工检查无错误（缺字段按默认解析）')
assert(!checkManufacturing(mkRp(legacyRP0 as RackPinionParams), 2).some((i) => i.severity === 'error'),
  '旧齿条数据加工检查无错误（基体宽回退 max(2m, 6) = 6 mm）')

// 实体尺寸与运动学解耦：改杆宽/端头/孔径，两孔中心距恒等于杆长
for (const solid of [
  { rodW: 14, pinD: 5, endD: 16 },
  { rodW: 4, pinD: 2, endD: 8 },
]) {
  const gg = crankSliderGeometry({ ...csP, ...solid }, 45)
  const hh = gg.solids.rod.holes
  assert(approx(Math.hypot(hh[0].x - hh[1].x, hh[0].y - hh[1].y), csP.rodL, 1e-9),
    `杆宽 ${solid.rodW}/孔径 ${solid.pinD}/端头 ${solid.endD} 变化时连杆孔心距恒为 ${csP.rodL} mm`)
}

// 圆头杆件隐式闭合边：末点（端头 +法向 endR）→ 首点（杆肩 hw）边长 = endR−hw = 2
const lo = linkOutline({ x: 0, y: 0 }, { x: 40, y: 0 }, 12, 8)
assert(outlineClosable(lo) && lo.length >= 20, '圆头连杆轮廓采样充足且可闭合（含隐式闭合边）')
assert(approx(Math.hypot(lo[0].x - lo[lo.length - 1].x, lo[0].y - lo[lo.length - 1].y), 2, 1e-9),
  '隐式闭合边长度 = 端头半径 6 − 杆身半宽 4 = 2 mm（端头与杆身材料连续）')

// validateSolidGeometry：孔切穿 → 红；孔周薄壁 → 橙但不阻止；正常 → 通过
const cutSolid = { outline: linkOutline({ x: 0, y: 0 }, { x: 40, y: 0 }, 12, 8), holes: [{ x: 0, y: 0, r: 7 }] }
assert(validateSolidGeometry(cutSolid, 2).some((i) => i.severity === 'error' && i.message.includes('切穿')),
  'Φ14 孔配 Φ12 端头切穿外轮廓 → 加工错误')
// 孔完整位于轮廓内（杆身半宽 8 > r7），端头与杆身处壁厚均为 1 mm < 2 mm 阈值 → 只警告
const thinSolid = { outline: linkOutline({ x: 0, y: 0 }, { x: 40, y: 0 }, 16, 16), holes: [{ x: 0, y: 0, r: 7 }] }
const thinIss = validateSolidGeometry(thinSolid, 2)
assert(thinIss.some((i) => i.severity === 'warn') && !thinIss.some((i) => i.severity === 'error'),
  '孔周仅剩 1 mm（< 阈值 2 mm）→ 橙色警告但不阻止设计')
const okSolid = {
  outline: linkOutline({ x: 0, y: 0 }, { x: 40, y: 0 }, 12, 8),
  holes: [{ x: 0, y: 0, r: 1.6 }, { x: 40, y: 0, r: 1.6 }],
}
assert(validateSolidGeometry(okSolid, 2).length === 0, '默认 Φ3.2 孔 / Φ12 端头加工几何校验全部通过')
// 杆宽等于端头直径（退化为纯胶囊）时不得产生重合点/零长度段
const capsule = { outline: linkOutline({ x: 0, y: 0 }, { x: 40, y: 0 }, 14, 14), holes: [{ x: 0, y: 0, r: 1.6 }] }
assert(outlineClosable(capsule.outline) && validateSolidGeometry(capsule, 2).length === 0,
  '杆宽 = 端头外径（14 mm）时轮廓退化为胶囊且无零长度段')

// 运动学检查与加工检查分列，互不冒充
const sepBad = runChecks([], [mkMech(badCS)])
assert(sepBad.mechIssues.some((i) => i.severity === 'error')
  && !sepBad.mfgIssues.some((i) => i.message.includes('连杆长度')),
  'L<r 只进入运动学检查，不混入加工检查')
const sepMfg = runChecks([], [mkMech({ ...csP, blockH: 2 })])
assert(sepMfg.mfgIssues.some((i) => i.severity === 'error')
  && !sepMfg.mechIssues.some((i) => i.severity === 'error'),
  '滑块宽度超范围只进入加工检查，运动学检查保持通过')

// 导出前检查：默认通过；加工硬错误阻止导出
assert(preExportCheck([], [mkMech(csP)], 2).errors.length === 0, '默认曲柄滑块通过导出前检查')
const blockedExp = preExportCheck([], [mkRp({ ...rpP, bore: 60 })], 2)
assert(blockedExp.errors.length > 0 && blockedExp.errors.some((e) => e.includes('孔')),
  '加工硬错误（孔切穿齿根）阻止导出并给出原因')

// 项目级加工设置：新建继承 / 改默认不动旧件 / 显式应用全部 / 全程可撤销
editorStore.addMechanism('crankSlider')
const idMfgA = editorStore.getState().doc.mechanisms[nMech() - 1].id
const mfgAPin = () => (editorStore.getState().doc.mechanisms.find((m) => m.id === idMfgA)!.params as CrankSliderParams).pinD
assert(approx(mfgAPin(), 3.2), '默认间隙 0.2：新机构销孔 Φ3.2（公称 3 + 直径间隙 0.2）')
editorStore.updateMfg({ clearance: 0.5 })
assert(approx(mfgAPin(), 3.2), '修改项目默认间隙不会偷偷改动已有机构孔径')
editorStore.undo()
assert(editorStore.getState().doc.mfg.clearance === 0.2, '加工设置修改可撤销')
editorStore.redo()
assert(editorStore.getState().doc.mfg.clearance === 0.5, '加工设置修改可重做')
editorStore.addMechanism('rackPinion')
const idMfgB = editorStore.getState().doc.mechanisms[nMech() - 1].id
assert(approx((editorStore.getState().doc.mechanisms.find((m) => m.id === idMfgB)!.params as RackPinionParams).mountD, 3.5),
  '间隙 0.5：新齿条安装孔 Φ3.5')
editorStore.updateMechanism(idMfgB, { params: { mountD: 0 } })
editorStore.applyMfgToAll()
assert(approx(mfgAPin(), 3.5), '显式「应用到全部零件」后旧机构销孔更新为 Φ3.5')
assert((editorStore.getState().doc.mechanisms.find((m) => m.id === idMfgB)!.params as RackPinionParams).mountD === 0,
  '选择不打孔（Φ0）的齿条在应用全部时保持不打孔')
editorStore.undo()
assert(approx(mfgAPin(), 3.2), '「应用到全部零件」同样可撤销')
editorStore.redo()
// 关闭「应用于新建零件」后新建机构不再套间隙（保留参数原值 Φ3.2/Φ8.2，而非 3.1/8.1）
editorStore.updateMfg({ applyToNew: false, clearance: 0.1 })
editorStore.addMechanism('fourBar')
const mfgC = editorStore.getState().doc.mechanisms[nMech() - 1].params as FourBarParams
assert(mfgC.pinD === DEFAULT_FOUR_BAR.pinD && mfgC.shaftD === DEFAULT_FOUR_BAR.shaftD,
  '关闭「应用于新建零件」后新机构不套用项目间隙（沿用参数原值）')
// 板材厚度：新建齿轮继承项目厚度；已有齿轮不被修改（二维轮廓与厚度无关）
const g1ThicknessBefore = editorStore.getState().doc.gears.find((g) => g.id === 'g1')?.thickness
editorStore.updateMfg({ thickness: 5, applyToNew: true })
editorStore.addGear()
const newGear = editorStore.getState().doc.gears[editorStore.getState().doc.gears.length - 1]
assert(newGear.thickness === 5, '新齿轮继承项目板材厚度 5 mm（板材厚度不改变二维轮廓）')
assert(editorStore.getState().doc.gears.find((g) => g.id === 'g1')!.thickness === (g1ThicknessBefore ?? 3),
  '修改项目板厚不会偷偷改动已有齿轮')
// 清空测试现场
editorStore.clearCanvas()
assert(nMech() === 0 && editorStore.getState().doc.gears.length === 0, '加工设置测试现场已清空')

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
