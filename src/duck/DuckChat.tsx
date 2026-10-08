import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SHEET_QUERY, useMedia } from '../useMedia'
import { content } from '../content'
import { useUI } from '../store'
import { askDuck } from './run'

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Reply text that types itself out, time-based so slow frames don't slow it (instant with reduced motion). */
function Typed({ text }: { text: string }) {
  const start = useRef(performance.now())
  const [n, setN] = useState(() => (reduced() ? text.length : 0))
  useEffect(() => {
    if (n >= text.length) return
    const id = window.setTimeout(() => setN(Math.min(text.length, Math.ceil((performance.now() - start.current) / 9))), 30)
    return () => window.clearTimeout(id)
  }, [n, text])
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="caret" aria-hidden="true" />}
    </>
  )
}

/** Chips shown before "More questions" (desktop) and in the single scrolling row (phones). */
const DESKTOP_CHIPS = 5
const PHONE_CHIPS = 3

/**
 * The duck's chat, in two parts so the input never scrolls away:
 *  - DuckLog sits in the panel's scrolling body (phones: only the latest answer).
 *  - DuckDock is pinned above the panel's Back/Next footer: preset chips + the free-text box
 *    (fuzzy-matched to a preset). Desktop: 5 chips + "More questions". Phones: one row of 3.
 */
export function DuckLog() {
  const all = useUI((s) => s.duckLog)
  const phone = useMedia(SHEET_QUERY)
  const log = phone ? all.slice(-1) : all
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [all])
  if (!log.length) return null
  return (
    <div className="duck-log" aria-live="polite">
      {log.map((e) => (
        <div className="duck-turn" key={e.id}>
          <p className="duck-q">
            <span aria-hidden="true">›</span> {e.question}
          </p>
          <ol className="duck-ticker" aria-label="Duck tool calls">
            {e.steps.slice(0, e.shown).map((st, i) => (
              <li key={i} className={i < e.shown - 1 || e.reply ? 'done' : 'run'}>
                {st}
              </li>
            ))}
            {e.shown === 0 && <li className="run">{content.duck.thinking}…</li>}
          </ol>
          {e.reply && (
            <p className={`duck-a${e.matched ? '' : ' miss'}`}>
              <span aria-hidden="true">🦆 </span>
              <Typed text={e.reply} />
            </p>
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

export function DuckDock() {
  const thinking = useUI((s) => s.duckThinking)
  const phone = useMedia(SHEET_QUERY)
  const [q, setQ] = useState('')
  const [more, setMore] = useState(false)
  const ask = (text: string) => {
    if (thinking) return
    void askDuck(text)
    setQ('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(q)
  }
  const all = content.duck.intents.filter((i) => i.chip)
  const chips = phone ? all.slice(0, PHONE_CHIPS) : more ? all : all.slice(0, DESKTOP_CHIPS)
  return (
    <div className="duck-dock">
      <div className={`duck-chips${phone ? ' row' : ''}`} role="list" aria-label="Suggested questions">
        {chips.map((c) => (
          <button key={c.id} type="button" role="listitem" className="chip" disabled={thinking} onClick={() => ask(c.chip)}>
            {c.chip}
          </button>
        ))}
        {!phone && all.length > DESKTOP_CHIPS && (
          <button type="button" className="chip more" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? content.duck.less : content.duck.more}
          </button>
        )}
      </div>
      <form className="duck-form" onSubmit={submit}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={content.duck.placeholder}
          aria-label={content.duck.placeholder}
          maxLength={200}
          disabled={thinking}
        />
        <button type="submit" className="btn primary small" disabled={thinking || !q.trim()}>
          {content.duck.send}
        </button>
      </form>
    </div>
  )
}
