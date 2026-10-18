import { useSyncExternalStore } from 'react'

/** Same breakpoint as the CSS bottom-sheet layout (index.css). */
export const SHEET_QUERY = '(max-width: 700px), (max-aspect-ratio: 4/5)'
/** The duck panel is a bottom sheet (not a docked column) under this query. */
/** The HUD folds into ⋯ under 430px (index.css uses the same 429.98px bound). */
export const HUD_FOLD_QUERY = '(max-width: 429.98px)'
export const CHAT_SHEET_QUERY = '(max-width: 899px), (orientation: portrait)'

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia?.(query)
      m?.addEventListener('change', cb)
      return () => m?.removeEventListener('change', cb)
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  )
}
