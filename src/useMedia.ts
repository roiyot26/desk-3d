import { useSyncExternalStore } from 'react'

/** Same breakpoint as the CSS bottom-sheet layout (index.css). */
export const SHEET_QUERY = '(max-width: 700px), (max-aspect-ratio: 4/5)'
/** The duck panel is a bottom sheet (not a docked column) under this query. */
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
