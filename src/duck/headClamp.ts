/**
 * Panel v2.3 #67: the desktop chat note shows the duck's last message clamped from the START, so
 * the closing question survives. Whole trailing sentences that fit (prefixed "…"); if even the last
 * sentence doesn't fit, its start is cut at a word boundary. `fits` measures a candidate (the note
 * uses a hidden clone at the button's width, two lines of Literata 17/1.55).
 * Sentences end at . ! ? … (plus closing quotes/brackets) followed by whitespace, so a URL such as
 * linkedin.com/in/… is never split, and every candidate is an exact tail of the original text.
 */
const END = /[.!?…]+["'”’)\]]*\s+/g

/** Start offsets of each sentence after the first. */
function starts(t: string): number[] {
  const out: number[] = []
  for (const m of t.matchAll(END)) {
    const at = m.index! + m[0].length
    if (at < t.length) out.push(at)
  }
  return out
}

export function sentences(text: string): string[] {
  const t = text.trim().replace(/\s+/g, ' ')
  const cut = [0, ...starts(t), t.length]
  return cut.slice(0, -1).map((a, i) => t.slice(a, cut[i + 1]).trim()).filter(Boolean)
}

export function headClamp(text: string, fits: (candidate: string) => boolean): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t || fits(t)) return t
  const s = starts(t)
  let best = ''
  for (let i = s.length - 1; i >= 0; i--) {
    const cand = `…${t.slice(s[i])}`
    if (!fits(cand)) break
    best = cand
  }
  if (best) return best
  const last = t.slice(s.length ? s[s.length - 1] : 0)
  const words = last.split(' ')
  for (let i = 1; i < words.length; i++) {
    const cand = `…${words.slice(i).join(' ')}`
    if (fits(cand)) return cand
  }
  return `…${words[words.length - 1]}`
}
