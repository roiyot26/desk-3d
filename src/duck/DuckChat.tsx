import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { STOPS, content } from '../content'
import { openChat, openPanel } from '../nav'
import { getUI, setUI, subscribe, useUI, type DuckEntry, type SheetState } from '../store'
import { markerTargetFor } from '../targets'
import { askDuck } from './run'

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

/** Same breakpoint as the chat sheet in index.css: phones are <900px wide or portrait. */
export const CHAT_SHEET_QUERY = '(max-width: 899px), (orientation: portrait)'
/** Docked column width on desktop: clamp(380px, 32vw, 520px). Also used by the camera offset. */
export const chatWidth = (w: number) => Math.min(520, Math.max(380, 0.32 * w))
export const CHAT_INSET = 24
export const PEEK_PX = 88

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

/**
 * Text that types itself out at `cps` characters/s (instant with reduced motion). `lead` chars
 * show at once (the greeting's first sentence lands inside 1 s, then the rest types on).
 */
function Typed({ text, cps = 110, lead = 0 }: { text: string; cps?: number; lead?: number }) {
  const start = useRef(performance.now())
  const [n, setN] = useState(() => (reduced() ? text.length : lead))
  useEffect(() => {
    if (n >= text.length) return
    const id = window.setInterval(() => {
      const k = Math.min(text.length, lead + Math.floor(((performance.now() - start.current) / 1000) * cps))
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

/** "looking at the bookshelf" (camera on a station) / "pointing at the monitor" (card posted) / the room. */
function useStatus() {
  const open = useUI((s) => s.open)
  const thinking = useUI((s) => s.duckThinking)
  const pointing = useUI((s) => s.duckPointing)
  if (thinking) return content.duck.status.thinking
  if (open) {
    const stop = STOPS.find((s) => s.id === open.id)
    const note = stop ? undefined : content.bonus.find((b) => b.id === open.id) ?? content.asides.find((a) => a.id === open.id)
    const name = (stop?.label ?? note?.title ?? '').split(' · ')[0].toLowerCase()
    if (name) return content.duck.status.at.replace('{x}', name)
  }
  if (pointing) return content.duck.status.pointing.replace('{x}', pointing)
  return content.duck.status.around
}

/** Station icons (inline SVG, inherit the accent): no letter tiles, no AI art. */
const ICONS: Record<string, string> = {
  projects: 'M3 5h18v11H3zM9 20h6M12 16v4',
  pitch: 'M4 6h16v10H4zM2 19h20',
  skills: 'M5 4v16M10 4v16M15 5l4 15M3 20h18',
  garden: 'M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2-5-6-5 0 3 2 5 6 5zM7 21h10',
  career: 'M3 5h18v14H3zM7 9h6M7 13h10M15 9h2',
  contact: 'M5 8h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10h2a2 2 0 0 1 0 4h-2',
  note: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4',
}
function StationIcon({ kind }: { kind: string }) {
  return (
    <span className="duck-card-icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" focusable="false">
        <path d={ICONS[kind] ?? ICONS.note} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function StationCard({ e }: { e: DuckEntry }) {
  const c = e.card!
  const stop = STOPS.find((s) => s.id === c.open.id)
  return (
    <div className="duck-card">
      <StationIcon kind={stop?.kind ?? 'note'} />
      <span className="duck-card-title">{c.title}</span>
      <button type="button" className="duck-go" onClick={() => openPanel(c.open)}>
        {content.duck.go} <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}

function Turn({ e }: { e: DuckEntry }) {
  const touch = isTouch()
  const greet = e.greet ? (touch ? `${content.duck.greet.line} ${content.duck.greet.touch}` : content.duck.greet.line) : null
  return (
    <div className="duck-turn">
      {!e.greet && <p className="bubble user">{e.question}</p>}
      {e.steps.length > 0 && (
        <ol className="duck-ticker" aria-hidden="true">
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
        </ol>
      )}
      {!e.reply && (
        <p className="bubble duck typing">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="sr-only">{content.duck.status.thinkingSr}</span>
        </p>
      )}
      {e.reply && (
        <p className={`bubble duck${e.matched ? '' : ' miss'}${e.error ? ' error' : ''}`}>
          {greet ? <Typed text={greet} cps={28} lead={greet.indexOf('.') + 1} /> : <Typed text={e.reply} />}
        </p>
      )}
      {e.error && (
        <button type="button" className="duck-retry" onClick={() => void askDuck(e.error!)}>
          {content.duck.retry}
        </button>
      )}
      {e.card && e.reply && <StationCard e={e} />}
    </div>
  )
}

/**
 * The log. Sticks to the bottom while the visitor is at the bottom; if they scrolled up, new
 * content shows a "New message ↓" pill instead of yanking the view.
 */
/**
 * Where "pinned" is. Normally the bottom. When the latest answer plus its card is taller than the
 * scroller (half sheet on small phones), the answer's first line goes to the top and the card stays
 * pinned at the bottom (sticky), so neither the answer's start nor the card is ever hidden and the
 * sheet doesn't have to grow over the focused station.
 */
function pin(el: HTMLElement) {
  const bubbles = el.querySelectorAll<HTMLElement>('.bubble.duck')
  const last = bubbles[bubbles.length - 1]
  const card = last?.parentElement?.querySelector<HTMLElement>('.duck-card')
  const bottom = el.scrollHeight - el.clientHeight
  if (last && card) {
    const top = el.scrollTop + last.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
    const need = last.offsetHeight + card.offsetHeight + 24
    if (need > el.clientHeight) {
      el.scrollTop = Math.min(bottom, top)
      return
    }
  }
  el.scrollTop = bottom
}

function Log() {
  const log = useUI((s) => s.duckLog)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const userAt = useRef(0)
  const [pill, setPill] = useState(false)
  const toBottom = (smooth: boolean) => {
    const el = box.current
    if (!el) return
    if (smooth && !reduced()) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    else pin(el)
    setPill(false)
  }
  // Content grows while it types: keep pinned with a ResizeObserver on the inner log.
  useEffect(() => {
    const el = box.current
    const inner = el?.firstElementChild
    if (!el || !inner || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (atBottom.current) pin(el)
      else setPill(true)
    })
    ro.observe(inner)
    ro.observe(el)
    // The sheet animates its height; re-pin once it settles.
    const sheet = el.closest('.chat')
    const settle = () => { if (atBottom.current) pin(el) }
    sheet?.addEventListener('transitionend', settle)
    return () => { ro.disconnect(); sheet?.removeEventListener('transitionend', settle) }
  }, [])
  // Pinning is instant (a smooth scroll's in-between positions would read as "the visitor scrolled up").
  useEffect(() => {
    if (atBottom.current) toBottom(false)
    else setPill(true)
  }, [log])
  return (
    <div
      className="chat-scroll"
      ref={box}
      // Only the visitor's own scrolling (wheel / touch / keys) unpins; programmatic scrolls never do.
      onWheel={() => (userAt.current = performance.now())}
      onTouchMove={() => (userAt.current = performance.now())}
      onKeyDown={() => (userAt.current = performance.now())}
      onScroll={(ev) => {
        const el = ev.currentTarget
        const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        if (bottom || performance.now() - userAt.current >= 800) {
          if (!bottom) return
          atBottom.current = true
          setPill(false)
        } else atBottom.current = false
      }}
    >
      <div className="duck-log" role="log" aria-live="polite" aria-label="Chat with the duck">
        {log.length === 0 && <p className="chat-empty">{content.duck.empty}</p>}
        {log.map((e) => (
          <Turn key={e.id} e={e} />
        ))}
      </div>
      {pill && (
        <button type="button" className="new-pill" onClick={() => { atBottom.current = true; toBottom(false) }}>
          {content.duck.newBelow} <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  )
}

/** Suggestion chips: the greeting's three, then the preset questions not yet asked. One scrolling row with a fade edge. */
function Chips() {
  const thinking = useUI((s) => s.duckThinking)
  const log = useUI((s) => s.duckLog)
  const norm = (t: string) => t.trim().toLowerCase()
  const asked = new Set(log.map((e) => norm(e.question)))
  const greet = content.duck.greet.chips.map((c) => ({ key: c.label, label: c.label, ask: c.ask }))
  const presets = chipIntents().map((c) => ({ key: c.id, label: c.chip, ask: c.chip as string | string[] }))
  const seen = new Set<string>()
  const list = [...greet, ...presets].filter((c) => {
    const a = Array.isArray(c.ask) ? '' : norm(c.ask)
    if (asked.has(norm(c.label)) || (a && asked.has(a)) || (a && seen.has(a))) return false
    if (a) seen.add(a)
    return true
  })
  const row = useRef<HTMLDivElement>(null)
  const [end, setEnd] = useState(false)
  const check = () => {
    const el = row.current
    if (el) setEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
  }
  useEffect(check, [list.length])
  return (
    <div className={`chat-chips-wrap${end ? ' at-end' : ''}`}>
      <div className="chat-chips" role="list" aria-label="Suggested questions" ref={row} onScroll={check}>
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
        enterKeyHint="send"
      />
      <button type="submit" className="chat-send" disabled={thinking || !q.trim()} aria-label={content.duck.send}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  )
}

/** The duck's first line, posted the moment the visitor enters the room (first sentence at once). */
function useGreeting() {
  const entered = useUI((s) => s.entered && s.stage === 'ready')
  useEffect(() => {
    if (!entered) return
    setUI((s) =>
      s.duckLog.some((e) => e.greet)
        ? {}
        : { duckLog: [{ id: 0, question: '', steps: [], shown: 0, reply: content.duck.greet.line, matched: true, greet: true }, ...s.duckLog] },
    )
  }, [entered])
}

/** Phones: ride on the visual viewport so the on-screen keyboard never covers the input. */
function useKeyboardInset(on: boolean) {
  useEffect(() => {
    const root = document.documentElement
    if (!on) {
      root.style.removeProperty('--kb')
      return
    }
    const set = () => {
      const vv = window.visualViewport
      const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
      root.style.setProperty('--kb', `${kb}px`)
      root.classList.toggle('kb-open', kb > 60)
    }
    set()
    window.visualViewport?.addEventListener('resize', set)
    window.visualViewport?.addEventListener('scroll', set)
    window.addEventListener('resize', set)
    return () => {
      window.visualViewport?.removeEventListener('resize', set)
      window.visualViewport?.removeEventListener('scroll', set)
      window.removeEventListener('resize', set)
      root.classList.remove('kb-open')
    }
  }, [on])
}

/** Handle cycle. While a station panel is open the sheet goes peek ↔ half only (full would cover the station). */
function nextSheet(sheet: SheetState, dir: 1 | -1 | 0): SheetState {
  const capped = !!getUI().open
  if (dir === 0) return sheet === 'peek' ? 'half' : sheet === 'half' && !capped ? 'full' : 'peek'
  if (dir > 0) return sheet === 'peek' ? 'half' : capped ? 'half' : 'full'
  return sheet === 'full' ? 'half' : 'peek'
}

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
        if (dy < -30) setUI({ sheet: dy < -220 && !getUI().open ? 'full' : nextSheet(sheet, 1) })
        else if (dy > 30) setUI({ sheet: dy > 220 ? 'peek' : nextSheet(sheet, -1) })
      }}
      onClick={() => {
        if (moved.current) return
        setUI({ sheet: nextSheet(sheet, 0) })
      }}
    >
      <span aria-hidden="true" />
    </button>
  )
}

/** Peek row: the duck's latest line (never hidden at peek), or "thinking…". */
function PeekLine() {
  const log = useUI((s) => s.duckLog)
  const thinking = useUI((s) => s.duckThinking)
  const last = [...log].reverse().find((e) => e.reply)
  const text = thinking ? content.duck.status.thinkingSr : last ? (last.greet && isTouch() ? `${content.duck.greet.line} ${content.duck.greet.touch}` : last.reply!) : content.duck.empty
  return (
    <p className="peek-last" onClick={() => setUI({ sheet: 'half' })}>
      {text}
    </p>
  )
}

/** Keyboard path to the stations (Tab cycles them with the hover label, Enter opens). Hint rims come in PR 2. */
function StationKeys() {
  const targets = useUI((s) => s.targets)
  const stations = STOPS.filter((s) => s.kind !== 'duck')
    .map((s) => ({ s, t: markerTargetFor(targets, s.id) }))
    .filter((x) => x.t)
  if (!stations.length) return null
  return (
    <nav className="station-keys" aria-label={content.duck.stations}>
      {stations.map(({ s, t }) => (
        <button
          key={s.id}
          type="button"
          onFocus={() => setUI({ hovered: t!.key, hoverTouch: false })}
          onBlur={() => getUI().hovered === t!.key && setUI({ hovered: null })}
          onClick={() => openPanel({ id: s.id })}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}

/**
 * The duck chat, the main surface (Vision's duck-hint spec §2 + Shuri's spec lock). Desktop: a
 * docked right column, clamp(380px, 32vw, 520px), collapsible to a 64px duck bubble. Phones: a
 * bottom sheet: peek 88px / half (content-sized, 40–62vh) / full 92vh; peek on load and on a
 * fly-to. While the sheet is raised over a station, the station panel steps aside.
 * DOM order = focus order: input → chips → log → collapse (CSS `order` puts the header on top).
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
  useKeyboardInset(ready && phone)
  // Publish the space the chat takes so panels, the caption and the camera keep clear of it.
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = box.current
    const set = () => {
      const r = el?.getBoundingClientRect()
      const docked = ready && !phone && chatOpen && r
      root.style.setProperty('--chat-w', docked ? `${Math.round(r.width + CHAT_INSET)}px` : '0px')
      root.style.setProperty('--chat-h', ready && phone ? `${Math.round(r?.height ?? PEEK_PX)}px` : '0px')
      root.classList.toggle('chat-docked', !!docked)
      root.classList.toggle('chat-sheet', ready && phone)
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
  useEffect(() => {
    document.documentElement.classList.toggle('sheet-raised', ready && phone && sheet !== 'peek')
  }, [ready, phone, sheet])
  // Leaving full while a station opens would hide it: the sheet is capped at half then.
  useEffect(() => {
    const off = subscribe(() => {
      const s = getUI()
      if (s.open && s.sheet === 'full') setUI({ sheet: 'half' })
    })
    return () => void off()
  }, [])
  if (!ready) return null
  if (!phone && !chatOpen)
    return (
      <>
        <button type="button" className="chat-bubble" onClick={openChat} aria-label={content.duck.expandChat}>
          <Avatar size={56} />
          {unread && <span className="unread" aria-hidden="true" />}
        </button>
        <StationKeys />
      </>
    )
  const raised = !phone || sheet !== 'peek'
  return (
    <>
      <section
        ref={box}
        className={`chat ${phone ? `sheet ${sheet}` : 'docked'}`}
        aria-label={content.duck.expandChat}
        data-sheet={phone ? sheet : undefined}
      >
        {phone && <Handle sheet={sheet} />}
        {raised ? (
          <>
            <div className="chat-dock">
              <Input />
              <Chips />
            </div>
            <Log />
          </>
        ) : (
          <Input onFocus={() => setUI({ sheet: 'half' })} />
        )}
        <header className="chat-head" onClick={phone && sheet === 'peek' ? () => setUI({ sheet: 'half' }) : undefined}>
          <Avatar size={phone ? 44 : 56} />
          <div className="chat-id">
            <p className="chat-name">{content.duck.name}</p>
            {phone && sheet === 'peek' ? (
              <PeekLine />
            ) : (
              <p className="chat-status" aria-live="polite">
                {status}
              </p>
            )}
          </div>
          {!phone && (
            <button
              type="button"
              className="chat-collapse"
              onClick={collapseChat}
              aria-label={content.duck.collapse}
              title={content.duck.collapse}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </header>
      </section>
      <StationKeys />
    </>
  )
}

/** Collapse the desktop column; focus lands on the duck bubble that replaces it. */
export function collapseChat() {
  setUI({ chatOpen: false })
  window.setTimeout(() => document.querySelector<HTMLButtonElement>('.chat-bubble')?.focus(), 0)
}

/** The 6 offered presets, in content.duck.chips order (unknown ids are skipped). */
export function chipIntents() {
  return content.duck.chips
    .map((id) => content.duck.intents.find((i) => i.id === id))
    .filter((i): i is (typeof content.duck.intents)[number] => !!i && !!i.chip)
}
