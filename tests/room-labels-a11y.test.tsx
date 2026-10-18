import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Labels.tsx pulls in the camera rig and room modules; the markup only needs the store and targets.
vi.mock('../src/CameraRig', () => ({ rigFlags: { flying: false } }))
vi.mock('../src/Room', () => ({ roomScene: null }))
vi.mock('../src/interact', () => ({ tapKey: () => {} }))
const { setUI } = await import('../src/store')
const { RoomLabels, LABELS } = await import('../src/Labels')

describe('Shuri #49: room labels stay out of the keyboard and screen-reader path', () => {
  const targets = new Map(LABELS.map((l) => [`k-${l.id}`, { key: `k-${l.id}`, id: l.id, def: { marker: true } }]))
  setUI({ stage: 'ready', entered: true, targets: targets as never })
  const html = renderToStaticMarkup(<RoomLabels />)
  it('the group is aria-hidden', () => {
    expect(html).toMatch(/^<div class="room-labels moving" aria-hidden="true">/)
  })
  it('every chip is tabIndex -1 (not a Tab stop)', () => {
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons.length).toBe(8)
    for (const b of buttons) expect(b).toContain('tabindex="-1"')
  })
})
