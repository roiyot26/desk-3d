/**
 * Phone station sheet caps (Vision v2.3.1, luminance ruling (a)). The half sheet hugs its content
 * up to the CSS default cap (index.css: `max-height: var(--sheet-cap, 400px)`). A station whose
 * capped station-open frame measured over the 0.46 mean-luminance limit gets a lower cap, found in
 * 8 px steps from the default with a 360 px floor (box measurements, metrics.json `caps`).
 * Keys are the phone width bucket: '360' for viewports under 375 px wide, '390' otherwise.
 */
export const CAP_STEP = 8
export const CAP_FLOOR = 360
export const SHEET_CAPS: Record<string, Partial<Record<'390' | '360', number>>> = {
  'stop-2': { '360': 376 },
  'stop-5': { '390': 376, '360': 376 },
}

export function widthBucket(w: number): '390' | '360' {
  return w < 375 ? '360' : '390'
}

/** The station's cap in px for this viewport width, or undefined for the CSS default. */
export function sheetCap(id: string, w: number): number | undefined {
  return SHEET_CAPS[id]?.[widthBucket(w)]
}
