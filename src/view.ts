// 视图变换辅助
import { editorStore } from './store/editor'
import { Gear, Mechanism, CrankSliderParams, RackPinionParams, FourBarParams } from './types'
import { mechanismBounds } from './mechanisms/crankSlider'
import { rackBounds } from './mechanisms/rackPinion'
import { fourBarBounds } from './mechanisms/fourBar'

/** 任意机构的静止包围盒（按类型分流） */
export function mechanismBoundsOf(m: Mechanism) {
  if (m.kind === 'rackPinion') return rackBounds(m.params as RackPinionParams)
  if (m.kind === 'fourBar') return fourBarBounds(m.params as FourBarParams)
  return mechanismBounds(m.params as CrankSliderParams)
}

export function boundsOf(gears: Gear[], mechanisms: Mechanism[] = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const g of gears) {
    const ra = (g.m * (g.z + 2)) / 2
    minX = Math.min(minX, g.x - ra)
    minY = Math.min(minY, g.y - ra)
    maxX = Math.max(maxX, g.x + ra)
    maxY = Math.max(maxY, g.y + ra)
  }
  for (const m of mechanisms) {
    const b = mechanismBoundsOf(m)
    minX = Math.min(minX, m.x + b.minX)
    minY = Math.min(minY, m.y + b.minY)
    maxX = Math.max(maxX, m.x + b.maxX)
    maxY = Math.max(maxY, m.y + b.maxY)
  }
  return { minX, minY, maxX, maxY }
}

export function fitView() {
  const st = editorStore.getState()
  if (st.doc.gears.length === 0 && st.doc.mechanisms.length === 0) {
    editorStore.setView({ scale: 4, tx: 0, ty: 0 })
    return
  }
  const b = boundsOf(st.doc.gears, st.doc.mechanisms)
  const w = Math.max(b.maxX - b.minX, 10)
  const h = Math.max(b.maxY - b.minY, 10)
  const { w: vw, h: vh } = st.viewport
  const scale = Math.min(vw / (w * 1.35), vh / (h * 1.45))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  editorStore.setView({
    scale: Math.min(60, Math.max(0.4, scale)),
    tx: -cx * scale,
    ty: cy * scale,
  })
}

/** 以屏幕中心为锚点缩放 */
export function zoomBy(factor: number) {
  const st = editorStore.getState()
  const scale = Math.min(60, Math.max(0.4, st.view.scale * factor))
  const f = scale / st.view.scale
  editorStore.setView({ scale, tx: st.view.tx * f, ty: st.view.ty * f })
}

/** 定位到世界坐标中的某个区域 */
export function focusOnWorld(x: number, y: number, radiusMm: number) {
  const st = editorStore.getState()
  const { w: vw, h: vh } = st.viewport
  const need = Math.max(radiusMm * 2.4, 40)
  const scale = Math.min(12, Math.max(st.view.scale, Math.min(vw / need, vh / need)))
  editorStore.setView({ scale, tx: -x * scale, ty: y * scale })
}
