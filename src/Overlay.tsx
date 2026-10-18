import { panelFocus } from './panelFocus'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { STOPS, content, noteById, text, type Stop } from './content'
import { closePanel, openPanel, parseHash } from './nav'
import { getUI, setUI, useUI } from './store'
import { Loader, enter } from './Loader'
import { DuckChat, collapseChat } from './duck/DuckChat'
import { Hud, Toast } from './Hud'
import { useTyping } from './keyboard'
import { prefersReducedMotion } from './gsap'
import { flushSync } from 'react-dom'
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
      // Enter works before the room is ready (Fury #6); everything else waits for the room.
      if (!s.entered) {
        if (e.key === 'Enter') {
          e.preventDefault()
          enter()
        }
        return
      }
      if (s.stage !== 'ready') return
      // Esc order: the station panel, then the chat (phone sheet to peek / desktop column collapses).
      if (e.key === 'Escape') {
        // Desktop, the whole chat restored over a station (v2.3 #67): Esc returns to the panel.
        if (s.open && s.chatFull) {
          // Commit now so the card is visible again, then focus its title (rAF fallback for slow frames).
          flushSync(() => setUI({ chatFull: false }))
          const title = () => document.getElementById('panel-title')?.focus({ preventScroll: true })
          title()
          requestAnimationFrame(() => {
            if (document.activeElement?.id !== 'panel-title') title()
          })
          return
        }
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

/**
 * Panel look v2.3 (Vision "A2, paper"): one paper card per station. Desktop: hugged at the top of
 * the chat column (the chat shrinks to a note under it). Phones: a sheet on the chat peek that hugs
 * its content up to the CSS cap and scrolls past it. One exit ("← chat"); Esc and a room tap still close.
 */
function Panel() {
  const open = useUI((s) => s.open)
  const full = useUI((s) => s.sheetFull)
  const chatFull = useUI((s) => s.chatFull)
  const ref = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const more = useScrollMore(body, open?.id)
  const phone = useMedia(SHEET_QUERY)
  const fonts = usePanelFonts()
  // Slide-in: a CSS transform animation (index.css panel-in-*), composited, so it never counts as
  // layout shift (the old GSAP tween scored ≈0.45 CLS per open). Motion only, never opacity.
  useSheetHeight(panel, fonts ? open?.id : undefined, phone, full)
  const lastFocus = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      if (!lastFocus.current) lastFocus.current = document.activeElement
      if (fonts) ref.current?.focus({ preventScroll: true })
    } else {
      // Back to where the visitor came from: usually the card's "Take me there".
      const back = lastFocus.current && document.contains(lastFocus.current) && lastFocus.current !== document.body ? lastFocus.current : [...document.querySelectorAll('.duck-go')].pop()
      ;(back as HTMLElement | undefined)?.focus?.({ preventScroll: true })
      lastFocus.current = null
    }
    if (!open && getUI().sheetFull) setUI({ sheetFull: false })
  }, [open, fonts])
  if (!open || !fonts) return null
  const stop = STOPS.find((s) => s.id === open.id)
  const note = stop ? undefined : noteById(open.id)
  if (!stop && !note) return null
  const title = stop ? stop.title : note!.title
  const kind = stop?.kind ?? note?.kind ?? 'note'
  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <aside
        className={`panel paper kind-${kind}${full ? ' full' : ''}${chatFull ? ' stepped' : ''}`}
        role="dialog"
        aria-labelledby="panel-title"
        key={open.id}
        ref={panel}
      >
        <div className="panel-top">
          <button type="button" className="panel-back" onClick={closePanel} aria-label={content.duck.backToChat}>
            <span aria-hidden="true">←</span> {content.duck.backShort}
          </button>
          <SheetHandle full={full} />
        </div>
        <div className={`panel-scroll${more ? ' has-more' : ''}`} ref={body} tabIndex={0} aria-label={title}>
          <h2 id="panel-title" tabIndex={-1} ref={ref}>
            {title}
          </h2>
          {stop ? <StopBody stop={stop} skill={open.skill} project={open.project} /> : note!.body.map((p, k) => <p key={k} className="body">{p}</p>)}
          <div className="panel-fade" aria-hidden="true" />
        </div>
      </aside>
    </>
  )
}

/**
 * v2.1 §5.4 / 0 CLS: the panel opens once Literata 600/28 and 400/17 are loaded, capped at 400 ms
 * (then the metric-matched fallback face renders it). One shared promise for the page.
 */
let fontsGate: Promise<void> | null = null
let fontsDone = false
export function panelFonts(): Promise<void> {
  if (fontsGate) return fontsGate
  const f = typeof document !== 'undefined' ? document.fonts : undefined
  const load = f?.load ? Promise.all([f.load('600 28px Literata'), f.load('400 17px Literata')]).then(() => undefined, () => undefined) : Promise.resolve()
  fontsGate = Promise.race([load, new Promise<void>((r) => setTimeout(r, 400))]).then(() => {
    fontsDone = true
  })
  return fontsGate
}
function usePanelFonts(): boolean {
  const [ok, setOk] = useState(fontsDone)
  useEffect(() => {
    if (ok) return
    let live = true
    panelFonts().then(() => live && setOk(true))
    return () => {
      live = false
    }
  }, [ok])
  return ok
}

/** Drag state of the phone sheet handle: the sheet is not re-measured (and the camera not re-framed) mid-drag. */
export const sheetDrag = { active: false }

/**
 * Panel v2.3 #66: a ResizeObserver on the phone sheet publishes its measured top edge
 * (innerHeight − peek − sheet height) for the camera and the room labels. First measure after
 * document.fonts.ready; then once per animation frame and only on a ≥2 px change; never while the
 * handle is dragged or the sheet is at full height (the camera keeps the half-sheet framing).
 */
export function sheetTopOf(el: HTMLElement, innerHeight: number): number {
  // Layout values, not the rect: the slide-in transform never skews the measure.
  const bottom = parseFloat(getComputedStyle(el).bottom) || 0
  return Math.round(innerHeight - bottom - el.offsetHeight)
}
export function shouldPublish(prev: { id: string; top: number } | null, id: string, top: number): boolean {
  return !prev || prev.id !== id || Math.abs(prev.top - top) >= 2
}
function useSheetHeight(panel: RefObject<HTMLElement>, id: string | undefined, phone: boolean, full: boolean) {
  useEffect(() => {
    const el = panel.current
    if (!el || !id || !phone || typeof ResizeObserver === 'undefined') return
    let raf = 0
    let ready = false
    let dead = false
    const measure = () => {
      raf = 0
      if (dead || !ready || sheetDrag.active || el.classList.contains('full') || el.offsetHeight === 0) return
      const top = sheetTopOf(el, window.innerHeight)
      if (shouldPublish(getUI().sheetTop, id, top)) setUI({ sheetTop: { id, top } })
    }
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(queue)
    ro.observe(el)
    window.addEventListener('resize', queue)
    // A drag that ends without a resize (the content grew mid-drag) still re-measures once.
    window.addEventListener('pointerup', queue)
    ;(document.fonts?.ready ?? Promise.resolve()).then(() => {
      ready = true
      queue()
    })
    return () => {
      dead = true
      ro.disconnect()
      window.removeEventListener('resize', queue)
      window.removeEventListener('pointerup', queue)
      if (raf) cancelAnimationFrame(raf)
    }
    // `full`: back at half after the full sheet, measure again (the camera re-frames only then).
  }, [panel, id, phone, full])
}

/** True while the scroll box has more content below the fold (drives the 12 px fade). */
function useScrollMore(ref: RefObject<HTMLElement>, key: string | undefined): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6)
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
  return more
}

/**
 * Phones only (hidden on desktop by CSS): a 96×44 handle sharing the top row with "← chat". Drag up
 * to snap full height, down to go back to half (or close from half). A tap toggles.
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
        sheetDrag.active = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (y0.current !== null && Math.abs(e.clientY - y0.current) > 8) moved.current = true
      }}
      onPointerCancel={() => {
        y0.current = null
        sheetDrag.active = false
      }}
      onPointerUp={(e) => {
        sheetDrag.active = false
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

function NewTab() {
  return <span className="sr-only"> {content.site.newTab}</span>
}

/** Repo / Live: plain text links, 44 px tall, no arrow glyph; the new tab is announced, not drawn. */
function Links({ links }: { links: { label: string; url: string }[] }) {
  return (
    <span className="links">
      {links.map((l) => (
        <a key={l.url} className="lk" href={l.url} target="_blank" rel="noopener noreferrer">
          {l.label}
          <NewTab />
        </a>
      ))}
    </span>
  )
}

/** Deep-link highlight (v2.1 §3): brass bar, scrolled to the top of the sheet, focus on its heading. */
function useHighlight(id: string | undefined) {
  const el = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!id) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const h = el.current
        if (!h) return
        h.closest('li')?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        h.focus({ preventScroll: true })
      }),
    )
  }, [id])
  return el
}

export function StopBody({ stop, skill, project }: { stop: Stop; skill?: string; project?: string }) {
  const phone = useMedia(SHEET_QUERY)
  const body = stop.body.map((p, k) => (
    <p key={k} className="body">
      {text(p)}
    </p>
  ))
  switch (stop.kind) {
    case 'projects':
      return (
        <>
          {/* #62: one bio line (hidden on the phone half sheet, shown in the full sheet), then the rule and the list. */}
          <p className="bio">{phone ? content.about.short : stop.body.map(text).join(' ')}</p>
          <hr className="rule" />
          <Projects initial={project} />
        </>
      )
    case 'skills':
      return <Skills intro={body} skill={skill} />
    case 'garden': {
      const p = content.projects.find((x) => x.slug === stop.project)
      return (
        <>
          {body}
          {p && (
            <div className="meta">
              <span />
              <Links links={[{ label: 'Repo', url: p.repo }, ...(p.live ? [{ label: 'Live', url: p.live }] : [])]} />
            </div>
          )}
        </>
      )
    }
    case 'career':
      // Room for the CV PR: its experience block slots in between the list and the teaching line.
      return (
        <>
          {body}
          <ol className="career">
            {content.career.items.map((c, k) => (
              <li key={k}>{c}</li>
            ))}
          </ol>
          <p className="body teaching">{content.career.teaching}</p>
        </>
      )
    case 'contact': {
      const c = content.contact
      return (
        <>
          {body}
          <div className="contact-actions">
            <a className="btn-ink" href={c.linkedin.url} target="_blank" rel="noopener noreferrer">
              {c.linkedin.cta}
              <NewTab />
            </a>
            <a className="lk" href={c.github.url} target="_blank" rel="noopener noreferrer">
              {c.github.label} · {c.github.handle}
              <NewTab />
            </a>
            {c.email.enabled && c.email.address && (
              <a className="lk" href={`mailto:${c.email.address}`}>
                {c.email.label}
              </a>
            )}
          </div>
        </>
      )
    }
    default:
      return <>{body}</>
  }
}

function Skills({ intro, skill }: { intro: ReactNode; skill?: string }) {
  const f = content.skills.featured
  const all = [f, ...content.skills.items]
  const hl = useHighlight(skill)
  return (
    <>
      {intro}
      <ul className="plain skills">
        {all.map((s) => (
          <li key={s.id} className={skill === s.id ? 'hl' : undefined}>
            <h3 className="skill-name" tabIndex={-1} ref={skill === s.id ? hl : undefined}>
              {s.name}
            </h3>
            <p className="skill-line">{s.line}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function Projects({ initial }: { initial?: string }) {
  const list = content.projects
  const hit = list.some((p) => p.slug === initial) ? initial : undefined
  // The monitor's screen slot shows the deep-linked project (else the first one).
  useEffect(() => {
    setUI({ slotProject: hit ?? list[0].slug })
  }, [hit, list])
  const hl = useHighlight(hit)
  // Opened from the room's Projects label: land on the list, not the bio above it (Shuri #50). The
  // panel focuses itself on open, so take focus two frames later.
  const first = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!panelFocus.card) return
    panelFocus.card = false
    if (hit) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = first.current
        if (!el) return
        el.closest('li')?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        el.focus({ preventScroll: true })
      }),
    )
  }, [hit])
  return (
    <ul className="plain projects">
      {list.map((p, k) => (
        <li key={p.slug} id={`project-${p.slug}`} className={`proj${p.slug === hit ? ' hl' : ''}`}>
          <h3 tabIndex={-1} ref={p.slug === hit ? hl : k === 0 ? first : undefined}>
            {p.name}
          </h3>
          <p className="tagline">{p.tagline}</p>
          <p className="more">{[p.serious, p.joke].filter(Boolean).join(' ')}</p>
          <div className="meta">
            <span className="tags">{p.tags.join(' · ')}</span>
            <Links links={[{ label: 'Repo', url: p.repo }, ...(p.live ? [{ label: 'Live', url: p.live }] : [])]} />
          </div>
        </li>
      ))}
    </ul>
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
