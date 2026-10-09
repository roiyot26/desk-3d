import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
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

/**
 * The duck's chat, in parts so the input never scrolls away:
 *  - DuckLog sits in the panel's scrolling body (phones: only the latest answer).
 *  - DuckPresets: 6 preset questions (content.duck.chips), see below.
 *  - DuckDock is pinned above the panel's Back/Next footer: the free-text box (fuzzy-matched over
 *    every intent, chip or not).
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
              {e.steps.slice(0, e.shown).map((st, i) => {
                // "tool(args) → 2 sources": the call on one line (ellipsis if long), the result on its own.
                const [call, ...res] = st.split(' → ')
                return (
                  <li key={i} className={i < e.shown - 1 || e.reply ? 'done' : 'run'}>
                    <span className="call" title={call}>
                      {call}
                    </span>
                    {res.length > 0 && <span className="res">→ {res.join(' → ')}</span>}
                  </li>
                )
              })}
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

/** Phone sheet: 3 rows folded, 5 behind "More questions" (the question just answered drops out). */
const PHONE_MORE = 5

/**
 * The preset questions. Desktop: 3 chips + "More questions" → a plain list. Phones: rows in both
 * states (3 → 5), rendered inside the sheet's scrolling body 16px under the "Scripted for now"
 * note, with More/Fewer on its own row; the sheet stays content-sized (≤65% of the viewport).
 */
export function DuckPresets({ phone }: { phone: boolean }) {
  const thinking = useUI((s) => s.duckThinking)
  const log = useUI((s) => s.duckLog)
  const [more, setMore] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (more && phone) wrap.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [more, phone])
  // The question just answered drops out of the presets; ones asked earlier stay, dimmed.
  const norm = (t: string) => t.trim().toLowerCase()
  const last = log.length ? norm(log[log.length - 1].question) : ''
  const asked = new Set(log.map((e) => norm(e.question)))
  const all = chipIntents().filter((c) => norm(c.chip) !== last)
  const first = content.duck.visible
  const dim = (chip: string) => (asked.has(norm(chip)) ? ' asked' : '')
  const ask = (text: string) => {
    if (thinking) return
    void askDuck(text)
  }
  const moreToggle = (
    <button type="button" className="duck-more" aria-expanded={more} onClick={() => setMore(!more)}>
      {more ? content.duck.less : content.duck.more}
    </button>
  )
  const rows = (list: typeof all) => (
    <ul className="duck-list" aria-label="Suggested questions">
      {list.map((c) => (
        <li key={c.id}>
          <button type="button" className={dim(c.chip).trim() || undefined} disabled={thinking} onClick={() => ask(c.chip)}>
            <span className="arrow" aria-hidden="true">›</span> {c.chip}
          </button>
        </li>
      ))}
    </ul>
  )
  if (phone)
    return (
      <div className="duck-presets phone" ref={wrap}>
        {rows(all.slice(0, more ? PHONE_MORE : first))}
        {all.length > first && <div className="duck-more-row">{moreToggle}</div>}
      </div>
    )
  return more ? (
    <div className="duck-list-wrap">
      {rows(all)}
      {moreToggle}
    </div>
  ) : (
    <div className="duck-chips-bar">
      <div className="duck-chips" role="list" aria-label="Suggested questions">
        {all.slice(0, first).map((c) => (
          <button key={c.id} type="button" role="listitem" className={`chip${dim(c.chip)}`} disabled={thinking} onClick={() => ask(c.chip)}>
            {c.chip}
          </button>
        ))}
      </div>
      {all.length > first && moreToggle}
    </div>
  )
}

/** Pinned above Back/Next: the free-text box (desktop: the presets too). */
export function DuckDock() {
  const thinking = useUI((s) => s.duckThinking)
  const phone = useMedia(SHEET_QUERY)
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (thinking) return
    void askDuck(q)
    setQ('')
  }
  return (
    <div className="duck-dock">
      {!phone && <DuckPresets phone={false} />}
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
