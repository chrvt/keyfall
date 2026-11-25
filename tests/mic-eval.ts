/**
 * Offline evaluation of the microphone note detector against real piano recordings
 * (the bundled Salamander samples), with a simulated room and a small-microphone response.
 * Needs ffmpeg.   node tests/mic-eval.ts [songId …]
 *
 * It plays each piece step by step like someone using Practice mode and reports
 *   missed     – a played note the detector did not confirm within 0.5 s
 *   wrong-ok   – a deliberately wrong note (±1, ±2, ±12 semitones …) accepted as the expected one
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { FRAME, PitchDetector, makeFft } from '../src/lib/pitch.ts'
import { parseMidi } from '../src/music/midi.ts'

const SR = 48000
const dir = new URL('../public/', import.meta.url).pathname
const NAMES = ['A', 'C', 'Ds', 'Fs']
const samples = new Map<number, Float32Array>()
for (let midi = 21; midi <= 108; midi += 3) {
  const name = NAMES[((midi - 21) / 3) % 4] + (Math.floor(midi / 12) - 1)
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', `${dir}samples/${name}.mp3`, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 })
  samples.set(midi, new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2))
}

const DETUNE = +(process.env.DETUNE ?? 0) // cents
let seed = 12345
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

function addNote(out: Float32Array, midi: number, at: number, vel: number, dur: number) {
  const sm = 21 + Math.round((midi - 21) / 3) * 3
  const src = samples.get(Math.min(108, sm))!
  const rate = Math.pow(2, (midi - sm + DETUNE / 100) / 12)
  const start = Math.round(at * SR)
  const len = Math.min(out.length - start, Math.floor(src.length / rate) - 1)
  const g = 0.1 + vel * 0.5
  const rel = dur * SR
  for (let i = 0; i < len; i++) {
    const x = i * rate
    const j = x | 0
    const env = i < rel ? 1 : Math.exp(-(i - rel) / (0.09 * SR))
    if (env < 1e-3) break
    out[start + i] += (src[j] + (src[j + 1] - src[j]) * (x - j)) * g * env
  }
}

/** small room (a few echoes), laptop-microphone high-pass, background noise */
function room(x: Float32Array, noiseDb: number) {
  const y = new Float32Array(x.length)
  const taps: [number, number][] = [[0, 1], [0.011, 0.35], [0.019, -0.28], [0.031, 0.22], [0.047, 0.17], [0.071, -0.12], [0.113, 0.08]]
  for (const [d, g] of taps) {
    const o = Math.round(d * SR)
    for (let i = o; i < x.length; i++) y[i] += x[i - o] * g
  }
  const a = Math.exp((-2 * Math.PI * 140) / SR) // one-pole high-pass ≈ 140 Hz, twice
  for (let pass = 0; pass < 2; pass++) {
    let px = 0, py = 0
    for (let i = 0; i < y.length; i++) {
      const v = a * (py + y[i] - px)
      px = y[i]
      py = y[i] = v
    }
  }
  const n = Math.pow(10, noiseDb / 20)
  let b = 0
  for (let i = 0; i < y.length; i++) {
    b = 0.97 * b + (rnd() * 2 - 1) * 0.25 // low-heavy noise
    y[i] += (b + (rnd() * 2 - 1) * 0.3) * n
  }
  return y
}

/** the previous (v1) detector, re-implemented for comparison: one partial per note, octave-blind */
class OldDetector {
  fft = makeFft(FRAME)
  data = new Float32Array(FRAME / 2)
  hist = new Map<number, number[]>()
  onsetAt = new Map<number, number>()
  pending = new Map<number, number>()
  consumed = new Map<number, number>()
  why = new Uint8Array(128)
  at(freq: number, tol: number) {
    const bin = freq / (SR / FRAME)
    let max = -200
    for (let b = Math.max(1, Math.round(bin) - tol); b <= Math.round(bin) + tol; b++) if (this.data[b] > max) max = this.data[b]
    return max
  }
  process(buf: Float32Array, now: number, expected: Iterable<number>) {
    this.fft(buf, this.data)
    const binHz = SR / FRAME
    let sum = 0, n = 0
    for (let b = Math.round(100 / binHz); b < Math.round(3000 / binHz); b += 3) { sum += Math.max(this.data[b], -120); n++ }
    const floor = sum / n
    for (let m = 21; m <= 108; m++) {
      const f0 = 440 * Math.pow(2, (m - 69) / 12)
      let h = 1
      while (h * f0 < 300 && h < 8) h++
      const f = f0 * h, semi = Math.pow(2, 1 / 12)
      const a = this.at(f * semi, 0), b = this.at(f / semi, 0)
      const L = this.at(f, h > 3 ? 2 : 1), nb = Math.max(a, b), nbMin = Math.min(a, b)
      let hs = this.hist.get(m)
      if (!hs) this.hist.set(m, (hs = []))
      const recentMin = hs.length ? Math.min(...hs) : L
      const present = L > floor + 14 && L > -78 && L > nb - 3 && L > nbMin + 12
      if (present && L - recentMin > 6 && now - (this.onsetAt.get(m) ?? -1) > 0.25) {
        const seen = (this.pending.get(m) ?? 0) + 1
        if (seen >= 3) { this.onsetAt.set(m, now); this.pending.delete(m); hs.length = 0 } else { this.pending.set(m, seen); continue }
      } else this.pending.delete(m)
      hs.push(L)
      if (hs.length > 9) hs.shift()
    }
    const out: number[] = []
    for (const m of expected) {
      const t = this.onsetAt.get(m)
      if (t !== undefined && now - t < 0.7 && t > (this.consumed.get(m) ?? -1)) { this.consumed.set(m, t); out.push(m) }
    }
    return out
  }
}

interface Ev { t: number; midis: number[]; expect: number[]; wrong: boolean }

function run(name: string, events: Ev[], total: number, audio: Float32Array, opts: any = JSON.parse(process.env.OPT ?? '{}')) {
  const det: any = process.env.OLD ? new OldDetector() : new PitchDetector(SR, opts)
  const heard: { t: number; p: number }[] = []
  const why: Record<string, number> = {}
  const exp = new Set<number>()
  let pos = FRAME
  while (pos < audio.length) {
    const t = pos / SR
    exp.clear()
    for (const e of events) if (t > e.t - 0.3 && t < e.t + 0.6) e.expect.forEach((m) => exp.add(m))
    for (const p of det.process(audio.subarray(pos - FRAME, pos), t, exp)) heard.push({ t, p })
    if (process.env.DEBUG) for (const e of events) if (!e.wrong && t > e.t - 0.03 && t < e.t + 0.3) for (const m of e.expect) ((e as any).tr ??= {})[m] = ((e as any).tr[m] ?? '') + ' ' + det.why[m]
    for (const e of events) if (!e.wrong && t > e.t + 0.03 && t < e.t + 0.3) for (const m of e.expect) {
      const k = e.t + ':' + m
      const w = det.why[m]
      ;(e as any).w ??= {}
      const cur = (e as any).w[m]
      if (cur === undefined || w === 0 || (cur !== 0 && w < cur && w !== 1)) (e as any).w[m] = w
    }
    pos += process.env.OLD ? 1320 + Math.floor(rnd() * 240) : 880 + Math.floor(rnd() * 240) // ≈ 20 ms polling with jitter (30 ms in v1)
  }
  let played = 0, missed = 0, wrongTrials = 0, wrongOk = 0, lat = 0
  const missBy: Record<string, number> = {}
  for (const e of events) {
    for (const m of e.expect) {
      const h = heard.find((x) => x.p === m && x.t >= e.t - 0.02 && x.t <= e.t + 0.5)
      if (e.wrong) {
        wrongTrials++
        if (h) { wrongOk++; if (process.env.DEBUG) console.log('WRONG-OK expected', m, 'of', e.expect.join(','), 'played', e.midis.join(',')) }
      } else {
        played++
        if (!h) {
          missed++
          if (process.env.DEBUG && missed < 12) console.log(e.t.toFixed(2), m, 'chord', e.midis.join(','), '|', (e as any).tr?.[m])
          const w = 'w' + (e as any).w?.[m]
          why[w] = (why[w] ?? 0) + 1
          const reg = m < 48 ? 'bass' : m < 72 ? 'mid' : 'treble'
          missBy[reg] = (missBy[reg] ?? 0) + 1
        } else lat += h.t - e.t
      }
    }
  }
  console.log(
    `${name.padEnd(34)} notes ${String(played).padStart(4)}  missed ${(100 * missed / Math.max(1, played)).toFixed(1).padStart(5)}%` +
    `  wrong-ok ${(100 * wrongOk / Math.max(1, wrongTrials)).toFixed(1).padStart(5)}% of ${wrongTrials}` +
    `  latency ${(1000 * lat / Math.max(1, played - missed)).toFixed(0)} ms  ${JSON.stringify(missBy)} ${JSON.stringify(why)}`,
  )
  return { played, missed, wrongTrials, wrongOk }
}

if (process.env.CASE) {
  // CASE="55,59,62@1.0;57@1.6" → frame-by-frame dump
  const dry = new Float32Array(4 * SR)
  const evs = process.env.CASE.split(';').map((c) => { const [m, t] = c.split('@'); return { t: +t, midis: m.split(',').map(Number) } })
  for (const e of evs) e.midis.forEach((m) => addNote(dry, m, e.t, 0.6, +(process.env.DUR ?? 1.5)))
  const audio = process.env.DRY ? dry : room(dry, -52)
  const det = new PitchDetector(SR, JSON.parse(process.env.OPT ?? '{}'))
  const watch = process.env.EXPECT ? process.env.EXPECT.split(',').map(Number) : [...new Set(evs.flatMap((e) => e.midis))]
  det.debug = true
  const b = (x: number) => x.toString(2).padStart(8, '0').split('').reverse().join('')
  for (let pos = FRAME; pos < audio.length; pos += 960) {
    const t = pos / SR
    const out = det.process(audio.subarray(pos - FRAME, pos), t, new Set(watch), [], !!process.env.OPENC)
    if (evs.some((e) => t > e.t - 0.03 && t < e.t + (process.env.OPENC ? 0.7 : 0.25))) console.log(t.toFixed(2), watch.map((m) => `${m}: w${det.why[m]}`).join(' | '), det.dbg, out.length ? '=> ' + out.join(',') : '')
  }
  process.exit(0)
}
if (process.env.OPEN) {
  // free playing: everything in range is a candidate; how much of an improvised line is heard?
  const bpm = +(process.env.BPM ?? 100), spb = 60 / bpm
  const scale = [0, 3, 5, 6, 7, 10]
  const shells = [[48, 58], [41, 51], [43, 53], [48, 58]]
  const evs: { t: number; midi: number }[] = []
  let cur = 67
  const bars = 48
  for (let b = 0; b < bars; b++) {
    if (process.env.OPEN === 'lh') for (const m of shells[b % 4]) evs.push({ t: 1 + b * 4 * spb, midi: m })
    if (b % 4 === 3) continue // leave space
    for (let e = 0; e < 8; e++) {
      if (rnd() < 0.4) continue
      let m = cur
      do { m = cur + Math.round((rnd() - 0.5) * 9) } while (!scale.includes(((m % 12) + 12) % 12) || m < 60 || m > 84)
      if (rnd() < 0.15) m = cur // repeated note
      cur = m
      evs.push({ t: 1 + (b * 4 + e / 2 + (e % 2 ? 1 / 6 : 0)) * spb + (rnd() - 0.5) * 0.02, midi: m })
    }
  }
  const dry = new Float32Array(Math.ceil((2 + bars * 4 * spb) * SR))
  for (const e of evs) addNote(dry, e.midi, e.t, 0.4 + rnd() * 0.4, e.midi < 60 ? 1.5 : 0.1 + rnd() * 0.5)
  const audio = room(dry, +(process.argv.find((a) => a.startsWith('--noise='))?.slice(8) ?? -52))
  const det = new PitchDetector(SR, JSON.parse(process.env.OPT ?? '{}'))
  const lo = process.env.OPEN === 'lh' ? 36 : 48
  const cand = Array.from({ length: 84 - lo + 1 }, (_, i) => lo + i)
  const heard: { t: number; p: number; used?: boolean }[] = []
  for (let pos = FRAME; pos < audio.length; pos += 880 + Math.floor(rnd() * 240)) {
    const t = pos / SR
    const sh = process.env.OPEN === 'lh' ? shells[((Math.floor((t - 1 + 0.3) / (4 * spb)) % 4) + 4) % 4] : []
    for (const p of det.process(audio.subarray(pos - FRAME, pos), t, process.env.OPEN === 'lh' ? [...sh, ...cand.filter((m) => m >= 60)] : cand, sh, true)) heard.push({ t, p })
  }
  let hit = 0, lat = 0
  const missed: string[] = []
  for (const e of evs) {
    const h = heard.find((x) => !x.used && x.p === e.midi && x.t >= e.t - 0.02 && x.t <= e.t + 0.4)
    if (h) { h.used = true; hit++; lat += h.t - e.t } else missed.push(e.midi + '@' + e.t.toFixed(2))
  }
  const extra = heard.filter((h) => !h.used)
  const kind: Record<string, number> = {}
  for (const x of extra) {
    const near = evs.filter((e) => Math.abs(e.t - x.t + 0.1) < 0.25)
    const d = near.map((e) => x.p - e.midi)
    const k = d.includes(0) ? 'dup' : d.some((v) => v % 12 === 0) ? 'octave' : d.some((v) => [19, 28, 31, 7].includes(v)) ? 'overtone' : d.some((v) => Math.abs(v) <= 2) ? 'neighbour' : 'other'
    kind[k] = (kind[k] ?? 0) + 1
    if (process.env.DEBUG) console.log('EXTRA', x.p, x.t.toFixed(2), k, near.map((e) => e.midi).join(','))
  }
  if (process.env.DEBUG) console.log('missed', missed.join(' '))
  console.log('missed low', missed.filter((m) => +m.split('@')[0] < 60).length, 'of', evs.filter((e) => e.midi < 60).length, ' extra low', extra.filter((x) => x.p < 60).length)
  console.log(`open set: played ${evs.length}  heard ${hit} (${(100 * hit / evs.length).toFixed(1)}%)  extra ${extra.length} ${JSON.stringify(kind)}  latency ${(1000 * lat / hit).toFixed(0)} ms`)
  process.exit(0)
}
const SONGS: Record<string, { bpm: number; pickup?: number }> = {
  'fur-elise': { bpm: 62, pickup: 0.5 }, 'minuet-in-g': { bpm: 112 }, 'bach-prelude-c': { bpm: 66 },
  'gymnopedie-1': { bpm: 66 }, 'entertainer': { bpm: 80 }, 'burgmuller-arabesque': { bpm: 132 },
}
const pick = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const noise = +(process.argv.find((a) => a.startsWith('--noise='))?.slice(8) ?? -52)
const tot = { played: 0, missed: 0, wrongTrials: 0, wrongOk: 0 }

for (const id of pick.length ? pick : Object.keys(SONGS)) {
  const song = parseMidi(readFileSync(`${dir}songs/${id}.mid`), { id, title: id, fifths: 0, ...SONGS[id] })
  for (const hands of ['R', 'L', 'both'] as const) {
    // group into steps exactly like Practice mode does
    const steps: { beat: number; midis: number[]; dur: number }[] = []
    for (const n of song.notes) {
      if (hands !== 'both' && n.hand !== hands) continue
      const last = steps[steps.length - 1]
      if (last && Math.abs(last.beat - n.beat) < 0.03) {
        if (!last.midis.includes(n.midi)) last.midis.push(n.midi)
      } else steps.push({ beat: n.beat, midis: [n.midi], dur: n.dur })
    }
    const use = steps.slice(0, +(process.env.STEPS ?? 160))
    const spb = 60 / song.bpm
    const events: Ev[] = []
    let t = 0.5
    let prev = use[0]?.beat ?? 0
    const audioLen = Math.ceil((use.length * 1.2 + 8) * SR)
    const dry = new Float32Array(audioLen)
    for (const s of use) {
      // a learner: at most ~70 % tempo, never faster than 5 steps per second
      t += Math.max(0.2, Math.min(1.2, ((s.beat - prev) * spb) / 0.7))
      prev = s.beat
      if ((t + 3) * SR > audioLen) break
      const wrong = rnd() < 0.18
      let midis = s.midis
      if (wrong) {
        const shift = [1, -1, 2, -2, 12, -12, 7, -5, 3, -4][Math.floor(rnd() * 10)]
        midis = s.midis.map((m) => Math.max(22, Math.min(107, m + shift)))
      }
      midis.forEach((m, i) => addNote(dry, m, t + i * 0.006 * rnd(), 0.35 + rnd() * 0.5, Math.max(0.25, s.dur * spb)))
      // a wrong note only counts where the expected pitch is not itself sounding in the wrong chord
      events.push({ t, midis, expect: wrong ? s.midis.filter((m) => !midis.includes(m)) : s.midis, wrong })
    }
    const r = run(`${id} [${hands}]`, events, t, room(dry, noise))
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k]
  }
}
console.log(`\nTOTAL  missed ${(100 * tot.missed / tot.played).toFixed(2)}% of ${tot.played}   wrong notes accepted ${(100 * tot.wrongOk / tot.wrongTrials).toFixed(2)}% of ${tot.wrongTrials}`)
