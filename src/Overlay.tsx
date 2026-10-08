import { useEffect, useRef, useState, type RefObject } from 'react'
import { STOPS, STOP_IDS, content, contactLinks, noteById, text, type Stop } from './content'
import { activate, closePanel, freeRoam, openPanel, parseHash, startTour, step } from './nav'
import { getUI, setUI, useUI } from './store'
import { Loader, enter } from './Loader'
import { DuckDock, DuckLog } from './duck/DuckChat'
import { DuckToast, Hud, SecretsCard, Toast } from './Hud'
import { LIST_URL } from './links'
import { useTyping } from './keyboard'
import { gsap, prefersReducedMotion, useGSAP } from './gsap'
import { SHEET_QUERY, useMedia } from './useMedia'
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

/** DOM layer over the canvas: loader, cold open, panels, tour progress, finale, hint. */
export function Overlay() {
  useDeepLinks()
  useKeys()
  useTyping()
  return (
    <>
      <Loader />
      <ColdOpen />
      <Panel />
      <Progress />
      <Finale />
      <SecretsCard />
      <Hint />
      <DuckToast />
      <Toast />
      <Hud />
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
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === 'Escape') {
        if (s.open) closePanel()
        else if (s.finale === 'open') setUI({ finale: 'dismissed' })
        else if (s.intro) freeRoam()
      } else if (e.key === 'ArrowRight' && (s.open || s.intro)) {
        e.preventDefault()
        if (s.intro) startTour()
        else step(1)
      } else if (e.key === 'ArrowLeft' && s.open) {
        e.preventDefault()
        step(-1)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

function ColdOpen() {
  const show = useUI((s) => s.stage === 'ready' && s.entered && s.intro && !s.open)
  if (!show) return null
  return (
    <section className="cold-open" aria-label="Introduction">
      <h1>{content.site.name}</h1>
      <p className="cold-role">{content.site.role}</p>
      <p className="cold-about">{content.about.next}</p>
      <div className="cold-actions">
        <button type="button" className="btn primary" onClick={startTour} autoFocus>
          {content.tour.start} <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="btn" onClick={freeRoam}>
          {content.tour.explore}
        </button>
      </div>
      <a className="cold-list" href={LIST_URL}>
        {content.site.listLink}
      </a>
    </section>
  )
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
  const lastFocus = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      if (!lastFocus.current) lastFocus.current = document.activeElement
      ref.current?.focus({ preventScroll: true })
    } else if (lastFocus.current) {
      ;(lastFocus.current as HTMLElement).focus?.({ preventScroll: true })
      lastFocus.current = null
    }
    if (!open && getUI().sheetFull) setUI({ sheetFull: false })
  }, [open])
  if (!open) return null
  const stop = STOPS.find((s) => s.id === open.id)
  const note = stop ? undefined : noteById(open.id)
  if (!stop && !note) return null
  const i = stop ? STOP_IDS.indexOf(stop.id) : -1
  const isBonus = open.id.startsWith('bonus-')
  const isDuck = stop?.kind === 'duck' || note?.kind === 'duck'
  // Phones, once the duck has answered: the two intro paragraphs fold behind "What's this?" so
  // the answer and the "Scripted for now" line both fit in the (65%) sheet.
  const foldIntro = isDuck && phone && answered
  const jokeText = stop ? text(stop.joke) : note!.joke
  return (
    <>
      <div className="backdrop" onClick={closePanel} aria-hidden="true" />
      <aside
        className={`panel${isBonus ? ' bonus' : ''}${note?.kind ? ` ${note.kind}` : ''}${stop?.kind === 'duck' ? ' duck' : ''}${full ? ' full' : ''}`}
        role="dialog"
        aria-labelledby="panel-title"
        key={open.id}
        ref={panel}
      >
        <SheetHandle full={full} />
        <button type="button" className="panel-close" onClick={closePanel} aria-label={content.tour.close}>
          ×
        </button>
        <p className="panel-kicker">{stop ? stop.kicker : isBonus ? content.tour.foundIt : 'Aside'}</p>
        <h2 id="panel-title" tabIndex={-1} ref={ref}>
          {stop ? stop.title : note!.title}
        </h2>
        <div className={`panel-scroll${more ? ' more' : ''}${scrolled ? ' scrolled' : ''}`}>
          <div className="panel-body" ref={body}>
            {foldIntro && (
              <button type="button" className="intro-toggle" aria-expanded={introOpen} aria-controls="duck-intro" onClick={() => setIntroOpen(!introOpen)}>
                {introOpen ? content.duck.hideIntro : content.duck.whatsThis} <span aria-hidden="true">{introOpen ? '▴' : '▾'}</span>
              </button>
            )}
            {(!foldIntro || introOpen) && (
              <div id="duck-intro" className="panel-intro">
                {stop ? <StopBody stop={stop} skill={open.skill} project={open.project} /> : note!.body.map((p, k) => <p key={k}>{p}</p>)}
              </div>
            )}
            {jokeText && !foldIntro && <p className="joke">{jokeText}</p>}
            {isDuck && <DuckLog tail={foldIntro && jokeText ? <p className="joke duck-scripted">{jokeText}</p> : undefined} />}
          </div>
          {more && !nearCarousel(body.current) && (
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
        {isDuck && <DuckDock />}
        <nav className="panel-nav" aria-label="Tour">
          <button type="button" className="btn ghost" onClick={() => step(-1)} disabled={i === 0}>
            ← {content.tour.back}
          </button>
          <span className="panel-count">{i >= 0 ? `${i + 1} ${content.tour.of} ${STOP_IDS.length}` : ''}</span>
          <button type="button" className="btn primary" onClick={() => step(1)}>
            {i === STOP_IDS.length - 1 ? content.tour.skip : content.tour.next} →
          </button>
        </nav>
        {/* On the last stop "Free roam →" is already the primary button: no duplicate link. */}
        {i !== STOP_IDS.length - 1 && (
          <button type="button" className="panel-skip" onClick={closePanel}>
            {content.tour.skip}
          </button>
        )}
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
  const body = stop.body.map((p, k) => <p key={k}>{text(p)}</p>)
  switch (stop.kind) {
    case 'projects':
      return (
        <>
          {body}
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

function Progress() {
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const intro = useUI((s) => s.intro)
  const visited = useUI((s) => s.visited)
  const open = useUI((s) => s.open)
  const bonus = useUI((s) => s.bonusFound)
  const full = useUI((s) => s.sheetFull)
  if (!ready || intro) return null
  const duck = STOPS.find((s) => s.id === open?.id)?.kind === 'duck'
  return (
    <nav className={`progress${open ? ' with-panel' : ''}${open && full ? ' sheet-full' : ''}${duck ? ' duck-sheet' : ''}`} aria-label="Tour stops">
      {STOPS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`pdot${visited.includes(s.id) ? ' seen' : ''}${open?.id === s.id ? ' on' : ''}`}
          onClick={() => activate(s.id)}
          aria-label={`Stop ${s.n}: ${s.label}${visited.includes(s.id) ? ' (seen)' : ''}`}
          title={s.label}
        >
          {s.n}
        </button>
      ))}
      {/* The 7 dots are the tour. Bonus objects are extras: a ★ shows up only once one is found. */}
      {bonus.length > 0 && (
        <span className="pdot bonus seen" role="img" aria-label={`${content.tour.foundIt} (${bonus.length})`} title={content.tour.foundIt}>
          ★
        </span>
      )}
    </nav>
  )
}

function Finale() {
  const show = useUI((s) => s.finale === 'open' && !s.open)
  if (!show) return null
  return (
    <section className="finale" role="dialog" aria-labelledby="finale-title">
      <button type="button" className="panel-close" onClick={() => setUI({ finale: 'dismissed' })} aria-label={content.tour.close}>
        ×
      </button>
      <h2 id="finale-title">{content.finale.title}</h2>
      <p>{content.finale.body}</p>
      <Links links={contactLinks()} />
      <p className="joke">{content.finale.joke}</p>
    </section>
  )
}

function Hint() {
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const open = useUI((s) => s.open)
  // The caption is a first-impression line: it fades out after the first drag.
  const dragged = useUI((s) => s.dragged)
  if (!ready) return null
  return (
    <div className={`hint${open ? ' hidden-mobile with-panel' : ''}${dragged ? ' gone' : ''}`} aria-hidden={dragged || undefined}>
      <p className="hint-line">{content.site.coldOpen}</p>
      <p className="hint-sub">{isTouch() ? content.site.hintTouch : content.site.hintDesktop}</p>
    </div>
  )
}
