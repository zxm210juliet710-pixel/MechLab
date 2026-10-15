import { useMemo, useState } from 'react'
import { useEditor } from '../store/editor'
import { preExportCheck, exportScene, ExportFormat } from '../export'
import { HelpTip } from './HelpTip'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const st = useEditor()
  const [format, setFormat] = useState<ExportFormat>('svg')
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [includeAux, setIncludeAux] = useState(false)
  const [includeTrace, setIncludeTrace] = useState(false)
  const [ackWarn, setAckWarn] = useState(false)

  const allGears = st.doc.gears
  const allMechs = st.doc.mechanisms
  const gears = scope === 'selected'
    ? allGears.filter((g) => st.selection.includes(g.id))
    : allGears
  const mechs = scope === 'selected'
    ? allMechs.filter((m) => st.selection.includes(m.id))
    : allMechs

  const check = useMemo(
    () => preExportCheck(gears, mechs, st.doc.mfg.minWall),
    [scope, st.doc.gears, st.doc.mechanisms, st.selection, st.doc.mfg.minWall],
  )

  const canExport = (gears.length + mechs.length) > 0 && check.errors.length === 0 &&
    (check.warnings.length === 0 || ackWarn)

  return (
    <div className="modal-mask" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h2>导出图纸</h2>
        <p className="desc">导出真实轮廓，所有尺寸均以毫米（mm）为准，不包含网格、选中框等界面元素。机构按当前姿态导出各零件外形与连接孔。</p>

        <h4 className="panel-h" style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--text-2)' }}>文件格式</h4>
        <div className="radio-grid">
          <label className={`radio-card${format === 'svg' ? ' selected' : ''}`}>
            <input type="radio" name="fmt" checked={format === 'svg'} onChange={() => setFormat('svg')} />
            <span>
              <b>SVG 矢量图 <HelpTip helpKey="exportSvg" /></b>
              <span>适合网页展示、进一步编辑和激光切割软件导入。</span>
            </span>
          </label>
          <label className={`radio-card${format === 'dxf' ? ' selected' : ''}`}>
            <input type="radio" name="fmt" checked={format === 'dxf'} onChange={() => setFormat('dxf')} />
            <span>
              <b>DXF 图纸 <HelpTip helpKey="exportDxf" /></b>
              <span>CAD 通用 R12 格式，零件为闭合多段线，连接孔为整圆。</span>
            </span>
          </label>
        </div>

        <h4 style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--text-2)' }}>导出范围</h4>
        <div className="radio-grid">
          <label className={`radio-card${scope === 'all' ? ' selected' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            <span><b>全部对象</b>
              <span>共 {allGears.length} 个齿轮、{allMechs.length} 个机构</span>
            </span>
          </label>
          <label className={`radio-card${scope === 'selected' ? ' selected' : ''}`}>
            <input type="radio" name="scope" checked={scope === 'selected'}
              disabled={st.selection.length === 0} onChange={() => setScope('selected')} />
            <span><b>仅选中对象（含完整机构）</b>
              <span>{st.selection.length > 0 ? `已选中 ${st.selection.length} 个` : '请先在画布中选择'}</span>
            </span>
          </label>
        </div>

        <h4 style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--text-2)' }}>辅助内容（默认不导出，避免混入加工轮廓）</h4>
        <label className="checkbox-line" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input type="checkbox" checked={includeAux} onChange={(e) => setIncludeAux(e.target.checked)}
            style={{ accentColor: 'var(--orange)' }} />
          包含导轨等辅助线<HelpTip helpKey="exportAux" />
        </label>
        <label className="checkbox-line" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={includeTrace} onChange={(e) => setIncludeTrace(e.target.checked)}
            style={{ accentColor: 'var(--orange)' }} />
          包含运动轨迹<HelpTip helpKey="trace" />
        </label>

        {check.errors.length > 0 && (
          <div className="issue error" style={{ display: 'block' }}>
            <b>存在 {check.errors.length} 个错误，已阻止导出：</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {check.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {check.warnings.length > 0 && (
          <div className="issue warn" style={{ display: 'block' }}>
            <b>存在 {check.warnings.length} 个警告：</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {check.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
              {check.warnings.length > 6 && <li>……等 {check.warnings.length} 项</li>}
            </ul>
            <label className="checkbox-line" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={ackWarn} onChange={(e) => setAckWarn(e.target.checked)}
                style={{ accentColor: 'var(--orange)' }} />
              我了解上述问题，仍要继续导出
            </label>
          </div>
        )}
        {gears.length + mechs.length === 0 && (
          <div className="issue error">所选范围内没有可导出的对象。</div>
        )}

        <p className="desc" style={{ marginTop: 12, marginBottom: 0 }}>
          精度说明：齿侧为真实渐开线，按每条齿侧 15 段、圆弧每 2.5° 离散（DXF 线段近似），坐标保留 0.001 mm。
        </p>

        <div className="modal-foot">
          <button className="tbtn ghost" onClick={onClose}>取消</button>
          <button className="tbtn primary" disabled={!canExport}
            onClick={() => {
              try {
                exportScene(gears, mechs, format, {
                  includeAuxiliaries: includeAux,
                  includeTrace,
                })
                onClose()
              } catch (err) {
                alert(`导出失败：${err instanceof Error ? err.message : String(err)}`)
              }
            }}>
            导出 {format.toUpperCase()} 文件
          </button>
        </div>
      </div>
    </div>
  )
}
