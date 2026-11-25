import type { Note, Song } from './types.ts'
import { buildMeasures, finalizeSong } from './types.ts'

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function pitchToMidi(p: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(p.trim())
  if (!m) throw new Error('bad pitch ' + p)
  return STEP[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3]) + 1) * 12
}

/**
 * Tiny notation: tokens separated by whitespace, `|` is ignored (visual bar line).
 * `C4:1` note of one beat, `C3+G3:2` chord, `r:1` rest. Duration defaults to 1.
 */
function parseVoice(src: string, hand: 'L' | 'R', out: Note[]) {
  let beat = 0
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue
    const [p, d] = tok.split(':')
    const dur = d ? parseFloat(d) : 1
    if (p !== 'r') {
      for (const one of p.split('+')) {
        out.push({ id: 0, midi: pitchToMidi(one), beat, dur: dur * 0.96, hand, vel: hand === 'R' ? 0.75 : 0.6, measure: 0 })
      }
    }
    beat += dur
  }
  return beat
}

export function songFromDsl(def: {
  id: string; title: string; composer: string; bpm: number; fifths?: number
  num: number; den: number; right: string; left: string
}): Song {
  const notes: Note[] = []
  const a = parseVoice(def.right, 'R', notes)
  const b = parseVoice(def.left, 'L', notes)
  return finalizeSong({
    id: def.id, title: def.title, composer: def.composer, bpm: def.bpm, fifths: def.fifths ?? 0,
    notes, measures: buildMeasures(Math.max(a, b), [{ beat: 0, num: def.num, den: def.den }]),
    source: 'builtin',
  })
}
