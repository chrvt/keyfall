/**
 * Piano note-onset detector for microphone input. Pure signal code (no Web Audio), so it can be
 * evaluated offline against recordings – see tests/mic-eval.ts.
 *
 * For every piano pitch it looks for that note's own harmonic series as sharp, correctly tuned
 * spectral peaks (not just energy near one frequency), requires the partials that tell the note
 * apart from its octave / twelfth relatives, and reports the pitch once when that pattern
 * freshly rises.
 */

export const FRAME = 8192
const SHORT = 4096
const LO = 21
const HI = 108

export function makeFft(n: number) {
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float32Array(n / 2)
  const sin = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = Math.sin((2 * Math.PI * i) / n)
  }
  const win = new Float32Array(n)
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  /** dB spectrum (0 dB = full-scale sine) of the last n samples of `buf` */
  return (buf: Float32Array, out: Float32Array) => {
    const off = buf.length - n
    for (let i = 0; i < n; i++) {
      re[rev[i]] = buf[off + i] * win[i]
      im[rev[i]] = 0
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half
          const tr = re[b] * cos[k] + im[b] * sin[k]
          const ti = im[b] * cos[k] - re[b] * sin[k]
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    const scale = 4 / n
    for (let i = 0; i < n / 2; i++) {
      const m = Math.hypot(re[i], im[i]) * scale
      out[i] = m > 1e-7 ? 20 * Math.log10(m) : -140
    }
  }
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const bits = (x: number) => { let n = 0; for (; x; x &= x - 1) n++; return n }

const K = 8
/** below this small microphones hear next to nothing */
const MIC_LOW = 85
const FREQ = Array.from({ length: HI + 1 }, (_, p) => 440 * Math.pow(2, (p - 69) / 12))
/** semitones below → the partials of that lower note which are not partials of ours */
const SUB: [number, number[]][] = [[12, [1, 3, 5, 7]], [19, [1, 2, 4, 5, 7, 8]], [24, [1, 2, 3, 5, 6, 7]], [28, [1, 2, 3, 4, 6]], [31, [1, 2, 3, 4, 5]]]

interface Spec { db: Float32Array; binHz: number; floor: Map<number, number> }

export interface DetectorOptions {
  /** dB a partial must stand above the local noise floor */
  snr?: number
  /** absolute minimum partial level, dBFS */
  minDb?: number
  /** dB the note's energy must rise within ~0.2 s to count as a fresh strike */
  rise?: number
  /** below this fundamental (Hz) the long, fine-resolution window is used */
  split?: number
  /** seconds a detection must persist before it is reported */
  hold?: number
  /** free playing: seconds a heard note keeps its octave and twelfth relatives above from being reported */
  shadow?: number
  /** report a pitch once per strike even while it stays a candidate (it is not removed when heard) */
  once?: boolean
}

export class PitchDetector {
  private fftS = makeFft(SHORT)
  private fftL = makeFft(FRAME)
  private S: Spec
  private L: Spec
  private sr: number
  private split: number
  private hist: { t: number; e: Float32Array; pow: number }[] = []
  private lastRising = new Float64Array((HI + 1) * K).fill(-10)
  private riseStart = new Float64Array((HI + 1) * K).fill(-10)
  private struckAt = -10
  private tuneX = 0
  private tuneY = 0
  /** estimated tuning of the instrument in cents relative to A = 440 Hz */
  tuning = 0
  private since = new Float64Array(HI + 1).fill(-1)
  private vetoUntil = new Float64Array(HI + 1)
  private lastOnset = new Float64Array(HI + 1).fill(-10)
  /** a reported pitch must stop looking fresh before it can be reported again (free playing, `once`) */
  private spent = new Uint8Array(HI + 1)
  private opt: Required<DetectorOptions>
  /** loudest partial seen in the last frame, dBFS (for a level meter) */
  level = -120
  debug = false
  dbg = ''
  /** per pitch, why the last frame did not report it: 1 pattern, 2 no rise, 3 vetoed, 0 passed */
  why = new Uint8Array(HI + 1)

  constructor(sampleRate: number, opt: DetectorOptions = {}) {
    this.sr = sampleRate
    this.opt = { snr: 18, minDb: -82, rise: 6, split: 350, hold: 0.035, shadow: 0.35, once: false, ...opt }
    this.split = this.opt.split
    this.S = { db: new Float32Array(SHORT / 2), binHz: sampleRate / SHORT, floor: new Map() }
    this.L = { db: new Float32Array(FRAME / 2), binHz: sampleRate / FRAME, floor: new Map() }
  }

  /** noise floor around `f`, always taken from the long window (enough bins between the partials) */
  private floorAt(f: number) {
    const s = this.L
    const band = Math.round(Math.log2(f / 55) * 3)
    let v = s.floor.get(band)
    if (v === undefined) {
      const c = 55 * Math.pow(2, band / 3)
      const a = Math.max(2, Math.floor(c / 1.41 / s.binHz))
      const b = Math.min(s.db.length - 2, Math.ceil((c * 1.41) / s.binHz))
      const sorted = s.db.slice(a, Math.max(b, a + 8)).sort()
      v = sorted[Math.floor(sorted.length * 0.25)]
      s.floor.set(band, v)
    }
    return v
  }

  /** level of a clean, in-tune spectral peak at `f`, or -200 */
  private peak(s: Spec, f: number, centsLo: number, centsHi: number) {
    const d = s.db
    const c = f / s.binHz
    const a = Math.max(2, Math.floor((f * Math.pow(2, -centsLo / 1200)) / s.binHz))
    const b = Math.min(d.length - 3, Math.ceil((f * Math.pow(2, centsHi / 1200)) / s.binHz))
    if (b < a) return -200
    let m = a
    for (let i = a + 1; i <= b; i++) if (d[i] > d[m]) m = i
    if (d[m] < d[m - 1] || d[m] < d[m + 1]) return -200 // the real peak lies outside the window
    const y0 = d[m - 1], y1 = d[m], y2 = d[m + 1]
    const den = y0 - 2 * y1 + y2
    const off = den < 0 ? (0.5 * (y0 - y2)) / den : 0
    const cents = 1200 * Math.log2((m + off) / c)
    if (cents < -centsLo || cents > centsHi) return -200
    const lvl = y1 - 0.25 * (y0 - y2) * off
    if (lvl < this.opt.minDb || lvl < this.floorAt(f) + this.opt.snr) return -200
    // not merely the skirt of a much louder note a semitone away
    const far = Math.max(2, Math.round((f * 0.09) / s.binHz))
    for (let i = Math.max(1, m - far); i <= Math.min(d.length - 1, m + far); i++) if (d[i] > lvl + 12) return -200
    // sharp on at least one side: a tone, not a broadband thump
    const w = 3
    if (lvl - Math.min(d[Math.max(0, m - w)], d[Math.min(d.length - 1, m + w)]) < 9) return -200
    return lvl
  }

  /**
   * Feed the most recent FRAME samples together with the pitches the app is waiting for.
   * Returns those of them that were freshly struck. `alsoSounding` – notes the app itself is
   * playing (accompaniment), so that they are not taken for the player hitting a lower octave.
   * `open` – the candidates are "anything the player might play" (free playing) rather than notes
   * known to be due, so a candidate may not excuse the overtones of another candidate.
   * `foreign` – synthesized notes (the band's bass) coming out of the speakers right now. A
   * candidate that coincides with one of their harmonics must clearly stand out from the
   * neighbouring harmonics, which a piano note has and a bass overtone has not.
   */
  process(buf: Float32Array, t: number, expected: Iterable<number>, alsoSounding: Iterable<number> = [], open = false, foreign: number[] = []): number[] {
    this.fftS(buf, this.S.db)
    this.fftL(buf, this.L.db)
    this.L.floor.clear()
    const fMax = Math.min(5000, this.sr / 2 - 200)
    const lv = new Float32Array((HI + 1) * K).fill(-200) // peak level of partial k of pitch p
    const e = new Float32Array((HI + 1) * K) // same, with the noise floor where there is no peak
    const rising = new Uint8Array(HI + 1)
    const present = new Uint8Array(HI + 1)
    const jump = new Float32Array(HI + 1) // dB the lowest audible partial has come up
    let level = -200
    while (this.hist.length && t - this.hist[0].t > 0.24) this.hist.shift()

    // Tuning: home pianos sit a little flat or sharp as a whole. Strong peaks vote on how far
    // they are from the nearest equal-tempered semitone; the note frequencies follow.
    {
      const d = this.S.db
      for (let i = Math.round(250 / this.S.binHz), n = Math.round(1300 / this.S.binHz); i < n; i++) {
        if (d[i] < -60 || d[i] <= d[i - 1] || d[i] < d[i + 1] || d[i] < this.floorAt(i * this.S.binHz) + 30) continue
        const den = d[i - 1] - 2 * d[i] + d[i + 1]
        const f = (i + (den < 0 ? (0.5 * (d[i - 1] - d[i + 1])) / den : 0)) * this.S.binHz
        const semis = 12 * Math.log2(f / 440)
        const a = 2 * Math.PI * (semis - Math.round(semis))
        this.tuneX = this.tuneX * 0.995 + Math.cos(a)
        this.tuneY = this.tuneY * 0.995 + Math.sin(a)
      }
      const len = Math.hypot(this.tuneX, this.tuneY)
      if (len > 25) this.tuning = (Math.atan2(this.tuneY, this.tuneX) / (2 * Math.PI)) * 100
    }
    const tune = Math.pow(2, this.tuning / 1200)

    // broadband loudness: did *something* get struck just now?
    let pow = 0
    for (let i = Math.round(300 / this.S.binHz), n = Math.round(fMax / this.S.binHz); i < n; i++) pow += Math.pow(10, this.S.db[i] / 10)
    let powPast = Infinity
    for (const h of this.hist) if (t - h.t >= 0.035 && t - h.t <= 0.13 && h.pow < powPast) powPast = h.pow
    if (pow > powPast * 1.6) this.struckAt = t
    const struck = t - this.struckAt < 0.1

    for (let p = LO; p <= HI; p++) {
      const f0 = FREQ[p] * tune
      let weak = 0
      for (let k = 1; k <= K; k++) {
        const f = f0 * k
        const s = f < this.split ? this.L : this.S
        const i = p * K + k - 1
        if (f > fMax) break
        if (f < MIC_LOW) continue
        // piano strings are stiff (upper partials run sharp); never demand better than half a bin
        const tol = Math.max(30, Math.min(46, 1200 * Math.log2(1 + (0.5 * s.binHz) / f)))
        const v = (lv[i] = this.peak(s, f, tol, tol + 0.6 * k * k))
        // history: this partial's own peak, else the level right at its frequency – so a peak
        // that merely flickers in and out of "clean" never looks like a fresh rise
        const c = Math.round(f / s.binHz)
        e[i] = v > -200 ? v : Math.max(s.db[c - 1], s.db[c], s.db[c + 1])
        if (v <= -200) continue
        present[p] |= 1 << (k - 1)
        if (v > level) level = v
        let past = Infinity
        for (const h of this.hist) if (t - h.t >= 0.035 && h.e[i] < past) past = h.e[i]
        if (past === Infinity) continue
        if (!jump[p]) jump[p] = v - past
        if (v - past >= this.opt.rise) rising[p] |= 1 << (k - 1)
        else if (struck && v - past >= 3) weak |= 1 << (k - 1)
      }
      // A key struck again while it still rings rises only a little – accept that, but only when
      // (nearly) all of its partials come up together; one or two flickering peaks do not count.
      weak |= rising[p]
      if (!open && weak !== rising[p] && bits(weak) >= Math.min(3, bits(present[p]))) rising[p] = weak
      for (let k = 1; k <= K; k++) {
        if (!(rising[p] & (1 << (k - 1)))) continue
        const i = p * K + k - 1
        // a new rise only if this partial has not been rising for a while (peaks flicker)
        if (t - this.lastRising[i] > 0.25) this.riseStart[i] = t
        this.lastRising[i] = t
      }
    }
    this.level = level
    this.hist.push({ t, e, pow })

    const want = [...expected]
    // partial frequencies that the expected notes themselves explain
    const own: number[] = []
    for (const p of open ? [...alsoSounding] : [...want, ...alsoSounding]) for (let k = 1; FREQ[p] * tune * k < fMax * 1.1; k++) own.push(FREQ[p] * tune * k)
    const explained = (f: number) => own.some((o) => Math.abs(Math.log2(f / o)) < 0.05)
    const also = open ? new Set(alsoSounding) : null

    const out: number[] = []
    this.dbg = ''
    for (const p of want) {
      if (p < LO || p > HI) continue
      const f0 = FREQ[p] * tune
      const P = present[p], R = rising[p]
      let g = 0 // greatest common divisor of the freshly rising partial numbers
      for (let k = 1; k <= K; k++) if (R & (1 << (k - 1))) g = gcd(g, k)
      // lowest partial the microphone can hear
      const k0 = Math.max(1, Math.ceil(MIC_LOW / f0))
      // Rich evidence without a clean fundamental (bass below the microphone's range, or close
      // chords that smear it): partials with no common divisor, the lowest audible ones, and the
      // 3rd plus 5th or 7th, which octaves and fifths above cannot fake.
      let top = -200
      for (let k = k0 + 1; k <= K; k++) top = Math.max(top, lv[p * K + k - 1])
      const base = e[p * K + k0 - 1] // energy at the lowest audible partial, clean peak or not
      const rich = g === 1 && bits(P) >= 4 && (P & 0b100) > 0 && (P & 0b1010000) > 0 &&
        base > top - 28 && base > this.floorAt(f0 * k0) + 4
      let ok: boolean
      if (f0 >= 500) ok = (R & 1) > 0
      else {
        // a real fundamental is not vastly weaker than the overtones above it
        ok = ((R & 1) > 0 && (P & 6) > 0 && lv[p * K] > top - 24) || rich
      }
      this.why[p] = ok ? 0 : R & 1 ? 4 : P ? 2 : 1
if (this.debug) this.dbg += ` ${p}:P${P.toString(2)}/R${R.toString(2)}`
      // Was it really a lower note whose overtone this is? Look for the tell-tale partials of the
      // notes 1, 1½, 2 … octaves below that the expected notes cannot explain.
      if (ok) {
        let ref = -200
        let start = t
        for (let k = 1; k <= K; k++) if (R & (1 << (k - 1))) start = Math.min(start, this.riseStart[p * K + k - 1])
        for (let k = 1; k <= 3; k++) ref = Math.max(ref, lv[p * K + k - 1])
        for (const [d, ks] of SUB) {
          const q = p - d
          if (q < LO) break
          let n = 0
          let strong = false
          for (const k of ks) {
            const f = FREQ[q] * tune * k
            // (free playing: a known lower note – a left-hand shell – does count against its own overtones)
            if (f < MIC_LOW || (!also?.has(q) && explained(f))) continue
            // … rising together with our note, not left over from the note before
            const dt = this.riseStart[q * K + k - 1] - start
            const v = lv[q * K + k - 1]
            if (rising[q] & (1 << (k - 1)) && v > ref - 20 && dt > -0.09 && dt < 0.13) {
              n++
              if (v > ref - 8) strong = true
            }
          }
          // one loud tell-tale partial or two quieter ones – a single faint peak is just splatter
          if (n >= 2 || strong) {
            ok = false
            this.vetoUntil[p] = t + 0.15
            this.why[p] = 3
          }
        }
      }
      if (ok) for (const q of foreign) {
        const fq = FREQ[q]
        const h = Math.round(f0 / fq)
        if (h < 1 || h > 12 || Math.abs(1200 * Math.log2(f0 / (h * fq))) > 50) continue
        const at = (f: number) => {
          const sp = f < this.split ? this.L : this.S
          const c = Math.round(f / sp.binHz)
          return Math.max(sp.db[c - 1], sp.db[c], sp.db[c + 1])
        }
        if (h === 1 || lv[p * K] < Math.max(at((h - 1) * fq), at((h + 1) * fq)) + 6) ok = false
      }
      if (!ok) this.spent[p] = 0
      // free playing: a ringing string that merely beats is not a strike – something must have been hit
      if (ok && open && this.since[p] < 0 && t - this.struckAt > 0.2) ok = false
      // Free playing: a note that was itself just heard explains its octave / twelfth above. While
      // it keeps ringing, those relatives need a real jump in level, not the flicker of an overtone.
      if (ok && open) for (const [d] of SUB) {
        const q = p - d
        if (q < LO) break
        const ago = t - this.lastOnset[q]
        if (this.since[q] >= 0 || ago < this.opt.shadow || (ago < 3 && present[q] && jump[p] < 14)) ok = false
      }
      if (!ok || t < this.vetoUntil[p] || ((open || this.opt.once) && this.spent[p])) {
        this.since[p] = -1
        continue
      }
      if (this.since[p] < 0) this.since[p] = t
      // hold briefly: the slower low-frequency analysis may still reveal a lower note
      if (t - this.since[p] >= this.opt.hold && t - this.lastOnset[p] > 0.18) {
        this.lastOnset[p] = t
        this.spent[p] = 1
        out.push(p)
      }
    }
    for (let p = LO; p <= HI; p++) if (this.since[p] >= 0 && !want.includes(p)) this.since[p] = -1
    return out
  }
}
