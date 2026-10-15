import { editorStore, useEditor } from '../store/editor'
import { HelpTip } from './HelpTip'
import {
  IconAdd, IconCursor, IconHand, IconCopy, IconTrash, IconMagnet, IconArrange, IconFit,
} from './Icons'
import { fitView } from '../view'

export function LeftRail() {
  const st = useEditor()
  const hasSel = st.selection.length > 0
  const btn = (
    key: string,
    node: React.ReactNode,
    onClick: () => void,
    opts: { disabled?: boolean; active?: boolean; title?: string } = {},
  ) => (
    <button
      className={`rail-btn${opts.active ? ' active' : ''}`}
      onClick={onClick}
      disabled={opts.disabled}
      title={opts.title}
    >
      {node}
      <HelpTip helpKey={key} />
    </button>
  )

  return (
    <aside className="rail">
      <button className="rail-btn active" style={{ background: '#fdeee4' }}
        onClick={() => editorStore.addGear()} title="添加齿轮">
        <span className="rail-ico" style={{ color: 'var(--orange)' }}><IconAdd size={19} /></span>
        <span className="rail-name">添加齿轮</span>
        <HelpTip helpKey="addGear" />
      </button>

      <div className="rail-sep" />

      <button className={`rail-btn${st.tool === 'select' ? ' active' : ''}`}
        onClick={() => editorStore.setTool('select')} title="选择工具">
        <span className="rail-ico"><IconCursor size={18} /></span>
        <span className="rail-name">选择</span>
        <HelpTip helpKey="selectTool" />
      </button>
      <button className={`rail-btn${st.tool === 'pan' ? ' active' : ''}`}
        onClick={() => editorStore.setTool('pan')} title="拖动画布">
        <span className="rail-ico"><IconHand size={18} /></span>
        <span className="rail-name">拖动</span>
        <HelpTip helpKey="panTool" />
      </button>

      <div className="rail-sep" />

      {btn('duplicate', (<><span className="rail-ico"><IconCopy size={18} /></span><span className="rail-name">复制</span></>),
        () => editorStore.duplicateSelected(), { disabled: !hasSel })}
      {btn('delete', (<><span className="rail-ico"><IconTrash size={18} /></span><span className="rail-name">删除</span></>),
        () => editorStore.deleteSelected(), { disabled: !hasSel })}

      <div className="rail-sep" />

      <button className={`rail-btn${st.snap ? ' active' : ''}`}
        onClick={() => editorStore.setSnap(!st.snap)}
        title="自动吸附啮合" aria-pressed={st.snap}>
        <span className="rail-ico"><IconMagnet size={18} /></span>
        <span className="rail-name">吸附{st.snap ? '开' : '关'}</span>
        <HelpTip helpKey="snap" />
      </button>
      {btn('arrange', (<><span className="rail-ico"><IconArrange size={18} /></span><span className="rail-name">排列</span></>),
        () => editorStore.arrange(), { disabled: st.doc.gears.length < 2 })}
      {btn('fitView', (<><span className="rail-ico"><IconFit size={18} /></span><span className="rail-name">适应</span></>),
        () => fitView(), { disabled: st.doc.gears.length === 0 && st.doc.mechanisms.length === 0 })}
    </aside>
  )
}
