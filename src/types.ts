// 全局数据模型：画布显示、运动模拟、检查与导出共用同一套数据

// ------------------------------------------------------------------
// 项目级加工设置（材料 / 板厚 / 加工方式 / 配合间隙）
// ------------------------------------------------------------------

export type MaterialType = 'plywood' | 'acrylic' | 'mdf' | 'custom'
export type ProcessType = 'laser' | 'print3d' | 'drawing'

/** 项目级统一加工设置；新建零件默认继承，修改默认值不改动已完成零件 */
export interface ManufacturingSettings {
  /** 材料类型 */
  material: MaterialType
  /** 自定义材料名称（material=custom 时使用） */
  customMaterial: string
  /** 板材厚度 mm（仅加工/装配信息，不改变二维轮廓） */
  thickness: number
  /** 加工方式 */
  process: ProcessType
  /** 机械配合间隙（直径间隙）mm：如轴径 8 mm + 0.2 mm → 孔径 8.2 mm */
  clearance: number
  /** 是否应用于新建零件 */
  applyToNew: boolean
  /** 孔周最小保留材料厚度 mm（低于则警告，不阻止） */
  minWall: number
}

export const DEFAULT_MANUFACTURING: ManufacturingSettings = {
  material: 'plywood',
  customMaterial: '',
  thickness: 3,
  process: 'laser',
  clearance: 0.2,
  applyToNew: true,
  minWall: 2,
}

export const MATERIAL_OPTIONS: Array<{ value: MaterialType; label: string }> = [
  { value: 'plywood', label: '胶合板' },
  { value: 'acrylic', label: '亚克力' },
  { value: 'mdf', label: 'MDF 中密度纤维板' },
  { value: 'custom', label: '自定义材料' },
]

export const PROCESS_OPTIONS: Array<{ value: ProcessType; label: string }> = [
  { value: 'laser', label: '激光切割' },
  { value: 'print3d', label: '3D 打印' },
  { value: 'drawing', label: '仅导出二维图纸' },
]

/** 标准铰接销公称直径 mm（默认孔径 = 公称直径 + 配合间隙） */
export const PIN_NOMINAL = 3
/** 固定轴公称直径 mm */
export const SHAFT_NOMINAL = 8

/** 标准外啮合直齿圆柱齿轮 */
export interface Gear {
  id: string
  /** 显示名称，如“齿轮 1” */
  name: string
  /** 齿数（正整数） */
  z: number
  /** 模数 mm */
  m: number
  /** 厚度 mm（仅用于制造记录，不参与二维啮合） */
  thickness: number
  /** 中心孔直径 mm */
  bore: number
  /** 中心坐标 mm */
  x: number
  y: number
  /** 设计旋转角度（齿形相位），度 */
  rotation: number
}

// ------------------------------------------------------------------
// 机构（由多个零件经运动副约束组成的系统）
// ------------------------------------------------------------------

export type MechanismKind = 'crankSlider' | 'rackPinion' | 'fourBar'

/** 曲柄滑块机构参数 */
export interface CrankSliderParams {
  /** 曲柄长度 mm（固定铰 O 到曲柄销 A，运动学尺寸） */
  crankR: number
  /** 连杆中心距 mm（曲柄销 A 到滑块销 B，运动学尺寸） */
  rodL: number
  /** 滑块沿导轨方向的尺寸 mm */
  blockW: number
  /** 滑块垂直导轨方向的尺寸 mm */
  blockH: number
  /** 滑块装配方向：1 = 沿导轨正方向，-1 = 负方向 */
  axisSign: 1 | -1
  /** 是否显示运动轨迹 */
  showTrace: boolean
  /** 是否显示运动方向箭头 */
  showArrow: boolean

  // ---- 实体加工尺寸（不影响运动学） ----
  /** 连杆杆身宽度 mm */
  rodW: number
  /** 铰接销连接孔直径 mm（曲柄销/滑块销统一） */
  pinD: number
  /** 曲柄杆身宽度 mm（高级参数） */
  crankW: number
  /** 连接头外径 mm（曲柄与连杆的圆头外径，高级参数） */
  endD: number
  /** 固定轴孔直径 mm（高级参数） */
  shaftD: number
  /** 高级：连杆 A 端（曲柄销端）独立孔径，省略时与 pinD 相同 */
  rodHoleA?: number
  /** 高级：连杆 B 端（滑块销端）独立孔径，省略时与 pinD 相同 */
  rodHoleB?: number
}

/** 齿轮齿条机构参数 */
export interface RackPinionParams {
  /** 齿轮齿数 */
  z: number
  /** 模数 mm（齿条齿距 p = πm 自动匹配，不允许另设） */
  m: number
  /** 齿轮中心孔直径 mm */
  bore: number
  /** 齿条总长度 mm */
  rackL: number
  /** 单侧允许移动行程 mm（超出后判定滑出导轨） */
  travel: number
  /** 齿条位于齿轮的哪一侧：1 = 上方，-1 = 下方 */
  rackSide: 1 | -1
  /** 是否显示运动轨迹 */
  showTrace: boolean
  /** 是否显示运动方向箭头 */
  showArrow: boolean

  // ---- 实体加工尺寸（不影响齿形与运动学） ----
  /** 齿条基体宽度 mm（齿根线以下的本体厚度，不改变齿高/齿形） */
  rackBodyW: number
  /** 安装孔直径 mm（0 表示不打孔） */
  mountD: number
  /** 安装孔数量（0～6，沿齿条中线均布，高级参数） */
  mountCount: number
  /** 安装孔间距 mm（相邻两孔中心距，高级参数） */
  mountSpacing: number
}

/** 铰链四连杆机构参数（曲柄摇杆型） */
export interface FourBarParams {
  /** 机架长度 mm（两固定铰 O4 与 O2 的间距 L1） */
  frameL: number
  /** 曲柄长度 mm（L2，主动件，须为最短杆） */
  crankL: number
  /** 连杆长度 mm（L3） */
  couplerL: number
  /** 摇杆长度 mm（L4） */
  rockerL: number
  /** 连杆与摇杆的交汇装配：1 = 机架线上方，-1 = 下方 */
  assembly: 1 | -1
  /** 是否显示运动轨迹（连杆中点轨迹） */
  showTrace: boolean
  /** 是否显示运动方向箭头 */
  showArrow: boolean

  // ---- 实体加工尺寸（不影响运动学） ----
  /** 铰接销连接孔直径 mm（A/B 活动铰统一） */
  pinD: number
  /** 曲柄杆身宽度 mm */
  crankW: number
  /** 连杆杆身宽度 mm */
  couplerW: number
  /** 摇杆杆身宽度 mm */
  rockerW: number
  /** 连接头外径 mm（三根活动杆圆头外径，高级参数） */
  endD: number
  /** 固定轴孔直径 mm（两固定铰轴承，高级参数） */
  shaftD: number
  /** 高级：连杆 A 端（曲柄销端）独立孔径，省略时与 pinD 相同 */
  couplerHoleA?: number
  /** 高级：连杆 B 端（摇杆销端）独立孔径，省略时与 pinD 相同 */
  couplerHoleB?: number
}

export type MechanismParams = CrankSliderParams | RackPinionParams | FourBarParams

export interface Mechanism {
  id: string
  kind: MechanismKind
  /** 显示名称，如“曲柄滑块 1” */
  name: string
  /** 机构原点世界坐标 mm（曲柄滑块为固定铰；齿轮齿条为齿轮中心） */
  x: number
  y: number
  /** 主动件初始角度（°） */
  initialAngle: number
  /** 主动件转速 r/min，负值表示反向 */
  driverRpm: number
  params: MechanismParams
  /** 高级：本机构单独的板材厚度覆盖（mm）；省略时继承项目加工设置 */
  thicknessOverride?: number
}

export type ToolMode = 'select' | 'pan'

export interface ViewTransform {
  /** 画布缩放倍数（1 = 100%） */
  scale: number
  /** 平移（屏幕像素） */
  tx: number
  ty: number
}

/** none=两齿轮相距过远、互不接触，无啮合关系也不构成干涉（不展示为问题） */
export type Severity = 'ok' | 'warn' | 'error' | 'none'

/** 单个齿轮的参数校验结果 */
export interface GearIssue {
  gearId: string
  severity: Severity
  message: string
}

/** 单个机构的检查结果 */
export interface MechIssue {
  mechId: string
  severity: Severity
  message: string
}

/** 一对齿轮的检查结果 */
export interface PairIssue {
  a: string
  b: string
  severity: Severity
  message: string
  /** 理论中心距 mm（模数相同时存在） */
  idealDistance?: number
  /** 实际中心距 mm */
  distance: number
  /** 是否被判定为正常啮合 */
  meshing: boolean
}

export interface CheckResult {
  gearIssues: GearIssue[]
  pairIssues: PairIssue[]
  /** 机构运动学检查结果（杆长约束、格拉霍夫、传动角、运动干涉等） */
  mechIssues: MechIssue[]
  /** 加工合理性检查结果（孔位、壁厚、轮廓闭合、齿条安装孔等，与运动学分开） */
  mfgIssues: MechIssue[]
  /** 以齿轮 id 为键的啮合关系图（仅包含确认啮合的对） */
  meshGraph: Record<string, string[]>
}
