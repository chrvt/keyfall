import type { PianoAudio } from '../lib/audio.ts'
import { chord, compVoicing } from './theory.ts'
import type { Chord, Form } from './theory.ts'

export interface BandMix { bass: boolean; drums: boolean; comp: boolean }

/** something the band (or the "teacher") plays at a fixed place in the loop */
export interface Phrase { bar: number; notes: { beat: number; dur: number; midi: number }[] }

/**
 * A tiny swing trio: walking bass, ride cymbal and a comping pianist, looping a chord form.
 * Time is counted in quarter-note beats from the first downbeat (negative during the count-in).
 */
export class Band {
  form: Form
  chords: Chord[]
  bpm = 100
  swing = 1
  mix: BandMix = { bass: true, drums: true, comp: true }
  playing = false
  /** called once per bar when it is scheduled; return notes for the teacher's piano to play in it */
  phraseFor?: (absBar: number) => { beat: number; dur: number; midi: number }[] | null
  private audio: PianoAudio
  private t0 = 0
  private nextBar = 0
  private timer = 0
  private seed = 7
  private lastBass = 40
  private bassLog: { t: number; end: number; midi: number }[] = []

  constructor(audio: PianoAudio, form: Form) {
    this.audio = audio
    this.form = form
    this.chords = form.bars.map(chord)
  }

  get spb() {
    return 60 / this.bpm
  }
  /** current position in beats (4 per bar) */
  get beat() {
    return this.playing ? (this.audio.now - this.t0) / this.spb : -4
  }
  get bar() {
    return Math.floor(this.beat / 4)
  }
  chordAt(absBar: number) {
    const n = this.chords.length
    return this.chords[((absBar % n) + n) % n]
  }

  /** bass notes sounding right now (so a listening microphone can tell them from the player) */
  bassNow() {
    const now = this.audio.now
    return this.playing ? this.bassLog.filter((n) => n.t - 0.05 <= now && now <= n.end).map((n) => n.midi) : []
  }

  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
  }
  /** beat position within the bar → seconds, with swung off-beat eighths */
  private at(absBar: number, beat: number) {
    const whole = Math.floor(beat)
    let frac = beat - whole
    if (Math.abs(frac - 0.5) < 0.01) frac = 0.5 + this.swing / 6
    return this.t0 + (absBar * 4 + whole + frac) * this.spb
  }

  start() {
    this.audio.ensure()
    this.playing = true
    this.bassLog = []
    this.t0 = this.audio.now + 0.15 + 4 * this.spb // one bar of count-in
    this.nextBar = -1
    this.timer = window.setInterval(() => this.schedule(), 40)
    this.schedule()
  }

  stop() {
    this.playing = false
    clearInterval(this.timer)
    this.audio.stopAll('band')
  }

  private schedule() {
    const horizon = this.audio.now + 0.35
    while (this.t0 + this.nextBar * 4 * this.spb < horizon) this.scheduleBar(this.nextBar++)
  }

  private scheduleBar(b: number) {
    const a = this.audio
    if (b < 0) {
      for (let i = 0; i < 4; i++) a.drum('stick', this.at(b, i), i === 0 ? 1 : 0.7)
      return
    }
    const c = this.chordAt(b)
    const next = this.chordAt(b + 1)
    if (this.mix.drums) {
      for (let i = 0; i < 4; i++) {
        a.drum('ride', this.at(b, i), i % 2 ? 0.9 : 0.65)
        if (i % 2) {
          a.drum('hat', this.at(b, i), 0.8)
          a.drum('ride', this.at(b, i + 0.5), 0.45) // the "a" of ding-ding-a-ding
        }
        a.drum('kick', this.at(b, i), i === 0 ? 0.35 : 0.14)
      }
      if (this.rnd() < 0.3) a.drum('snare', this.at(b, 3.5), 0.35)
    }
    if (this.mix.bass) {
      const fit = (pc: number, near: number) => {
        let m = 36 + ((pc - 36) % 12 + 12) % 12
        if (m - near > 6) m -= 12
        if (near - m > 6) m += 12
        return Math.max(28, Math.min(50, m))
      }
      const root = fit(c.root, Math.min(45, Math.max(33, this.lastBass)))
      const target = fit(next.root, root)
      const up = target > root || (target === root && this.rnd() < 0.5)
      const third = root + c.third, fifth = root + 7
      // root – chord tone – chord tone – half-step approach into the next bar's root
      const line = up
        ? [root, this.rnd() < 0.5 ? third : root + 2, fifth, target - 1]
        : [root, this.rnd() < 0.5 ? fifth : root + c.seventh - 12, third, target + 1]
      if (target === root) line[3] = this.rnd() < 0.5 ? root + 7 : root - 1
      line.forEach((m, i) => {
        a.bass(m, this.at(b, i), this.spb * 0.92, i === 0 ? 0.85 : 0.7)
        this.bassLog.push({ t: this.at(b, i), end: this.at(b, i) + this.spb * 0.92 + 0.15, midi: m })
      })
      if (this.bassLog.length > 16) this.bassLog.splice(0, this.bassLog.length - 16)
      this.lastBass = target
    }
    if (this.mix.comp) {
      const v = compVoicing(c)
      const patterns = [[0, 1.5], [1.5, 3.5], [0.5, 2.5], [0, 2.5], [1.5], [0, 3.5]]
      const pat = patterns[Math.floor(this.rnd() * patterns.length)]
      for (const beat of pat) for (const m of v) a.play(m, 0.3, this.at(b, beat), this.spb * (beat % 1 ? 0.3 : 0.55), 'band')
    }
    const phrase = this.phraseFor?.(b)
    if (phrase) for (const n of phrase) a.play(n.midi, 0.72, this.at(b, n.beat), Math.max(0.12, n.dur * this.spb * 0.9), 'band')
  }
}
