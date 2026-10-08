import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SHEET_QUERY, useMedia } from '../useMedia'
import { content } from '../content'
import { getUI, setUI, useUI } from '../store'
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

/**
 * The duck's chat, in two parts so the input never scrolls away:
 *  - DuckLog sits in the panel's scrolling body (phones: only the latest answer).
 *  - DuckDock is pinned above the panel's Back/Next footer: 6 preset questions (content.duck.chips)
 *    + the free-text box (fuzzy-matched over every intent, chip or not). 3 show as chips; "More
 *    questions" swaps them for a plain list of all 6 (phones also snap the sheet to full height so
 *    the last answer stays visible above the list).
 */
export function DuckLog({ tail }: { tail?: ReactNode }) {
  const all = useUI((s) => s.duckLog)
  const phone = useMedia(SHEET_QUERY)
  const log = phone ? all.slice(-1) : all
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [all])
  if (!log.length) return null
  return (
    <>
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
      </div>
      {tail}
      <div ref={end} />
    </>
  )
}

export function DuckDock() {
  const thinking = useUI((s) => s.duckThinking)
  const phone = useMedia(SHEET_QUERY)
  const [q, setQ] = useState('')
  const [more, setMoreState] = useState(false)
  const setMore = (v: boolean) => {
    setMoreState(v)
    if (phone) setUI({ sheetFull: v })
  }
  // Leaving the duck (fly to an answer, close) folds the list and the full-height sheet back.
  useEffect(
    () => () => {
      if (getUI().sheetFull) setUI({ sheetFull: false })
    },
    [],
  )
  const ask = (text: string) => {
    if (thinking) return
    void askDuck(text)
    setQ('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(q)
  }
  // The question just answered drops out of the presets; ones asked earlier stay, dimmed.
  const log = useUI((s) => s.duckLog)
  const norm = (t: string) => t.trim().toLowerCase()
  const last = log.length ? norm(log[log.length - 1].question) : ''
  const asked = new Set(log.map((e) => norm(e.question)))
  const all = chipIntents().filter((c) => norm(c.chip) !== last)
  const first = content.duck.visible
  const dim = (chip: string) => (asked.has(norm(chip)) ? ' asked' : '')
  const moreToggle = (
    <button type="button" className="duck-more" aria-expanded={more} onClick={() => setMore(!more)}>
      {more ? content.duck.less : content.duck.more}
    </button>
  )
  return (
    <div className="duck-dock">
      {more ? (
        <div className="duck-list-wrap">
          <ul className="duck-list" aria-label="Suggested questions">
            {all.map((c) => (
              <li key={c.id}>
                <button type="button" className={dim(c.chip).trim() || undefined} disabled={thinking} onClick={() => ask(c.chip)}>
                  <span className="arrow" aria-hidden="true">›</span> {c.chip}
                </button>
              </li>
            ))}
          </ul>
          {moreToggle}
        </div>
      ) : (
        <div className={`duck-chips-bar${phone ? ' phone' : ''}`}>
          <div className={`duck-chips${phone ? ' row' : ''}`} role="list" aria-label="Suggested questions">
            {all.slice(0, first).map((c) => (
              <button key={c.id} type="button" role="listitem" className={`chip${dim(c.chip)}`} disabled={thinking} onClick={() => ask(c.chip)}>
                {c.chip}
              </button>
            ))}
          </div>
          {all.length > first && moreToggle}
        </div>
      )}
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

/** The 6 offered presets, in content.duck.chips order (unknown ids are skipped). */
export function chipIntents() {
  return content.duck.chips
    .map((id) => content.duck.intents.find((i) => i.id === id))
    .filter((i): i is (typeof content.duck.intents)[number] => !!i && !!i.chip)
}
