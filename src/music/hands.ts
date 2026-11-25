import type { Hand, Note } from './types.ts'

/** widest stretch (semitones) one hand is asked to play at once – a tenth is already a lot */
const REACH = 15

const span = (ns: Note[]) => (ns.length ? Math.max(...ns.map((n) => n.midi)) - Math.min(...ns.map((n) => n.midi)) : 0)

/**
 * MIDI files say which track a note is on, not which hand plays it, and single-track files are
 * simply cut at middle C. Both can ask one hand for an impossible stretch – typically a bass
 * note with a chord far above it. Wherever a hand would have to span more than a tenth, the
 * notes on the side facing the other hand are handed over, provided that hand can take them.
 * Returns how many notes changed hands.
 */
export function fixHands(notes: Note[]): number {
  const sorted = [...notes].sort((a, b) => a.beat - b.beat || a.midi - b.midi)
  const lastOnset: Record<Hand, number> = { L: -9, R: -9 }
  let moved = 0
  for (let i = 0; i < sorted.length; ) {
    const t = sorted[i].beat
    let j = i
    while (j < sorted.length && sorted[j].beat === t) j++
    const group = sorted.slice(i, j)
    // notes struck earlier that the same hand would still be holding
    const held = (h: Hand) => {
      const out: Note[] = []
      for (let k = i - 1; k >= 0 && t - sorted[k].beat < 8; k--) if (sorted[k].hand === h && sorted[k].beat + sorted[k].dur > t + 0.02) out.push(sorted[k])
      return out
    }
    for (const hand of ['R', 'L'] as Hand[]) {
      const other: Hand = hand === 'R' ? 'L' : 'R'
      // the notes nearest the other hand come first
      const on = group.filter((n) => n.hand === hand).sort((a, b) => (hand === 'R' ? a.midi - b.midi : b.midi - a.midi))
      if (!on.length) continue
      const keep = held(hand)
      if (span([...on, ...keep]) <= REACH) continue
      const otherOn = group.filter((n) => n.hand === other)
      // the other hand needs a moment to get there
      if (!otherOn.length && t - lastOnset[other] < 0.45) continue
      let best = 0, bestGap = -1
      for (let k = 1; k <= on.length; k++) {
        const give = on.slice(0, k), stay = [...on.slice(k), ...keep]
        if (span(stay) > REACH || span([...give, ...otherOn]) > REACH) continue
        // hands must not cross
        if (otherOn.some((o) => give.some((g) => (hand === 'R' ? o.midi > g.midi + 4 : o.midi < g.midi - 4)))) continue
        const edge = give[k - 1].midi
        const gap = stay.length ? Math.min(...stay.map((n) => Math.abs(n.midi - edge))) : 99
        if (gap > bestGap) { bestGap = gap; best = k }
      }
      for (const n of on.slice(0, best)) { n.hand = other; moved++ }
    }
    for (const n of group) lastOnset[n.hand] = t
    i = j
  }
  return moved
}
