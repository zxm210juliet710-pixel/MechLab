import { editorStore, useEditor } from '../store/editor'
import { HelpTip } from './HelpTip'
import {
  IconBook, IconHelp, IconUndo, IconRedo, IconReset, IconExport, IconTrash, IconSettings,
} from './Icons'

interface Props {
  onOpenLibrary: () => void
  onOpenHelp: () => void
  onExport: () => void
  onClear: () => void
  onOpenMfg: () => void
}

export function TopBar({ onOpenLibrary, onOpenHelp, onExport, onClear, onOpenMfg }: Props) {
  const st = useEditor()
  return (
    <header className="topbar">
      <div className="logo">
        <img className="logo-mark" src="/logo.png" alt="白日机械实验室标志" />
        <div>
          <div className="logo-title">白日机械实验室</div>
          <div className="logo-sub">生成机械 · 理解运动 · 动手制造</div>
        </div>
      </div>

      <nav className="top-nav">
        <button className="tbtn" onClick={onOpenLibrary} title="机械库：浏览并添加标准齿轮">
          <IconBook size={15} /> <span className="label">机械库</span>
        </button>
        <button className="tbtn" onClick={onOpenHelp} title="使用说明：查看操作指引与机械知识">
          <IconHelp size={15} /> <span className="label">使用说明</span>
        </button>
        <button className="tbtn" onClick={onOpenMfg} title="加工设置：材料、板材厚度、加工方式与配合间隙">
          <IconSettings size={15} /> <span className="label">加工设置</span>
        </button>
      </nav>

      <div className="top-actions">
        <button className="tbtn" disabled={!st.canUndo} onClick={() => editorStore.undo()}
          title="撤销（Ctrl+Z）">
          <IconUndo size={15} /> <span className="label">撤销</span>
        </button>
        <button className="tbtn" disabled={!st.canRedo} onClick={() => editorStore.redo()}
          title="重做（Ctrl+Y）">
          <IconRedo size={15} /> <span className="label">重做</span>
        </button>
        <button className="tbtn ghost" disabled={st.selection.length === 0}
          onClick={() => editorStore.resetSelected()} title="将选中齿轮恢复默认参数">
          <IconReset size={15} /> <span className="label">重置</span>
          <HelpTip helpKey="reset" />
        </button>
        <button className="tbtn ghost" disabled={st.doc.gears.length === 0 && st.doc.mechanisms.length === 0} onClick={onClear}
          title="清空画布（需确认）">
          <IconTrash size={15} /> <span className="label">清空画布</span>
        </button>
        <button className="tbtn primary" disabled={st.doc.gears.length === 0 && st.doc.mechanisms.length === 0} onClick={onExport}
          title="导出 SVG 或 DXF 图纸">
          <IconExport size={15} /> <span className="label">导出图纸</span>
          <HelpTip helpKey="exportSvg" />
        </button>
      </div>
    </header>
  )
}
