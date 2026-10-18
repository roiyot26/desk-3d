/**
 * Panel v2.3 #67: the desktop chat note shows the duck's last message clamped from the START, so
 * the closing question survives. Whole trailing sentences that fit (prefixed "…"); if even the last
 * sentence doesn't fit, its start is cut at a word boundary. `fits` measures a candidate (the note
 * uses a hidden clone at the button's width, two lines of Literata 17/1.55).
 */
export function sentences(text: string): string[] {
  const out = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [text]
  return out.map((s) => s.trim()).filter(Boolean)
}

export function headClamp(text: string, fits: (candidate: string) => boolean): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t || fits(t)) return t
  const ss = sentences(t)
  let best = ''
  for (let i = ss.length - 1; i >= 1; i--) {
    const cand = `…${ss.slice(i).join(' ')}`
    if (!fits(cand)) break
    best = cand
  }
  if (best) return best
  const words = ss[ss.length - 1].split(' ')
  for (let i = 1; i < words.length; i++) {
    const cand = `…${words.slice(i).join(' ')}`
    if (fits(cand)) return cand
  }
  return `…${words[words.length - 1]}`
}
