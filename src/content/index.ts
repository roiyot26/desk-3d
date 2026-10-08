import raw from './content.json'

export type Link = { label: string; url: string }
export type Project = {
  slug: string
  name: string
  tagline: string
  serious: string
  joke: string
  tags: string[]
  repo: string
  live?: string
}
export type Skill = { id: string; book: string; name: string; line: string }
export type Stop = {
  id: string
  n: number
  aliases: string[]
  label: string
  kicker: string
  title: string
  kind: 'projects' | 'pitch' | 'skills' | 'garden' | 'career' | 'contact' | 'duck'
  project?: string
  body: string[]
  joke: string
}
export type Note = {
  id: string
  label: string
  title: string
  body: string[]
  joke: string
  kind?: 'duck'
}
export type DuckTool = { name: string; args: string[]; sources?: string[] }
export type DuckIntent = { id: string; chip: string; keywords: string[]; reply: string; tools: DuckTool[] }

export const content = raw as unknown as {
  site: Record<string, string>
  tour: Record<string, string>
  contact: {
    github: Link & { handle: string }
    linkedin: Link & { handle: string }
    email: { enabled: boolean; label: string; address: string }
  }
  about: { lead: string; ai: string; next: string }
  projects: Project[]
  skills: { intro: string; featured: Skill; items: Skill[]; joke: string }
  career: { items: string[]; teaching: string }
  stops: Stop[]
  bonus: Note[]
  asides: Note[]
  finale: { title: string; body: string; joke: string }
  loader: { title: string; lines: { at: number; text: string; live?: boolean }[]; ready: string }
  audio: Record<string, string>
  labels: Record<string, string>
  toasts: Record<string, string>
  secrets: { label: string; found: string; hidden: string; items: { id: string; label: string }[]; doneTitle: string; doneBody: string; doneJoke: string }
  duck: {
    placeholder: string
    send: string
    thinking: string
    back: string
    fallback: { reply: string; steps: string[] }
    intents: DuckIntent[]
  }
}

/** "@about.lead" style references point at another field, so copy lives in one place. */
export function text(s: string): string {
  if (!s.startsWith('@')) return s
  let v: unknown = content
  for (const k of s.slice(1).split('.')) v = (v as Record<string, unknown>)?.[k]
  return typeof v === 'string' ? v : ''
}

export const STOPS = content.stops
export const STOP_IDS = STOPS.map((s) => s.id)
export const BONUS_IDS = content.bonus.map((b) => b.id)

export function contactLinks(): Link[] {
  const c = content.contact
  const out: Link[] = [c.github, c.linkedin]
  if (c.email.enabled && c.email.address) out.push({ label: c.email.label, url: `mailto:${c.email.address}` })
  return out
}

export function noteById(id: string): Note | undefined {
  return content.bonus.find((b) => b.id === id) ?? content.asides.find((a) => a.id === id)
}

export function labelFor(id: string): string {
  return STOPS.find((s) => s.id === id)?.label ?? noteById(id)?.label ?? content.labels[id] ?? id
}
