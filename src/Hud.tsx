import { useEffect, useRef, useState } from 'react'
import { content } from './content'
import { getUI, momentHeld, setMuted, subscribe, useUI } from './store'
import { audio } from './audio'
import { setLights } from './actions'
import { LIST_URL } from './links'
import { SHEET_QUERY, useMedia } from './useMedia'
import { Guide, openGuide } from './Guide'

/**
 * Live viewport rect of the HUD (top bar on phones, top-right cluster on desktop). Tour markers
 * read it every frame and step out of the way, so the résumé link is never covered.
 */
let hudBox: DOMRect | null = null
export const hudRect = () => hudBox

/** Bulb icon (filled = lights on). Inline SVG: crisp at any DPR, inherits the HUD colour. */
function BulbIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5v-.5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"
        fill={on ? 'currentColor' : 'none'}
        fillOpacity={on ? 0.9 : 0}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!on && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  )
}

/** Speaker icon (slash = muted). Inline SVG instead of the 🔊 emoji: no blue emoji in the chrome. */
function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={0.9} />
      {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.7 7.7 0 0 1 0 11" />}
    </svg>
  )
}

/**
 * Room lights: the same circuit as the wall switch (CLICK_Switch_Lights, off-screen from the
 * default view). Baked: lightmap groups Fill + Pictures and ShelfLEDCyan; live path: the fill
 * lights. Lamps and neon stay as they are.
 */
function LightsToggle() {
  const on = useUI((s) => s.lights.ambient)
  const label = on ? content.lightsToggle.off : content.lightsToggle.on
  return (
    <button
      type="button"
      className={`hud-btn icon lights${on ? ' on' : ''}`}
      onClick={() => {
        audio.unlock()
        setLights('ambient', 'toggle')
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <BulbIcon on={on} />
    </button>
  )
}

/**
 * Top-right corner (Vision recruiter look §1/§4). Before Enter: only Quick version. After: What's
 * here, Quick version, room lights, mute. Phones under 430px fold them into a ⋯ menu (What's here first).
 */
export function Hud() {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = el.current
    if (!node) return
    const measure = () => {
      hudBox = node.getBoundingClientRect()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      hudBox = null
    }
  }, [])
  const entered = useUI((s) => s.entered)
  const ready = useUI((s) => s.entered && s.stage === 'ready')
  const guide = useUI((s) => s.guide)
  const muted = useUI((s) => s.muted)
  const [menu, setMenu] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  // The ⋯ menu closes on Esc (focus back to ⋯), an outside tap, or any chat / station action.
  useEffect(() => {
    if (!menu) return
    const s0 = getUI()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setMenu(false)
      more.current?.focus({ preventScroll: true })
    }
    const down = (e: PointerEvent) => {
      if (!el.current?.contains(e.target as Node)) setMenu(false)
    }
    const off = subscribe(() => {
      const s = getUI()
      if (
        s.duckLog !== s0.duckLog ||
        s.open !== s0.open ||
        s.sheet !== s0.sheet ||
        s.chatOpen !== s0.chatOpen ||
        s.visited !== s0.visited ||
        s.duckThinking
      )
        setMenu(false)
    })
    window.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', down, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('pointerdown', down, true)
      off()
    }
  }, [menu])
  const toggleMute = () => {
    audio.unlock()
    setMuted(!muted)
  }
  const resume = (
    <a className="hud-btn text resume" href={LIST_URL}>
      {content.site.resume}
    </a>
  )
  return (
    <div className={`hud${menu ? ' menu-open' : ''}${entered ? ' in' : ''}`} ref={el}>
      {!entered ? (
        resume
      ) : (
        <>
          <button ref={more} type="button" className="hud-btn icon hud-more" aria-expanded={menu} aria-controls="hud-group" aria-label={content.site.more} onClick={() => setMenu(!menu)}>
            <span aria-hidden="true">⋯</span>
          </button>
          <div className="hud-group" id="hud-group">
            {ready && (
              <button
                type="button"
                className="hud-btn text hud-whats"
                aria-expanded={guide}
                onClick={() => {
                  setMenu(false)
                  openGuide()
                }}
              >
                {content.guide.button}
              </button>
            )}
            {resume}
            {ready && <LightsToggle />}
            <button
              type="button"
              className="hud-btn icon"
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? content.audio.unmute : content.audio.mute}
              title={muted ? content.audio.unmute : content.audio.mute}
            >
              <SoundIcon muted={muted} />
            </button>
          </div>
          <Guide />
        </>
      )}
    </div>
  )
}

/** True for `ms` after `at` changes (re-renders itself when the window ends). */
function useRecent(at: number | undefined, ms: number) {
  const [, force] = useState(0)
  const live = at !== undefined && (performance.now() - at < ms || momentHeld())
  useEffect(() => {
    if (at === undefined) return
    const left = ms - (performance.now() - at)
    if (left <= 0) return
    const id = window.setTimeout(() => force((x) => x + 1), left + 20)
    return () => window.clearTimeout(id)
  }, [at, ms])
  return live
}

/** Status toast (lights, rain, agentic). Auto-dismisses after 3s. No counters. */
const TOAST_MS = 3000
export function Toast() {
  const toast = useUI((s) => s.toast)
  const phone = useMedia(SHEET_QUERY)
  const show = useRecent(toast?.at, TOAST_MS)
  if (!show || !toast) return null
  return (
    <div className={phone ? 'toast one' : 'toast'} role="status" key={toast.at}>
      <p>{toast.text}</p>
    </div>
  )
}
