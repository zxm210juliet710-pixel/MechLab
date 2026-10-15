import { useEffect, useRef, useState } from 'react'
import { editorStore, useEditor } from '../store/editor'
import {
  ManufacturingSettings, MATERIAL_OPTIONS, PROCESS_OPTIONS, DEFAULT_MANUFACTURING,
} from '../types'

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-mask" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`}>{children}</div>
    </div>
  )
}

/** 项目级加工设置：材料 / 板厚 / 加工方式 / 配合间隙。
 *  编辑过程实时预览（不入历史），关闭时与打开时快照比对，有变化才提交一次撤销记录。 */
export function ManufacturingModal({ onClose }: { onClose: () => void }) {
  const st = useEditor()
  const mfg = st.doc.mfg
  // 已存在零件数（用于「应用到全部零件」的确认提示）
  const partCount = st.doc.gears.length + st.doc.mechanisms.length
  const snapshot = useRef<ManufacturingSettings>({ ...mfg })
  const [confirmAll, setConfirmAll] = useState(false)

  const live = (patch: Partial<ManufacturingSettings>) => editorStore.updateMfgLive(patch)

  // Escape 走与「完成」相同的提交式关闭（捕获阶段拦截，避免与全局快捷键冲突）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    const before = snapshot.current
    const after = editorStore.getState().doc.mfg
    const diff: Partial<ManufacturingSettings> = {}
    ;(Object.keys(after) as Array<keyof ManufacturingSettings>).forEach((k) => {
      if (after[k] !== before[k]) (diff as Record<string, unknown>)[k] = after[k]
    })
    if (Object.keys(diff).length > 0) editorStore.updateMfg(diff)
    onClose()
  }

  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)

  return (
    <Modal onClose={close}>
      <h2>加工设置</h2>
      <p className="desc">这些是整个项目的默认加工参数，新建零件会自动继承；修改默认值不会改动已经完成的零件。</p>

      <div className="mfg-form">
        <label className="mfg-row">
          <span>材料类型</span>
          <select value={mfg.material} onChange={(e) => live({ material: e.target.value as ManufacturingSettings['material'] })}>
            {MATERIAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {mfg.material === 'custom' && (
          <label className="mfg-row">
            <span>自定义材料名称</span>
            <input type="text" value={mfg.customMaterial} placeholder="如：椴木层板"
              onChange={(e) => live({ customMaterial: e.target.value })} />
          </label>
        )}

        <label className="mfg-row">
          <span>板材厚度（mm）</span>
          <span className="mfg-numline">
            <input type="number" min={0.5} max={50} step={0.1} value={num(mfg.thickness, 3)}
              onChange={(e) => live({ thickness: Number(e.target.value) })} />
            {[3, 4, 5, 6].map((t) => (
              <button key={t} type="button" className={`chip${Math.abs(mfg.thickness - t) < 1e-9 ? ' on' : ''}`}
                onClick={() => live({ thickness: t })}>{t} mm</button>
            ))}
          </span>
        </label>
        <p className="mfg-hint">板材厚度只用于加工和装配记录，不会改变二维零件的轮廓尺寸。</p>

        <label className="mfg-row">
          <span>加工方式</span>
          <select value={mfg.process} onChange={(e) => live({ process: e.target.value as ManufacturingSettings['process'] })}>
            {PROCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="mfg-row">
          <span>配合间隙（mm）</span>
          <span className="mfg-numline">
            <input type="number" min={0} max={2} step={0.05} value={num(mfg.clearance, 0.2)}
              onChange={(e) => live({ clearance: Number(e.target.value) })} />
            {[0.1, 0.2, 0.3, 0.5].map((c) => (
              <button key={c} type="button" className={`chip${Math.abs(mfg.clearance - c) < 1e-9 ? ' on' : ''}`}
                onClick={() => live({ clearance: c })}>{c} mm</button>
            ))}
          </span>
        </label>
        <p className="mfg-hint">
          间隙按<b>直径间隙</b>计算：例如 8 mm 的轴配 {num(mfg.clearance, 0.2)} mm 间隙，孔加工为 {(8 + num(mfg.clearance, 0.2)).toFixed(2)} mm。
          间隙只用于轴与孔等配合部位，不会改变齿轮模数、齿形或理论中心距。
        </p>

        <label className="mfg-row switch-row">
          <span>应用于新建零件</span>
          <input type="checkbox" checked={mfg.applyToNew} onChange={(e) => live({ applyToNew: e.target.checked })} />
        </label>

        <label className="mfg-row">
          <span>孔周最小留料（mm）</span>
          <input type="number" min={0.5} max={10} step={0.5} style={{ maxWidth: 110 }}
            value={num(mfg.minWall, DEFAULT_MANUFACTURING.minWall)}
            onChange={(e) => live({ minWall: Number(e.target.value) })} />
        </label>
        <p className="mfg-hint">孔周围材料少于该值时给出橙色提醒，但不会阻止设计。</p>

        <p className="mfg-warn">加工间隙为设计参考值，实际效果会受材料、设备和加工精度影响，建议先制作小样测试。</p>

        <div className="mfg-apply">
          {confirmAll ? (
            <>
              <span className="mfg-apply-tip">将把当前板厚与配合间隙写入全部 {partCount} 个已有零件（独立孔径不变），确认应用？</span>
              <button type="button" className="tbtn primary" onClick={() => { editorStore.applyMfgToAll(); setConfirmAll(false) }}>确认应用</button>
              <button type="button" className="tbtn ghost" onClick={() => setConfirmAll(false)}>取消</button>
            </>
          ) : (
            <button type="button" className="tbtn ghost" disabled={partCount === 0}
              title="把当前板厚与配合间隙统一更新到已经放在画布上的零件"
              onClick={() => setConfirmAll(true)}>应用到全部零件…</button>
          )}
        </div>
      </div>

      <div className="modal-foot">
        <button className="tbtn primary" onClick={close}>完成</button>
      </div>
    </Modal>
  )
}

/** 机械库：按「齿轮传动 / 连杆机构 / 凸轮机构 / 基础连接件」分类。
 *  零件是可独立编辑的实体；机构是多个零件经运动副组成的系统，一键生成整套。 */
export function LibraryModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} wide>
      <h2>机械库</h2>
      <p className="desc">零件是可独立编辑的实体；机构是多个零件经运动副约束组成的整套系统，点击卡片会一次生成。</p>

      <h4 className="lib-group">齿轮传动</h4>
      <div className="lib-grid">
        <div className="lib-card" role="button" tabIndex={0}
          onClick={() => { editorStore.addGear(); onClose() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editorStore.addGear(); onClose() } }}>
          <svg className="mini-gear" viewBox="-25 -25 50 50">
            <g transform="scale(1 -1)">
              <g stroke="#F47732" strokeWidth="3" fill="#fff" strokeLinejoin="round">
                <path d="M22 0a22 22 0 0 1-2.9 10.9l-2.3-1.3a19 19 0 0 0 0-19.2l2.3-1.3A22 22 0 0 1 22 0Z" />
              </g>
              <circle cx="0" cy="0" r="17" fill="none" stroke="#D95D1E" strokeWidth="2.5"
                strokeDasharray="4 3" />
              <circle cx="0" cy="0" r="5" fill="#F47732" />
            </g>
          </svg>
          <div>
            <b>标准直齿圆柱齿轮 <span className="lib-tag">零件</span></b>
            <span className="lib-desc">渐开线齿形，压力角 20°，模数与齿数可调，支持啮合检查、运动模拟与 SVG / DXF 导出。</span>
          </div>
        </div>

        <div className="lib-card" role="button" tabIndex={0}
          onClick={() => { editorStore.addMechanism('rackPinion'); onClose() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editorStore.addMechanism('rackPinion'); onClose() } }}>
          <span className="mini-symbol">⚙＋▭</span>
          <div>
            <b>齿轮齿条机构 <span className="lib-tag">机构</span></b>
            <span className="lib-desc">含渐开线齿轮、真实齿形齿条、固定轴承座与直线导轨。齿轮转动带动齿条做直线运动，位移 s = r × Δθ。</span>
          </div>
        </div>
      </div>

      <h4 className="lib-group">连杆机构</h4>
      <div className="lib-grid">
        <div className="lib-card" role="button" tabIndex={0}
          onClick={() => { editorStore.addMechanism('crankSlider'); onClose() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editorStore.addMechanism('crankSlider'); onClose() } }}>
          <span className="mini-symbol">○─◉─▭</span>
          <div>
            <b>曲柄滑块机构 <span className="lib-tag">机构</span></b>
            <span className="lib-desc">含固定机架、曲柄、连杆、滑块与三处转动副。曲柄连续转动，滑块沿导轨做往复直线运动。</span>
          </div>
        </div>

        <div className="lib-card" role="button" tabIndex={0}
          onClick={() => { editorStore.addMechanism('fourBar'); onClose() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editorStore.addMechanism('fourBar'); onClose() } }}>
          <span className="mini-symbol">▱</span>
          <div>
            <b>四连杆机构 <span className="lib-tag">机构</span></b>
            <span className="lib-desc">机架、曲柄、连杆、摇杆经四个转动副首尾铰接。曲柄整周转动，摇杆往复摆动，自动按格拉霍夫条件检查杆长。</span>
          </div>
        </div>
      </div>

      <h4 className="lib-group">凸轮机构 · 基础连接件</h4>
      <p className="desc" style={{ margin: '2px 0 0' }}>
        圆盘凸轮、直动从动件、独立转轴孔、固定支点、转动副、移动副、简单连接杆等将在后续版本提供。
      </p>

      <div className="modal-foot">
        <button className="tbtn ghost" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  )
}

export function InstructionsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} wide>
      <h2>使用说明</h2>
      <p className="desc">按照「添加零件或机构 → 调整参数 → 拖动排列 → 自动检查 → 播放运动 → 导出图纸」的流程完成设计。</p>
      <ol className="instruct-list">
        <li><b>添加齿轮：</b>点击左侧「添加齿轮」，在画布中央创建一个默认 20 齿、模数 2 mm 的齿轮。</li>
        <li><b>添加机构：</b>点击顶部「机械库」，选择「曲柄滑块机构」，会一次生成机架、曲柄、连杆、滑块和转动副。</li>
        <li><b>调整参数：</b>选中齿轮或机构后，在右侧面板用滑块或输入框修改齿数、模数、曲柄长度、连杆长度等；尺寸和运动学会实时重算。</li>
        <li><b>拖动排列：</b>直接拖动齿轮改变位置，拖机构会整体移动；开启「吸附」后，齿轮靠近同模数齿轮时自动对齐。</li>
        <li><b>多选：</b>按住 Shift 点击，或在空白处按住拖框；可整体拖动、复制或删除。</li>
        <li><b>自动检查：</b>实时检查模数、中心距、齿形相位、孔尺寸、机构杆长约束和干涉，问题列表点击即可定位。</li>
        <li><b>运动模拟：</b>齿轮勾选「设为主动轮」；机构自带曲柄转速。点击画布下方播放按钮，齿轮按齿数比反向转动，滑块按真实运动学往复移动。</li>
        <li><b>导出图纸：</b>点击右上角「导出图纸」，选择 SVG 或 DXF（均为真实毫米尺寸），可选择是否包含轨迹等辅助线。</li>
        <li><b>快捷键：</b>Delete 删除，Ctrl+Z / Ctrl+Y 撤销重做，Ctrl+D 复制，空格临时平移视图。</li>
      </ol>
      <div className="modal-foot">
        <button className="tbtn primary" onClick={onClose}>开始使用</button>
      </div>
    </Modal>
  )
}

export function ConfirmModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <h2>清空画布？</h2>
      <p className="desc">将删除画布上的全部齿轮和机构，此操作可以通过「撤销」恢复。</p>
      <div className="modal-foot">
        <button className="tbtn ghost" onClick={onClose}>取消</button>
        <button className="tbtn primary" onClick={() => { editorStore.clearCanvas(); onClose() }}>确认清空</button>
      </div>
    </Modal>
  )
}
