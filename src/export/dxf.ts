// DXF R12 (AC1009) 导出：真实毫米坐标
// 零件外轮廓为闭合 POLYLINE，孔为 CIRCLE；导轨/轨迹等辅助线为 LINE，放在独立图层
import { Gear, Mechanism } from '../types'
import { collectScene, ExportOptions } from './entities'

/** 写一组 DXF 组码 */
function pairs(codes: Array<[number, string | number]>): string {
  return codes.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n'
}

function closedPolyline(pts: Array<{ x: number; y: number }>): string {
  let s = pairs([
    [0, 'POLYLINE'],
    [8, '0'],
    [66, 1],
    [70, 1], // 闭合多段线
    [10, '0.0'],
    [20, '0.0'],
    [30, '0.0'],
  ])
  for (const p of pts) {
    s += pairs([
      [0, 'VERTEX'],
      [8, '0'],
      [10, (Math.round(p.x * 1000) / 1000).toFixed(3)],
      [20, (Math.round(p.y * 1000) / 1000).toFixed(3)],
      [30, '0.0'],
    ])
  }
  s += pairs([[0, 'SEQEND'], [8, '0']])
  return s
}

function circle(x: number, y: number, r: number): string {
  return pairs([
    [0, 'CIRCLE'],
    [8, '0'],
    [10, x.toFixed(3)],
    [20, y.toFixed(3)],
    [30, '0.0'],
    [40, r.toFixed(3)],
  ])
}

function line(x1: number, y1: number, x2: number, y2: number, layer: string): string {
  return pairs([
    [0, 'LINE'],
    [8, layer],
    [10, x1.toFixed(3)], [20, y1.toFixed(3)], [30, '0.0'],
    [11, x2.toFixed(3)], [21, y2.toFixed(3)], [31, '0.0'],
  ])
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** 生成 DXF R12 文件字符串（INSUNITS = 4 表示毫米） */
export function buildDXF(
  gears: Gear[],
  mechanisms: Mechanism[] = [],
  opts: ExportOptions = { includeAuxiliaries: false, includeTrace: false },
): string {
  const scene = collectScene(gears, mechanisms, opts)
  if (scene.solids.length === 0) throw new Error('没有可导出的零件。')

  let entities = ''
  for (const s of scene.solids) {
    entities += closedPolyline(s.outline.map((p) => ({ x: r3(p.x), y: r3(p.y) })))
    for (const h of s.holes) entities += circle(r3(h.x), r3(h.y), r3(h.r))
  }
  for (const a of scene.auxiliaries) {
    entities += line(r3(a.x1), r3(a.y1), r3(a.x2), r3(a.y2), a.kind === 'trace' ? 'TRACE' : 'AUX')
  }

  return `  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1009
  9
$INSUNITS
 70
     4
  0
ENDSEC
  0
SECTION
  2
TABLES
  0
TABLE
  2
LTYPE
 70
1
  0
LTYPE
  2
CONTINUOUS
 70
0
  3
Solid line
 72
65
 73
0
 40
0.0
  0
ENDTAB
  0
TABLE
  2
LAYER
 70
2
  0
LAYER
  2
0
 70
0
 62
7
  6
CONTINUOUS
  0
LAYER
  2
AUX
 70
0
 62
8
  6
CONTINUOUS
  0
LAYER
  2
TRACE
 70
0
 62
32
  6
CONTINUOUS
  0
ENDTAB
  0
ENDSEC
  0
SECTION
  2
ENTITIES
${entities}  0
ENDSEC
  0
EOF
`
}
