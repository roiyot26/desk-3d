import { useEffect, useRef, useState } from 'react'
import { content } from './content'
import { activate } from './nav'
import { SECRET_COUNT, momentHeld, setMuted, setUI, useUI } from './store'
import { audio } from './audio'
import { LIST_URL } from './links'

/**
 * Live viewport rect of the HUD (top bar on phones, top-right cluster on desktop). Tour markers
 * read it every frame and step out of the way, so the résumé link is never covered.
 */
let hudBox: DOMRect | null = null
export const hudRect = () => hudBox

/** Top-right corner, always visible: recruiter lane, secrets counter, mute. */
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
      <button
        type="button"
        className="hud-btn icon"
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? content.audio.unmute : content.audio.mute}
        title={muted ? content.audio.unmute : content.audio.mute}
      >
        {muted ? '🔇' : '🔊'}
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

/** One-line status at the bottom (lights, rain, agentic) + the "secret found" line. */
export function Toast() {
  const toast = useUI((s) => s.toast)
  const flash = useUI((s) => s.secretFlash)
  const count = useUI((s) => s.secrets.length)
  const showToast = useRecent(toast?.at, 3200)
  const showFlash = useRecent(flash?.at, 3200)
  if (!showToast && !showFlash) return null
  const item = flash ? content.secrets.items.find((i) => i.id === flash.id) : undefined
  return (
    <div className="toast" role="status" key={(toast?.at ?? 0) + (flash?.at ?? 0)}>
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
