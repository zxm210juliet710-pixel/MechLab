import { useEffect, useRef } from 'react'
import { editorStore, useEditor } from '../store/editor'
import { runChecks } from '../geometry/checks'
import { computeMotion } from '../geometry/motion'
import { IconPlay, IconPause, IconStop } from './Icons'
import { HelpTip } from './HelpTip'

/** 运动模拟引擎：rAF 按真实齿数比传播角速度 */
function useSimulation() {
  const raf = useRef<number>(0)
  const last = useRef<number>(0)
  const angles = useRef<Record<string, number>>({})

  useEffect(() => {
    const tick = (now: number) => {
      const st = editorStore.getState()
      const dt = Math.min(0.05, (now - last.current) / 1000)
      last.current = now

      if (st.playing) {
        const checks = runChecks(st.doc.gears, st.doc.mechanisms, st.doc.mfg.minWall)
        const motion = computeMotion(st.doc.gears, st.doc.driverId, st.driverRpm, checks.meshGraph)
        if (motion.conflict) {
          editorStore.setPlaying(false)
          editorStore.toastMsg(motion.conflict)
        } else {
          for (const g of st.doc.gears) {
            const w = motion.omega[g.id]
            if (w !== undefined) {
              angles.current[g.id] = (angles.current[g.id] ?? 0) + w * dt
              // 归一化到 [0,360)，避免长时间运行后角度无界增长损失精度
              angles.current[g.id] = ((angles.current[g.id] % 360) + 360) % 360
            }
          }
          // 机构：按各自曲柄转速独立推进（r/min → °/s），无效机构保持静止
          const badMechs = new Set(checks.mechIssues.filter((i) => i.severity === 'error').map((i) => i.mechId))
          for (const m of st.doc.mechanisms) {
            if (badMechs.has(m.id)) continue
            const w = (m.driverRpm * 360) / 60
            angles.current[m.id] = (angles.current[m.id] ?? 0) + w * dt * st.speedFactor
            // 曲柄滑块、四连杆为周期运动，角度归一化避免精度无界增长；
            // 齿轮齿条的位移 s=r·θ 无界，归一化会导致齿条每转一圈瞬间跳回
            // 一个周长，因此保持角度连续累积
            if (m.kind !== 'rackPinion') {
              angles.current[m.id] = ((angles.current[m.id] % 360) + 360) % 360
            }
          }
          editorStore.setSimAngles({ ...angles.current })
        }
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  const reset = () => {
    angles.current = {}
    editorStore.setSimAngles({})
  }
  return { reset }
}

export function SimBar() {
  const st = useEditor()
  const { reset } = useSimulation()

  const play = () => {
    const hasMech = st.doc.mechanisms.length > 0
    if (hasMech) {
      editorStore.setPlaying(!st.playing)
      return
    }
    if (!st.doc.driverId) {
      editorStore.toastMsg('请先在右侧参数面板中指定一个主动轮，或从机械库添加机构。')
      return
    }
    if (st.doc.gears.length < 2) {
      editorStore.toastMsg('至少需要两个齿轮才能演示传动。')
      return
    }
    editorStore.setPlaying(!st.playing)
  }

  const stop = () => {
    editorStore.setPlaying(false)
    reset()
  }

  return (
    <div className="sim-bar">
      <button className={`sim-btn${st.playing ? '' : ' play'}`} onClick={play}
        title={st.playing ? '暂停（保持当前角度）' : '播放 / 继续'}>
        {st.playing ? <IconPause size={15} /> : <IconPlay size={15} />}
      </button>
      <button className="sim-btn" onClick={stop} title="复位到初始角度">
        <IconStop size={14} />
      </button>
      <div className="sim-speed">
        <span>主动轮转速 <HelpTip helpKey="rotationSpeed" /></span>
        <input type="range" min={5} max={120} step={5} value={st.driverRpm}
          onChange={(e) => editorStore.setDriverRpm(Number(e.target.value))}
          style={{ accentColor: 'var(--orange)' }} />
        <b style={{ color: 'var(--text)', minWidth: 64 }}>{st.driverRpm} r/min</b>
      </div>
    </div>
  )
}
