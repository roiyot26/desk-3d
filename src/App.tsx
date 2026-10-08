import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ListView } from './ListView'
import { Loader } from './Overlay'
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

function initialView(probeOk: boolean): 'list' | '3d' {
  const v = new URLSearchParams(window.location.search).get('view')
  if (v === 'list') return 'list'
  return probeOk ? '3d' : 'list'
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
  const stage = useUI((s) => s.stage)
  useEffect(() => {
    const poster = document.getElementById('poster')
    if (!poster) return
    poster.classList.toggle('out', view === 'list' || stage === 'ready')
    document.documentElement.classList.toggle('list-mode', view === 'list')
    document.documentElement.classList.toggle('room-mode', view === '3d')
  }, [stage, view])

  if (view === 'list') {
    const fromWebgl = reason !== '' || new URLSearchParams(window.location.search).get('from') === 'webgl'
    return <ListView webglOk={probe.ok} fallback={fromWebgl} />
  }
  return (
    <Boundary onError={goList}>
      <Suspense fallback={<Loader />}>
        <Experience onFatal={goList} initialTier={detectTier(probe)} />
      </Suspense>
    </Boundary>
  )
}
