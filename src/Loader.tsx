import { useEffect, useRef } from 'react'
import { audio } from './audio'
import { content } from './content'
import { LIST_URL } from './links'
import { getUI, setUI, useUI } from './store'

/** Enter: unlocks audio (it is a user gesture), reveals the room, then the cold open. */
export function enter() {
  if (getUI().entered) return
  audio.unlock()
  setUI({ entered: true })
}

/**
 * Themed loader: a coding-agent style log over the poster. Lines appear as the real progress
 * passes their threshold (download = first 85%, shader warm-up the rest). When the room is ready
 * it waits for Enter (sound on) or "Just the résumé" (plain page).
 */
export function Loader() {
  const stage = useUI((s) => s.stage)
  const progress = useUI((s) => s.progress)
  const entered = useUI((s) => s.entered)
  const ready = stage === 'ready'
  const p = stage === 'download' ? progress * 0.85 : stage === 'compile' ? 0.93 : 1
  const lines = content.loader.lines
  const shown = lines.filter((l) => l.at <= p)
  const enterRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (ready) enterRef.current?.focus({ preventScroll: true })
  }, [ready])
  return (
    <div className={`loader${entered ? ' done' : ''}${ready ? ' ready' : ''}`} aria-live="polite" aria-busy={!ready}>
      <div className="loader-card">
        <p className="loader-title">
          <span className="loader-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {content.loader.title}
        </p>
        <p className="loader-name">
          {content.site.name} <span>· {content.site.role}</span>
        </p>
        <ol className="loader-log">
          {shown.map((l, i) => {
            const next = lines[lines.indexOf(l) + 1]
            const done = ready || (next ? next.at <= p : false)
            const pct = next && l.live ? Math.round(Math.min(1, (p - l.at) / (next.at - l.at)) * 100) : null
            return (
              <li key={i} className={done ? 'ok' : 'run'}>
                <span className="mark" aria-hidden="true">
                  {done ? '✓' : '▸'}
                </span>{' '}
                {l.text}
                {!done && (pct !== null ? ` ${pct}%` : '…')}
              </li>
            )
          })}
          {ready && <li className="ready">{content.loader.ready}</li>}
        </ol>
        <div className="loader-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
          <span style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
        <div className="loader-actions">
          <button ref={enterRef} type="button" className="btn primary" disabled={!ready} onClick={enter}>
            {content.site.enter} <kbd>⏎</kbd>
          </button>
          <a className="btn ghost" href={LIST_URL}>
            {content.site.resume}
          </a>
        </div>
        <p className="loader-hint">{ready ? content.site.enterHint : content.site.loading + '…'}</p>
      </div>
    </div>
  )
}
