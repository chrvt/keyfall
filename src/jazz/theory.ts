/** Just enough jazz harmony for the Jazz Lab: chords, scales, voicings and forms. */

export const PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const ROOTS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export interface Chord {
  symbol: string
  root: number
  /** semitones above the root: root, 3rd, 5th, 7th */
  tones: number[]
  third: number
  seventh: number
}

const QUALITIES: Record<string, number[]> = {
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  m7b5: [0, 3, 6, 10],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  dim7: [0, 3, 6, 9],
}

export function chord(symbol: string): Chord {
  const m = /^([A-G])([b#♭♯]?)(.*)$/.exec(symbol)
  if (!m) throw new Error('bad chord ' + symbol)
  const root = (ROOTS[m[1]] + (m[2] === 'b' || m[2] === '♭' ? 11 : m[2] ? 1 : 0)) % 12
  const tones = QUALITIES[m[3]]
  if (!tones) throw new Error('unknown chord quality ' + symbol)
  return { symbol: symbol.replace('b5', '♭5').replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯'), root, tones, third: tones[1], seventh: tones[3] }
}

export const chordPcs = (c: Chord) => c.tones.map((t) => (c.root + t) % 12)
export const guidePcs = (c: Chord) => [(c.root + c.third) % 12, (c.root + c.seventh) % 12]

export const SCALES: Record<string, { name: string; steps: number[] }> = {
  blues: { name: 'blues scale', steps: [0, 3, 5, 6, 7, 10] },
  minorPent: { name: 'minor pentatonic', steps: [0, 3, 5, 7, 10] },
  majorPent: { name: 'major pentatonic', steps: [0, 2, 4, 7, 9] },
  major: { name: 'major scale', steps: [0, 2, 4, 5, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
}
export const scalePcs = (root: number, scale: string) => SCALES[scale].steps.map((s) => (root + s) % 12)

/** left-hand shell: root + 7th (wide, easy to grab), kept below middle C */
export function shell(c: Chord): number[] {
  let r = 48 + c.root // C3 … B3
  if (r > 49) r -= 12 // keep the pair low enough to stay out of the right hand's way
  return [r, r + c.seventh]
}

/** comping voicing for the band's pianist: 3rd and 7th plus a colour tone, around middle C */
export function compVoicing(c: Chord): number[] {
  const fit = (pc: number, lo: number) => {
    let m = lo + ((pc - lo) % 12 + 12) % 12
    if (m > lo + 11) m -= 12
    return m
  }
  const third = fit(c.root + c.third, 52)
  const seventh = fit(c.root + c.seventh, 52)
  const colour = fit(c.root + (c.tones[1] === 4 && c.tones[3] === 10 ? 9 : c.tones[2]), 60) // 13th on dominants, else the 5th
  return [...new Set([third, seventh, colour])].sort((a, b) => a - b)
}

export interface Form {
  id: string
  name: string
  /** one chord symbol per bar (4/4) */
  bars: string[]
  /** home scale for guidance */
  key: number
  scale: string
}

export const FORMS: Record<string, Form> = {
  vamp: { id: 'vamp', name: 'C7 vamp', bars: ['C7', 'C7', 'C7', 'C7'], key: 0, scale: 'blues' },
  blues: {
    id: 'blues', name: '12-bar blues in C', key: 0, scale: 'blues',
    bars: ['C7', 'F7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'G7'],
  },
  bluesBasic: {
    id: 'bluesBasic', name: '12-bar blues in C (basic)', key: 0, scale: 'blues',
    bars: ['C7', 'C7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'C7'],
  },
  twoFiveOne: { id: 'twoFiveOne', name: 'ii – V – I in C', key: 0, scale: 'major', bars: ['Dm7', 'G7', 'Cmaj7', 'Cmaj7'] },
  minorTwoFive: { id: 'minorTwoFive', name: 'minor ii – V – i in A minor', key: 9, scale: 'minorPent', bars: ['Bm7b5', 'E7', 'Am7', 'Am7'] },
  turnaround: { id: 'turnaround', name: 'I – vi – ii – V turnaround', key: 0, scale: 'major', bars: ['Cmaj7', 'Am7', 'Dm7', 'G7'] },
}
