import { useEffect, useRef } from 'react'
import { content } from './content'
import { DUCK_ID, openPanel } from './nav'
import { getUI, setUI, useUI } from './store'
import { SHEET_QUERY, useMedia } from './useMedia'

/** `claude` in a line → inline code in Literata italic (Vision §4: not monospace). */
function Coded({ text }: { text: string }) {
  const bits = text.split(/`([^`]+)`/)
  return <>{bits.map((b, i) => (i % 2 ? <em key={i} className="guide-code">{b}</em> : b))}</>
}

/** Quiet brass check (Vision §4): empty slot until visited. Not accent, not green. */
function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="guide-tick" aria-label={on ? label : undefined} role={on ? 'img' : undefined}>
      {on && (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

/** Esc returns focus to whichever opener is on screen: What's here on desktop, ⋯ on phones (Hawkeye WARN-5). */
export function hudReturnTarget(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.hud-whats, .hud-more')].find((el) => el.getClientRects().length > 0)
}

export function openGuide(on = !getUI().guide) {
  setUI({ guide: on })
}

/**
 * "What's here" (Vision recruiter look §4, Loki §5): the eight labelled objects in label priority
 * order, each with its proof line and a quiet tick once opened, then "Also in the room". No count,
 * no score, no progress bar. Desktop: a popover under the HUD button. Phones: a half sheet.
 */
export function Guide() {
  const open = useUI((s) => s.guide)
  const visited = useUI((s) => s.visited)
  const asked = useUI((s) => s.duckLog.some((e) => !e.greet))
  const sculpture = useUI((s) => s.bonusFound.includes('bonus-sculpture'))
  const phone = useMedia(SHEET_QUERY)
  const box = useRef<HTMLDivElement>(null)
  const g = content.guide
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      openGuide(false)
      hudReturnTarget()?.focus({ preventScroll: true })
    }
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (box.current?.contains(t) || t.closest?.('.hud-whats')) return
      openGuide(false)
    }
    window.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', down, true)
    box.current?.querySelector<HTMLElement>('.guide-row')?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('pointerdown', down, true)
    }
  }, [open])
  if (!open) return null
  const go = (id: string) => {
    openGuide(false)
    openPanel({ id })
  }
  return (
    <>
    {phone && <div className="guide-dim" aria-hidden="true" />}
    <div ref={box} className={`guide ${phone ? 'sheet' : 'pop'}`} role="dialog" aria-label={g.title}>
      <h2 className="guide-title">{g.title}</h2>
      {phone && (
        <button type="button" className="guide-close" onClick={() => openGuide(false)} aria-label={g.close}>
          <span aria-hidden="true">×</span>
        </button>
      )}
      <ul className="guide-rows">
        {g.rows.map((r) => {
          const done = r.id === DUCK_ID ? asked || visited.includes(DUCK_ID) : visited.includes(r.id)
          return (
            <li key={r.id}>
              <button type="button" className="guide-row" onClick={() => go(r.id)}>
                <span className="guide-text">
                  <span className="guide-label">{r.label}</span>
                  <span className="guide-proof">{r.proof}</span>
                </span>
                <Tick on={done} label={g.visited} />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="guide-also">
        <p className="guide-also-label">{g.also}</p>
        <ul>
          {g.alsoItems.map((t) => (
            <li key={t}>
              <Coded text={t} />
            </li>
          ))}
          {/* The sculpture bonus: a quiet tick only (Fury #8), and only once found, so it never reads as a to-do. */}
          {sculpture && (
            <li className="guide-bonus">
              <span>{g.sculpture}</span>
              <Tick on label={g.visited} />
            </li>
          )}
        </ul>
      </div>
    </div>
    </>
  )
}
