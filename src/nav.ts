import { BONUS_IDS, STOPS, STOP_IDS, content } from './content'
import { getUI, setUI, type Open } from './store'

// Panel / tour navigation and deep links. Stops are the six tour beats; bonus and aside panels are
// extra (bonus ones light the 7th "found it" dot). Hashes: #stop-1..#stop-6, plus aliases from
// content.json (#projects #3d #goal #skills #stack #garden #career #contact) and
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

export function openPanel(o: NonNullable<Open>, opts: { writeHash?: boolean } = {}) {
  setUI((s) => ({
    open: o,
    intro: false,
    hovered: null,
    hoverTouch: false,
    visited: STOP_IDS.includes(o.id) && !s.visited.includes(o.id) ? [...s.visited, o.id] : s.visited,
    bonusFound: BONUS_IDS.includes(o.id) && !s.bonusFound.includes(o.id) ? [...s.bonusFound, o.id] : s.bonusFound,
  }))
  if (opts.writeHash !== false) writeHash(o)
}

/** Close the panel and return to free roam. Shows the finale card once all six stops are seen. */
export function closePanel() {
  const s = getUI()
  setUI({
    open: null,
    intro: false,
    finale: s.finale === 'hidden' && s.visited.length >= STOP_IDS.length ? 'open' : s.finale,
  })
  writeHash(null)
}

export function startTour() {
  openPanel({ id: 'stop-1' })
}

export function freeRoam() {
  setUI({ intro: false })
  closePanel()
}

function stopIndex(id: string | undefined) {
  return id ? STOP_IDS.indexOf(id) : -1
}

export function step(dir: 1 | -1) {
  const s = getUI()
  const i = stopIndex(s.open?.id)
  if (i < 0) {
    // From a bonus / aside / free roam: jump to the first unseen stop (or stop 1).
    const next = STOP_IDS.find((id) => !s.visited.includes(id)) ?? STOP_IDS[0]
    openPanel({ id: dir === 1 ? next : STOP_IDS[STOP_IDS.length - 1] })
    return
  }
  const j = i + dir
  if (j >= STOP_IDS.length) closePanel()
  else if (j >= 0) openPanel({ id: STOP_IDS[j] })
}

export function activate(id: string, extra: Partial<NonNullable<Open>> = {}) {
  openPanel({ id, ...extra })
}
