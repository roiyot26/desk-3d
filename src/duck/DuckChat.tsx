import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { STOPS, content } from '../content'
import { openChat, openPanel } from '../nav'
import { setUI, useUI, type DuckEntry, type SheetState } from '../store'
import { askDuck } from './run'

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Same breakpoint as the chat sheet in index.css: phones are <900px wide or portrait. */
export const CHAT_SHEET_QUERY = '(max-width: 899px), (orientation: portrait)'
/** Docked column width on desktop: clamp(380px, 32vw, 520px). Also used by the camera offset. */
export const chatWidth = (w: number) => Math.min(520, Math.max(380, 0.32 * w))
export const CHAT_INSET = 24
export const PEEK_PX = 96

function useSheetLayout() {
  const [m, setM] = useState(() => window.matchMedia?.(CHAT_SHEET_QUERY).matches ?? false)
  useEffect(() => {
    const q = window.matchMedia?.(CHAT_SHEET_QUERY)
    const on = () => setM(q.matches)
    q?.addEventListener('change', on)
    return () => q?.removeEventListener('change', on)
  }, [])
  return m
}

/** Text that types itself out at `cps` characters/s (instant with reduced motion). */
function Typed({ text, cps = 110 }: { text: string; cps?: number }) {
  const start = useRef(performance.now())
  const [n, setN] = useState(() => (reduced() ? text.length : 0))
  useEffect(() => {
    if (n >= text.length) return
    const id = window.setInterval(() => {
      const k = Math.min(text.length, Math.floor(((performance.now() - start.current) / 1000) * cps))
      setN((p) => Math.max(p, k))
      if (k >= text.length) window.clearInterval(id)
    }, 30)
    return () => window.clearInterval(id)
  }, [text, cps]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="caret" aria-hidden="true" />}
    </>
  )
}

/** The duck's face: a still render of the scene's own duck (no emoji, no AI art). Live render target in a later PR. */
function Avatar({ size }: { size: number }) {
  const thinking = useUI((s) => s.duckThinking)
  return (
    <span className={`duck-avatar${thinking ? ' thinking' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}duck-avatar.webp`} alt="" width={size} height={size} draggable={false} />
    </span>
  )
}

/** "looking at the bookshelf": always the station the camera is framing, else the room. */
function useStatus() {
  const open = useUI((s) => s.open)
  const thinking = useUI((s) => s.duckThinking)
  if (thinking) return content.duck.status.thinking
  if (!open) return content.duck.status.around
  const stop = STOPS.find((s) => s.id === open.id)
  const note = stop ? undefined : content.bonus.find((b) => b.id === open.id) ?? content.asides.find((a) => a.id === open.id)
  const name = (stop?.label ?? note?.title ?? '').split(' · ')[0].toLowerCase()
  return name ? content.duck.status.at.replace('{x}', name) : content.duck.status.around
}

function StationCard({ e }: { e: DuckEntry }) {
  const c = e.card!
  const stop = STOPS.find((s) => s.id === c.open.id)
  return (
    <div className="duck-card">
      <span className={`duck-card-thumb k-${stop?.kind ?? 'note'}`} aria-hidden="true">
        {c.label.slice(0, 1)}
      </span>
      <span className="duck-card-title">{c.title}</span>
      <button type="button" className="duck-go" onClick={() => openPanel(c.open)}>
        {content.duck.go} <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}

function Log() {
  const log = useUI((s) => s.duckLog)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }, [log])
  return (
    <div className="duck-log" aria-live="polite">
      {log.map((e) => (
        <div className="duck-turn" key={e.id}>
          {!e.greet && <p className="bubble user">{e.question}</p>}
          {e.steps.length > 0 && (
            <ol className="duck-ticker" aria-label="Duck tool calls">
              {e.steps.slice(0, e.shown).map((st, i) => {
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
          )}
          {e.reply && (
            <p className={`bubble duck${e.matched ? '' : ' miss'}`}>
              <Typed text={e.reply} cps={e.greet ? 28 : 110} />
            </p>
          )}
          {e.card && e.reply && <StationCard e={e} />}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

/** Suggestion chips: the greeting's three, then the preset questions not yet asked. One scrolling row. */
function Chips() {
  const thinking = useUI((s) => s.duckThinking)
  const log = useUI((s) => s.duckLog)
  const norm = (t: string) => t.trim().toLowerCase()
  const asked = new Set(log.map((e) => norm(e.question)))
  const greet = content.duck.greet.chips.map((c) => ({ key: c.label, label: c.label, ask: c.ask }))
  const presets = chipIntents().map((c) => ({ key: c.id, label: c.chip, ask: c.chip as string | string[] }))
  const list = [...greet, ...presets].filter((c) => !asked.has(norm(c.label)) && !asked.has(norm(Array.isArray(c.ask) ? '' : c.ask)))
  return (
    <div className="chat-chips" role="list" aria-label="Suggested questions">
      {list.map((c) => (
        <button
          key={c.key}
          type="button"
          role="listitem"
          className="chip"
          disabled={thinking}
          onClick={() => void askDuck(Array.isArray(c.ask) ? c.ask[Math.floor(Math.random() * c.ask.length)] : c.ask)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

function Input({ onFocus }: { onFocus?: () => void }) {
  const thinking = useUI((s) => s.duckThinking)
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (thinking || !q.trim()) return
    void askDuck(q)
    setQ('')
  }
  return (
    <form className="chat-form" onSubmit={submit}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={onFocus}
        placeholder={content.duck.placeholder}
        aria-label={content.duck.placeholder}
        maxLength={200}
        disabled={thinking}
      />
      <button type="submit" className="chat-send" disabled={thinking || !q.trim()} aria-label={content.duck.send}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  )
}

/** The duck's first line (typed at 28 chars/s), posted once the visitor has entered the room. */
function useGreeting() {
  const entered = useUI((s) => s.entered && s.stage === 'ready')
  useEffect(() => {
    if (!entered) return
    const id = window.setTimeout(() => {
      setUI((s) =>
        s.duckLog.some((e) => e.greet)
          ? {}
          : { duckLog: [{ id: 0, question: '', steps: [], shown: 0, reply: content.duck.greet.line, matched: true, greet: true }, ...s.duckLog] },
      )
    }, reduced() ? 0 : 900)
    return () => window.clearTimeout(id)
  }, [entered])
}

const NEXT_UP: Record<SheetState, SheetState> = { peek: 'half', half: 'full', full: 'full' }
const NEXT_DOWN: Record<SheetState, SheetState> = { peek: 'peek', half: 'peek', full: 'half' }

function Handle({ sheet }: { sheet: SheetState }) {
  const y0 = useRef<number | null>(null)
  const moved = useRef(false)
  return (
    <button
      type="button"
      className="chat-handle"
      aria-label={sheet === 'full' ? content.duck.sheetDown : content.duck.sheetUp}
      aria-expanded={sheet !== 'peek'}
      onPointerDown={(e) => {
        y0.current = e.clientY
        moved.current = false
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (y0.current !== null && Math.abs(e.clientY - y0.current) > 8) moved.current = true
      }}
      onPointerUp={(e) => {
        if (y0.current === null) return
        const dy = e.clientY - y0.current
        y0.current = null
        if (!moved.current) return
        if (dy < -30) setUI({ sheet: dy < -220 ? 'full' : NEXT_UP[sheet] })
        else if (dy > 30) setUI({ sheet: dy > 220 ? 'peek' : NEXT_DOWN[sheet] })
      }}
      onClick={() => {
        if (moved.current) return
        setUI({ sheet: sheet === 'full' ? 'peek' : NEXT_UP[sheet] })
      }}
    >
      <span aria-hidden="true" />
    </button>
  )
}

/**
 * The duck chat, the main surface (Vision's duck-hint spec §2). Desktop: a docked right column,
 * clamp(380px, 32vw, 520px), collapsible to a 64px duck bubble. Phones: a bottom sheet with
 * peek (96px) / half (55vh) / full (92vh); it opens at peek and drops back to peek on a fly-to.
 */
export function DuckChat() {
  useGreeting()
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const chatOpen = useUI((s) => s.chatOpen)
  const unread = useUI((s) => s.chatUnread)
  const sheet = useUI((s) => s.sheet)
  const phone = useSheetLayout()
  const status = useStatus()
  const box = useRef<HTMLElement>(null)
  // Publish the space the chat takes so panels, the caption and the camera keep clear of it.
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = box.current
    const set = () => {
      const r = el?.getBoundingClientRect()
      const docked = ready && !phone && chatOpen && r
      root.style.setProperty('--chat-w', docked ? `${Math.round(r.width + CHAT_INSET)}px` : '0px')
      root.style.setProperty('--chat-h', ready && phone ? `${PEEK_PX}px` : '0px')
      root.classList.toggle('chat-docked', !!docked)
    }
    set()
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    window.addEventListener('resize', set)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', set)
    }
  }, [ready, phone, chatOpen])
  if (!ready) return null
  if (!phone && !chatOpen)
    return (
      <button type="button" className="chat-bubble" onClick={openChat} aria-label={content.duck.expandChat}>
        <Avatar size={52} />
        {unread && <span className="unread" aria-hidden="true" />}
      </button>
    )
  return (
    <section
      ref={box}
      className={`chat ${phone ? `sheet ${sheet}` : 'docked'}`}
      aria-label={content.duck.expandChat}
      data-sheet={phone ? sheet : undefined}
    >
      {phone && <Handle sheet={sheet} />}
      <header className="chat-head" onClick={phone && sheet === 'peek' ? () => setUI({ sheet: 'half' }) : undefined}>
        <Avatar size={phone ? 44 : 56} />
        <div className="chat-id">
          <p className="chat-name">{content.duck.name}</p>
          <p className="chat-status" aria-live="polite">
            {status}
          </p>
        </div>
        {!phone && (
          <button type="button" className="chat-collapse" onClick={() => setUI({ chatOpen: false })} aria-label={content.duck.collapse} title={content.duck.collapse}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </header>
      {phone && sheet === 'peek' ? (
        <Input onFocus={() => setUI({ sheet: 'half' })} />
      ) : (
        <>
          <div className="chat-scroll">
            <Log />
          </div>
          <div className="chat-dock">
            <Chips />
            <Input />
          </div>
        </>
      )}
    </section>
  )
}

/** The 6 offered presets, in content.duck.chips order (unknown ids are skipped). */
export function chipIntents() {
  return content.duck.chips
    .map((id) => content.duck.intents.find((i) => i.id === id))
    .filter((i): i is (typeof content.duck.intents)[number] => !!i && !!i.chip)
}
