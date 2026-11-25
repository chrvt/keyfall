import type { Hand, Song } from './types.ts'

/** Generates a readable (simplified, one voice per hand) grand-staff MusicXML from a Song. */
const DIV = 24
const BIN: [number, string, boolean][] = [
  [96, 'whole', false], [72, 'half', true], [48, 'half', false], [36, 'quarter', true], [24, 'quarter', false],
  [18, 'eighth', true], [12, 'eighth', false], [9, '16th', true], [6, '16th', false], [3, '32nd', false],
]
const TRI: [number, string][] = [[16, 'quarter'], [8, 'eighth'], [4, '16th']]

const snap = (beat: number) => {
  const u = beat * DIV
  const a = Math.round(u / 3) * 3
  const b = Math.round(u / 4) * 4
  return Math.abs(a - u) <= Math.abs(b - u) ? a : b
}

interface Piece { d: number; type: string; dot: boolean; tri: boolean }

function decompose(d: number): Piece[] {
  const out: Piece[] = []
  let guard = 0
  while (d >= 3 && guard++ < 40) {
    if (d % 3 === 0) {
      const v = BIN.find((b) => b[0] <= d)!
      out.push({ d: v[0], type: v[1], dot: v[2], tri: false })
      d -= v[0]
    } else {
      const v = TRI.find((t) => t[0] <= d && ![1, 2, 5].includes(d - t[0])) ?? (d >= 4 ? TRI[2] : null)
      if (!v) break
      out.push({ d: v[0], type: v[1], dot: false, tri: true })
      d -= v[0]
    }
  }
  return out
}

function spell(midi: number, fifths: number) {
  const pc = midi % 12
  const oct = Math.floor(midi / 12) - 1
  const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
  let useFlat = fifths < 0
  if (useFlat) {
    // leading tone of the relative minor is written as a sharp (e.g. C# in D minor)
    const majorTonic = (((fifths * 7) % 12) + 12) % 12
    if (pc === (majorTonic + 8) % 12) useFlat = false
  }
  const name = (useFlat ? flat : sharp)[pc]
  return { step: name[0], alter: name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0, oct }
}

interface Item { start: number; end: number; pitches: number[] | null; tieIn?: boolean; tieOut?: boolean }

function staffItems(song: Song, hand: Hand, bounds: number[]): Item[][] {
  const groups = new Map<number, { pitches: Set<number>; end: number }>()
  for (const n of song.notes) {
    if (n.hand !== hand) continue
    const s = snap(n.beat)
    const e = Math.max(snap(n.beat + n.dur), s + 3)
    const g = groups.get(s) ?? { pitches: new Set<number>(), end: 0 }
    g.pitches.add(n.midi)
    g.end = Math.max(g.end, e)
    groups.set(s, g)
  }
  const starts = [...groups.keys()].sort((a, b) => a - b)
  const items: Item[] = []
  let pos = 0
  starts.forEach((s, i) => {
    const g = groups.get(s)!
    const next = starts[i + 1] ?? Infinity
    let end = Math.min(g.end, next)
    if (next !== Infinity && next - end < (next - s) * 0.5) end = next
    if (end <= s) end = Math.min(next, s + 3)
    if (s > pos) items.push({ start: pos, end: s, pitches: null })
    items.push({ start: s, end, pitches: [...g.pitches].sort((a, b) => a - b) })
    pos = end
  })
  // split into measures
  const per: Item[][] = bounds.slice(0, -1).map(() => [])
  let mi = 0
  for (const it of items) {
    let s = it.start
    while (s < it.end) {
      while (mi < per.length - 1 && bounds[mi + 1] <= s) mi++
      const mEnd = mi === per.length - 1 ? Infinity : bounds[mi + 1]
      const e = Math.min(it.end, mEnd)
      per[mi].push({
        start: s, end: e, pitches: it.pitches,
        tieIn: !!it.pitches && s > it.start, tieOut: !!it.pitches && e < it.end,
      })
      s = e
    }
  }
  return per
}

export function songToMusicXml(song: Song): string {
  const bounds = song.measures.map((m) => snap(m.beat))
  const lastM = song.measures[song.measures.length - 1]
  bounds.push(snap(lastM.beat + lastM.len))
  const staves: [Hand, number, number][] = [['R', 1, 1], ['L', 2, 5]]
  const perStaff = staves.map(([h]) => staffItems(song, h, bounds))
  const x: string[] = []
  x.push(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">',
  )
  let prevSig = ''
  song.measures.forEach((m, mi) => {
    const mLen = bounds[mi + 1] - bounds[mi]
    const nominal = Math.round(((m.num * 4) / m.den) * DIV)
    x.push(`<measure number="${mi + 1}"${mLen < nominal - 2 ? ' implicit="yes"' : ''}>`)
    const sig = m.num + '/' + m.den
    if (mi === 0) {
      x.push(
        `<attributes><divisions>${DIV}</divisions><key><fifths>${song.fifths}</fifths></key><time><beats>${m.num}</beats><beat-type>${m.den}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`,
      )
    } else if (sig !== prevSig) {
      x.push(`<attributes><time><beats>${m.num}</beats><beat-type>${m.den}</beat-type></time></attributes>`)
    }
    prevSig = sig
    staves.forEach(([, staff, voice], si) => {
      const items = perStaff[si][mi]
      let emitted = 0
      const hasNotes = items.some((i) => i.pitches)
      if (!hasNotes) {
        x.push(`<note><rest measure="yes"/><duration>${mLen}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`)
        emitted = mLen
      } else {
        let cur = bounds[mi]
        const all: Item[] = []
        for (const it of items) {
          if (it.start > cur) all.push({ start: cur, end: it.start, pitches: null })
          all.push(it)
          cur = it.end
        }
        const mEnd = bounds[mi + 1]
        if (cur < mEnd) all.push({ start: cur, end: mEnd, pitches: null })
        // flatten into pieces so tuplets can be bracketed
        const flat: { p: Piece; it: Item; first: boolean; last: boolean }[] = []
        for (const it of all) {
          const ps = decompose(it.end - it.start)
          ps.forEach((p, i) => flat.push({ p, it, first: i === 0, last: i === ps.length - 1 }))
        }
        const tup = new Map<number, string>()
        for (let i = 0; i + 2 < flat.length; ) {
          if (flat[i].p.tri && flat[i + 1].p.tri && flat[i + 2].p.tri && flat[i].p.d === flat[i + 1].p.d && flat[i].p.d === flat[i + 2].p.d) {
            tup.set(i, 'start'); tup.set(i + 2, 'stop'); i += 3
          } else i++
        }
        flat.forEach(({ p, it, first, last }, fi) => {
          emitted += p.d
          const common =
            `<voice>${voice}</voice><type>${p.type}</type>${p.dot ? '<dot/>' : ''}` +
            (p.tri ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '') +
            `<staff>${staff}</staff>`
          const tu = tup.get(fi)
          if (!it.pitches) {
            x.push(`<note><rest/><duration>${p.d}</duration>${common}${tu ? `<notations><tuplet type="${tu}"/></notations>` : ''}</note>`)
            return
          }
          const tStop = !first || it.tieIn
          const tStart = !last || it.tieOut
          it.pitches.forEach((midi, ci) => {
            const s = spell(midi, song.fifths)
            const nots =
              (tStop ? '<tied type="stop"/>' : '') + (tStart ? '<tied type="start"/>' : '') + (tu && ci === 0 ? `<tuplet type="${tu}"/>` : '')
            x.push(
              `<note>${ci > 0 ? '<chord/>' : ''}<pitch><step>${s.step}</step>${s.alter ? `<alter>${s.alter}</alter>` : ''}<octave>${s.oct}</octave></pitch><duration>${p.d}</duration>` +
                (tStop ? '<tie type="stop"/>' : '') + (tStart ? '<tie type="start"/>' : '') +
                common + (nots ? `<notations>${nots}</notations>` : '') + '</note>',
            )
          })
        })
      }
      if (si === 0 && emitted > 0) x.push(`<backup><duration>${emitted}</duration></backup>`)
    })
    x.push('</measure>')
  })
  x.push('</part></score-partwise>')
  return x.join('\n')
}
