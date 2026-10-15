// 导出前检查与文件下载
import { Gear, Mechanism, DEFAULT_MANUFACTURING } from '../types'
import { runChecks } from '../geometry/checks'
import { buildSVG } from './svg'
import { buildDXF } from './dxf'
import { ExportOptions } from './entities'

export interface PreCheck {
  errors: string[]
  warnings: string[]
}

export function preExportCheck(
  gears: Gear[],
  mechanisms: Mechanism[] = [],
  minWall: number = DEFAULT_MANUFACTURING.minWall,
): PreCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (gears.length === 0 && mechanisms.length === 0) {
    errors.push('没有可导出的零件。')
    return { errors, warnings }
  }
  const r = runChecks(gears, mechanisms, minWall)
  for (const i of r.gearIssues) {
    if (i.severity === 'error') errors.push(i.message)
    else if (i.severity === 'warn') warnings.push(i.message)
  }
  for (const i of r.pairIssues) {
    if (i.severity === 'error') errors.push(i.message)
    else if (i.severity === 'warn') warnings.push(i.message)
  }
  for (const i of r.mechIssues) {
    if (i.severity === 'error') errors.push(i.message)
    else if (i.severity === 'warn') warnings.push(i.message)
  }
  // 加工硬错误（孔切穿、轮廓不闭合等）同样阻止导出，警告只提示
  for (const i of r.mfgIssues) {
    if (i.severity === 'error') errors.push(i.message)
    else if (i.severity === 'warn') warnings.push(i.message)
  }
  return { errors, warnings }
}

export type ExportFormat = 'svg' | 'dxf'

export function exportScene(
  gears: Gear[],
  mechanisms: Mechanism[],
  format: ExportFormat,
  opts: ExportOptions,
): void {
  const content = format === 'svg' ? buildSVG(gears, mechanisms, opts) : buildDXF(gears, mechanisms, opts)
  const mime = format === 'svg' ? 'image/svg+xml' : 'application/dxf'
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')
  a.download = `机械图纸_${stamp}.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
