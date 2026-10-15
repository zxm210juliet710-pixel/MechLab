// 编辑器全局状态：文档数据 + 历史撤销 + 视图/选择/模拟等会话状态
import { useSyncExternalStore } from 'react'
import {
  Gear, Mechanism, CrankSliderParams, RackPinionParams, FourBarParams, ToolMode, ViewTransform,
  ManufacturingSettings, DEFAULT_MANUFACTURING, PIN_NOMINAL, SHAFT_NOMINAL,
} from '../types'
import { arrangeGears } from '../geometry/arrange'
import { DEFAULT_CRANK_SLIDER, mechanismBounds } from '../mechanisms/crankSlider'
import { DEFAULT_RACK_PINION, rackBounds } from '../mechanisms/rackPinion'
import { DEFAULT_FOUR_BAR, fourBarBounds } from '../mechanisms/fourBar'

/** 机构编辑补丁：params 允许只传部分字段（任意机构类型） */
type MechanismPatch = Omit<Partial<Mechanism>, 'params'> & {
  params?: Partial<CrankSliderParams> & Partial<RackPinionParams> & Partial<FourBarParams>
}

export const DEFAULT_GEAR = { z: 20, m: 2, thickness: 3, bore: 5 }

interface Doc {
  gears: Gear[]
  mechanisms: Mechanism[]
  driverId: string | null
  seq: number
  /** 项目级加工设置（材料/板厚/工艺/配合间隙） */
  mfg: ManufacturingSettings
}

/** 参与历史比较的文档内容 */
function docFingerprint(d: Doc): string {
  return JSON.stringify({ gears: d.gears, mechanisms: d.mechanisms, driverId: d.driverId, mfg: d.mfg })
}

/** 按当前项目配合间隙生成新机构的实体孔径（仅影响新建机构） */
function withClearance<T extends { pinD?: number; shaftD?: number; mountD?: number }>(
  base: T,
  mfg: ManufacturingSettings,
): T {
  if (!mfg.applyToNew) return { ...base }
  return {
    ...base,
    ...(base.pinD !== undefined ? { pinD: PIN_NOMINAL + mfg.clearance } : null),
    ...(base.shaftD !== undefined ? { shaftD: SHAFT_NOMINAL + mfg.clearance } : null),
    ...(base.mountD !== undefined ? { mountD: PIN_NOMINAL + mfg.clearance } : null),
  }
}

function defaultDoc(): Doc {
  // 默认示例：一对正确啮合的齿轮（z=20 与 z=40，模数 2，中心距 60 mm）
  const g1: Gear = {
    id: 'g1', name: '齿轮 1', ...DEFAULT_GEAR,
    x: -30, y: 0, rotation: 0,
  }
  // g2 以齿槽对准 g1：朝向角 π，槽中心位于 π/z2
  const g2: Gear = {
    id: 'g2', name: '齿轮 2', z: 40, m: 2, thickness: 3, bore: 5,
    x: 30, y: 0, rotation: (((Math.PI - Math.PI / 40) * 180) / Math.PI),
  }
  return { gears: [g1, g2], mechanisms: [], driverId: 'g1', seq: 3, mfg: { ...DEFAULT_MANUFACTURING } }
}

export interface EditorState {
  doc: Doc
  selection: string[]
  tool: ToolMode
  snap: boolean
  view: ViewTransform
  viewport: { w: number; h: number }
  canUndo: boolean
  canRedo: boolean
  // 运动模拟
  playing: boolean
  simAngles: Record<string, number>
  driverRpm: number
  speedFactor: number
  // 定位高亮（问题列表点击）
  highlightPair: [string, string] | null
  toast: string | null
  /** 加工设置弹窗是否打开（会话状态，不进历史） */
  mfgModalOpen: boolean
}

class EditorStore {
  private state: EditorState = {
    doc: defaultDoc(),
    selection: [],
    tool: 'select',
    snap: true,
    view: { scale: 4, tx: 0, ty: 0 },
    viewport: { w: 1000, h: 700 },
    canUndo: false,
    canRedo: false,
    playing: false,
    simAngles: {},
    driverRpm: 30,
    speedFactor: 1,
    highlightPair: null,
    toast: null,
    mfgModalOpen: false,
  }
  private listeners = new Set<() => void>()
  private past: Doc[] = []
  private future: Doc[] = []
  private gestureBase: Doc | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  getState = (): EditorState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.state = { ...this.state, canUndo: this.past.length > 0, canRedo: this.future.length > 0 }
    this.listeners.forEach((l) => l())
  }

  // ---- 历史 ----
  /** 开始一次连续操作（拖动、连续调参），记录基线 */
  beginGesture() {
    if (!this.gestureBase) this.gestureBase = this.cloneDoc()
  }

  commitGesture() {
    if (this.gestureBase) {
      if (docFingerprint(this.gestureBase) !== docFingerprint(this.state.doc)) {
        this.past.push(this.gestureBase)
        this.future = []
      }
      this.gestureBase = null
      this.emit()
    }
  }

  private cloneDoc(): Doc {
    return JSON.parse(JSON.stringify(this.state.doc)) as Doc
  }

  /** 单次即提交的修改 */
  private mutate(label: string, fn: (doc: Doc) => void) {
    const base = this.cloneDoc()
    fn(this.state.doc)
    // 刷新数组引用，确保以 doc 数据为依赖的缓存重新计算
    this.state.doc = {
      ...this.state.doc,
      gears: [...this.state.doc.gears],
      mechanisms: [...this.state.doc.mechanisms],
    }
    void label
    if (docFingerprint(base) !== docFingerprint(this.state.doc)) {
      this.past.push(base)
      this.future = []
      this.emit()
    }
  }

  /** 判断 id 是否属于当前文档（齿轮或机构） */
  private idExists(d: Doc, id: string): boolean {
    return d.gears.some((g) => g.id === id) || d.mechanisms.some((m) => m.id === id)
  }

  undo() {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.cloneDoc())
    this.gestureBase = null
    this.state.doc = prev
    this.state.selection = this.state.selection.filter((id) => this.idExists(prev, id))
    if (this.state.doc.driverId && !prev.gears.some((g) => g.id === this.state.doc.driverId)) {
      this.state.doc.driverId = null
    }
    this.state.playing = false
    this.state.simAngles = {}
    this.emit()
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.cloneDoc())
    this.gestureBase = null
    this.state.doc = next
    this.state.selection = this.state.selection.filter((id) => this.idExists(next, id))
    this.state.playing = false
    this.state.simAngles = {}
    this.emit()
  }

  // ---- 选择与工具 ----
  setSelection(ids: string[]) {
    this.state.selection = ids
    this.emit()
  }

  setTool(tool: ToolMode) {
    this.state.tool = tool
    this.emit()
  }

  setSnap(v: boolean) {
    this.state.snap = v
    this.emit()
  }

  setView(v: Partial<ViewTransform>) {
    this.state.view = { ...this.state.view, ...v }
    this.emit()
  }

  setViewport(w: number, h: number) {
    this.state.viewport = { w, h }
  }

  setHighlightPair(p: [string, string] | null) {
    this.state.highlightPair = p
    this.emit()
  }

  toastMsg(msg: string) {
    this.state.toast = msg
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.state.toast = null
      this.emit()
    }, 2600)
    this.emit()
  }

  // ---- 坐标换算 ----
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const { scale, tx, ty } = this.state.view
    const cx = this.state.viewport.w / 2
    const cy = this.state.viewport.h / 2
    return { x: (sx - cx - tx) / scale, y: -(sy - cy - ty) / scale }
  }

  // ---- 文档操作 ----
  addGear() {
    const center = this.screenToWorld(this.state.viewport.w / 2, this.state.viewport.h / 2)
    this.mutate('add', (doc) => {
      const id = `g${doc.seq++}`
      // 螺旋偏移，避免与已有齿轮或机构重叠
      let x = center.x
      let y = center.y
      const ra = (DEFAULT_GEAR.m * (DEFAULT_GEAR.z + 2)) / 2
      const occupied = (gx: number, gy: number) => {
        if (doc.gears.some((g) => Math.hypot(g.x - gx, g.y - gy) < ra + g.m * (g.z + 2) / 2 + 4)) return true
        return doc.mechanisms.some((m) => {
          const b = m.kind === 'crankSlider'
            ? mechanismBounds(m.params as CrankSliderParams)
            : m.kind === 'rackPinion'
              ? rackBounds(m.params as RackPinionParams)
              : fourBarBounds(m.params as FourBarParams)
          const cx = (b.minX + b.maxX) / 2
          const cy = (b.minY + b.maxY) / 2
          const rad = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2
          return Math.hypot(m.x + cx - gx, m.y + cy - gy) < rad + ra
        })
      }
      if (occupied(x, y)) {
        for (let k = 1; k <= 24; k++) {
          const ang = k * 0.9
          const r = k * 22
          const nx = center.x + r * Math.cos(ang)
          const ny = center.y + r * Math.sin(ang)
          if (!occupied(nx, ny)) { x = nx; y = ny; break }
        }
      }
      const gear: Gear = {
        id, name: `齿轮 ${doc.seq - 1}`, ...DEFAULT_GEAR,
        thickness: doc.mfg.thickness > 0 ? doc.mfg.thickness : DEFAULT_GEAR.thickness,
        x, y, rotation: 0,
      }
      doc.gears.push(gear)
      this.state.selection = [id]
    })
  }

  /** 在可见区域添加一个完整机构，不覆盖已有对象 */
  addMechanism(kind: Mechanism['kind'] = 'crankSlider') {
    const center = this.screenToWorld(this.state.viewport.w / 2, this.state.viewport.h / 2)
    this.mutate('add-mech', (doc) => {
      const id = `m${doc.seq++}`
      const nameCN = kind === 'crankSlider' ? '曲柄滑块' : kind === 'rackPinion' ? '齿轮齿条' : '四连杆'
      const b = kind === 'crankSlider'
        ? mechanismBounds(DEFAULT_CRANK_SLIDER)
        : kind === 'rackPinion'
          ? rackBounds(DEFAULT_RACK_PINION)
          : fourBarBounds(DEFAULT_FOUR_BAR)
      let x = center.x - (b.minX + b.maxX) / 2
      let y = center.y - (b.minY + b.maxY) / 2
      const overlap = (mx: number, my: number) =>
        doc.mechanisms.some((m2) => Math.hypot(m2.x - mx, m2.y - my) < 160) ||
        doc.gears.some((g) => Math.hypot(g.x - mx, g.y - my) < 130)
      if (overlap(x, y)) {
        for (let k = 1; k <= 24; k++) {
          const nx = x + k * 36 * Math.cos(k * 0.8)
          const ny = y + k * 36 * Math.sin(k * 0.8)
          if (!overlap(nx, ny)) { x = nx; y = ny; break }
        }
      }
      const mech: Mechanism = {
        id,
        kind,
        name: `${nameCN} ${doc.seq - 1}`,
        x,
        y,
        initialAngle: kind === 'crankSlider' || kind === 'fourBar' ? 45 : 0,
        driverRpm: 30,
        params: kind === 'crankSlider'
          ? withClearance({ ...DEFAULT_CRANK_SLIDER }, doc.mfg)
          : kind === 'rackPinion'
            ? withClearance({ ...DEFAULT_RACK_PINION }, doc.mfg)
            : withClearance({ ...DEFAULT_FOUR_BAR }, doc.mfg),
      }
      doc.mechanisms.push(mech)
      this.state.selection = [id]
    })
  }

  deleteSelected() {
    if (this.state.selection.length === 0) return
    const ids = new Set(this.state.selection)
    this.mutate('delete', (doc) => {
      doc.gears = doc.gears.filter((g) => !ids.has(g.id))
      doc.mechanisms = doc.mechanisms.filter((m) => !ids.has(m.id))
      if (doc.driverId && ids.has(doc.driverId)) doc.driverId = null
    })
    this.state.selection = []
  }

  duplicateSelected() {
    if (this.state.selection.length === 0) return
    this.mutate('duplicate', (doc) => {
      const gearCopies: Gear[] = []
      const mechCopies: Mechanism[] = []
      for (const id of this.state.selection) {
        const g = doc.gears.find((x) => x.id === id)
        if (g) {
          const nid = `g${doc.seq++}`
          gearCopies.push({
            ...JSON.parse(JSON.stringify(g)),
            id: nid,
            name: `齿轮 ${doc.seq - 1}`,
            x: g.x + 12,
            y: g.y - 12,
          })
          continue
        }
        const m = doc.mechanisms.find((x) => x.id === id)
        if (m) {
          const nid = `m${doc.seq++}`
          mechCopies.push({
            ...JSON.parse(JSON.stringify(m)),
            id: nid,
            name: `${m.name} 副本`,
            x: m.x + 24,
            y: m.y - 24,
          })
        }
      }
      doc.gears.push(...gearCopies)
      doc.mechanisms.push(...mechCopies)
      this.state.selection = [...gearCopies.map((g) => g.id), ...mechCopies.map((m) => m.id)]
    })
  }

  /** 重置选中对象的参数为默认值（保留位置） */
  resetSelected() {
    if (this.state.selection.length === 0) {
      this.toastMsg('请先选择需要重置的齿轮或机构。')
      return
    }
    this.mutate('reset', (doc) => {
      for (const g of doc.gears) {
        if (this.state.selection.includes(g.id)) {
          g.z = DEFAULT_GEAR.z
          g.m = DEFAULT_GEAR.m
          g.thickness = doc.mfg.thickness > 0 ? doc.mfg.thickness : DEFAULT_GEAR.thickness
          g.bore = DEFAULT_GEAR.bore
        }
      }
      for (const m of doc.mechanisms) {
        if (!this.state.selection.includes(m.id)) continue
        if (m.kind === 'crankSlider') {
          m.params = withClearance({ ...DEFAULT_CRANK_SLIDER }, doc.mfg)
          m.initialAngle = 45
          m.driverRpm = 30
        } else if (m.kind === 'rackPinion') {
          m.params = withClearance({ ...DEFAULT_RACK_PINION }, doc.mfg)
          m.initialAngle = 0
          m.driverRpm = 30
        } else if (m.kind === 'fourBar') {
          m.params = withClearance({ ...DEFAULT_FOUR_BAR }, doc.mfg)
          m.initialAngle = 45
          m.driverRpm = 30
        }
        delete m.thicknessOverride
      }
    })
  }

  clearCanvas() {
    this.mutate('clear', (doc) => {
      doc.gears = []
      doc.mechanisms = []
      doc.driverId = null
    })
    this.state.selection = []
    this.state.simAngles = {}
    this.state.playing = false
  }

  arrange() {
    if (this.state.doc.gears.length < 2) {
      this.toastMsg('画布上至少需要两个齿轮才能自动排列。')
      return
    }
    this.mutate('arrange', (doc) => {
      doc.gears = arrangeGears(doc.gears)
    })
  }

  // ---- 参数编辑（支持手势合并，需不可变更新以驱动 memo 重算） ----
  updateGearLive(id: string, patch: Partial<Gear>) {
    this.state.doc = {
      ...this.state.doc,
      gears: this.state.doc.gears.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }
    this.emit()
  }

  updateGear(id: string, patch: Partial<Gear>) {
    this.beginGesture()
    this.updateGearLive(id, patch)
    this.commitGesture()
  }

  // ---- 机构参数编辑（支持手势合并） ----
  updateMechanismLive(id: string, patch: MechanismPatch) {
    this.state.doc = {
      ...this.state.doc,
      mechanisms: this.state.doc.mechanisms.map((m) =>
        m.id === id
          ? {
              ...m,
              ...patch,
              params: patch.params ? { ...m.params, ...patch.params } : m.params,
            }
          : m,
      ),
    }
    this.emit()
  }

  updateMechanism(id: string, patch: MechanismPatch) {
    this.beginGesture()
    this.updateMechanismLive(id, patch)
    this.commitGesture()
  }

  // ---- 拖动（整体合并为一次历史） ----
  dragBegin() {
    this.beginGesture()
  }

  dragMove(next: Gear[]) {
    this.state.doc.gears = next
    this.emit()
  }

  dragMoveMechanisms(next: Mechanism[]) {
    this.state.doc.mechanisms = next
    this.emit()
  }

  dragEnd() {
    this.commitGesture()
  }

  setDriver(id: string | null) {
    this.mutate('driver', (doc) => {
      doc.driverId = doc.driverId === id ? null : id
    })
  }

  // ---- 运动模拟 ----
  setPlaying(v: boolean) {
    this.state.playing = v
    this.emit()
  }

  setSimAngles(a: Record<string, number>) {
    this.state.simAngles = a
    this.emit()
  }

  setDriverRpm(rpm: number) {
    this.state.driverRpm = rpm
    this.emit()
  }

  setSpeedFactor(f: number) {
    this.state.speedFactor = f
    this.emit()
  }

  // ---- 项目级加工设置 ----
  setMfgModalOpen(v: boolean) {
    this.state.mfgModalOpen = v
    this.emit()
  }

  /** 弹窗内实时编辑（不进历史），关闭/切换时由 updateMfg 统一提交 */
  updateMfgLive(patch: Partial<ManufacturingSettings>) {
    this.state.doc = { ...this.state.doc, mfg: { ...this.state.doc.mfg, ...patch } }
    this.emit()
  }

  /** 提交一次加工设置修改（进入撤销历史） */
  updateMfg(patch: Partial<ManufacturingSettings>) {
    this.mutate('mfg', (doc) => {
      doc.mfg = { ...doc.mfg, ...patch }
    })
  }

  /**
   * 把当前项目板材厚度与配合间隙明确应用到全部已有零件（需 UI 确认后调用）。
   * 只重算标准孔（销孔/轴孔/已有的安装孔）与板厚，用户单独设置的独立孔径保持不变；
   * 不触碰任何运动学尺寸与齿轮齿形。
   */
  applyMfgToAll() {
    this.mutate('mfg-apply-all', (doc) => {
      const t = doc.mfg.thickness
      const c = doc.mfg.clearance
      for (const g of doc.gears) {
        if (t > 0) g.thickness = t
      }
      for (const m of doc.mechanisms) {
        delete m.thicknessOverride
        if (m.kind === 'crankSlider') {
          const p = m.params as CrankSliderParams
          p.pinD = PIN_NOMINAL + c
          p.shaftD = SHAFT_NOMINAL + c
        } else if (m.kind === 'fourBar') {
          const p = m.params as FourBarParams
          p.pinD = PIN_NOMINAL + c
          p.shaftD = SHAFT_NOMINAL + c
        } else if (m.kind === 'rackPinion') {
          const p = m.params as RackPinionParams
          // 安装孔直径为 0 表示不打孔，尊重该选择
          if (p.mountD > 0) p.mountD = PIN_NOMINAL + c
        }
      }
    })
  }

  /** 单独覆盖/清除选中机构的板材厚度（undefined 表示恢复继承项目设置） */
  setSelectedThicknessOverride(t: number | undefined) {
    if (this.state.selection.length === 0) return
    this.mutate('thickness-override', (doc) => {
      for (const m of doc.mechanisms) {
        if (!this.state.selection.includes(m.id)) continue
        if (t === undefined) delete m.thicknessOverride
        else m.thicknessOverride = t
      }
    })
  }
}

export const editorStore = new EditorStore()

export function useEditor(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getState)
}
