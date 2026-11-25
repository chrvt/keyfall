export type Hand = 'L' | 'R'

export interface Note {
  id: number
  midi: number
  /** onset in quarter-note beats from the start of the song */
  beat: number
  /** duration in quarter-note beats */
  dur: number
  hand: Hand
  vel: number
  /** index into song.measures */
  measure: number
}

export interface Measure {
  index: number
  beat: number
  len: number
  num: number
  den: number
}

export interface Song {
  id: string
  title: string
  composer: string
  bpm: number
  fifths: number
  notes: Note[]
  measures: Measure[]
  totalBeats: number
  source: 'builtin' | 'upload' | 'folder'
  /** original MusicXML (if the song came from one) – used for the sheet view */
  xml?: string
  difficulty?: number
  blurb?: string
  credit?: string
  addedAt?: number
  /** pieces that belong to a course rather than the main library */
  tag?: 'jazz'
}

export interface SongMeta {
  id: string
  title: string
  composer: string
  difficulty: number
  blurb?: string
  source: 'builtin' | 'upload' | 'folder'
  durationSec?: number
  measures?: number
}

const NAMES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

export function noteName(midi: number, fifths = 0, withOctave = false): string {
  const pc = ((midi % 12) + 12) % 12
  const n = (fifths < 0 ? NAMES_FLAT : NAMES_SHARP)[pc]
  return withOctave ? n + (Math.floor(midi / 12) - 1) : n
}

export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)

/** Build measures + assign measure index to notes. `sigs` = time signature changes at beats. */
export function buildMeasures(
  totalBeats: number,
  sigs: { beat: number; num: number; den: number }[],
  pickup = 0,
): Measure[] {
  const out: Measure[] = []
  const s = sigs.length ? [...sigs].sort((a, b) => a.beat - b.beat) : [{ beat: 0, num: 4, den: 4 }]
  let beat = 0
  let si = 0
  if (pickup > 0) {
    out.push({ index: 0, beat: 0, len: pickup, num: s[0].num, den: s[0].den })
    beat = pickup
  }
  let guard = 0
  while (beat < totalBeats - 1e-6 && guard++ < 5000) {
    while (si + 1 < s.length && s[si + 1].beat <= beat + 1e-6) si++
    const len = (s[si].num * 4) / s[si].den
    out.push({ index: out.length, beat, len, num: s[si].num, den: s[si].den })
    beat += len
  }
  if (!out.length) out.push({ index: 0, beat: 0, len: 4, num: 4, den: 4 })
  return out
}

export function measureAt(measures: Measure[], beat: number): number {
  let lo = 0
  let hi = measures.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measures[mid].beat <= beat + 1e-6) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function finalizeSong(song: Omit<Song, 'totalBeats'> & { totalBeats?: number }): Song {
  const notes = song.notes
    .filter((n) => n.dur > 0 && n.midi >= 21 && n.midi <= 108)
    .sort((a, b) => a.beat - b.beat || a.midi - b.midi)
  const last = song.measures[song.measures.length - 1]
  const totalBeats = Math.max(last.beat + last.len, ...notes.slice(-40).map((n) => n.beat + n.dur))
  notes.forEach((n, i) => {
    n.id = i
    n.measure = measureAt(song.measures, n.beat)
  })
  return { ...song, notes, totalBeats }
}

export function songDurationSec(song: Song) {
  return (song.totalBeats * 60) / song.bpm
}

/** crude 1-5 difficulty estimate */
export function estimateDifficulty(song: Song): number {
  if (!song.notes.length) return 1
  const sec = songDurationSec(song)
  const nps = song.notes.length / Math.max(sec, 1)
  const pitches = song.notes.map((n) => n.midi)
  const range = Math.max(...pitches) - Math.min(...pitches)
  const blacks = song.notes.filter((n) => isBlack(n.midi)).length / song.notes.length
  const score = nps * 0.55 + range / 30 + blacks * 2 + Math.min(sec / 120, 1.5)
  return Math.max(1, Math.min(5, Math.round(score - 1.2)))
}
