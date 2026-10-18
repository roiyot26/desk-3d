import { BONUS_IDS, STOPS, STOP_IDS, content } from './content'
import { setUI, type Open } from './store'

// Panel navigation and deep links (no tour: free roam, the duck leads). stop-1..6 are stations,
// stop-7 is the duck (opens the chat column / sheet); bonus and aside panels are extras. Hashes: #stop-1..#stop-7, plus aliases from
// content.json (#projects #3d #goal #skills #stack #garden #career #contact #duck) and
// #project-<slug> / #skill-<id> for a specific card.

export function parseHash(hash: string): Open {
  const h = decodeURIComponent(hash.replace(/^#\/?/, '')).toLowerCase()
  if (!h) return null
  if (STOP_IDS.includes(h)) return { id: h }
  const stop = STOPS.find((s) => s.aliases.includes(h))
  if (stop) return { id: stop.id }
  const p = h.match(/^project-(.+)$/)
  if (p && content.projects.some((x) => x.slug === p[1])) return { id: 'stop-1', project: p[1] }
  const sk = h.match(/^skill-(.+)$/)
  if (sk) return { id: 'stop-3', skill: sk[1] }
  return null
}

function hashFor(o: Open): string {
  if (!o) return ''
  if (o.id === 'stop-1' && o.project) return `#project-${o.project}`
  if (STOP_IDS.includes(o.id)) return `#${o.id}`
  return ''
}

function writeHash(o: Open) {
  const h = hashFor(o)
  const url = window.location.pathname + window.location.search + h
  if (url !== window.location.pathname + window.location.search + window.location.hash) {
    history.replaceState(null, '', url)
  }
}

/** The duck is not a panel any more: its station (and #stop-7 / #duck) opens the chat. */
export const DUCK_ID = 'stop-7'
const ASIDE_IDS = content.asides.map((a) => a.id)

export function openChat() {
  setUI((s) => ({
    chatOpen: true,
    chatUnread: false,
    sheet: s.sheet === 'peek' ? 'half' : s.sheet,
    open: null,
    visited: s.visited.includes(DUCK_ID) ? s.visited : [...s.visited, DUCK_ID],
  }))
}

export function openPanel(o: NonNullable<Open>, opts: { writeHash?: boolean } = {}) {
  if (o.id === DUCK_ID) {
    openChat()
    return
  }
  setUI((s) => ({
    open: o,
    intro: false,
    hovered: null,
    hoverTouch: false,
    // Phones: flying to a station drops the chat sheet to peek so the station stays in view.
    sheet: 'peek',
    // Stations and asides (the sticky note) get the quiet tick in What's here.
    visited: (STOP_IDS.includes(o.id) || ASIDE_IDS.includes(o.id)) && !s.visited.includes(o.id) ? [...s.visited, o.id] : s.visited,
    bonusFound: BONUS_IDS.includes(o.id) && !s.bonusFound.includes(o.id) ? [...s.bonusFound, o.id] : s.bonusFound,
  }))
  if (opts.writeHash !== false) writeHash(o)
}

/** Close the panel and return to free roam. */
export function closePanel() {
  setUI({ open: null, intro: false })
  writeHash(null)
}

export function activate(id: string, extra: Partial<NonNullable<Open>> = {}) {
  openPanel({ id, ...extra })
}
