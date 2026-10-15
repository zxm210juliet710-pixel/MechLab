// 统一杆件几何模型与加工几何校验
// ------------------------------------------------------------------
// 所有活动杆件（曲柄、连杆、摇杆）共用同一简化模型：
//   两端圆形连接头（外径 endD）+ 中间等宽杆身（宽度 bodyW）
//   两个连接孔中心间距 = 中心距（运动学尺寸，由各机构求解器给出）
//   连接孔直径只改孔，不改中心距与连接点位置
// 运动学中心线（P1→P2）与加工外轮廓在这里分开计算。
import type { Severity } from '../types'
import type { Pt } from '../geometry/gear'
import type { MechSolid } from './crankSlider'

const ARC_STEPS = 12

function arc(c: Pt, r: number, a0: number, a1: number, steps = ARC_STEPS): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return pts
}

/**
 * 圆头连杆闭合轮廓（哑铃形）：P1、P2 为两端连接孔中心，
 * endD 为两端圆形端头外径，bodyW 为中间杆身宽度（≤ endD）。
 * 两端圆头与杆身之间为连续材料，轮廓不断裂（隐式闭合，末点不重复首点）。
 */
export function linkOutline(p1: Pt, p2: Pt, endD: number, bodyW: number): Pt[] {
  const endR = Math.max(endD, 0.1) / 2
  const hw = Math.min(Math.max(bodyW, 0.1), endD) / 2
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // u=(ux,uy) 的法向 n=(-uy,ux)
  const nx = -uy
  const ny = ux
  const ang = Math.atan2(uy, ux)
  const off = (c: Pt, ox: number, oy: number): Pt => ({ x: c.x + ox, y: c.y + oy })

  const s1p = off(p1, nx * hw, ny * hw)
  const s2p = off(p2, nx * hw, ny * hw)
  const s2m = off(p2, -nx * hw, -ny * hw)
  const s1m = off(p1, -nx * hw, -ny * hw)
  // P2 端头半圆：+法向 → −法向；P1 端头半圆：−法向 → +法向
  const cap2 = arc(p2, endR, ang + Math.PI / 2, ang - Math.PI / 2)
  const cap1 = arc(p1, endR, ang - Math.PI / 2, ang - Math.PI * 1.5)
  // 杆身宽度等于端头直径（hw=endR）时退化为纯胶囊：没有杆肩，
  // 否则 s2p/c2p 等点会重合形成零长度段。
  if (endR - hw < 1e-9) {
    return [s1p, s2p, ...cap2.slice(1, -1), s2m, s1m, ...cap1.slice(1, -1)]
  }
  const c2p = off(p2, nx * endR, ny * endR)
  const c1m = off(p1, -nx * endR, -ny * endR)
  // cap1 末点即 +法向端 c1p，隐式闭合边 c1p → s1p 构成杆肩
  return [s1p, s2p, c2p, ...cap2.slice(1, -1), s2m, s1m, c1m, ...cap1.slice(1)]
}

// ------------------------------------------------------------------
// 通用加工几何校验（基于真实实体数据，不做固定文案判断）
// ------------------------------------------------------------------

export interface SolidIssue {
  severity: Severity
  message: string
}

/** 点是否在闭合多边形内部（射线法，边界点按内部处理） */
export function pointInPolygon(q: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    if (((a.y > q.y) !== (b.y > q.y)) &&
      (q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x)) {
      inside = !inside
    }
  }
  return inside
}

/** 点到线段的最短距离 */
function distPointSegment(q: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy))
}

/** 点到闭合多边形轮廓（含闭合边）的最短距离 */
function distToPolygonOutline(q: Pt, poly: Pt[]): number {
  let min = Infinity
  for (let i = 0; i < poly.length; i++) {
    min = Math.min(min, distPointSegment(q, poly[i], poly[(i + 1) % poly.length]))
  }
  return min
}

/**
 * 校验一个实体零件：轮廓闭合/无零长度线段、孔为正径、孔在轮廓内、
 * 孔周保留材料厚度、孔间不重叠。返回的消息不含零件名前缀，由调用方拼装。
 */
export function validateSolidGeometry(solid: MechSolid, minWall: number): SolidIssue[] {
  const out: SolidIssue[] = []
  const push = (severity: Severity, message: string) => out.push({ severity, message })
  const poly = solid.outline

  if (poly.length < 3 || poly.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) {
    push('error', '轮廓坐标无效或点数不足，无法导出闭合轮廓。')
    return out
  }

  // 零长度线段 / 内部重复点。注意：末点与首点重合是加工领域标准的「显式闭合」写法
  // （圆轮廓 0→2π、多边形回到起点），wrap 边重合应放行；只有内部相邻重复点才是错误。
  let zeroSeg = 0
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-7) zeroSeg++
  }
  if (zeroSeg > 0) {
    push('error', `外轮廓存在 ${zeroSeg} 段零长度线段或重复点，加工软件可能无法识别，请调整该零件尺寸。`)
  }

  // 孔校验
  const validHoles = solid.holes.filter((h) => Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.r))
  for (const h of solid.holes) {
    if (!(h.r > 1e-9)) push('error', '存在直径不大于 0 的孔，连接孔直径必须为正数（不需要孔时请将数量设为 0）。')
  }
  for (const h of validHoles) {
    if (h.r <= 1e-9) continue
    if (!pointInPolygon({ x: h.x, y: h.y }, poly)) {
      push('error', `位于 (${h.x.toFixed(1)}, ${h.y.toFixed(1)}) 的孔中心已落在零件轮廓之外，零件会被切坏。`)
      continue
    }
    // 孔圆周采样：任一点严格穿出轮廓（孔边与轮廓的距离 > 容差）才算切穿；
    // 恰好落在轮廓上的切点按内部处理，避免射线法对边界顶点的误判。
    // 同时记录孔边到外轮廓的最小壁厚。
    const N = 32
    let minMargin = Infinity
    let cutThrough = false
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2
      const q = { x: h.x + h.r * Math.cos(a), y: h.y + h.r * Math.sin(a) }
      const edgeDist = distToPolygonOutline(q, poly)
      if (!pointInPolygon(q, poly) && edgeDist > 1e-6) cutThrough = true
      minMargin = Math.min(minMargin, edgeDist)
    }
    if (cutThrough) {
      push('error', `位于 (${h.x.toFixed(1)}, ${h.y.toFixed(1)})、直径 ${(h.r * 2).toFixed(1)} mm 的孔已切穿零件外轮廓，请缩小孔径或增大零件尺寸。`)
    } else if (minMargin < minWall - 1e-6) {
      push('warn', `直径 ${(h.r * 2).toFixed(1)} mm 的孔周围最薄处仅剩约 ${minMargin.toFixed(1)} mm 材料（建议不少于 ${minWall} mm），切割后容易断裂。`)
    }
  }

  // 孔与孔重叠
  for (let i = 0; i < validHoles.length; i++) {
    for (let j = i + 1; j < validHoles.length; j++) {
      const a = validHoles[i]
      const b = validHoles[j]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < a.r + b.r - 1e-6) {
        push('error', `两个孔（直径 ${(a.r * 2).toFixed(1)} 与 ${(b.r * 2).toFixed(1)} mm）相互交叠，会打成一个不规则大洞，请减小孔径或增大孔间距。`)
      }
    }
  }

  return out
}
