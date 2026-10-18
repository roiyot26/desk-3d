import { useEffect, useRef, useState } from 'react'
import { audio } from './audio'
import { content } from './content'
import { LIST_URL } from './links'
import { getUI, setUI, useUI } from './store'
import { prefersReducedMotion } from './gsap'
import { CHAT_SHEET_QUERY } from './useMedia'
import { CvLink } from './CvLink'

/**
 * Enter: unlocks audio (it is a user gesture) and opens the duck with the greeting already set,
 * whether or not the room has loaded (Fury #6). Phones open the sheet at half so the chips show.
 */
export function enter() {
  if (getUI().entered) return
  audio.unlock()
  const phone = window.matchMedia?.(CHAT_SHEET_QUERY).matches ?? false
  setUI(phone ? { entered: true, sheet: 'half' } : { entered: true })
}

/**
 * First screen over poster.jpg (Vision recruiter look §1): headline, sub-line, two buttons that
 * work at 0% load, then one small loader line with a hairline. The loader never takes a click.
 * On Enter the block fades (220 ms) and the scrim (500 ms); the loader line stays until the room
 * is ready, reads "room ready" and fades after 1 s.
 * After Enter (Hawkeye WARN-1, Shuri's lingering line): the block's line hides and a quiet note sits top
 * left over the poster while the room loads. While the room code itself is still downloading (this is
 * the Suspense fallback, so no chat or HUD yet) the note carries Quick version as the way out. The note
 * is gone the moment the room is ready.
 */
export function Loader({ fallback = false }: { fallback?: boolean }) {
  const stage = useUI((s) => s.stage)
  const progress = useUI((s) => s.progress)
  const entered = useUI((s) => s.entered)
  const ready = stage === 'ready'
  const p = stage === 'download' ? progress * 0.85 : stage === 'compile' ? 0.93 : 1
  const lines = content.loader.lines
  const line = [...lines].reverse().find((l) => l.at <= p) ?? lines[0]
  const next = lines[lines.indexOf(line) + 1]
  const pct = next && line.live ? Math.round(Math.min(1, (p - line.at) / (next.at - line.at)) * 100) : null
  const enterRef = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // "room ready" holds for 1 s, then the line fades (it only matters while someone waits).
  const [lineGone, setLineGone] = useState(false)
  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setLineGone(true), prefersReducedMotion() ? 0 : 1000)
    return () => window.clearTimeout(id)
  }, [ready])
  useEffect(() => {
    enterRef.current?.focus({ preventScroll: true })
  }, [])
  // After Enter the block is gone for good: inert, so focus can never land in it.
  useEffect(() => {
    const el = root.current as (HTMLDivElement & { inert: boolean }) | null
    if (!el || !entered) return
    el.inert = true
    el.setAttribute('aria-hidden', 'true')
  }, [entered])
  const done = entered && ready && lineGone
  const status = ready ? content.hero.ready : `${line.text}${pct !== null ? ` ${pct}%` : '…'}`
  // Shuri #53: a frozen "0%" reads as stuck, so at 0 or unknown progress the note drops the number and a slow
  // hairline shimmers instead. Screen readers hear the line itself, once per change, never each percent.
  const counting = pct !== null && pct > 0
  const waitText = counting ? `${line.text} ${pct}%` : `${line.text}…`
  return (
    <>
    {entered && !ready && (
      <div className="hero-wait">
        <span className="sr-only" role="status">
          {`${line.text}…`}
        </span>
        <p className={`hero-wait-line${counting ? '' : ' waiting'}`} aria-hidden="true">
          {waitText}
          {!counting && <span className="hero-wait-shimmer" />}
        </p>
        {fallback && (
          <a className="hero-wait-link" href={LIST_URL}>
            {content.site.resume}
          </a>
        )}
      </div>
    )}
    <div
      ref={root}
      className={`loader hero${entered ? ' entered' : ''}${ready ? ' ready' : ''}${done ? ' done' : ''}`}
      aria-busy={!ready}
    >
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-block">
        <h1 className="hero-title">{content.hero.headline}</h1>
        <p className="hero-sub">{content.hero.sub}</p>
        <div className="hero-actions">
          <span className="hero-enter">
            <button ref={enterRef} type="button" className="hero-btn primary" onClick={enter} aria-describedby="hero-enter-hint">
              {content.hero.enter}
            </button>
            {/* Mute is hidden before Enter, so say it here (Shuri #7 fix 4). */}
            <span id="hero-enter-hint" className="hero-hint">
              {content.hero.enterHint}
            </span>
          </span>
          <a className="hero-btn secondary" href={LIST_URL}>
            {content.site.resume}
          </a>
        </div>
        <CvLink className="hero-cv" />
        <div className={`hero-load${ready && lineGone ? ' gone' : ''}`} aria-live="polite">
          <p className="hero-line">{status}</p>
          <div className="hero-bar" role="progressbar" aria-label={content.site.loading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
            <span style={{ width: `${Math.round(p * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
