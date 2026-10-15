// 简洁线性图标（内联 SVG）
interface P {
  size?: number
  color?: string
}

const S = ({ size = 16, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const IconGear = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v2.6M18.7 5.3l-1.8 1.8M21.5 12h-2.6M18.7 18.7l-1.8-1.8M12 21.5v-2.6M5.3 18.7l1.8-1.8M2.5 12h2.6M5.3 5.3l1.8 1.8" />
  </S>
)

export const IconAdd = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </S>
)

export const IconCursor = (p: P) => (
  <S {...p}>
    <path d="M5 3l6.5 16 2-6.8L20 10.5z" />
  </S>
)

export const IconHand = (p: P) => (
  <S {...p}>
    <path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-1.5v-4a1.5 1.5 0 013 0V11m0-1v-3a1.5 1.5 0 013 0v6c0 4-2.5 7-6 7-2.4 0-3.8-1.2-5.2-3.2L4 14.5c-.8-1.2.6-2.6 1.9-1.7L8 14.5" />
  </S>
)

export const IconCopy = (p: P) => (
  <S {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h10" />
  </S>
)

export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </S>
)

export const IconMagnet = (p: P) => (
  <S {...p}>
    <path d="M6 4v7a6 6 0 0012 0V4M6 4h4v5M14 4h4v5" />
  </S>
)

export const IconArrange = (p: P) => (
  <S {...p}>
    <circle cx="6" cy="12" r="3" />
    <circle cx="17" cy="7" r="2.2" />
    <circle cx="17.5" cy="17" r="2" />
    <path d="M8.7 10.8l6.2-2.7M8.7 13.2l6.5 2.9" />
  </S>
)

export const IconFit = (p: P) => (
  <S {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </S>
)

export const IconUndo = (p: P) => (
  <S {...p}>
    <path d="M9 7L4 12l5 5M4 12h11a5 5 0 015 5v1" />
  </S>
)

export const IconRedo = (p: P) => (
  <S {...p}>
    <path d="M15 7l5 5-5 5M20 12H9a5 5 0 00-5 5v1" />
  </S>
)

export const IconReset = (p: P) => (
  <S {...p}>
    <path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M5 3v3.5h3.5" />
  </S>
)

export const IconExport = (p: P) => (
  <S {...p}>
    <path d="M12 3v12m0-12l-4 4m4-4l4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
  </S>
)

export const IconPlay = (p: P) => (
  <S {...p}>
    <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
  </S>
)

export const IconPause = (p: P) => (
  <S {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </S>
)

export const IconStop = (p: P) => (
  <S {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" stroke="none" />
  </S>
)

export const IconBook = (p: P) => (
  <S {...p}>
    <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13" />
  </S>
)

export const IconHelp = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.3a2.5 2.5 0 014.9.7c0 1.8-2.4 2-2.4 3.5M12 17h.01" />
  </S>
)

export const IconPanel = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </S>
)

export const IconSettings = (p: P) => (
  <S {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="8" cy="17" r="2.2" />
  </S>
)
