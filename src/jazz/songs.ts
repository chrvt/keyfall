import type { Song } from '../music/types.ts'
import { songFromDsl } from '../music/dsl.ts'

/** left-hand shells (root + 7th) as notation */
const SH: Record<string, string> = { C7: 'C3+Bb3', F7: 'F2+Eb3', G7: 'G2+F3', Dm7: 'D2+C3', Cmaj7: 'C3+B3' }
const shells = (bars: string[], rhythm = (s: string) => `${s}:4`) => bars.map((b) => rhythm(SH[b])).join(' | ')

const BLUES = ['C7', 'F7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'G7']
const BLUES_BASIC = ['C7', 'C7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'C7']

/** two-bar blues licks (swung eighths written as ⅔ + ⅓ of a beat) – written for this course */
export const LICKS = [
  'r:1 C5:.67 Bb4:.33 G4:.67 F4:.33 Eb4:.67 C4:.33 | C4:2 r:2',
  'Eb4:.67 F4:.33 F#4:.67 G4:.33 Bb4:1 G4:1 | C5:2 r:2',
  'G4:.67 Bb4:.33 C5:1 r:.67 Bb4:.33 G4:.67 F4:.33 | Eb4:.67 C4:.33 C4:1 r:2',
  'C5:1 C5:.67 Bb4:.33 C5:1 Eb5:1 | C5:.67 Bb4:.33 G4:1 r:2',
]
/** easier call-and-response phrases for the very first echo game */
export const EASY_CALLS = [
  'C4:1 Eb4:1 F4:2 | r:4',
  'F4:1 Eb4:1 C4:2 | r:4',
  'C4:.67 C4:.33 Eb4:1 F4:1 G4:1 | r:4',
  'G4:1 F4:.67 Eb4:.33 C4:2 | r:4',
  'C5:1 Bb4:1 G4:.67 F4:.33 G4:1 | r:4',
]

export function phraseNotes(dsl: string) {
  return songFromDsl({ id: 'x', title: '', composer: '', bpm: 100, num: 4, den: 4, right: dsl, left: 'r:4' }).notes
    .filter((n) => n.hand === 'R')
    .map((n) => ({ beat: n.beat, dur: n.dur, midi: n.midi }))
}

export function jazzSongs(): Song[] {
  const mk = (id: string, title: string, bpm: number, right: string, left: string, blurb: string, difficulty = 2): Song => {
    const s = songFromDsl({ id, title, composer: 'Keyfall Jazz Lab', bpm, num: 4, den: 4, right, left })
    return { ...s, tag: 'jazz', blurb, difficulty }
  }
  const riff = 'C4:.67 Eb4:.33 F4:.67 F#4:.33 G4:1 r:1'
  const head = [
    riff, 'Bb4:.67 G4:.33 C5:2 r:1', riff, 'Bb4:.67 G4:.33 Eb4:2 r:1',
    riff, 'Bb4:.67 G4:.33 C5:2 r:1', riff, 'Bb4:.67 G4:.33 Eb4:.67 C4:.33 C4:1 r:1',
    'G4:1 B4:.67 D5:.33 F5:1 D5:1', 'Eb5:1 C5:.67 A4:.33 F4:1 r:1',
    'C4:.67 Eb4:.33 F4:.67 F#4:.33 G4:.67 Bb4:.33 C5:1', 'C5:1 r:3',
  ].join(' | ')
  return [
    mk('jazz-blues-scale', 'The C blues scale', 84,
      'C4:.5 Eb4:.5 F4:.5 F#4:.5 G4:.5 Bb4:.5 C5:1 | C5:.5 Bb4:.5 G4:.5 F#4:.5 F4:.5 Eb4:.5 C4:1 | C4:.67 Eb4:.33 F4:.67 F#4:.33 G4:.67 Bb4:.33 C5:1 | C5:.67 Bb4:.33 G4:.67 F#4:.33 F4:.67 Eb4:.33 C4:1',
      shells(['C7', 'C7', 'C7', 'C7']), 'Six notes that always sound like the blues – straight, then swung.', 1),
    mk('jazz-licks', 'Four blues licks', 92, LICKS.join(' | '), shells(['C7', 'C7', 'C7', 'C7', 'C7', 'C7', 'C7', 'C7']),
      'Vocabulary to steal. Loop two bars at a time.'),
    mk('jazz-shells', 'Shell voicings through the blues', 96, Array(12).fill('r:4').join(' | '), shells(BLUES),
      'Left hand only: root + 7th for each chord of the 12-bar blues.', 1),
    mk('jazz-shells-charleston', 'Shells with the Charleston rhythm', 96, Array(12).fill('r:4').join(' | '),
      shells(BLUES, (s) => `${s}:1.67 ${s}:1 r:1.33`), 'The same shells, now on “one … and-of-two” – the classic comping rhythm.'),
    mk('jazz-guide-tones', 'Guide-tone lines', 96,
      'E4:4 | Eb4:4 | E4:4 | E4:4 | Eb4:4 | Eb4:4 | E4:4 | E4:4 | F4:4 | Eb4:4 | E4:4 | F4:4 | Bb4:4 | A4:4 | Bb4:4 | Bb4:4 | A4:4 | A4:4 | Bb4:4 | Bb4:4 | B4:4 | A4:4 | Bb4:4 | B4:4',
      shells([...BLUES, ...BLUES]), '3rds and 7ths: the two notes that spell out each chord. Notice they only ever move by a step.'),
    mk('jazz-approach', 'Approach notes', 88,
      'Eb4:.5 E4:1.5 F#4:.5 G4:1.5 | A4:.5 Bb4:1.5 B4:.5 C5:1.5 | G#4:.5 A4:1.5 B4:.5 C5:1.5 | D5:.5 Eb5:1.5 E5:.5 F5:1.5',
      shells(['C7', 'C7', 'F7', 'F7']), 'Slide into each chord tone from a half-step below.'),
    mk('jazz-two-five-one', 'A ii – V – I line', 96,
      'D4:.67 F4:.33 A4:.67 C5:.33 E5:.67 D5:.33 C5:.67 A4:.33 | B4:.67 D5:.33 F5:.67 D5:.33 B4:.67 A4:.33 G4:.67 F4:.33 | E4:2 G4:1 E4:1 | C4:4 | D4:.67 F4:.33 A4:.67 C5:.33 E5:.67 D5:.33 C5:.67 A4:.33 | B4:.67 D5:.33 F5:.67 D5:.33 B4:.67 A4:.33 G4:.67 F4:.33 | E4:2 G4:1 E4:1 | C4:4',
      shells(['Dm7', 'G7', 'Cmaj7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7', 'Cmaj7']), 'Arpeggio up, scale down, land on the 3rd – the most common sentence in jazz.', 3),
    mk('jazz-keyfall-blues', 'Keyfall Blues (head)', 104, head, shells(BLUES_BASIC),
      'A riff blues written for this course. Learn the tune, then solo over it.'),
  ]
}
