import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { STOPS, content } from '../content'
import { openChat, openPanel } from '../nav'
import { getUI, setUI, subscribe, useUI, type DuckEntry, type SheetState } from '../store'
import { markerTargetFor } from '../targets'
import { askDuck } from './run'
import { headClamp } from './headClamp'
import { CHAT_SHEET_QUERY } from '../useMedia'

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

/** Same breakpoint as the chat sheet in index.css: phones are <900px wide or portrait. */
export { CHAT_SHEET_QUERY } from '../useMedia'
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

/** Answer text: 180 ms fade per paragraph (Vision restyle). Instant with reduced motion. */
/** Plain text with any https:// URL turned into a link (the duck's LinkedIn answers). */
function Linked({ text }: { text: string }) {
  const bits = text.split(/(https:\/\/[^\s)]+)/)
  return (
    <>
      {bits.map((b, i) =>
        i % 2 ? (
          <a key={i} href={b} target="_blank" rel="noopener noreferrer">
            {b.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')}
          </a>
        ) : (
          b
        ),
      )}
    </>
  )
}

function FadeIn({ text }: { text: string }) {
  const parts = text.split(/\n+/).filter(Boolean)
  if (reduced()) return <Linked text={text} />
  return (
    <>
      {parts.map((para, i) => (
        <span key={i} className="duck-fade" style={{ animationDelay: `${i * 180}ms`, display: parts.length > 1 ? 'block' : 'inline' }}>
          <Linked text={para} />
        </span>
      ))}
    </>
  )
}


/** Still of the scene duck; a 2-frame blink every ~6 s is the only motion in the panel (Vision). */
function Avatar({ size }: { size: number }) {
  return (
    <span className="duck-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}duck-avatar.webp`} alt="" width={size} height={size} draggable={false} />
    </span>
  )
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
  // Visitors can chat before the room has loaded; "Take me there" waits for the room (Fury #6).
  const ready = useUI((s) => s.stage === 'ready')
  const c = e.card!
  const stop = STOPS.find((s) => s.id === c.open.id)
  if (!ready) return null
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

/**
 * The tool ticker (Vision recruiter look §2): one quiet sans line above the answer,
 * "search_portfolio · fly_to monitor · open projects", the current step in ink. Once the answer
 * lands it collapses to "3 steps ▸" (tap to expand). Never the old mono ticker.
 */
function Ticker({ e }: { e: DuckEntry }) {
  const [open, setOpen] = useState(false)
  const steps = e.steps
  const live = !e.reply
  if (!steps.length)
    return live ? (
      <p className="duck-ticker">
        <span className="sr-only">{content.duck.status.thinkingSr}</span>
        <span aria-hidden="true">…</span>
      </p>
    ) : null
  const cur = live ? Math.max(0, e.shown - 1) : -1
  const count = `${steps.length} step${steps.length === 1 ? '' : 's'}`
  const line = (
    <>
      {steps.map((t, i) => (
        <span key={i}>
          {i > 0 && <span className="sep" aria-hidden="true"> · </span>}
          <span className={i === cur ? 'cur' : i < e.shown || !live ? 'done' : 'next'}>{t}</span>
        </span>
      ))}
    </>
  )
  if (live)
    return (
      // Hidden from screen readers: the log would announce every step; the answer is announced.
      <p className="duck-ticker live" aria-hidden="true">
        {line}
      </p>
    )
  return (
    <button
      type="button"
      className={`duck-ticker toggle${open ? ' open' : ''}`}
      aria-expanded={open}
      aria-label={open ? `${content.duck.hideSteps}: ${steps.join(', ')}` : content.duck.showSteps.replace('{n}', String(steps.length))}
      onClick={() => setOpen(!open)}
    >
      {open ? line : count}{' '}
      {/* Drawn, not a ▸ glyph: not every system font has one. */}
      <svg className={`ticker-caret${open ? ' open' : ''}`} width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
        <path d="M2 1l4 3-4 3z" fill="currentColor" />
      </svg>
    </button>
  )
}

function Turn({ e }: { e: DuckEntry }) {
  const touch = isTouch()
  const greet = e.greet
    ? (touch && content.duck.greet.touch ? `${content.duck.greet.line} ${content.duck.greet.touch}`.trim() : content.duck.greet.line)
    : null
  return (
    <div className="duck-turn">
      {!e.greet && (
        <p className="visitor-line">
          <span className="you">you · </span>
          {e.question}
        </p>
      )}
      {!e.greet && <Ticker e={e} />}
      {e.reply && (
        <p className={`duck-answer${e.matched ? '' : ' miss'}${e.error ? ' error' : ''}`}>
          <FadeIn text={greet ?? e.reply} />
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
 * Pinned = the bottom: the latest card sits just above the chips and never gets clipped. If the
 * answer + card are taller than the half sheet (already content-sized up to 62vh), the sheet goes
 * to full; with a station open (full is off then) the answer's top fades under the header instead.
 */
function pin(el: HTMLElement) {
  el.scrollTop = el.scrollHeight - el.clientHeight
  const turns = el.querySelectorAll<HTMLElement>('.duck-turn')
  const last = turns[turns.length - 1]
  const u = getUI()
  if (last?.querySelector('.duck-card') && u.sheet === 'half' && !u.open && last.offsetHeight + 16 > el.clientHeight && el.closest('.chat.sheet'))
    setUI({ sheet: 'full' })
}

function Log() {
  const log = useUI((s) => s.duckLog)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const userAt = useRef(0)
  const [pill, setPill] = useState(false)
  const [faded, setFaded] = useState(false)
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
      className={`chat-scroll${faded ? ' faded' : ''}`}
      ref={box}
      // Only the visitor's own scrolling (wheel / touch / keys) unpins; programmatic scrolls never do.
      onWheel={() => (userAt.current = performance.now())}
      onTouchMove={() => (userAt.current = performance.now())}
      onKeyDown={() => (userAt.current = performance.now())}
      onScroll={(ev) => {
        const el = ev.currentTarget
        setFaded(el.scrollTop > 4)
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
          <Fragment key={e.id}>
            <Turn e={e} />
            {e.greet && <Chips />}
          </Fragment>
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

/**
 * Opening chips (Vision recruiter look §2, on Shuri's PR #6 stack): the greeting's three, stacked
 * full width under the greeting, one sentence each in the duck's voice (Literata). "More questions"
 * (a sans text link) opens the other presets as extra stacked rows, "Fewer questions" right under
 * them; on phones the sheet goes to full while More is open. Used chips stay but go quiet.
 * All sentence case (Fury #3).
 */
function Chips() {
  const thinking = useUI((s) => s.duckThinking)
  const log = useUI((s) => s.duckLog)
  const phone = useSheetLayout()
  const [more, setMore] = useState(false)
  const norm = (t: string) => t.trim().toLowerCase()
  const asked = new Set(log.map((e) => norm(e.question)))
  const greet = content.duck.greet.chips.map((c) => ({ key: c.label, label: c.label, ask: c.ask as string | string[] }))
  const seen = new Set(greet.map((c) => norm(c.label)))
  const presets = chipIntents()
    .filter((c) => !seen.has(norm(c.chip)))
    .map((c) => ({ key: c.id, label: c.chip, ask: c.chip as string | string[] }))
  const list = more ? [...greet, ...presets] : greet
  const toggle = () => {
    const next = !more
    setMore(next)
    if (next && phone && !getUI().open) setUI({ sheet: 'full' })
    // Fewer: back to half (Shuri #6 note 2), unless the visitor already moved the sheet.
    else if (!next && phone && getUI().sheet === 'full') setUI({ sheet: 'half' })
  }
  return (
    <div className="duck-chips-stack">
      <ul className="chip-stack" aria-label="Suggested questions">
        {list.map((c) => {
          const used = asked.has(norm(c.label)) || (!Array.isArray(c.ask) && asked.has(norm(c.ask)))
          return (
            <li key={c.key}>
              <button
                type="button"
                className={`chip-line${used ? ' used' : ''}`}
                disabled={thinking}
                onClick={() => void askDuck(Array.isArray(c.ask) ? c.ask[Math.floor(Math.random() * c.ask.length)] : c.ask)}
              >
                {c.label}
              </button>
            </li>
          )
        })}
      </ul>
      {presets.length > 0 && (
        <button type="button" className="chip-more-link" aria-expanded={more} onClick={toggle}>
          {more ? content.duck.less : content.duck.more}
        </button>
      )}
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
      <button type="submit" className="chat-send" disabled={thinking || !q.trim()}>
        {content.duck.send}
      </button>
    </form>
  )
}

/** The duck's first line, posted the moment the visitor enters the room (first sentence at once). */
function useGreeting() {
  // Visitors can enter before the room loads: the duck greets them right away (Fury #6).
  const entered = useUI((s) => s.entered)
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
  const text = thinking
    ? content.duck.status.thinkingSr
    : last
      ? last.greet && isTouch() && content.duck.greet.touch
        ? `${content.duck.greet.line} ${content.duck.greet.touch}`.trim()
        : last.reply!
      : content.duck.greet.line
  return (
    // Phones at peek: the log region is on the page too, so the first answer is announced.
    <p className="peek-last" role="log" aria-live="polite" aria-label="Chat with the duck" onClick={() => setUI({ sheet: 'half' })}>
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
  const ready = useUI((s) => s.entered)
  const chatOpen = useUI((s) => s.chatOpen)
  const unread = useUI((s) => s.chatUnread)
  const sheet = useUI((s) => s.sheet)
  const station = useUI((s) => !!s.open)
  const chatFull = useUI((s) => s.chatFull)
  const phone = useSheetLayout()
  const box = useRef<HTMLElement>(null)
  // v2.2 #59 / v2.3 #67: desktop with a station open, the column shrinks to a dark note under the card.
  const note = ready && !phone && chatOpen && station && !chatFull
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
      root.classList.toggle('chat-note', !!docked && note)
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
  }, [ready, phone, chatOpen, note])
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
  if (note)
    return (
      <>
        <section ref={box} className="chat docked chatnote" aria-label={content.duck.expandChat}>
          <NoteLine />
          <div className="chat-dock">
            <Input />
          </div>
        </section>
        <StationKeys />
      </>
    )
  const raised = !phone || sheet !== 'peek'
  return (
    <>
      <section
        ref={box}
        className={`chat ${phone ? `sheet ${sheet}${station ? ' station' : ''}` : 'docked'}`}
        aria-label={content.duck.expandChat}
        data-sheet={phone ? sheet : undefined}
      >
        {phone && <Handle sheet={sheet} />}
        {raised && (
          <>
            <div className="chat-dock">
              <Input />
            </div>
            <Log />
          </>
        )}
        <header className="chat-head" onClick={phone && sheet === 'peek' ? () => setUI({ sheet: 'half' }) : undefined}>
          {!phone ? (
            <button type="button" className="duck-avatar-btn" onClick={collapseChat} aria-label={content.duck.collapse} title={content.duck.collapse}>
              <Avatar size={44} />
            </button>
          ) : (
            <Avatar size={40} />
          )}
          <div className="chat-id">
            <p className="chat-name">{content.duck.name}</p>
            {phone && sheet === 'peek' && <PeekLine />}
          </div>
        </header>
      </section>
      <StationKeys />
    </>
  )
}

/** The duck's last line, as the note shows it (the greeting before any answer). */
export function lastDuckLine(log: DuckEntry[]): string {
  const last = [...log].reverse().find((e) => e.reply)
  return last?.reply ?? content.duck.greet.line
}

/**
 * The note's last line (v2.3 #67): head-clamped to two lines so the closing question survives, and
 * a button: Enter, Space or click restores the whole chat column with focus on its last message.
 */
function NoteLine() {
  const log = useUI((s) => s.duckLog)
  const full = lastDuckLine(log)
  const btn = useRef<HTMLButtonElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(full)
  useLayoutEffect(() => {
    const b = btn.current
    const p = probe.current
    if (!b || !p) return
    let live = true
    const run = () => {
      if (!live) return
      const cs = getComputedStyle(b)
      const w = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      if (w <= 0) return
      p.style.width = `${w}px`
      const lines = parseFloat(cs.lineHeight) * 2 + 1
      setShown(headClamp(full, (c) => {
        p.textContent = c
        return p.scrollHeight <= lines
      }))
    }
    run()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null
    ro?.observe(b)
    document.fonts?.ready.then(run)
    return () => {
      live = false
      ro?.disconnect()
    }
  }, [full])
  return (
    <>
      <button type="button" className="last" ref={btn} aria-label={`${content.duck.showWholeChat}: ${shown}`} onClick={showWholeChat}>
        {shown}
      </button>
      <span className="last last-probe" ref={probe} aria-hidden="true" />
    </>
  )
}

/** Restore the full chat column over the station card (the card waits; Esc brings it back). */
export function showWholeChat() {
  setUI({ chatFull: true })
  // The column mounts on the next commit; keep trying for a few frames until focus is inside it.
  let tries = 0
  const tick = () => {
    const col = document.querySelector<HTMLElement>('.chat.docked:not(.chatnote)')
    if (col) {
      const scroll = col.querySelector<HTMLElement>('.chat-scroll')
      if (scroll) scroll.scrollTop = scroll.scrollHeight
      const msg = [...col.querySelectorAll<HTMLElement>('.duck-answer')].pop()
      if (msg) {
        msg.tabIndex = -1
        msg.focus({ preventScroll: true })
      } else col.querySelector<HTMLElement>('.chat-dock input, .chat-dock textarea')?.focus()
      if (col.contains(document.activeElement)) return
    }
    if (tries++ < 20) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
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
