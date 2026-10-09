import { useEffect, useRef, useState } from 'react'
import { content } from './content'
import { activate } from './nav'
import { SECRET_COUNT, momentHeld, setMuted, setUI, useUI } from './store'
import { audio } from './audio'
import { setLights } from './actions'
import { LIST_URL } from './links'
import { SHEET_QUERY, useMedia } from './useMedia'

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
        setLights('ambient', 'toggle', { secret: false })
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <BulbIcon on={on} />
    </button>
  )
}

/** Top-right corner, always visible: recruiter lane, secrets counter, room lights, mute. */
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
  const found = useUI((s) => s.secrets)
  const flash = useUI((s) => s.secretFlash)
  const muted = useUI((s) => s.muted)
  const [open, setOpen] = useState(false)
  const recent = useRecent(flash?.at, 2600)
  const toggleMute = () => {
    audio.unlock()
    setMuted(!muted)
  }
  return (
    <div className="hud" ref={el}>
      <a className="hud-btn resume" href={LIST_URL}>
        {content.site.resume}
      </a>
      {entered && (
        <div className="hud-secrets">
          <button
            type="button"
            className={`hud-btn${recent ? ' flash' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            title={content.secrets.label}
          >
            {content.secrets.label} {found.length}/{SECRET_COUNT}
          </button>
          {open && (
            <ul className="hud-pop">
              {content.secrets.items.map((it) => (
                <li key={it.id} className={found.includes(it.id) ? 'got' : ''}>
                  {found.includes(it.id) ? `✓ ${it.label}` : `· ${content.secrets.hidden}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {entered && <LightsToggle />}
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

/** Status toast (lights, rain, agentic) + the "secret found" line. Both auto-dismiss after 3s. */
const TOAST_MS = 3000
export function Toast() {
  const toast = useUI((s) => s.toast)
  const flash = useUI((s) => s.secretFlash)
  const count = useUI((s) => s.secrets.length)
  const phone = useMedia(SHEET_QUERY)
  const showToast = useRecent(toast?.at, TOAST_MS)
  const showFlash = useRecent(flash?.at, TOAST_MS)
  if (!showToast && !showFlash) return null
  const item = flash ? content.secrets.items.find((i) => i.id === flash.id) : undefined
  const key = (toast?.at ?? 0) + (flash?.at ?? 0)
  if (phone) {
    // Phones: never two stacked bubbles. One line: "★ Secret 2/6 · agentic mode on".
    const line =
      showFlash && item
        ? `★ ${content.secrets.short} ${count}/${SECRET_COUNT} · ${showToast && toast ? toast.short ?? toast.text : item.label}`
        : toast?.text
    if (!line) return null
    return (
      <div className="toast one" role="status" key={key}>
        <p className={showFlash && item ? 'toast-secret' : undefined}>{line}</p>
      </div>
    )
  }
  return (
    <div className="toast" role="status" key={key}>
      {showToast && toast && <p>{toast.text}</p>}
      {showFlash && item && (
        <p className="toast-secret">
          ★ {content.secrets.found} · {count}/{SECRET_COUNT} · {item.label}
        </p>
      )}
    </div>
  )
}

export function SecretsCard() {
  const show = useUI((s) => s.secretsCard === 'open' && !s.open)
  if (!show) return null
  return (
    <section className="finale secrets-card" role="dialog" aria-labelledby="secrets-title">
      <button type="button" className="panel-close" onClick={() => setUI({ secretsCard: 'dismissed' })} aria-label={content.tour.close}>
        ×
      </button>
      <h2 id="secrets-title">★ {content.secrets.doneTitle}</h2>
      <p>{content.secrets.doneBody}</p>
      <ul className="secrets-list">
        {content.secrets.items.map((i) => (
          <li key={i.id}>✓ {i.label}</li>
        ))}
      </ul>
      <p className="joke">{content.secrets.doneJoke}</p>
    </section>
  )
}

/** After the duck flies you somewhere, its answer stays in a small card with a way back. */
export function DuckToast() {
  const reply = useUI((s) => s.duckReply)
  const onDuck = useUI((s) => s.open?.id === 'stop-7')
  const live = useRecent(reply?.at, 20000)
  if (!reply || !live || onDuck) return null
  return (
    <aside className="duck-toast" aria-live="polite">
      <p className="duck-toast-q">› {reply.question}</p>
      <p>🦆 {reply.reply}</p>
      <div className="duck-toast-actions">
        <button type="button" className="btn small" onClick={() => activate('stop-7')}>
          {content.duck.back}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setUI({ duckReply: null })} aria-label={content.tour.close}>
          ×
        </button>
      </div>
    </aside>
  )
}
