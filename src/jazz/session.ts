import type { PianoAudio } from '../lib/audio.ts'
import { makeLayout } from '../ui/waterfall.ts'
import type { Layout } from '../ui/waterfall.ts'
import type { MicTarget } from '../lib/mic.ts'
import { Band } from './band.ts'
import type { Goal, Step } from './course.ts'
import { phraseNotes } from './songs.ts'
import { FORMS, PC_NAMES, chordPcs, guidePcs, scalePcs, shell } from './theory.ts'

type JamStep = Extract<Step, { kind: 'jam' }>
type EchoStep = Extract<Step, { kind: 'echo' }>
type Cls = 'bright' | 'safe' | 'out' | 'lh'

interface Played { beat: number; midi: number; bar: number; pos: number; lh: boolean; cls: Cls; chordTone: boolean; guideTone: boolean; off: number | null }

export interface GoalState { label: string; value: number; target: number; met: boolean; text: string }
export interface EchoRound { call: number; matched: number; total: number; played: number }

const COL = { bright: '#7ee787', safe: '#ffb454', out: '#8a90a6', lh: '#5ccfe6', call: '#b48cff' }
const mod12 = (n: number) => ((n % 12) + 12) % 12

/** One jam or call-and-response exercise: the band, what the player did, and how it is drawn. */
export class JamSession {
  band: Band
  step: JamStep | EchoStep
  log: Played[] = []
  rounds: EchoRound[] = []
  private audio: PianoAudio
  private held = new Map<number, Played | null>()
  private flash = new Map<number, number>()
  /** notes arrive from the microphone: a little late, without key-up, and with the odd phantom */
  mic = false
  /** notes the microphone has picked up so far (shown so the player can see they are heard) */
  heard = 0
  private shellHeard = 0
  private layout: Layout | null = null
  private calls: { beat: number; dur: number; midi: number }[][] = []
  private startedAt = 0
  /** seconds actually spent playing (for the practice log) */
  elapsed = 0
  lo: number
  hi: number

  constructor(audio: PianoAudio, step: JamStep | EchoStep) {
    this.audio = audio
    this.step = step
    this.band = new Band(audio, FORMS[step.kind === 'jam' ? step.form : 'vamp'])
    this.band.bpm = step.bpm
    if (step.kind === 'jam') Object.assign(this.band.mix, step.mix ?? {})
    else {
      this.calls = step.calls.map(phraseNotes)
      this.band.phraseFor = (absBar) => {
        const inCycle = absBar % 4
        if (inCycle > 1) return null
        const call = this.calls[this.callIndex(Math.floor(absBar / 4))]
        return call.filter((n) => Math.floor(n.beat / 4) === inCycle).map((n) => ({ ...n, beat: n.beat - inCycle * 4 }))
      }
    }
    const wide = step.kind === 'jam' && !!step.showShell
    this.lo = wide ? 36 : 48
    this.hi = 84
  }

  get isEcho() {
    return this.step.kind === 'echo'
  }
  /** each call is played twice before moving on */
  callIndex(cycle: number) {
    return Math.floor(cycle / 2) % this.calls.length
  }
  get totalCycles() {
    return this.calls.length * 2
  }

  start() {
    this.log = []
    this.rounds = []
    this.held.clear()
    this.band.start()
    this.startedAt = performance.now()
  }
  stop() {
    if (!this.band.playing) return
    this.band.stop()
    this.elapsed += (performance.now() - this.startedAt) / 1000
  }

  /** which keys to light up for the bar being played */
  private guide(absBar: number) {
    const s = this.step
    const c = this.band.chordAt(absBar)
    if (s.kind === 'echo') return { bright: new Set<number>(), safe: new Set(scalePcs(0, 'blues')), shell: [] as number[], c }
    const form = this.band.form
    const safe = new Set(s.pcs ?? scalePcs(form.key, s.scale ?? form.scale))
    const bright = new Set(s.guide === 'chord' ? chordPcs(c) : s.guide === 'guide' ? guidePcs(c) : [])
    return { bright, safe, shell: s.showShell ? shell(c) : [], c }
  }

  /** `ago` – seconds since the key was actually struck (microphone detection lags) */
  noteOn(midi: number, ago = 0) {
    const b = this.band
    if (ago) {
      this.flash.set(midi, performance.now() + 280)
      this.heard++
    }
    if (!b.playing || b.beat < -0.5) {
      if (!ago) this.held.set(midi, null)
      return
    }
    const beat = b.beat - ago / b.spb
    const bar = Math.floor((beat + 0.3) / 4) // a note just before the bar line belongs to the new bar
    const g = this.guide(bar)
    const pc = mod12(midi)
    const lh = this.step.kind === 'jam' && !!this.step.showShell && midi < 60
    const chordTone = chordPcs(g.c).includes(pc)
    const guideTone = guidePcs(g.c).includes(pc)
    const cls: Cls = lh ? 'lh' : g.bright.has(pc) ? 'bright' : g.safe.has(pc) || (g.bright.size > 0 && chordTone) ? 'safe' : 'out'
    const p: Played = { beat, midi, bar, pos: beat - bar * 4, lh, cls, chordTone, guideTone, off: null }
    this.log.push(p)
    if (ago) p.off = beat + 0.45
    else this.held.set(midi, p)
  }

  /** what the microphone should listen for right now */
  micTarget(): MicTarget {
    const s = this.step
    const range = (lo: number, hi: number, m = new Map<number, number>()) => { for (let i = lo; i <= hi; i++) m.set(i, i); return m }
    const shellNow = () => {
      if (s.kind !== 'jam' || !s.showShell) return []
      const beat = this.band.beat
      const out = shell(this.band.chordAt(Math.floor((beat + 0.3) / 4)))
      // around the bar line the next chord's shell is fair game too
      if (((beat % 4) + 4) % 4 > 3.2) out.push(...shell(this.band.chordAt(Math.floor(beat / 4) + 1)))
      return out
    }
    const self = this
    return {
      // phrases are single lines, so even the copy game listens the "free playing" way: it keeps
      // one phrase note from being mistaken for its octave elsewhere in the phrase
      open: true,
      once: true,
      want() {
        const b = self.band
        if (!b.playing) return range(self.lo, self.hi) // lets the player check that they are heard
        if (s.kind === 'jam') {
          if (!s.showShell) return range(self.lo, self.hi)
          const m = range(60, self.hi)
          for (const n of shellNow()) m.set(n, n)
          return m
        }
        // call & response: only while it is the player's turn (the teacher's phrase is not theirs)
        const inCycle = ((b.beat % 16) + 16) % 16
        if (b.beat < 0 || inCycle < 7.75) return new Map()
        if (s.answer) return range(self.lo, self.hi)
        const m = new Map<number, number>()
        const cycle = Math.floor(b.beat / 16)
        if (cycle < self.totalCycles) for (const n of self.calls[self.callIndex(cycle)]) m.set(n.midi, n.midi)
        return m
      },
      also: () => (self.band.playing ? shellNow() : []),
      foreign: () => self.band.bassNow(),
      hit: (m) => {
        const sh = shellNow()
        if (!sh.length) return self.noteOn(m, 0.13)
        if (m < 60) {
          self.shellHeard = performance.now()
          return self.noteOn(m, 0.13)
        }
        // A right-hand note that is an overtone of the shell is held back for a moment: the low
        // strings are recognised later than their overtones, and then it was only the shell.
        if (!sh.some((q) => [12, 19, 24, 28, 31, 34, 36].includes(m - q))) return self.noteOn(m, 0.13)
        if (performance.now() - self.shellHeard < 400) return
        setTimeout(() => { if (performance.now() - self.shellHeard > 600) self.noteOn(m, 0.13 + 0.2) }, 200)
      },
    }
  }
  noteOff(midi: number) {
    const p = this.held.get(midi)
    if (p) p.off = this.band.beat
    this.held.delete(midi)
  }

  // ---------- goals & feedback ----------
  private get rh() {
    return this.log.filter((p) => !p.lh)
  }
  private barsDone() {
    return Math.max(0, Math.floor(this.band.playing ? this.band.beat / 4 : (this.log.at(-1)?.beat ?? 0) / 4 + 1))
  }
  private barsWith(test: (p: Played) => boolean) {
    return new Set(this.log.filter(test).map((p) => p.bar)).size
  }

  goalStates(): GoalState[] {
    if (this.step.kind !== 'jam') return []
    const rh = this.rh
    return this.step.goals.map((g: Goal) => {
      let value = 0, target = 1, text = ''
      switch (g.type) {
        case 'notes': value = rh.length; target = g.min; text = `${value} / ${target}`; break
        case 'only': {
          const ok = rh.filter((p) => g.pcs.includes(mod12(p.midi))).length
          value = rh.length >= 8 ? ok / rh.length : 0
          target = g.pct - (this.mic ? 0.12 : 0)
          text = rh.length ? `${Math.round((100 * ok) / rh.length)} %` : '–'
          break
        }
        case 'restBars': {
          const busy = new Map<number, number>()
          for (const p of rh) busy.set(Math.floor(p.beat / 4), (busy.get(Math.floor(p.beat / 4)) ?? 0) + 1)
          // through the microphone a stray phantom note (more with ringing shells) must not spoil a rest
          const slack = !this.mic ? 0 : this.step.kind === 'jam' && this.step.showShell ? 2 : 1
          let rests = 0
          for (let b = 0; b < this.barsDone(); b++) if ((busy.get(b) ?? 0) <= slack) rests++
          value = rests; target = g.min; text = `${value} / ${target}`
          break
        }
        case 'distinct': {
          // through the microphone a note heard only once may be a phantom
          const uses = new Map<number, number>()
          for (const p of rh) uses.set(mod12(p.midi), (uses.get(mod12(p.midi)) ?? 0) + 1)
          const n = [...uses.values()].filter((c) => c >= (this.mic ? 2 : 1)).length
          if (g.max !== undefined) { value = rh.length >= 12 && n <= g.max ? 1 : 0; target = 1; text = `${n} used` } else { value = n; target = g.min ?? 1; text = `${n} / ${target}` }
          break
        }
        case 'uses': value = rh.filter((p) => mod12(p.midi) === g.pc).length; target = g.min; text = `${value} / ${target}`; break
        case 'chordToneOnOne': value = this.barsWith((p) => !p.lh && p.chordTone && p.pos > -0.31 && p.pos < 0.6); target = g.min; text = `${value} / ${target}`; break
        case 'guideOnOne': value = this.barsWith((p) => !p.lh && p.guideTone && p.pos > -0.31 && p.pos < 0.6); target = g.min; text = `${value} / ${target}`; break
        case 'shellBars':
          value = this.barsWith((p) => p.midi < 60 && p.pos > -0.31 && p.pos < 1.1 && shell(this.band.chordAt(p.bar)).some((m) => mod12(m) === mod12(p.midi)))
          target = g.min; text = `${value} / ${target}`
          break
      }
      return { label: g.label, value, target, met: value >= target, text }
    })
  }

  /** a couple of friendly, specific coaching remarks after a jam */
  feedback(): string[] {
    const rh = this.rh
    const bars = Math.max(1, this.barsDone())
    if (rh.length < 4) return ['Nothing to review yet – press Start and play a few phrases.']
    const tips: string[] = []
    const busy = new Set(rh.map((p) => Math.floor(p.beat / 4))).size
    const perBar = rh.length / Math.max(1, busy)
    const out = rh.filter((p) => p.cls === 'out').length / rh.length
    const span = Math.max(...rh.map((p) => p.midi)) - Math.min(...rh.map((p) => p.midi))
    const pcs = new Set(rh.map((p) => mod12(p.midi))).size
    if (busy >= bars && bars >= 4) tips.push('You played in every single bar. Try the opposite next time: one phrase, then two bars of nothing. Silence is what makes the next phrase land.')
    else if (perBar > 7) tips.push('Lots of notes per phrase. Take the same ideas and play half as many notes – choose rhythm over speed.')
    if (out > 0.3) tips.push('Quite a few notes landed on unlit keys. That is fine as a passing colour – just resolve to a glowing key right after.')
    if (span <= 7 && rh.length > 15) tips.push('Everything stayed inside a small hand position. Take one of your phrases and repeat it an octave higher for contrast.')
    if (pcs >= 6 && rh.length < 40) tips.push('You explored many different notes. Pick your favourite three-note idea from that and build the next chorus only from it.')
    const ct = this.barsWith((p) => !p.lh && p.chordTone && p.pos > -0.31 && p.pos < 0.6)
    if (this.step.kind === 'jam' && this.step.guide !== 'scale' && ct < bars / 3) tips.push('Few phrases arrived on a bright key when the bar started. Slow the tempo and aim for just one target note per bar.')
    if (!tips.length) tips.push('Nicely balanced: clear phrases, room to breathe and notes that fit. Raise the tempo a little or switch off the band’s piano and comp for yourself.')
    return tips.slice(0, 2)
  }

  /** score finished echo rounds (called every frame; cheap) */
  private scoreRounds() {
    if (!this.isEcho || !this.band.playing) return
    const done = Math.floor((this.band.beat - 0.6) / 16)
    while (this.rounds.length < done && this.rounds.length < this.totalCycles) {
      const cycle = this.rounds.length
      const call = this.calls[this.callIndex(cycle)]
      const from = cycle * 16 + 8 - 1, to = cycle * 16 + 16 + 0.6
      const mine = this.log.filter((p) => p.beat >= from && p.beat < to).map((p) => p.midi)
      // longest run of the phrase found in order – a stray or missing note costs one, not the rest
      const lcs = new Array<number>(call.length + 1).fill(0)
      for (const m of mine) {
        for (let j = call.length; j > 0; j--) if (call[j - 1].midi === m) lcs[j] = Math.max(lcs[j], lcs[j - 1] + 1)
        for (let j = 1; j <= call.length; j++) lcs[j] = Math.max(lcs[j], lcs[j - 1])
      }
      this.rounds.push({ call: this.callIndex(cycle), matched: lcs[call.length], total: call.length, played: mine.length })
    }
  }
  get echoFinished() {
    return this.isEcho && this.rounds.length >= this.totalCycles
  }

  // ---------- drawing ----------
  resize(w: number, h: number) {
    this.layout = makeLayout(this.lo, this.hi, w, h)
    return this.layout
  }
  get currentLayout() {
    return this.layout
  }

  /** status for the header: bar, chord, phase */
  status() {
    const b = this.band
    const beat = b.beat
    const bar = Math.floor(beat / 4)
    const n = b.chords.length
    const phase = !b.playing ? 'idle' : beat < 0 ? 'count' : this.isEcho ? (bar % 4 < 2 ? 'listen' : 'play') : 'jam'
    return { playing: b.playing, beat, bar, barInForm: ((bar % n) + n) % n, beatInBar: Math.floor(((beat % 4) + 4) % 4), phase, chorus: Math.floor(bar / n) + 1, cycle: Math.floor(bar / 4) }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const l = this.layout
    if (!l) return
    this.scoreRounds()
    const b = this.band
    const now = b.beat
    const bar = Math.max(0, Math.floor((now + 0.3) / 4))
    const g = this.guide(bar)
    const ppb = l.fallH / 8
    ctx.clearRect(0, 0, l.w, l.h)

    // faint lane lines at every C
    ctx.fillStyle = 'rgba(255,255,255,0.035)'
    for (const [m, k] of l.keys) if (m % 12 === 0) ctx.fillRect(k.x, 0, 1, l.fallH)

    if (b.playing) {
      // bar lines travelling with the music
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      const dir = this.isEcho ? 1 : -1
      for (let bb = Math.floor(now / 4) - 3; bb <= Math.floor(now / 4) + 3; bb++) {
        const y = l.fallH - dir * (bb * 4 - now) * ppb
        if (y > 0 && y < l.fallH) ctx.fillRect(0, y, l.w, 1)
      }
    }

    if (this.isEcho && b.playing) {
      // the teacher's phrase falls; then falls again as an outline for your reply
      const cyc = Math.floor(now / 16)
      for (let c = Math.max(0, cyc - 1); c <= cyc + 1; c++) {
        if (c >= this.totalCycles) continue
        const call = this.calls[this.callIndex(c)]
        for (const ghost of [false, true]) {
          if (ghost && (this.step as EchoStep).answer) continue
          for (const n of call) {
            const k = l.keys.get(n.midi)
            if (!k) continue
            const start = c * 16 + n.beat + (ghost ? 8 : 0)
            const y1 = l.fallH - (start - now) * ppb
            const y0 = y1 - n.dur * ppb
            if (y1 < 0 || y0 > l.fallH) continue
            ctx.beginPath()
            ctx.roundRect(k.x + 1, y0, k.w - 2, Math.min(y1, l.fallH) - y0, 4)
            if (ghost) {
              ctx.strokeStyle = COL.safe
              ctx.lineWidth = 2
              ctx.stroke()
            } else {
              ctx.fillStyle = COL.call
              ctx.fill()
            }
          }
        }
      }
    } else {
      // what you played rises away from the keyboard, coloured by how well it fits
      for (let i = this.log.length - 1; i >= 0; i--) {
        const p = this.log[i]
        const y1 = l.fallH - (now - p.beat) * ppb
        if (y1 < -400) break
        const k = l.keys.get(p.midi)
        if (!k) continue
        const y0 = l.fallH - (now - (p.off ?? now)) * ppb
        ctx.fillStyle = COL[p.cls]
        ctx.globalAlpha = Math.max(0.15, Math.min(1, y1 / l.fallH + 0.25))
        ctx.beginPath()
        ctx.roundRect(k.x + 1, y1, k.w - 2, Math.max(5, y0 - y1), 4)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    // keyboard
    const top = l.fallH
    const colourOf = (m: number): string | null => {
      if (g.shell.includes(m)) return COL.lh
      if (g.shell.length && m < 60) return null
      const pc = mod12(m)
      if (g.bright.has(pc)) return COL.bright
      if (g.safe.has(pc)) return COL.safe
      return null
    }
    for (const black of [false, true]) {
      for (const [m, k] of l.keys) {
        if (k.black !== black) continue
        const h = black ? l.kbH * 0.62 : l.kbH
        const c = colourOf(m)
        const down = this.held.has(m) || (this.flash.get(m) ?? 0) > performance.now()
        ctx.beginPath()
        ctx.roundRect(k.x + 0.5, top, k.w - 1, h, [0, 0, 4, 4])
        ctx.fillStyle = black ? '#161922' : '#e9ebf2'
        ctx.fill()
        if (c) {
          const strong = c !== COL.safe || g.bright.size === 0
          ctx.globalAlpha = down ? 0.95 : strong ? (black ? 0.8 : 0.55) : black ? 0.38 : 0.2
          ctx.fillStyle = c
          ctx.fill()
          ctx.globalAlpha = 1
        } else if (down) {
          ctx.fillStyle = 'rgba(138,144,166,0.75)'
          ctx.fill()
        }
        if (!black) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'
          ctx.lineWidth = 1
          ctx.stroke()
        }
        if (c && k.w > 13) {
          ctx.fillStyle = black ? '#fff' : '#1a1206'
          ctx.font = `600 ${Math.min(11, k.w * 0.55)}px ui-sans-serif, system-ui`
          ctx.textAlign = 'center'
          ctx.fillText(PC_NAMES[mod12(m)], k.x + k.w / 2, top + h - 6)
        }
      }
    }
    // beat pulse along the top edge of the keyboard
    if (b.playing) {
      const frac = ((now % 1) + 1) % 1
      ctx.fillStyle = `rgba(180,140,255,${Math.max(0, 0.9 - frac * 2.2)})`
      ctx.fillRect(0, top - 3, l.w, 3)
    }
  }
}
