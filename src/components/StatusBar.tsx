import { useMemo } from 'react'
import { useEditor } from '../store/editor'
import { runChecks } from '../geometry/checks'

export function StatusBar() {
  const st = useEditor()
  const checks = useMemo(
    () => runChecks(st.doc.gears, st.doc.mechanisms, st.doc.mfg.minWall),
    [st.doc.gears, st.doc.mechanisms, st.doc.mfg.minWall],
  )

  const errors = checks.gearIssues.filter((i) => i.severity === 'error').length
    + checks.pairIssues.filter((i) => i.severity === 'error').length
    + checks.mechIssues.filter((i) => i.severity === 'error').length
    + checks.mfgIssues.filter((i) => i.severity === 'error').length
  const warns = checks.gearIssues.filter((i) => i.severity === 'warn').length
    + checks.pairIssues.filter((i) => i.severity === 'warn').length
    + checks.mechIssues.filter((i) => i.severity === 'warn').length
    + checks.mfgIssues.filter((i) => i.severity === 'warn').length

  const empty = st.doc.gears.length === 0 && st.doc.mechanisms.length === 0
  const status = empty
    ? { color: 'var(--grid)', text: '画布为空' }
    : errors
      ? { color: 'var(--red)', text: `检查发现 ${errors} 个错误` }
      : warns
        ? { color: 'var(--amber)', text: `检查发现 ${warns} 个警告` }
        : { color: 'var(--green)', text: '检查通过' }

  const hint = st.playing
    ? '运动模拟中：齿轮按传动比转动，机构按运动学规律运动'
    : st.tool === 'pan'
      ? '拖动画布可平移视图，滚轮缩放'
      : '拖动齿轮或机构改变位置；Shift 或拖框多选；滚轮缩放；空格临时平移'

  return (
    <footer className="statusbar">
      <span className="status-item">齿轮：<b style={{ color: 'var(--text)' }}>{st.doc.gears.length}</b></span>
      <span className="status-item">机构：<b style={{ color: 'var(--text)' }}>{st.doc.mechanisms.length}</b></span>
      <span className="status-item">已选中：<b style={{ color: 'var(--text)' }}>{st.selection.length}</b></span>
      <span className="status-item">缩放：<b style={{ color: 'var(--text)' }}>{st.view.scale.toFixed(1)}×</b></span>
      <span className="status-item">单位：<b style={{ color: 'var(--text)' }}>mm</b></span>
      <span className="status-item">
        <i className="status-dot" style={{ background: status.color }} />
        {status.text}
      </span>
      <span className="status-hint">{hint}</span>
    </footer>
  )
}
