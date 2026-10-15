import { useEffect, useRef, useState, type RefObject } from 'react'
import { STOPS, content, contactLinks, noteById, text, type Stop } from './content'
import { closePanel, openPanel, parseHash } from './nav'
import { getUI, setUI, useUI } from './store'
import { Loader, enter } from './Loader'
import { DuckChat, collapseChat } from './duck/DuckChat'
import { Hud, SecretsCard, Toast } from './Hud'
import { useTyping } from './keyboard'
import { gsap, prefersReducedMotion, useGSAP } from './gsap'
import { SHEET_QUERY, useMedia } from './useMedia'
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

/** DOM layer over the canvas: loader, station panels, the duck chat, hint. No tour. */
export function Overlay() {
  useDeepLinks()
  useKeys()
  useTyping()
  return (
    <>
      <Loader />
      <Hud />
      <Panel />
      <DuckChat />
      <SecretsCard />
      <Hint />
      <Toast />
    </>
  )
}

function useDeepLinks() {
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current) return
    done.current = true
    const o = parseHash(window.location.hash)
    if (o) openPanel(o, { writeHash: false })
  }, [ready])
  useEffect(() => {
    const on = () => {
      if (getUI().stage !== 'ready' || !getUI().entered) return
      const o = parseHash(window.location.hash)
      if (o) openPanel(o, { writeHash: false })
      else if (getUI().open) closePanel()
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
}

function useKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const s = getUI()
      if (s.stage !== 'ready') return
      if (!s.entered) {
        if (e.key === 'Enter') {
          e.preventDefault()
          enter()
        }
        return
      }
      // Esc order: the station panel, then the chat (phone sheet to peek / desktop column collapses).
      if (e.key === 'Escape') {
        if (s.open) {
          closePanel()
          // Phones: the card lives in the log, which only shows at half; raise it and focus "Take me there".
          if (document.documentElement.classList.contains('chat-sheet') && s.duckLog.some((x) => x.card)) {
            setUI({ sheet: 'half' })
            requestAnimationFrame(() => requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('.duck-go')].pop()?.focus({ preventScroll: false })))
          }
        }
        else if (document.documentElement.classList.contains('chat-sheet')) {
          if (s.sheet !== 'peek') setUI({ sheet: 'peek' })
        } else if (s.chatOpen && document.documentElement.classList.contains('chat-docked')) collapseChat()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

function Panel() {
  const open = useUI((s) => s.open)
  const full = useUI((s) => s.sheetFull)
  const ref = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const { more, scrolled } = useScrollMore(body, open?.id)
  const phone = useMedia(SHEET_QUERY)
  const answered = useUI((s) => s.duckLog.length > 0)
  const [introOpen, setIntroOpen] = useState(false)
  useEffect(() => setIntroOpen(false), [open?.id, answered])
  // Slide the panel in (side panel on desktop, bottom sheet on phones). Motion only, never opacity,
  // so the copy stays readable even if a slow GPU stalls the tween. Reduced motion: no tween.
  useGSAP(
    () => {
      const el = panel.current
      if (!el || prefersReducedMotion()) return
      const sheet = window.matchMedia?.(SHEET_QUERY).matches
      gsap.from(el, sheet ? { y: 24, duration: 0.35, ease: 'power2.out' } : { x: 16, duration: 0.35, ease: 'power2.out' })
    },
    { dependencies: [open?.id], scope: panel, revertOnUpdate: true },
  )
  // The duck's sheet is content-sized: publish its height so the stop dots ride just above it.
  useEffect(() => {
    const el = panel.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--sheet-h', `${Math.round(el.getBoundingClientRect().height)}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--sheet-h')
    }
  }, [open?.id])
  const lastFocus = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      if (!lastFocus.current) lastFocus.current = document.activeElement
      ref.current?.focus({ preventScroll: true })
    } else {
      // Back to where the visitor came from: usually the card's "Take me there".
      const back = lastFocus.current && document.contains(lastFocus.current) && lastFocus.current !== document.body ? lastFocus.current : [...document.querySelectorAll('.duck-go')].pop()
      ;(back as HTMLElement | undefined)?.focus?.({ preventScroll: true })
      lastFocus.current = null
    }
    if (!open && getUI().sheetFull) setUI({ sheetFull: false })
  }, [open])
  if (!open) return null
  const stop = STOPS.find((s) => s.id === open.id)
  const note = stop ? undefined : noteById(open.id)
  if (!stop && !note) return null
  const isBonus = open.id.startsWith('bonus-')
  const isDuck = stop?.kind === 'duck' || note?.kind === 'duck'
  // Phones, once the duck has answered: the two intro paragraphs fold behind "What's this?" so
  // the answer and the "Scripted for now" line both fit in the (65%) sheet.
  const foldIntro = isDuck && phone && answered
  // Phones, stop 1: title, one line, the project card. The panel joke stays on desktop / 2D.
  const jokeText = stop ? (phone && stop.kind === 'projects' ? '' : text(stop.joke)) : note!.joke
  // The scroll chevron gets its own 24px row under the text (never over it). Hidden next to the
  // carousel dots and on the duck (its dock sits right below; the fade still says "more").
  const chev = more && !isDuck && !nearCarousel(body.current)
  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <aside
        className={`panel${isBonus ? ' bonus' : ''}${note?.kind ? ` ${note.kind}` : ''}${stop?.kind === 'duck' ? ' duck' : ''}${foldIntro ? ' folded' : ''}${full ? ' full' : ''}`}
        role="dialog"
        aria-labelledby="panel-title"
        key={open.id}
        ref={panel}
      >
        <SheetHandle full={full} />
        {/* Desktop with the chat open: the panel is an overlay inside the chat column. */}
        <button type="button" className="panel-back" onClick={closePanel}>
          <span aria-hidden="true">←</span> {content.duck.backToChat}
        </button>
        <button type="button" className="panel-close" onClick={closePanel} aria-label={content.tour.close}>
          ×
        </button>
        <p className="panel-kicker">{stop ? stop.kicker.replace(/^Stop \d+ · /, '') : isBonus ? content.tour.foundIt : 'Aside'}</p>
        <h2 id="panel-title" tabIndex={-1} ref={ref}>
          {stop ? stop.title : note!.title}
        </h2>
        {/* Phones, after an answer: the toggle sits on the title row so the answer keeps the room. */}
        {foldIntro && (
          <button type="button" className="intro-toggle head" aria-expanded={introOpen} aria-controls="duck-intro" onClick={() => setIntroOpen(!introOpen)}>
            {introOpen ? content.duck.hideIntro : content.duck.whatsThis} <span aria-hidden="true">{introOpen ? '▴' : '▾'}</span>
          </button>
        )}
        <div className={`panel-scroll${more ? ' more' : ''}${chev ? ' chev' : ''}${scrolled ? ' scrolled' : ''}`}>
          <div className="panel-body" ref={body}>
            {(!foldIntro || introOpen) && (
              <div id="duck-intro" className="panel-intro">
                {stop ? <StopBody stop={stop} skill={open.skill} project={open.project} /> : note!.body.map((p, k) => <p key={k}>{p}</p>)}
              </div>
            )}
            {jokeText && !foldIntro && <p className="joke">{jokeText}</p>}
          </div>
          {chev && (
            <button
              type="button"
              className="scroll-more"
              aria-label={content.tour.more}
              onClick={() => body.current?.scrollBy({ top: body.current.clientHeight * 0.8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
            >
              <span aria-hidden="true">⌄</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

/** True while the scroll box has more content below the fold (drives the fade + chevron). */
function useScrollMore(ref: RefObject<HTMLElement>, key: string | undefined) {
  const [more, setMore] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [, bump] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6)
      setScrolled(el.scrollTop > 4)
      bump((x) => (x + 1) % 1024) // re-evaluate the chevron vs carousel-dots check on scroll
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref, key])
  return { more, scrolled }
}

/**
 * Desktop: the scroll chevron sits at the bottom centre of the panel, exactly where the project
 * carousel's dots land. Hide the chevron (the 32px fade stays) while those dots are in view.
 */
function nearCarousel(body: HTMLElement | null): boolean {
  const nav = body?.querySelector('.carousel-nav')
  if (!body || !nav) return false
  const b = body.getBoundingClientRect()
  const n = nav.getBoundingClientRect()
  return n.bottom > b.top && n.top < b.bottom
}

/**
 * Phones only (hidden on desktop by CSS): the sheet opens at 50% height. Drag the handle up to
 * snap full height, down to go back to 50% (or close from 50%). A tap toggles.
 */
function SheetHandle({ full }: { full: boolean }) {
  const y0 = useRef<number | null>(null)
  const moved = useRef(false)
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={full ? content.tour.collapse : content.tour.expand}
      aria-expanded={full}
      onPointerDown={(e) => {
        y0.current = e.clientY
        moved.current = false
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (y0.current !== null && Math.abs(e.clientY - y0.current) > 8) moved.current = true
      }}
      onPointerUp={(e) => {
        if (y0.current === null) return
        const dy = e.clientY - y0.current
        y0.current = null
        if (!moved.current) return
        if (dy < -30) setUI({ sheetFull: true })
        else if (dy > 30) {
          if (full) setUI({ sheetFull: false })
          else closePanel()
        }
      }}
      onClick={() => {
        if (moved.current) return
        setUI({ sheetFull: !full })
      }}
    >
      <span aria-hidden="true" />
    </button>
  )
}

function Links({ links }: { links: { label: string; url: string }[] }) {
  return (
    <p className="links">
      {links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
          {l.label} ↗
        </a>
      ))}
    </p>
  )
}

function StopBody({ stop, skill, project }: { stop: Stop; skill?: string; project?: string }) {
  const phone = useMedia(SHEET_QUERY)
  const body = stop.body.map((p, k) => <p key={k}>{text(p)}</p>)
  switch (stop.kind) {
    case 'projects':
      return (
        <>
          {phone ? <p>{content.about.short}</p> : body}
          <Projects initial={project} />
        </>
      )
    case 'skills': {
      const f = content.skills.featured
      return (
        <>
          {body}
          <div className={`skill featured${skill === f.id ? ' hl' : ''}`}>
            <strong>{f.name}</strong>
            <span>{f.line}</span>
          </div>
          <ul className="skills">
            {content.skills.items.map((s) => (
              <li key={s.id} className={skill === s.id ? 'hl' : ''}>
                <strong>{s.name}</strong>
                <span>{s.line}</span>
              </li>
            ))}
          </ul>
        </>
      )
    }
    case 'garden': {
      const p = content.projects.find((x) => x.slug === stop.project)
      return (
        <>
          {body}
          {p && <Links links={[{ label: 'Repo', url: p.repo }, ...(p.live ? [{ label: 'Live', url: p.live }] : [])]} />}
        </>
      )
    }
    case 'career':
      return (
        <>
          {body}
          <ol className="career">
            {content.career.items.map((c, k) => (
              <li key={k}>{c}</li>
            ))}
          </ol>
          <p className="pin">📌 {content.career.teaching}</p>
        </>
      )
    case 'duck':
      return <>{body}</>
    case 'contact':
      return (
        <>
          {body}
          <Links links={contactLinks()} />
        </>
      )
    default:
      return <>{body}</>
  }
}

function Projects({ initial }: { initial?: string }) {
  const list = content.projects
  const [i, setI] = useState(() => Math.max(0, list.findIndex((p) => p.slug === initial)))
  useEffect(() => {
    if (initial) setI(Math.max(0, list.findIndex((p) => p.slug === initial)))
  }, [initial, list])
  const p = list[i]
  const first = useRef(true)
  useEffect(() => {
    setUI({ slotProject: p.slug })
    if (first.current) {
      first.current = false
      return
    }
    // Keep the per-project deep link in sync while the carousel moves.
    if (getUI().open?.id === 'stop-1') history.replaceState(null, '', `${window.location.pathname}${window.location.search}#project-${p.slug}`)
  }, [p.slug])
  const go = (d: number) => setI((i + d + list.length) % list.length)
  return (
    <div className="carousel" aria-roledescription="carousel" aria-label="Projects">
      <article className="card" aria-live="polite">
        <h3>{p.name}</h3>
        <p className="tagline">{p.tagline}</p>
        <p>{p.serious}</p>
        <p className="joke">{p.joke}</p>
        <p className="tags">{p.tags.join(' · ')}</p>
        <Links links={[{ label: 'Repo', url: p.repo }, ...(p.live ? [{ label: 'Live', url: p.live }] : [])]} />
      </article>
      <div className="carousel-nav">
        <button type="button" className="btn ghost small" onClick={() => go(-1)} aria-label="Previous project">
          ‹
        </button>
        {list.map((x, k) => (
          <button
            key={x.slug}
            type="button"
            className={`dot${k === i ? ' on' : ''}`}
            aria-label={x.name}
            aria-current={k === i}
            onClick={() => setI(k)}
          />
        ))}
        <button type="button" className="btn ghost small" onClick={() => go(1)} aria-label="Next project">
          ›
        </button>
      </div>
    </div>
  )
}

const LOOKED_KEY = 'desk3d-looked-360'
function seenLookHint() {
  try {
    return localStorage.getItem(LOOKED_KEY) === '1'
  } catch {
    return false
  }
}

function Hint() {
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const open = useUI((s) => s.open)
  // The caption is a first-impression line: it fades out after the first drag. The 360° drag
  // hint is first-visit only: once someone has dragged, it is remembered (localStorage).
  const dragged0 = useUI((s) => s.dragged)
  const [seen] = useState(seenLookHint)
  // The caption is an arrival line on desktop only (phones: the duck's peek line says it). It
  // fades on the first drag, the first chat message, or after 6 s.
  const asked = useUI((s) => s.duckLog.some((e) => !e.greet))
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setTimedOut(true), 6000)
    return () => window.clearTimeout(id)
  }, [ready])
  const dragged = dragged0 || asked || timedOut
  // Phones: publish the caption's height so the stop dots sit above it, never on top of it.
  const box = useRef<HTMLDivElement>(null)
  const shown = ready && !dragged && !open
  useEffect(() => {
    const root = document.documentElement
    const el = box.current
    if (!shown || !el || typeof ResizeObserver === 'undefined') {
      root.style.removeProperty('--hint-h')
      return
    }
    const ro = new ResizeObserver(() => root.style.setProperty('--hint-h', `${Math.round(el.getBoundingClientRect().height)}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--hint-h')
    }
  }, [shown])
  useEffect(() => {
    if (!dragged0) return
    try {
      localStorage.setItem(LOOKED_KEY, '1')
    } catch {
      /* private mode: fine */
    }
  }, [dragged0])
  if (!ready) return null
  return (
    <div ref={box} className={`hint${open ? ' hidden-mobile with-panel' : ''}${dragged ? ' gone' : ''}`} aria-hidden={dragged || undefined}>
      <p className="hint-line">{content.site.coldOpen}</p>
      {!seen && <p className="hint-sub">{isTouch() ? content.site.hintTouch : content.site.hintDesktop}</p>}
    </div>
  )
}
