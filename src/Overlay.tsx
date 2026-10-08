import { useEffect, useRef, useState } from 'react'
import { STOPS, STOP_IDS, content, contactLinks, noteById, text, type Stop } from './content'
import { activate, closePanel, freeRoam, openPanel, parseHash, startTour, step } from './nav'
import { getUI, setUI, useUI } from './store'
import { Loader, enter } from './Loader'
import { DuckChat } from './duck/DuckChat'
import { DuckToast, Hud, SecretsCard, Toast } from './Hud'
import { LIST_URL } from './links'
import { useTyping } from './keyboard'
import { gsap, prefersReducedMotion, useGSAP } from './gsap'
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
  const ref = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  // Slide the panel in (side panel on desktop, bottom sheet on phones). Motion only, never opacity,
  // so the copy stays readable even if a slow GPU stalls the tween. Reduced motion: no tween.
  useGSAP(
    () => {
      const el = panel.current
      if (!el || prefersReducedMotion()) return
      const sheet = window.matchMedia?.('(max-width: 700px), (max-aspect-ratio: 4/5)').matches
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
  }, [open])
  if (!open) return null
  const stop = STOPS.find((s) => s.id === open.id)
  const note = stop ? undefined : noteById(open.id)
  if (!stop && !note) return null
  const i = stop ? STOP_IDS.indexOf(stop.id) : -1
  const isBonus = open.id.startsWith('bonus-')
  return (
    <>
      <div className="backdrop" onClick={closePanel} aria-hidden="true" />
      <aside className={`panel${isBonus ? ' bonus' : ''}${note?.kind ? ` ${note.kind}` : ''}`} role="dialog" aria-labelledby="panel-title" key={open.id} ref={panel}>
        <button type="button" className="panel-close" onClick={closePanel} aria-label={content.tour.close}>
          ×
        </button>
        <p className="panel-kicker">{stop ? stop.kicker : isBonus ? content.tour.foundIt : 'Aside'}</p>
        <h2 id="panel-title" tabIndex={-1} ref={ref}>
          {stop ? stop.title : note!.title}
        </h2>
        <div className="panel-body">
          {stop ? <StopBody stop={stop} skill={open.skill} project={open.project} /> : note!.body.map((p, k) => <p key={k}>{p}</p>)}
          {note?.kind === 'duck' && <DuckChat />}
          {(stop ? text(stop.joke) : note!.joke) && <p className="joke">{stop ? text(stop.joke) : note!.joke}</p>}
        </div>
        <nav className="panel-nav" aria-label="Tour">
          <button type="button" className="btn ghost" onClick={() => step(-1)} disabled={i === 0}>
            ← {content.tour.back}
          </button>
          <span className="panel-count">{i >= 0 ? `${i + 1} ${content.tour.of} ${STOP_IDS.length}` : ''}</span>
          <button type="button" className="btn primary" onClick={() => step(1)}>
            {i === STOP_IDS.length - 1 ? content.tour.skip : content.tour.next} →
          </button>
        </nav>
        <button type="button" className="panel-skip" onClick={closePanel}>
          {content.tour.skip}
        </button>
      </aside>
    </>
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
  if (!ready || intro) return null
  return (
    <nav className={`progress${open ? ' with-panel' : ''}`} aria-label="Tour stops">
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
      <span
        className={`pdot bonus${bonus.length ? ' seen' : ''}`}
        role="img"
        aria-label={bonus.length ? `${content.tour.foundIt} (${bonus.length})` : content.tour.bonusHint}
        title={bonus.length ? content.tour.foundIt : content.tour.bonusHint}
      >
        ★
      </span>
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
  if (!ready) return null
  return (
    <div className={`hint${open ? ' hidden-mobile with-panel' : ''}`}>
      <p className="hint-line">{content.site.coldOpen}</p>
      <p className="hint-sub">{isTouch() ? content.site.hintTouch : content.site.hintDesktop}</p>
    </div>
  )
}
