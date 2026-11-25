/** Web MIDI + computer-keyboard note input. */
export interface NoteSink {
  on(midi: number, vel: number): void
  off(midi: number): void
}

const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
}
export const KEY_LABELS: Record<number, string> = {
  0: 'A', 1: 'W', 2: 'S', 3: 'E', 4: 'D', 5: 'F', 6: 'T', 7: 'G', 8: 'Y', 9: 'H', 10: 'U', 11: 'J',
  12: 'K', 13: 'O', 14: 'L', 15: 'P', 16: ';', 17: "'",
}

export function attachKeyboard(sink: NoteSink, getOctave: () => number, shiftOctave: (d: number) => void) {
  const held = new Map<string, number>()
  const down = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
    if (e.code === 'KeyZ') return shiftOctave(-1)
    if (e.code === 'KeyX') return shiftOctave(1)
    const off = KEYMAP[e.code]
    if (off === undefined || held.has(e.code)) return
    const midi = (getOctave() + 1) * 12 + off
    held.set(e.code, midi)
    sink.on(midi, 0.75)
  }
  const up = (e: KeyboardEvent) => {
    const midi = held.get(e.code)
    if (midi === undefined) return
    held.delete(e.code)
    sink.off(midi)
  }
  const blur = () => {
    for (const m of held.values()) sink.off(m)
    held.clear()
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  return () => {
    blur()
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
  }
}

export function attachMidi(sink: NoteSink, onDevices: (names: string[]) => void) {
  let access: MIDIAccess | null = null
  let disposed = false
  const handler = (e: MIDIMessageEvent) => {
    const d = e.data
    if (!d || d.length < 3) return
    const cmd = d[0] & 0xf0
    if (cmd === 0x90 && d[2] > 0) sink.on(d[1], Math.max(0.25, d[2] / 127))
    else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) sink.off(d[1])
  }
  const refresh = () => {
    if (!access) return
    const names: string[] = []
    access.inputs.forEach((input) => {
      input.onmidimessage = handler
      if (input.state !== 'disconnected') names.push(input.name ?? 'MIDI device')
    })
    onDevices(names)
  }
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(
      (a) => {
        if (disposed) return
        access = a
        a.onstatechange = refresh
        refresh()
      },
      () => onDevices([]),
    )
  }
  return () => {
    disposed = true
    if (access) {
      access.onstatechange = null
      access.inputs.forEach((i) => (i.onmidimessage = null))
    }
  }
}
