import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ListView } from './ListView'
import { Loader } from './Loader'
import { detectTier, probeWebGL } from './quality'
import { useUI } from './store'

const Experience = lazy(() => import('./Experience'))

type Fatal = (reason: string) => void

class Boundary extends Component<{ onError: Fatal; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.warn('[desk-3d] 3D view crashed, switching to the plain page.', e)
    this.props.onError('error')
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Phone-sized device (UA or a narrow screen). */
export function isPhone() {
  const ua = navigator.userAgent || ''
  if (/Android.+Mobile|iPhone|iPod|Windows Phone|Mobi/i.test(ua)) return true
  return Math.min(window.innerWidth, window.screen?.width || window.innerWidth) < 600
}

/**
 * Phones with WebGL open the room too (low tier, phone framing, bottom sheets); the plain page is
 * one tap away ("Just the résumé →"). The 2D page is the default only without WebGL, or when the
 * phone asks to save data / has very little memory, and then it carries a sticky
 * "Enter the 3D room →" bar. ?view=list / ?view=room force either.
 */
export function lightweightPhone() {
  const n = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  return isPhone() && (!!n.connection?.saveData || (n.deviceMemory !== undefined && n.deviceMemory < 2))
}

function initialView(probeOk: boolean): 'list' | '3d' {
  const v = new URLSearchParams(window.location.search).get('view')
  if (v === 'list') return 'list'
  if (!probeOk) return 'list'
  if (v === 'room' || v === '3d') return '3d'
  return lightweightPhone() ? 'list' : '3d'
}

export default function App() {
  const probe = useMemo(() => probeWebGL(), [])
  const [view, setView] = useState<'list' | '3d'>(() => initialView(probe.ok))
  const [reason, setReason] = useState(probe.ok ? '' : 'no-webgl')

  const goList = useCallback((why: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'list')
    url.searchParams.set('from', 'webgl')
    url.hash = ''
    history.replaceState(null, '', url)
    setReason(why)
    setView('list')
  }, [])

  // The poster in index.html is the first paint. It fades into the canvas once the room is ready.
  // It stays behind the loader's log until the visitor presses Enter.
  const entered = useUI((s) => s.entered)
  useEffect(() => {
    const poster = document.getElementById('poster')
    if (!poster) return
    poster.classList.toggle('out', view === 'list' || entered)
    document.documentElement.classList.toggle('list-mode', view === 'list')
    document.documentElement.classList.toggle('room-mode', view === '3d')
  }, [entered, view])

  if (view === 'list') {
    const fromWebgl = reason !== '' || new URLSearchParams(window.location.search).get('from') === 'webgl'
    return <ListView webglOk={probe.ok} fallback={fromWebgl} phone={!fromWebgl && isPhone()} />
  }
  return (
    <Boundary onError={goList}>
      <Suspense fallback={<Loader />}>
        <Experience onFatal={goList} initialTier={detectTier(probe)} />
      </Suspense>
    </Boundary>
  )
}
