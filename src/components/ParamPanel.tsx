import { useMemo, useState } from 'react'
import { editorStore, useEditor } from '../store/editor'
import { Gear, Mechanism, CheckResult, CrankSliderParams, RackPinionParams, FourBarParams, MATERIAL_OPTIONS } from '../types'
import { gearDims, idealDistance } from '../geometry/gear'
import { runChecks, worstSeverity, Z_MIN, Z_MAX, M_MIN, M_MAX, T_MIN, T_MAX, BORE_MAX } from '../geometry/checks'
import { computeMotion } from '../geometry/motion'
import { solveCrankSlider, CS_LIMITS } from '../mechanisms/crankSlider'
import { solveRackPinion, RP_LIMITS } from '../mechanisms/rackPinion'
import { solveFourBar, grashofInfo, rockerSwing, minTransmissionAngle, FB_LIMITS } from '../mechanisms/fourBar'
import { focusOnWorld } from '../view'
import { HelpTip } from './HelpTip'

/** 滑块 + 数字输入组合控件（一次调参手势合并为一条历史） */
function Field(props: {
  label: string
  helpKey: string
  value: number | null
  unit?: string
  min: number
  max: number
  step?: number
  sliderMin?: number
  sliderMax?: number
  integer?: boolean
  onLive: (v: number) => void
}) {
  const { label, helpKey, value, unit, min, max, step = 1, sliderMin, sliderMax, integer } = props
  const [text, setText] = useState<string | null>(null)
  const invalid = text !== null && (text.trim() === '' || Number.isNaN(Number(text)))

  const clamp = (v: number) => Math.min(max, Math.max(min, integer ? Math.round(v) : v))
  const parse = (raw: string) => (raw.trim() === '' ? NaN : Number(raw))

  return (
    <div className="param-row">
      <div className="param-head">
        <span className="param-label">
          {label}
          {unit && <span className="unit">（{unit}）</span>}
          <HelpTip helpKey={helpKey} />
        </span>
        <input
          className={`param-input${invalid ? ' invalid' : ''}`}
          inputMode="decimal"
          value={text ?? (value === null ? '' : value)}
          placeholder={value === null ? '多个值' : ''}
          onFocus={() => {
            setText(value === null ? '' : String(value))
            editorStore.beginGesture()
          }}
          onChange={(e) => {
            setText(e.target.value)
            const v = parse(e.target.value)
            if (!Number.isNaN(v)) props.onLive(clamp(v))
          }}
          onBlur={() => {
            const v = text === null ? NaN : parse(text)
            if (!Number.isNaN(v)) props.onLive(clamp(v))
            setText(null)
            editorStore.commitGesture()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') { setText(null); editorStore.commitGesture() }
          }}
        />
      </div>
      <input
        className="param-slider"
        type="range"
        min={sliderMin ?? min}
        max={sliderMax ?? max}
        step={step}
        value={value ?? (sliderMin ?? min)}
        disabled={value === null}
        onPointerDown={() => editorStore.beginGesture()}
        onPointerUp={() => editorStore.commitGesture()}
        onChange={(e) => props.onLive(clamp(Number(e.target.value)))}
      />
    </div>
  )
}

export function ParamPanel() {
  const st = useEditor()
  const { doc, selection } = st
  const selectedGears = doc.gears.filter((g) => selection.includes(g.id))
  const selectedMechs = doc.mechanisms.filter((m) => selection.includes(m.id))
  const checks = useMemo(
    () => runChecks(doc.gears, doc.mechanisms, doc.mfg.minWall),
    [doc.gears, doc.mechanisms, doc.mfg.minWall])

  // ---------- 混合选中：齿轮与机构不能批量编辑参数 ----------
  if (selectedGears.length > 0 && selectedMechs.length > 0) {
    return (
      <aside className="panel">
        <div className="panel-section">
          <h3>已选中 {selection.length} 个对象</h3>
          <p className="empty-hint">
            同时选中了 {selectedGears.length} 个齿轮和 {selectedMechs.length} 个机构。
            齿轮与机构的参数不同，请分别单击选中后编辑；可以整体拖动、复制或删除。
          </p>
        </div>
      </aside>
    )
  }

  // ---------- 仅选中机构 ----------
  if (selectedMechs.length > 0) {
    return <MechanismPanel mechs={selectedMechs} checks={checks} />
  }

  const selected = selectedGears
  const multi = selected.length > 1
  const common = (pick: (g: Gear) => number): number | null => {
    if (selected.length === 0) return null
    const v = pick(selected[0])
    return selected.every((g) => pick(g) === v) ? v : null
  }
  const patchAll = (patch: Partial<Gear>) => {
    for (const g of selected) editorStore.updateGearLive(g.id, patch)
  }

  // ---------- 无选中：画布信息 + 检查结果 ----------
  if (selected.length === 0) {
    const motion = computeMotion(doc.gears, doc.driverId, st.driverRpm * st.speedFactor, checks.meshGraph)
    const worst = worstSeverity(checks)
    const kinIssues = [...checks.mechIssues]
    const mfgIssues = [...checks.mfgIssues]
    const errorCount = checks.gearIssues.filter((i) => i.severity === 'error').length
      + checks.pairIssues.filter((i) => i.severity === 'error').length
      + kinIssues.filter((i) => i.severity === 'error').length
      + mfgIssues.filter((i) => i.severity === 'error').length
    const warnCount = checks.gearIssues.filter((i) => i.severity === 'warn').length
      + checks.pairIssues.filter((i) => i.severity === 'warn').length
      + kinIssues.filter((i) => i.severity === 'warn').length
      + mfgIssues.filter((i) => i.severity === 'warn').length
    const meshedPairs = checks.pairIssues.filter((p) => p.meshing).length
    const empty = doc.gears.length === 0 && doc.mechanisms.length === 0
    const statusText = empty
      ? '画布为空'
      : errorCount ? `发现 ${errorCount} 个错误`
        : warnCount ? `发现 ${warnCount} 个警告`
          : '检查全部通过'

    return (
      <aside className="panel">
        <div className="panel-section">
          <h3>画布信息</h3>
          <div className="calc-line"><span>齿轮数量</span><b>{doc.gears.length}</b></div>
          <div className="calc-line"><span>机构数量</span><b>{doc.mechanisms.length}</b></div>
          <div className="calc-line"><span>确认啮合的齿轮对</span><b>{meshedPairs}</b></div>
          <div className="calc-line"><span>齿轮主动轮</span>
            <b>{doc.gears.find((g) => g.id === doc.driverId)?.name ?? '未设置'}</b>
          </div>
          <div className="calc-line"><span>单位</span><b>毫米（mm）</b></div>
        </div>

        <div className="panel-section">
          <h3>检查结果
            <span className={`status-dot`} style={{
              marginLeft: 6,
              background: worst === 'error' ? 'var(--red)' : worst === 'warn' ? 'var(--amber)' : !empty ? 'var(--green)' : 'var(--grid)',
            }} />
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }}>{statusText}</span>
          </h3>
          {empty && <p className="empty-hint">点击左侧「添加齿轮」，或从顶部「机械库」中添加机构开始设计。</p>}
          {!empty && errorCount + warnCount === 0 && (
            <div className="issue ok"><span className="issue-icon">✓</span>所有齿轮、机构与啮合关系均正常。</div>
          )}
          {kinIssues.length > 0 && <p className="issue-subhead">运动学检查</p>}
          {kinIssues.map((i, k) => (
            <div
              key={`mi${k}`}
              className={`issue ${i.severity} clickable`}
              onClick={() => {
                const mech = doc.mechanisms.find((x) => x.id === i.mechId)
                if (!mech) return
                editorStore.setSelection([mech.id])
                focusOnWorld(mech.x, mech.y, 160)
              }}
            >
              <span className="issue-icon">{i.severity === 'error' ? '×' : '!'}</span>
              <span>{i.message}　<span style={{ opacity: 0.75 }}>（点击定位）</span></span>
            </div>
          ))}
          {mfgIssues.length > 0 && <p className="issue-subhead">加工检查</p>}
          {mfgIssues.map((i, k) => (
            <div
              key={`fi${k}`}
              className={`issue ${i.severity} clickable`}
              onClick={() => {
                const mech = doc.mechanisms.find((x) => x.id === i.mechId)
                if (!mech) return
                editorStore.setSelection([mech.id])
                focusOnWorld(mech.x, mech.y, 160)
              }}
            >
              <span className="issue-icon">{i.severity === 'error' ? '×' : '!'}</span>
              <span>{i.message}　<span style={{ opacity: 0.75 }}>（点击定位）</span></span>
            </div>
          ))}
          {checks.gearIssues.map((i, k) => (
            <div key={`gi${k}`} className={`issue ${i.severity}`}>
              <span className="issue-icon">{i.severity === 'error' ? '×' : '!'}</span>
              <span>{i.message}</span>
            </div>
          ))}
          {checks.pairIssues.filter((i) => i.severity !== 'ok').map((i, k) => (
            <div
              key={`pi${k}`}
              className={`issue ${i.severity} clickable`}
              onClick={() => {
                const ga = doc.gears.find((g) => g.id === i.a)
                const gb = doc.gears.find((g) => g.id === i.b)
                if (!ga || !gb) return
                editorStore.setSelection([i.a, i.b])
                editorStore.setHighlightPair([i.a, i.b])
                focusOnWorld((ga.x + gb.x) / 2, (ga.y + gb.y) / 2,
                  Math.max(ga.m * (ga.z + 2), gb.m * (gb.z + 2)) / 2)
                setTimeout(() => editorStore.setHighlightPair(null), 2600)
              }}
            >
              <span className="issue-icon">{i.severity === 'error' ? '×' : '!'}</span>
              <span>{i.message}　<span style={{ opacity: 0.75 }}>（点击定位）</span></span>
            </div>
          ))}
        </div>

        {doc.gears.length > 0 && (
          <div className="panel-section">
            <h3>运动模拟</h3>
            <p className="empty-hint" style={{ margin: 0 }}>
              {motion.conflict ?? (motion.disconnected.length > 0
                ? `${motion.disconnected.length} 个齿轮未接入以主动轮为起点的啮合链，模拟时保持静止。`
                : '所有齿轮均在传动链中，点击画布下方播放按钮开始模拟。')}
            </p>
          </div>
        )}
      </aside>
    )
  }

  // ---------- 单选 / 多选：参数编辑 ----------
  const g0 = selected[0]
  const z = common((g) => g.z)
  const m = common((g) => g.m)
  const thickness = common((g) => g.thickness)
  const bore = common((g) => g.bore)
  const x = common((g) => g.x)
  const y = common((g) => g.y)
  const rotation = common((g) => g.rotation)
  const dims = gearDims(g0.z, g0.m, g0.bore)

  // 恰好选中两个：显示啮合计算
  let pairInfo: React.ReactNode = null
  if (selected.length === 2) {
    const [a, b] = selected
    const c = Math.hypot(a.x - b.x, a.y - b.y)
    const sameM = Math.abs(a.m - b.m) < 1e-9
    const ideal = sameM ? idealDistance(a.z, b.z, a.m) : null
    const ratio = b.z / a.z
    const n2 = st.driverRpm * (a.z / b.z)
    pairInfo = (
      <div className="panel-section">
        <h3>两齿轮计算</h3>
        <div className="calc-line"><span>当前中心距</span><b>{c.toFixed(2)} mm</b></div>
        <div className="calc-line"><span>理论中心距</span>
          <b>{ideal === null ? '模数不同' : `${ideal.toFixed(2)} mm`}</b>
        </div>
        <div className="calc-line"><span>传动比 i（从动轮齿数 ÷ 主动轮齿数）<HelpTip helpKey="ratio" /></span>
          <b>{ratio.toFixed(3)}</b>
        </div>
        <div className="calc-line"><span>从动轮转速（主动 {st.driverRpm} r/min 时）<HelpTip helpKey="rotationSpeed" /></span>
          <b>{n2.toFixed(1)} r/min，方向相反</b>
        </div>
      </div>
    )
  }

  return (
    <aside className="panel">
      <div className="panel-section">
        <h3>
          {multi ? `已选中 ${selected.length} 个齿轮` : '齿轮参数'}
        </h3>
        {!multi && (
          <div className="param-row">
            <div className="param-head">
              <span className="param-label">齿轮名称</span>
              <input
                className="param-input"
                style={{ textAlign: 'left' }}
                value={g0.name}
                onFocus={() => editorStore.beginGesture()}
                onChange={(e) => editorStore.updateGearLive(g0.id, { name: e.target.value })}
                onBlur={() => editorStore.commitGesture()}
              />
            </div>
          </div>
        )}

        <Field label="齿数" helpKey="teeth" value={z} unit="齿"
          min={Z_MIN} max={Z_MAX} step={1} sliderMin={8} sliderMax={120} integer
          onLive={(v) => patchAll({ z: v })} />
        <Field label="模数" helpKey="module" value={m} unit="mm"
          min={M_MIN} max={M_MAX} step={0.25} sliderMin={0.5} sliderMax={6}
          onLive={(v) => patchAll({ m: v })} />
        <Field label="厚度" helpKey="thickness" value={thickness} unit="mm"
          min={T_MIN} max={T_MAX} step={0.5} sliderMin={1} sliderMax={12}
          onLive={(v) => patchAll({ thickness: v })} />
        <Field label="中心孔直径" helpKey="bore" value={bore} unit="mm"
          min={0} max={BORE_MAX} step={0.5} sliderMin={0} sliderMax={20}
          onLive={(v) => patchAll({ bore: v })} />
        {!multi && (
          <p className="empty-hint" style={{ margin: '2px 0 0' }}>
            项目加工设置：{doc.mfg.material === 'custom' ? (doc.mfg.customMaterial.trim() || '自定义材料') : (MATERIAL_OPTIONS.find((o) => o.value === doc.mfg.material)?.label ?? '')}
            ，板厚 {doc.mfg.thickness} mm，配合间隙 {doc.mfg.clearance} mm（直径间隙，仅作加工参考，不会加入齿形或分度圆）。
          </p>
        )}

        <div className="calc-line">
          <span>压力角</span>
          <b>20°（标准固定）<HelpTip helpKey="pressureAngle" /></b>
        </div>
      </div>

      <div className="panel-section">
        <h3>位置与相位</h3>
        <Field label="中心坐标 X" helpKey="coords" value={x === null ? null : Math.round(x * 100) / 100}
          unit="mm" min={-2000} max={2000} step={0.5} sliderMin={-300} sliderMax={300}
          onLive={(v) => patchAll({ x: v })} />
        <Field label="中心坐标 Y" helpKey="coords" value={y === null ? null : Math.round(y * 100) / 100}
          unit="mm" min={-2000} max={2000} step={0.5} sliderMin={-300} sliderMax={300}
          onLive={(v) => patchAll({ y: v })} />
        <Field label="旋转角度（齿形相位）" helpKey="phase"
          value={rotation === null ? null : Math.round(((rotation % 360) + 360) % 360 * 10) / 10}
          unit="°" min={0} max={360} step={1}
          onLive={(v) => patchAll({ rotation: v })} />
      </div>

      <div className="panel-section">
        <h3>计算结果</h3>
        {!multi && (
          <>
            <div className="calc-line">
              <span>分度圆直径 d = m × z</span><HelpTip helpKey="pitchDiameter" />
              <b>{(dims.r * 2).toFixed(2)} mm</b>
            </div>
            <div className="calc-line">
              <span>基圆直径 db = d × cos20°</span>
              <b>{(dims.rb * 2).toFixed(2)} mm</b>
            </div>
            <div className="calc-line">
              <span>齿顶圆直径 da = m × (z+2)</span><HelpTip helpKey="addendumDiameter" />
              <b>{(dims.ra * 2).toFixed(2)} mm</b>
            </div>
            <div className="calc-line">
              <span>齿根圆直径 df = m × (z−2.5)</span><HelpTip helpKey="dedendumDiameter" />
              <b>{(dims.rf * 2).toFixed(2)} mm</b>
            </div>
            {dims.undercut && (
              <div className="issue warn" style={{ marginTop: 8 }}>
                <span className="issue-icon">!</span>
                <span>齿数少于 17，可能出现根切，建议仅用于演示。<HelpTip helpKey="undercut" /></span>
              </div>
            )}
          </>
        )}
        {multi && <p className="empty-hint" style={{ margin: 0 }}>多选时显示共同参数；各齿轮的详细尺寸请单选查看。</p>}
      </div>

      {pairInfo}

      {!multi && (
        <div className="panel-section">
          <label className="driver-row">
            <input
              type="checkbox"
              checked={doc.driverId === g0.id}
              onChange={() => editorStore.setDriver(g0.id)}
            />
            <span>设为主动轮（提供输入运动）<HelpTip helpKey="driver" /></span>
          </label>
        </div>
      )}
    </aside>
  )
}

// ------------------------------------------------------------------
// 机构参数面板（第一阶段：曲柄滑块机构）
// ------------------------------------------------------------------

function ToggleRow(props: { label: string; helpKey: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="driver-row">
      <input type="checkbox" checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ accentColor: 'var(--orange)' }} />
      <span>{props.label}<HelpTip helpKey={props.helpKey} /></span>
    </label>
  )
}

function MechanismPanel({ mechs, checks }: { mechs: Mechanism[]; checks: CheckResult }) {
  if (mechs.length > 1) {
    return (
      <aside className="panel">
        <div className="panel-section">
          <h3>已选中 {mechs.length} 个机构</h3>
          <p className="empty-hint">
            多个机构已组成一组，可以一起拖动、复制或删除；参数请单击单个机构后分别编辑。
          </p>
        </div>
      </aside>
    )
  }
  const m = mechs[0]
  if (m.kind === 'rackPinion') return <RackPinionPanel m={m} checks={checks} />
  if (m.kind === 'fourBar') return <FourBarPanel m={m} checks={checks} />
  return <CrankSliderPanel m={m} checks={checks} />
}

/** 机构通用：名称行 + 位置区段 + 检查列表（各机构面板复用） */
function MechNameRow({ name, patch }: { name: string; patch: (p: Partial<Mechanism>) => void }) {
  return (
    <div className="param-row">
      <div className="param-head">
        <span className="param-label">机构名称</span>
        <input
          className="param-input"
          style={{ textAlign: 'left' }}
          value={name}
          onFocus={() => editorStore.beginGesture()}
          onChange={(e) => patch({ name: e.target.value })}
          onBlur={() => editorStore.commitGesture()}
        />
      </div>
    </div>
  )
}

function MechPositionSection({ m, patch, xLabel, yLabel }: {
  m: Mechanism
  patch: (p: Partial<Mechanism>) => void
  xLabel: string
  yLabel: string
}) {
  return (
    <div className="panel-section">
      <h3>机构位置</h3>
      <Field label={xLabel} helpKey="coords" value={Math.round(m.x * 100) / 100}
        unit="mm" min={-2000} max={2000} step={0.5} sliderMin={-300} sliderMax={300}
        onLive={(v) => patch({ x: v })} />
      <Field label={yLabel} helpKey="coords" value={Math.round(m.y * 100) / 100}
        unit="mm" min={-2000} max={2000} step={0.5} sliderMin={-300} sliderMax={300}
        onLive={(v) => patch({ y: v })} />
      <p className="empty-hint" style={{ margin: '4px 0 0' }}>
        机构中的零件由参数和运动约束统一驱动，在画布上拖动会整体移动；不能单独拖动某个零件破坏约束。
      </p>
    </div>
  )
}

// ------------------------------------------------------------------
// 三层参数体系：折叠区 / 加工设置继承区 / 运动学与加工检查分区
// ------------------------------------------------------------------

/** 折叠区域（加工设置、高级参数默认折叠） */
function Collapsible(props: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  return (
    <div className={`panel-section collapsible${open ? ' open' : ''}`}>
      <button type="button" className="collapsible-head" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}>
        <h3>{props.title}<span className="chev" /></h3>
      </button>
      {open && <div className="collapsible-body">{props.children}</div>}
    </div>
  )
}

/** 机构的「加工设置」折叠区：默认继承项目材料/板厚/间隙，可单独覆盖板厚 */
function MechMfgSection({ m }: { m: Mechanism }) {
  const st = useEditor()
  const mfg = st.doc.mfg
  const overriding = m.thicknessOverride !== undefined
  const thickness = m.thicknessOverride ?? mfg.thickness
  const materialLabel = mfg.material === 'custom'
    ? (mfg.customMaterial.trim() || '自定义材料')
    : (MATERIAL_OPTIONS.find((o) => o.value === mfg.material)?.label ?? '')

  return (
    <Collapsible title="加工设置">
      <div className="inherit-line">
        <span>材料</span>
        <b>{materialLabel}</b>
        <em>继承项目</em>
      </div>
      <div className="inherit-line">
        <span>板材厚度</span>
        <b>{Number.isFinite(thickness) ? thickness : '—'} mm</b>
        <em>{overriding ? '单独设置' : '继承项目'}</em>
      </div>
      <div className="inherit-line">
        <span>配合间隙</span>
        <b>{mfg.clearance} mm</b>
        <em>继承项目</em>
      </div>
      <p className="empty-hint" style={{ margin: '4px 0 6px' }}>
        配合间隙为直径间隙，仅在新建零件的孔尺寸中参考计入；修改这里不会改变已有孔和运动规律。
      </p>
      <ToggleRow label="单独设置本机构板材厚度" helpKey="thickness" checked={overriding}
        onChange={(v) => editorStore.setSelectedThicknessOverride(v ? mfg.thickness : undefined)} />
      {overriding && (
        <Field label="本机构板材厚度" helpKey="thickness" value={Math.round(thickness * 100) / 100}
          unit="mm" min={0.5} max={50} step={0.5} sliderMin={1} sliderMax={12}
          onLive={(v) => editorStore.updateMechanismLive(m.id, { thicknessOverride: v })} />
      )}
      <button type="button" className="tbtn ghost" style={{ marginTop: 6 }}
        onClick={() => editorStore.setMfgModalOpen(true)}>
        打开项目加工设置
      </button>
    </Collapsible>
  )
}

/** 运动学检查与加工检查分开显示；加工检查恒显示，绿色表示通过 */
function MechCheckSections({ m, checks }: { m: Mechanism; checks: CheckResult }) {
  const kin = checks.mechIssues.filter((i) => i.mechId === m.id)
  const mfgIssues = checks.mfgIssues.filter((i) => i.mechId === m.id)
  return (
    <>
      <div className="panel-section">
        <h3>运动学检查</h3>
        {kin.length === 0
          ? <div className="issue ok"><span className="issue-icon">✓</span>运动约束正常，杆长与传动关系成立。</div>
          : kin.map((i, k) => (
            <div key={k} className={`issue ${i.severity}`}>
              <span className="issue-icon">{i.severity === 'error' ? '×' : '!'}</span>
              <span>{i.message}</span>
            </div>
          ))}
      </div>
      <div className="panel-section">
        <h3>加工检查</h3>
        {mfgIssues.length === 0
          ? <div className="issue ok"><span className="issue-icon">✓</span>孔径、壁厚与轮廓检查通过，可以导出加工。</div>
          : mfgIssues.map((i, k) => (
            <div key={k} className={`issue ${i.severity}`}>
              <span className="issue-icon">{i.severity === 'error' ? '×' : '!'}</span>
              <span>{i.message}</span>
            </div>
          ))}
      </div>
    </>
  )
}

/** 高级参数：同一根杆件两端使用不同孔径（勾选后出现两个输入；取消勾选恢复与统一孔径相同） */
function IndependentHoleFields(props: {
  valueA: number | undefined
  valueB: number | undefined
  commonD: number
  limits: { min: number; max: number }
  labelA: string
  labelB: string
  onChange: (a: number | undefined, b: number | undefined) => void
}) {
  const enabled = props.valueA !== undefined || props.valueB !== undefined
  return (
    <>
      <ToggleRow label="两端连接孔使用不同直径" helpKey="pinDiameter" checked={enabled}
        onChange={(v) => props.onChange(v ? props.commonD : undefined, v ? props.commonD : undefined)} />
      {enabled && (
        <>
          <Field label={props.labelA} helpKey="pinDiameter" value={props.valueA ?? props.commonD} unit="mm"
            min={props.limits.min} max={props.limits.max} step={0.1} sliderMin={1} sliderMax={12}
            onLive={(v) => props.onChange(v, props.valueB ?? props.commonD)} />
          <Field label={props.labelB} helpKey="pinDiameter" value={props.valueB ?? props.commonD} unit="mm"
            min={props.limits.min} max={props.limits.max} step={0.1} sliderMin={1} sliderMax={12}
            onLive={(v) => props.onChange(props.valueA ?? props.commonD, v)} />
        </>
      )}
    </>
  )
}

// ------------------------------------------------------------------
// 曲柄滑块机构参数面板
// ------------------------------------------------------------------

function CrankSliderPanel({ m, checks }: { m: Mechanism; checks: CheckResult }) {
  const st = useEditor()
  const p = m.params as CrankSliderParams
  const patch = (patch2: Partial<Mechanism>) => editorStore.updateMechanismLive(m.id, patch2)
  const patchParams = (pp: Partial<CrankSliderParams>) => editorStore.updateMechanismLive(m.id, { params: pp })
  const simAngle = st.simAngles[m.id] ?? 0
  const theta = m.initialAngle + simAngle
  const sol = solveCrankSlider(p, theta)
  const L = CS_LIMITS

  return (
    <aside className="panel">
      <div className="panel-section">
        <h3>曲柄滑块机构</h3>
        <MechNameRow name={m.name} patch={patch} />

        <p className="param-group-label">运动尺寸（决定运动规律）</p>
        <Field label="曲柄半径" helpKey="crank" value={p.crankR} unit="mm"
          min={L.crankR.min} max={L.crankR.max} step={1} sliderMin={10} sliderMax={80}
          onLive={(v) => patchParams({ crankR: v })} />
        <Field label="连杆中心距" helpKey="rod" value={p.rodL} unit="mm"
          min={L.rodL.min} max={L.rodL.max} step={1} sliderMin={20} sliderMax={200}
          onLive={(v) => patchParams({ rodL: v })} />

        <p className="param-group-label">实体尺寸（不改变运动规律）</p>
        <Field label="连杆杆身宽度" helpKey="linkBodyW" value={p.rodW ?? 8} unit="mm"
          min={L.rodW.min} max={L.rodW.max} step={0.5} sliderMin={4} sliderMax={20}
          onLive={(v) => patchParams({ rodW: v })} />
        <Field label="连接孔直径" helpKey="pinDiameter" value={p.pinD ?? 3.2} unit="mm"
          min={L.pinD.min} max={L.pinD.max} step={0.1} sliderMin={1} sliderMax={10}
          onLive={(v) => patchParams({ pinD: v })} />
        <Field label="滑块长度（沿导轨）" helpKey="sliderBlock" value={p.blockW} unit="mm"
          min={L.blockW.min} max={L.blockW.max} step={1} sliderMin={10} sliderMax={100}
          onLive={(v) => patchParams({ blockW: v })} />
        <Field label="滑块宽度" helpKey="sliderBlock" value={p.blockH} unit="mm"
          min={L.blockH.min} max={L.blockH.max} step={1} sliderMin={6} sliderMax={60}
          onLive={(v) => patchParams({ blockH: v })} />
      </div>

      <div className="panel-section">
        <h3>运动设置</h3>
        <Field label="曲柄初始角度" helpKey="crankAngle" value={Math.round(m.initialAngle * 10) / 10}
          unit="°" min={0} max={360} step={1}
          onLive={(v) => patch({ initialAngle: v })} />
        <Field label="曲柄转速（负值反向）" helpKey="crankSpeed"
          value={Math.round(m.driverRpm * 10) / 10} unit="r/min"
          min={-120} max={120} step={5} sliderMin={-60} sliderMax={60}
          onLive={(v) => patch({ driverRpm: v })} />
        <div className="param-row">
          <div className="param-head">
            <span className="param-label">滑块运动方向<HelpTip helpKey="blockDir" /></span>
          </div>
          <div className="seg-row">
            <button
              className={`seg-btn${p.axisSign === 1 ? ' active' : ''}`}
              onClick={() => patchParams({ axisSign: 1 })}>沿导轨向右 →</button>
            <button
              className={`seg-btn${p.axisSign === -1 ? ' active' : ''}`}
              onClick={() => patchParams({ axisSign: -1 })}>← 沿导轨向左</button>
          </div>
        </div>
        <ToggleRow label="显示运动轨迹" helpKey="trace" checked={p.showTrace}
          onChange={(v) => patchParams({ showTrace: v })} />
        <ToggleRow label="显示运动方向箭头" helpKey="dirArrow" checked={p.showArrow}
          onChange={(v) => patchParams({ showArrow: v })} />
      </div>

      <MechMfgSection m={m} />

      <Collapsible title="高级参数">
        <p className="empty-hint" style={{ margin: '0 0 6px' }}>
          普通设计无需修改；这些尺寸只影响零件外形与开孔，不影响运动规律。
        </p>
        <Field label="曲柄杆身宽度" helpKey="linkBodyW" value={p.crankW ?? 13} unit="mm"
          min={L.crankW.min} max={L.crankW.max} step={0.5} sliderMin={4} sliderMax={20}
          onLive={(v) => patchParams({ crankW: v })} />
        <Field label="连接头外径" helpKey="linkEndD" value={p.endD ?? 14} unit="mm"
          min={L.endD.min} max={L.endD.max} step={0.5} sliderMin={8} sliderMax={30}
          onLive={(v) => patchParams({ endD: v })} />
        <Field label="固定轴孔直径" helpKey="shaftHole" value={p.shaftD ?? 8.2} unit="mm"
          min={L.shaftD.min} max={L.shaftD.max} step={0.1} sliderMin={2} sliderMax={14}
          onLive={(v) => patchParams({ shaftD: v })} />
        <IndependentHoleFields
          valueA={p.rodHoleA} valueB={p.rodHoleB} commonD={p.pinD ?? 3.2}
          limits={L.pinD} labelA="连杆第一端孔径（曲柄销端）" labelB="连杆第二端孔径（滑块销端）"
          onChange={(a, b) => patchParams({ rodHoleA: a, rodHoleB: b })} />
      </Collapsible>

      <MechPositionSection m={m} patch={patch} xLabel="固定铰位置 X" yLabel="固定铰位置 Y" />

      <div className="panel-section">
        <h3>运动学计算</h3>
        <div className="calc-line"><span>滑块行程（= 2 × 曲柄长度）<HelpTip helpKey="stroke" /></span>
          <b>{sol.stroke.toFixed(2)} mm</b></div>
        <div className="calc-line"><span>当前曲柄角度</span><b>{(((theta % 360) + 360) % 360).toFixed(1)}°</b></div>
        <div className="calc-line"><span>当前滑块位置（相对固定铰）</span><b>{sol.blockX.toFixed(2)} mm</b></div>
        <div className="calc-line"><span>连杆长度校核 |AB| − L</span>
          <b style={{ color: Math.abs(sol.rodError) < 1e-6 ? 'var(--green)' : 'var(--red)' }}>
            {sol.rodError.toFixed(7)} mm
          </b></div>
        {!sol.valid && (
          <div className="issue error" style={{ marginTop: 8 }}>
            <span className="issue-icon">×</span><span>{sol.reason}</span>
          </div>
        )}
      </div>

      <MechCheckSections m={m} checks={checks} />
    </aside>
  )
}

// ------------------------------------------------------------------
// 齿轮齿条机构参数面板
// ------------------------------------------------------------------

function RackPinionPanel({ m, checks }: { m: Mechanism; checks: CheckResult }) {
  const st = useEditor()
  const p = m.params as RackPinionParams
  const patch = (patch2: Partial<Mechanism>) => editorStore.updateMechanismLive(m.id, patch2)
  const patchParams = (pp: Partial<RackPinionParams>) => editorStore.updateMechanismLive(m.id, { params: pp })
  const simAngle = st.simAngles[m.id] ?? 0
  const theta = m.initialAngle + simAngle
  const sol = solveRackPinion(p, theta)
  const L = RP_LIMITS
  const overTravel = Math.abs(sol.s) > p.travel + 1e-9

  return (
    <aside className="panel">
      <div className="panel-section">
        <h3>齿轮齿条机构</h3>
        <MechNameRow name={m.name} patch={patch} />

        <Field label="齿轮齿数" helpKey="teeth" value={p.z} unit="齿"
          min={L.z.min} max={L.z.max} step={1} sliderMin={8} sliderMax={120} integer
          onLive={(v) => patchParams({ z: v })} />
        <Field label="模数" helpKey="module" value={p.m} unit="mm"
          min={L.m.min} max={L.m.max} step={0.25} sliderMin={0.5} sliderMax={6}
          onLive={(v) => patchParams({ m: v })} />
        <Field label="齿轮中心孔直径" helpKey="bore" value={p.bore} unit="mm"
          min={L.bore.min} max={L.bore.max} step={0.5} sliderMin={0} sliderMax={20}
          onLive={(v) => patchParams({ bore: v })} />
        <Field label="齿条总长度" helpKey="rackLength" value={p.rackL} unit="mm"
          min={L.rackL.min} max={L.rackL.max} step={1} sliderMin={40} sliderMax={300}
          onLive={(v) => patchParams({ rackL: v })} />
        <Field label="单侧有效行程" helpKey="rackTravel" value={p.travel} unit="mm"
          min={L.travel.min} max={L.travel.max} step={1} sliderMin={0} sliderMax={200}
          onLive={(v) => patchParams({ travel: v })} />
      </div>

      <div className="panel-section">
        <h3>齿条实体尺寸</h3>
        <Field label="齿条基体宽度" helpKey="rackBodyW" value={p.rackBodyW ?? 8} unit="mm"
          min={L.rackBodyW.min} max={L.rackBodyW.max} step={0.5} sliderMin={4} sliderMax={30}
          onLive={(v) => patchParams({ rackBodyW: v })} />
        <Field label="安装孔直径（0 为不打孔）" helpKey="rackMount" value={p.mountD ?? 3.2} unit="mm"
          min={L.mountD.min} max={L.mountD.max} step={0.1} sliderMin={0} sliderMax={10}
          onLive={(v) => patchParams({ mountD: v })} />
        <p className="empty-hint" style={{ margin: '4px 0 0' }}>
          齿形只由模数决定，修改基体宽度不会改变齿高与啮合；安装孔为真实开孔，默认沿中线对称布置 2 个。
        </p>
      </div>

      <div className="panel-section">
        <h3>运动设置</h3>
        <Field label="齿轮初始角度" helpKey="rackAngle" value={Math.round(m.initialAngle * 10) / 10}
          unit="°" min={0} max={360} step={1}
          onLive={(v) => patch({ initialAngle: v })} />
        <Field label="齿轮转速（负值反向）" helpKey="rackSpeed"
          value={Math.round(m.driverRpm * 10) / 10} unit="r/min"
          min={L.driverRpm.min} max={L.driverRpm.max} step={5} sliderMin={-60} sliderMax={60}
          onLive={(v) => patch({ driverRpm: v })} />
        <div className="param-row">
          <div className="param-head">
            <span className="param-label">齿条装配方向<HelpTip helpKey="rackSide" /></span>
          </div>
          <div className="seg-row">
            <button
              className={`seg-btn${p.rackSide === 1 ? ' active' : ''}`}
              onClick={() => patchParams({ rackSide: 1 })}>齿条在齿轮上方 ↑</button>
            <button
              className={`seg-btn${p.rackSide === -1 ? ' active' : ''}`}
              onClick={() => patchParams({ rackSide: -1 })}>↓ 齿条在齿轮下方</button>
          </div>
        </div>
        <ToggleRow label="显示运动轨迹" helpKey="trace" checked={p.showTrace}
          onChange={(v) => patchParams({ showTrace: v })} />
        <ToggleRow label="显示运动方向箭头" helpKey="dirArrow" checked={p.showArrow}
          onChange={(v) => patchParams({ showArrow: v })} />
      </div>

      <MechMfgSection m={m} />

      <Collapsible title="高级参数">
        <Field label="安装孔数量（0～6）" helpKey="rackMount" value={p.mountCount ?? 2} unit="个"
          min={L.mountCount.min} max={L.mountCount.max} step={1} sliderMin={0} sliderMax={6} integer
          onLive={(v) => patchParams({ mountCount: Math.round(v) })} />
        <Field label="安装孔间距" helpKey="rackMount" value={p.mountSpacing ?? 60} unit="mm"
          min={L.mountSpacing.min} max={L.mountSpacing.max} step={1} sliderMin={20} sliderMax={160}
          onLive={(v) => patchParams({ mountSpacing: v })} />
      </Collapsible>

      <MechPositionSection m={m} patch={patch} xLabel="齿轮中心位置 X" yLabel="齿轮中心位置 Y" />

      <div className="panel-section">
        <h3>运动学计算</h3>
        <div className="calc-line">
          <span>分度圆直径 d = m × z<HelpTip helpKey="pitchDiameter" /></span>
          <b>{(sol.rp * 2).toFixed(2)} mm</b>
        </div>
        <div className="calc-line">
          <span>齿条齿距 p = π × m<HelpTip helpKey="rackPitch" /></span>
          <b>{sol.pitch.toFixed(3)} mm</b>
        </div>
        <div className="calc-line"><span>当前齿轮转角</span><b>{(((theta % 360) + 360) % 360).toFixed(1)}°</b></div>
        <div className="calc-line">
          <span>当前齿条位移 s = r × Δθ<HelpTip helpKey="rackMotion" /></span>
          <b style={{ color: overTravel ? 'var(--red)' : 'var(--text)' }}>{sol.s.toFixed(2)} mm</b>
        </div>
        <p className="empty-hint" style={{ margin: '6px 0 0' }}>
          齿条与齿轮必须模数相同才能啮合；齿轮每转一圈，齿条移动一个分度圆周长 π × d。
        </p>
        {!sol.valid && (
          <div className="issue error" style={{ marginTop: 8 }}>
            <span className="issue-icon">×</span><span>{sol.reason}</span>
          </div>
        )}
        {overTravel && (
          <div className="issue warn" style={{ marginTop: 8 }}>
            <span className="issue-icon">!</span>
            <span>当前位移已超出单侧有效行程（±{p.travel} mm），齿条会滑出导轨。</span>
          </div>
        )}
      </div>

      <MechCheckSections m={m} checks={checks} />
    </aside>
  )
}

// ------------------------------------------------------------------
// 四连杆机构参数面板
// ------------------------------------------------------------------

function FourBarPanel({ m, checks }: { m: Mechanism; checks: CheckResult }) {
  const st = useEditor()
  const p = m.params as FourBarParams
  const patch = (patch2: Partial<Mechanism>) => editorStore.updateMechanismLive(m.id, patch2)
  const patchParams = (pp: Partial<FourBarParams>) => editorStore.updateMechanismLive(m.id, { params: pp })
  const simAngle = st.simAngles[m.id] ?? 0
  const theta = m.initialAngle + simAngle
  const sol = solveFourBar(p, theta)
  const g = grashofInfo(p)
  const swing = rockerSwing(p)
  const mu = minTransmissionAngle(p)
  const L = FB_LIMITS

  const typeCN: Record<string, string> = {
    crankRocker: '曲柄摇杆机构（曲柄可整周转动）',
    doubleCrank: '双曲柄机构',
    doubleRocker: '双摇杆机构',
    none: '不满足格拉霍夫条件',
  }

  return (
    <aside className="panel">
      <div className="panel-section">
        <h3>四连杆机构</h3>
        <MechNameRow name={m.name} patch={patch} />

        <Field label="机架长度 L1" helpKey="fbFrame" value={p.frameL} unit="mm"
          min={L.frameL.min} max={L.frameL.max} step={1} sliderMin={40} sliderMax={200}
          onLive={(v) => patchParams({ frameL: v })} />
        <Field label="曲柄长度 L2" helpKey="fbCrank" value={p.crankL} unit="mm"
          min={L.crankL.min} max={L.crankL.max} step={1} sliderMin={10} sliderMax={80}
          onLive={(v) => patchParams({ crankL: v })} />
        <Field label="连杆长度 L3" helpKey="fbCoupler" value={p.couplerL} unit="mm"
          min={L.couplerL.min} max={L.couplerL.max} step={1} sliderMin={30} sliderMax={200}
          onLive={(v) => patchParams({ couplerL: v })} />
        <Field label="摇杆长度 L4" helpKey="fbRocker" value={p.rockerL} unit="mm"
          min={L.rockerL.min} max={L.rockerL.max} step={1} sliderMin={30} sliderMax={200}
          onLive={(v) => patchParams({ rockerL: v })} />
      </div>

      <div className="panel-section">
        <h3>杆件实体尺寸</h3>
        <p className="empty-hint" style={{ margin: '0 0 4px' }}>
          杆长（中心距）在上一区，决定运动；这里只改外形宽度与开孔，不影响运动规律。
        </p>
        <Field label="连接孔直径（三杆统一）" helpKey="pinDiameter" value={p.pinD ?? 3.2} unit="mm"
          min={L.pinD.min} max={L.pinD.max} step={0.1} sliderMin={1} sliderMax={10}
          onLive={(v) => patchParams({ pinD: v })} />
        <Field label="曲柄杆身宽度" helpKey="linkBodyW" value={p.crankW ?? 13} unit="mm"
          min={L.crankW.min} max={L.crankW.max} step={0.5} sliderMin={4} sliderMax={20}
          onLive={(v) => patchParams({ crankW: v })} />
        <Field label="连杆杆身宽度" helpKey="linkBodyW" value={p.couplerW ?? 8} unit="mm"
          min={L.couplerW.min} max={L.couplerW.max} step={0.5} sliderMin={4} sliderMax={20}
          onLive={(v) => patchParams({ couplerW: v })} />
        <Field label="摇杆杆身宽度" helpKey="linkBodyW" value={p.rockerW ?? 13} unit="mm"
          min={L.rockerW.min} max={L.rockerW.max} step={0.5} sliderMin={4} sliderMax={20}
          onLive={(v) => patchParams({ rockerW: v })} />
      </div>

      <div className="panel-section">
        <h3>运动设置</h3>
        <Field label="曲柄初始角度" helpKey="crankAngle" value={Math.round(m.initialAngle * 10) / 10}
          unit="°" min={0} max={360} step={1}
          onLive={(v) => patch({ initialAngle: v })} />
        <Field label="曲柄转速（负值反向）" helpKey="crankSpeed"
          value={Math.round(m.driverRpm * 10) / 10} unit="r/min"
          min={L.driverRpm.min} max={L.driverRpm.max} step={5} sliderMin={-60} sliderMax={60}
          onLive={(v) => patch({ driverRpm: v })} />
        <div className="param-row">
          <div className="param-head">
            <span className="param-label">交汇装配方式<HelpTip helpKey="fbAssembly" /></span>
          </div>
          <div className="seg-row">
            <button
              className={`seg-btn${p.assembly === 1 ? ' active' : ''}`}
              onClick={() => patchParams({ assembly: 1 })}>摇杆在机架线上方 ↑</button>
            <button
              className={`seg-btn${p.assembly === -1 ? ' active' : ''}`}
              onClick={() => patchParams({ assembly: -1 })}>↓ 摇杆在机架线下方</button>
          </div>
        </div>
        <ToggleRow label="显示连杆中点轨迹" helpKey="trace" checked={p.showTrace}
          onChange={(v) => patchParams({ showTrace: v })} />
        <ToggleRow label="显示运动方向箭头" helpKey="dirArrow" checked={p.showArrow}
          onChange={(v) => patchParams({ showArrow: v })} />
      </div>

      <MechMfgSection m={m} />

      <Collapsible title="高级参数">
        <Field label="连接头外径（三根活动杆）" helpKey="linkEndD" value={p.endD ?? 14} unit="mm"
          min={L.endD.min} max={L.endD.max} step={0.5} sliderMin={8} sliderMax={30}
          onLive={(v) => patchParams({ endD: v })} />
        <Field label="固定轴孔直径（两个固定铰）" helpKey="shaftHole" value={p.shaftD ?? 8.2} unit="mm"
          min={L.shaftD.min} max={L.shaftD.max} step={0.1} sliderMin={2} sliderMax={14}
          onLive={(v) => patchParams({ shaftD: v })} />
        <IndependentHoleFields
          valueA={p.couplerHoleA} valueB={p.couplerHoleB} commonD={p.pinD ?? 3.2}
          limits={L.pinD} labelA="连杆第一端孔径（曲柄销端）" labelB="连杆第二端孔径（摇杆销端）"
          onChange={(a, b) => patchParams({ couplerHoleA: a, couplerHoleB: b })} />
      </Collapsible>

      <MechPositionSection m={m} patch={patch} xLabel="曲柄固定铰位置 X" yLabel="曲柄固定铰位置 Y" />

      <div className="panel-section">
        <h3>运动学计算</h3>
        <div className="calc-line">
          <span>机构类型（格拉霍夫判别）<HelpTip helpKey="grashof" /></span>
          <b style={{ color: g.type === 'crankRocker' ? 'var(--green)' : 'var(--red)' }}>
            {typeCN[g.type]}
          </b>
        </div>
        <div className="calc-line">
          <span>最短杆 + 最长杆 ≤ 其余两杆之和</span>
          <b style={{ color: g.grashof ? 'var(--green)' : 'var(--red)' }}>
            {g.shortest} + {g.longest} = {g.shortest + g.longest} ≤ {g.restSum}
          </b>
        </div>
        <div className="calc-line">
          <span>摇杆摆角 ψ<HelpTip helpKey="swingAngle" /></span>
          <b>{Number.isFinite(swing) ? `${swing.toFixed(1)}°` : '—'}</b>
        </div>
        <div className="calc-line">
          <span>最小传动角 μ<HelpTip helpKey="transmissionAngle" /></span>
          <b style={{ color: mu < 20 ? 'var(--red)' : mu < 40 ? 'var(--amber)' : 'var(--green)' }}>
            {Number.isFinite(mu) ? `${mu.toFixed(1)}°` : '—'}
          </b>
        </div>
        <div className="calc-line"><span>当前曲柄角度</span><b>{(((theta % 360) + 360) % 360).toFixed(1)}°</b></div>
        <div className="calc-line"><span>当前摇杆角度</span><b>{sol.valid ? `${sol.rockerDeg.toFixed(1)}°` : '—'}</b></div>
        <div className="calc-line">
          <span>杆长校核 |AB| − L3</span>
          <b style={{ color: sol.errL3 < 1e-6 ? 'var(--green)' : 'var(--red)' }}>{sol.errL3.toFixed(7)} mm</b>
        </div>
        <div className="calc-line">
          <span>杆长校核 |O2B| − L4</span>
          <b style={{ color: sol.errL4 < 1e-6 ? 'var(--green)' : 'var(--red)' }}>{sol.errL4.toFixed(7)} mm</b>
        </div>
        {!sol.valid && (
          <div className="issue error" style={{ marginTop: 8 }}>
            <span className="issue-icon">×</span><span>{sol.reason}</span>
          </div>
        )}
      </div>

      <MechCheckSections m={m} checks={checks} />
    </aside>
  )
}
