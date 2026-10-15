// SVG 图纸导出：真实毫米坐标、真实齿形/机构轮廓、内孔用 evenodd 挖空
import { Gear, Mechanism } from '../types'
import { gearProfile, Pt } from '../geometry/gear'
import { collectScene, sceneBounds, ExportOptions } from './entities'

export interface ExportBounds {
  minX: number
  minY: number
  width: number
  height: number
}

export function computeBounds(gears: Gear[], mechanisms: Mechanism[] = []): ExportBounds | null {
  const scene = collectScene(gears, mechanisms, { includeAuxiliaries: true, includeTrace: true })
  return sceneBounds(scene)
}

/** 局部齿形变换到世界坐标（含设计相位与中心位置） */
export function worldOutline(g: Gear): Pt[] {
  const { outline } = gearProfile(g.z, g.m, g.bore)
  const rad = (g.rotation * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return outline.map((p) => ({
    x: g.x + p.x * c - p.y * s,
    y: g.y + p.x * s + p.y * c,
  }))
}

function solidPath(outline: Pt[], holes: { x: number; y: number; r: number }[], shiftX: number, height: number, shiftY: number): string {
  let d = ''
  outline.forEach((p, i) => {
    const x = p.x + shiftX
    const y = height - (p.y + shiftY) // SVG Y 轴向下
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`
  })
  d += 'Z'
  for (const h of holes) {
    const cx = h.x + shiftX
    const cy = height - (h.y + shiftY)
    d += `M${(cx + h.r).toFixed(3)},${cy.toFixed(3)}`
    d += `A${h.r.toFixed(3)},${h.r.toFixed(3)} 0 1,0 ${(cx - h.r).toFixed(3)},${cy.toFixed(3)}`
    d += `A${h.r.toFixed(3)},${h.r.toFixed(3)} 0 1,0 ${(cx + h.r).toFixed(3)},${cy.toFixed(3)}Z`
  }
  return d
}

/** 生成独立 SVG 文件字符串（单位 mm） */
export function buildSVG(
  gears: Gear[],
  mechanisms: Mechanism[] = [],
  opts: ExportOptions = { includeAuxiliaries: false, includeTrace: false },
): string {
  const scene = collectScene(gears, mechanisms, opts)
  const b = sceneBounds(scene)
  if (!b) throw new Error('没有可导出的零件。')

  const shiftX = -b.minX
  const shiftY = -b.minY
  const W = b.width.toFixed(3)
  const H = b.height.toFixed(3)

  const bodies = scene.solids
    .map((s) => `  <path d="${solidPath(s.outline, s.holes, shiftX, b.height, shiftY)}" fill="#FFFFFF" stroke="#1A1A1A" stroke-width="0.12" fill-rule="evenodd"/>`)
    .join('\n')

  // 辅助线（默认不导出）：导轨灰色实线，轨迹橙色虚线
  const aux = scene.auxiliaries
    .map((a) => {
      const x1 = (a.x1 + shiftX).toFixed(3)
      const y1 = (b.height - (a.y1 + shiftY)).toFixed(3)
      const x2 = (a.x2 + shiftX).toFixed(3)
      const y2 = (b.height - (a.y2 + shiftY)).toFixed(3)
      if (a.kind === 'trace') {
        return `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#F47732" stroke-width="0.15" stroke-dasharray="1.2,0.8"/>`
      }
      return `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8A8478" stroke-width="0.12"/>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" version="1.1">
  <title>白日机械实验室 - 机械图纸</title>
  <desc>单位：毫米（mm）。齿轮齿形为渐开线标准直齿圆柱齿轮，压力角 20°；机构为当前姿态导出。</desc>
  <rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>
${bodies}${aux ? `\n${aux}` : ''}
</svg>
`
}
