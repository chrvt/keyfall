import * as ToneMidi from '@tonejs/midi'
import type { Hand, Note, Song } from './types.ts'
import { buildMeasures, finalizeSong } from './types.ts'
import { fixHands } from './hands.ts'

// works both as a bundled ES module and as CommonJS under Node
const Midi: typeof ToneMidi.Midi = (ToneMidi as any).Midi ?? (ToneMidi as any).default.Midi

const MAJOR_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
}

export interface MidiOpts {
  id: string
  title: string
  composer?: string
  pickup?: number
  bpm?: number
  fifths?: number
  /** split pitch used when the file has a single track */
  split?: number
  /** set to false to keep the hands exactly as the file's tracks (or the split) give them */
  fixHands?: boolean
}

export function parseMidi(data: ArrayBuffer | Uint8Array, opts: MidiOpts): Song {
  const midi = new Midi(data as ArrayBuffer)
  const ppq = midi.header.ppq || 480
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && t.channel !== 9)
  if (!tracks.length) throw new Error('This MIDI file contains no notes.')

  const avg = (t: (typeof tracks)[number]) => t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length
  const handOf = new Map<(typeof tracks)[number], Hand | null>()
  if (tracks.length === 1) {
    handOf.set(tracks[0], null)
  } else {
    const sorted = [...tracks].sort((a, b) => avg(b) - avg(a))
    const half = Math.ceil(sorted.length / 2)
    sorted.forEach((t, i) => handOf.set(t, i < half ? 'R' : 'L'))
  }
  const split = opts.split ?? 60
  const notes: Note[] = []
  for (const t of tracks) {
    const h = handOf.get(t)
    for (const n of t.notes) {
      notes.push({
        id: 0,
        midi: n.midi,
        beat: n.ticks / ppq,
        dur: Math.max(n.durationTicks / ppq, 0.05),
        hand: h ?? (n.midi >= split ? 'R' : 'L'),
        vel: n.velocity || 0.7,
        measure: 0,
      })
    }
  }
  // snap tiny offsets (humanised files) to a fine grid so chords line up
  for (const n of notes) n.beat = Math.round(n.beat * 96) / 96
  if (opts.fixHands !== false) fixHands(notes)

  const sigs = midi.header.timeSignatures.map((t) => ({
    beat: t.ticks / ppq,
    num: t.timeSignature[0],
    den: t.timeSignature[1],
  }))
  const total = Math.max(...notes.map((n) => n.beat + n.dur))
  const ks = midi.header.keySignatures[0]
  const fifths = opts.fifths ?? (ks ? (MAJOR_FIFTHS[ks.key] ?? 0) : 0)
  const bpm = opts.bpm ?? Math.round(midi.header.tempos[0]?.bpm ?? 100)
  return finalizeSong({
    id: opts.id,
    title: opts.title || midi.name || 'Untitled',
    composer: opts.composer ?? '',
    bpm: Math.max(20, Math.min(300, bpm)),
    fifths,
    notes,
    measures: buildMeasures(total, sigs, opts.pickup ?? 0),
    source: 'upload',
  })
}
