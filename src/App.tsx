import { useEffect, useState } from 'react'
import { editorStore, useEditor } from './store/editor'
import { TopBar } from './components/TopBar'
import { LeftRail } from './components/LeftRail'
import { GearCanvas } from './components/GearCanvas'
import { ParamPanel } from './components/ParamPanel'
import { StatusBar } from './components/StatusBar'
import { LibraryModal, InstructionsModal, ConfirmModal, ManufacturingModal } from './components/Modals'
import { ExportDialog } from './components/ExportDialog'
import { IconPanel } from './components/Icons'

type ModalKind = 'library' | 'help' | 'clear' | 'export' | null

export default function App() {
  const st = useEditor()
  const [modal, setModal] = useState<ModalKind>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (typing) return
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        editorStore.undo()
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        editorStore.redo()
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        editorStore.duplicateSelected()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrl) {
        editorStore.deleteSelected()
      } else if (e.key === 'Escape') {
        if (st.mfgModalOpen) {
          editorStore.setMfgModalOpen(false)
        } else if (modal) {
          setModal(null)
        } else if (panelOpen) {
          setPanelOpen(false)
        } else if (!typing) {
          editorStore.setSelection([])
          editorStore.setHighlightPair(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, panelOpen, st.mfgModalOpen])

  return (
    <div className="app">
      <TopBar
        onOpenLibrary={() => setModal('library')}
        onOpenHelp={() => setModal('help')}
        onClear={() => setModal('clear')}
        onExport={() => setModal('export')}
        onOpenMfg={() => editorStore.setMfgModalOpen(true)}
      />
      <div className="main">
        <LeftRail />
        <GearCanvas />
        <button className="panel-toggle" onClick={() => setPanelOpen((v) => !v)} title="参数面板">
          <IconPanel size={16} />
        </button>
        <div className={`panel-drawer${panelOpen ? ' open' : ''}`}>
          <ParamPanel />
        </div>
      </div>
      <StatusBar />

      {modal === 'library' && <LibraryModal onClose={() => setModal(null)} />}
      {modal === 'help' && <InstructionsModal onClose={() => setModal(null)} />}
      {modal === 'clear' && <ConfirmModal onClose={() => setModal(null)} />}
      {st.mfgModalOpen && <ManufacturingModal onClose={() => editorStore.setMfgModalOpen(false)} />}
      {modal === 'export' && <ExportDialog onClose={() => setModal(null)} />}

      {st.toast && <div className="toast" style={{ left: '50%', top: 64, transform: 'translateX(-50%)' }}>{st.toast}</div>}
    </div>
  )
}

