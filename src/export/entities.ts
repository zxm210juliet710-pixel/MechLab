// 导出场景：把齿轮与机构统一转换为世界坐标（mm，Y 向上）的可绘制实体
import { Gear, Mechanism, CrankSliderParams, RackPinionParams, FourBarParams } from '../types'
import { gearProfile, Pt } from '../geometry/gear'
import { crankSliderGeometry, Circle, MechSolid } from '../mechanisms/crankSlider'
import { rackPinionGeometry } from '../mechanisms/rackPinion'
import { fourBarGeometry } from '../mechanisms/fourBar'

export interface WorldSolid {
  /** 闭合外轮廓（世界坐标 mm，Y 向上） */
  outline: Pt[]
  /** 圆孔（世界坐标） */
  holes: Circle[]
}

export interface WorldLine {
  x1: number
  y1: number
  x2: number
  y2: number
  /** 辅助线类型：导轨 / 轨迹 */
  kind: 'rail' | 'trace'
}

export interface ExportScene {
  solids: WorldSolid[]
  auxiliaries: WorldLine[]
}

export interface ExportOptions {
  /** 是否包含导轨等辅助线（默认不导出，避免混入加工轮廓） */
  includeAuxiliaries: boolean
  /** 是否包含运动轨迹 */
  includeTrace: boolean
}

/** 齿轮轮廓（含中心孔）→ 世界实体 */
function gearSolid(g: Gear): WorldSolid {
  const { outline } = gearProfile(g.z, g.m, g.bore)
  const rad = (g.rotation * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return {
    outline: outline.map((p) => ({ x: g.x + p.x * c - p.y * s, y: g.y + p.x * s + p.y * c })),
    holes: g.bore > 0 ? [{ x: g.x, y: g.y, r: g.bore / 2 }] : [],
  }
}

function shiftSolid(solid: MechSolid, dx: number, dy: number): WorldSolid {
  return {
    outline: solid.outline.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    holes: solid.holes.map((h) => ({ x: h.x + dx, y: h.y + dy, r: h.r })),
  }
}

/** 收集当前姿态下的导出场景（机构取当前曲柄角度姿态） */
export function collectScene(
  gears: Gear[],
  mechanisms: Mechanism[],
  opts: ExportOptions = { includeAuxiliaries: false, includeTrace: false },
): ExportScene {
  const solids: WorldSolid[] = gears.map(gearSolid)
  const auxiliaries: WorldLine[] = []

  for (const m of mechanisms) {
    if (m.kind === 'crankSlider') {
      const geom = crankSliderGeometry(m.params as CrankSliderParams, m.initialAngle)
      solids.push(
        shiftSolid(geom.solids.frameBase, m.x, m.y),
        shiftSolid(geom.solids.frameBearing, m.x, m.y),
        shiftSolid(geom.solids.crank, m.x, m.y),
        shiftSolid(geom.solids.rod, m.x, m.y),
        shiftSolid(geom.solids.block, m.x, m.y),
      )
      if (opts.includeAuxiliaries) {
        for (const r of geom.rails) {
          auxiliaries.push({ x1: m.x + r.x1, y1: m.y + r.y1, x2: m.x + r.x2, y2: m.y + r.y2, kind: 'rail' })
        }
      }
      if (opts.includeTrace) {
        auxiliaries.push({
          x1: m.x + geom.trace.x1, y1: m.y, x2: m.x + geom.trace.x2, y2: m.y, kind: 'trace',
        })
      }
    } else if (m.kind === 'rackPinion') {
      const geom = rackPinionGeometry(m.params as RackPinionParams, m.initialAngle)
      solids.push(
        shiftSolid(geom.solids.pinion, m.x, m.y),
        shiftSolid(geom.solids.rack, m.x, m.y),
        shiftSolid(geom.solids.frameBearing, m.x, m.y),
        shiftSolid(geom.solids.frameBase, m.x, m.y),
      )
      if (opts.includeAuxiliaries) {
        for (const r of geom.rails) {
          auxiliaries.push({ x1: m.x + r.x1, y1: m.y + r.y1, x2: m.x + r.x2, y2: m.y + r.y2, kind: 'rail' })
        }
      }
      if (opts.includeTrace) {
        auxiliaries.push({
          x1: m.x + geom.trace.x1, y1: m.y + geom.trace.y,
          x2: m.x + geom.trace.x2, y2: m.y + geom.trace.y, kind: 'trace',
        })
      }
    } else if (m.kind === 'fourBar') {
      const geom = fourBarGeometry(m.params as FourBarParams, m.initialAngle)
      solids.push(
        shiftSolid(geom.solids.bearingO4, m.x, m.y),
        shiftSolid(geom.solids.bearingO2, m.x, m.y),
        shiftSolid(geom.solids.crank, m.x, m.y),
        shiftSolid(geom.solids.coupler, m.x, m.y),
        shiftSolid(geom.solids.rocker, m.x, m.y),
      )
      // 连杆中点整周轨迹：离散为闭合折线导出
      if (opts.includeTrace) {
        const pts = geom.tracePts
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]
          const b2 = pts[(i + 1) % pts.length]
          auxiliaries.push({
            x1: m.x + a.x, y1: m.y + a.y, x2: m.x + b2.x, y2: m.y + b2.y, kind: 'trace',
          })
        }
      }
    }
  }

  return { solids, auxiliaries }
}

/** 场景包围盒（仅实体；不含辅助线时用实体即可） */
export function sceneBounds(scene: ExportScene) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  for (const s of scene.solids) {
    for (const p of s.outline) eat(p.x, p.y)
    for (const h of s.holes) {
      eat(h.x - h.r, h.y - h.r); eat(h.x + h.r, h.y + h.r)
    }
  }
  for (const a of scene.auxiliaries) {
    eat(a.x1, a.y1); eat(a.x2, a.y2)
  }
  if (!Number.isFinite(minX)) return null
  const pad = 2
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
}
