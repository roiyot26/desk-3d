import { useEffect, useRef, useState, type FormEvent } from 'react'
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

/** The duck's chat: preset chips, free text (fuzzy-matched to a preset) and a tool-call ticker. */
export function DuckChat() {
  const log = useUI((s) => s.duckLog)
  const thinking = useUI((s) => s.duckThinking)
  const [q, setQ] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [log])
  const ask = (text: string) => {
    if (thinking) return
    void askDuck(text)
    setQ('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(q)
  }
  const chips = content.duck.intents.filter((i) => i.chip)
  return (
    <div className="duck-chat">
      {log.length > 0 && (
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
      )}
      <div className="duck-chips" role="list">
        {chips.map((c) => (
          <button key={c.id} type="button" role="listitem" className="chip" disabled={thinking} onClick={() => ask(c.chip)}>
            {c.chip}
          </button>
        ))}
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
