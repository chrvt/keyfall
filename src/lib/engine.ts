import type { Note, Song } from '../music/types.ts'
import { measureAt } from '../music/types.ts'
import type { PianoAudio } from './audio.ts'

export type Mode = 'watch' | 'wait' | 'perform'
export type HandSel = 'both' | 'L' | 'R'

interface Step { beat: number; notes: Note[]; hit: Set<number>; mistakes: number; measure: number }

export interface RunResult {
  mode: Mode
  accuracy: number
  hits: number
  misses: number
  wrong: number
  /** per measure: [attempts, clean] */
  measures: Record<number, [number, number]>
  partial: boolean
}

export const PENDING = 0, HIT = 1, MISSED = 2

export class Engine {
  song: Song
  audio: PianoAudio
  beat = -1
  playing = false
  waiting = false
  finished = false
  speed = 1
  mode: Mode = 'watch'
  hands: HandSel = 'both'
  accompany = true
  demoSound = true
  metronome = false
  octaveFree = false
  loop: { from: number; to: number } | null = null
  autoSpeed: { step: number; target: number } | null = null
  loopCount = 0

  /** keys the user currently holds → true if it was a correct key */
  pressed = new Map<number, boolean>()
  wrongFlash = new Map<number, number>()
  okFlash = new Map<number, number>()
  /** true while the microphone listener is driving the judging (looser timing) */
  micOn = false
  pitchLo = 21
  pitchHi = 108
  noteState: Uint8Array
  hits = 0
  misses = 0
  wrong = 0
  combo = 0
  bestCombo = 0
  private passWrong = 0
  private measureStats: Record<number, [number, number]> = {}

  private steps: Step[] = []
  private stepIdx = 0
  private judgeIdx = 0
  private practiceNotes: Note[] = []
  private schedIdx = 0
  private schedBeat = -Infinity
  private clicks: { beat: number; accent: boolean }[] = []
  private clickIdx = 0
  private lastTime = 0
  private raf = 0
  private listeners = new Set<() => void>()
  private frameFns = new Set<() => void>()
  private lastEmit = 0
  version = 0
  onFinish?: (r: RunResult) => void
  onLoop?: () => void
  onPracticeTime?: (sec: number) => void
  private timeAcc = 0

  constructor(song: Song, audio: PianoAudio) {
    this.song = song
    this.audio = audio
    this.noteState = new Uint8Array(song.notes.length)
    if (song.notes.length) {
      this.pitchLo = Math.min(...song.notes.map((n) => n.midi))
      this.pitchHi = Math.max(...song.notes.map((n) => n.midi))
    }
    {
      const m0 = song.measures[0]
      const unit = 4 / m0.den
      const n = Math.max(1, Math.round(((m0.num * 4) / m0.den) / unit))
      for (let k = n; k >= 1; k--) this.clicks.push({ beat: -k * unit, accent: k === n })
    }
    for (const m of song.measures) {
      const unit = 4 / m.den
      const n = Math.round(m.len / unit)
      for (let k = 0; k < n; k++) this.clicks.push({ beat: m.beat + k * unit, accent: k === 0 })
    }
    this.rebuild()
    this.seek(this.startBeat(), true)
    const loop = () => {
      this.tick()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.audio.stopAll()
    this.flushTime()
    this.listeners.clear()
    this.frameFns.clear()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  onFrame(fn: () => void) {
    this.frameFns.add(fn)
    return () => void this.frameFns.delete(fn)
  }
  getVersion = () => this.version
  emit() {
    this.version++
    this.lastEmit = performance.now()
    for (const l of this.listeners) l()
  }

  get bps() {
    return (this.song.bpm * this.speed) / 60
  }
  get rangeStart() {
    return this.loop ? this.loop.from : 0
  }
  get rangeEnd() {
    return this.loop ? this.loop.to : this.song.totalBeats
  }
  private leadIn() {
    const m = this.song.measures[measureAt(this.song.measures, Math.max(0, this.rangeStart))]
    return this.metronome ? m.len : Math.min(2, m.len)
  }
  startBeat() {
    return this.rangeStart - this.leadIn()
  }

  isPractice(n: Note) {
    return this.hands === 'both' || n.hand === this.hands
  }
  private autoPlays(n: Note) {
    if (this.isPractice(n)) return this.mode === 'watch' && this.demoSound
    return this.accompany
  }

  /** call after changing mode / hands */
  rebuild() {
    const by = new Map<number, Step>()
    this.practiceNotes = []
    for (const n of this.song.notes) {
      if (!this.isPractice(n)) continue
      this.practiceNotes.push(n)
      const k = Math.round(n.beat * 48)
      let s = by.get(k)
      if (!s) by.set(k, (s = { beat: n.beat, notes: [], hit: new Set(), mistakes: 0, measure: n.measure }))
      s.notes.push(n)
    }
    this.steps = [...by.values()].sort((a, b) => a.beat - b.beat)
    this.resetRun()
    this.seek(Math.max(this.beat, this.startBeat()), true)
  }

  resetRun() {
    this.hits = this.misses = this.wrong = this.combo = this.bestCombo = this.passWrong = 0
    this.measureStats = {}
    this.finished = false
  }

  set<K extends 'mode' | 'hands' | 'accompany' | 'demoSound' | 'metronome' | 'octaveFree' | 'autoSpeed'>(k: K, v: this[K]) {
    if (this[k] === v) return
    ;(this as any)[k] = v
    if (k === 'mode' || k === 'hands') this.rebuild()
    else this.reschedule()
    this.emit()
  }

  setSpeed(s: number) {
    this.speed = Math.max(0.2, Math.min(1.5, Math.round(s * 100) / 100))
    this.reschedule()
    this.emit()
  }

  setLoop(loop: { from: number; to: number } | null) {
    this.loop = loop && loop.to > loop.from ? loop : null
    this.loopCount = 0
    if (this.loop && (this.beat < this.startBeat() || this.beat >= this.loop.to)) this.seek(this.startBeat())
    this.emit()
  }

  private reschedule() {
    this.audio.stopAll('auto')
    this.seek(this.beat, true)
  }

  seek(beat: number, quiet = false) {
    const b = Math.max(this.startBeat(), Math.min(beat, this.song.totalBeats))
    this.beat = b
    this.waiting = false
    this.audio.stopAll('auto')
    const notes = this.song.notes
    const b0 = Math.max(b, this.rangeStart)
    let i = 0
    while (i < notes.length && notes[i].beat < b0 - 1e-6) i++
    this.schedIdx = i
    this.schedBeat = b0
    for (let j = i; j < notes.length; j++) this.noteState[j] = PENDING
    this.stepIdx = this.steps.findIndex((s) => s.beat >= b0 - 1e-6)
    if (this.stepIdx < 0) this.stepIdx = this.steps.length
    for (let j = this.stepIdx; j < this.steps.length; j++) {
      this.steps[j].hit.clear()
      this.steps[j].mistakes = 0
    }
    this.judgeIdx = this.practiceNotes.findIndex((n) => n.beat >= b0 - 1e-6)
    if (this.judgeIdx < 0) this.judgeIdx = this.practiceNotes.length
    this.clickIdx = this.clicks.findIndex((c) => c.beat >= b - 1e-6)
    if (this.clickIdx < 0) this.clickIdx = this.clicks.length
    this.finished = false
    if (!quiet) this.emit()
  }

  play() {
    this.audio.ensure()
    if (this.finished || this.beat >= this.rangeEnd - 1e-3) {
      this.resetRun()
      this.seek(this.startBeat(), true)
    }
    this.playing = true
    this.lastTime = this.audio.now
    this.emit()
  }
  pause() {
    this.playing = false
    this.waiting = false
    this.audio.stopAll('auto')
    const b0 = Math.max(this.beat, this.rangeStart)
    this.schedBeat = b0
    let i = 0
    const notes = this.song.notes
    while (i < notes.length && notes[i].beat < b0 - 1e-6) i++
    this.schedIdx = i
    this.flushTime()
    this.emit()
  }
  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }
  restart() {
    this.resetRun()
    this.seek(this.startBeat())
  }

  private flushTime() {
    if (this.timeAcc > 0.5) {
      this.onPracticeTime?.(this.timeAcc)
      this.timeAcc = 0
    }
  }

  private tick() {
    const now = this.audio.now
    const dt = Math.min(Math.max(now - this.lastTime, 0), 0.25)
    this.lastTime = now
    if (this.playing) {
      this.timeAcc += dt
      if (this.timeAcc > 10) this.flushTime()
      let nb = this.beat + dt * this.bps
      // wait mode: stop at the next unfinished step
      this.waiting = false
      if (this.mode === 'wait') {
        const s = this.steps[this.stepIdx]
        if (s && s.beat < this.rangeEnd && nb >= s.beat) {
          nb = s.beat
          this.waiting = true
        }
      }
      this.beat = nb
      this.schedule(now)
      if (this.mode === 'perform') this.judgeMissed()
      const end = this.rangeEnd
      if (nb >= end + (this.loop ? 0 : 0.5)) {
        if (this.loop) {
          this.loopCount++
          if (this.autoSpeed && (this.mode === 'watch' || this.passWrong <= 1) && this.speed < this.autoSpeed.target) {
            this.speed = Math.min(this.autoSpeed.target, Math.round((this.speed + this.autoSpeed.step) * 100) / 100)
          }
          this.passWrong = 0
          this.onLoop?.()
          this.seek(this.startBeat(), true)
          this.emit()
        } else {
          this.playing = false
          this.finished = true
          this.flushTime()
          this.onFinish?.(this.result(false))
          this.emit()
        }
      }
    }
    const t = performance.now()
    for (const [k, until] of this.wrongFlash) if (until < t) this.wrongFlash.delete(k)
    for (const [k, until] of this.okFlash) if (until < t) this.okFlash.delete(k)
    for (const f of this.frameFns) f()
    if (this.playing && t - this.lastEmit > 200) this.emit()
  }

  result(partial: boolean): RunResult {
    const total = this.mode === 'wait'
      ? Object.values(this.measureStats).reduce((a, m) => a + m[0], 0)
      : this.hits + this.misses + this.wrong
    const good = this.mode === 'wait' ? Object.values(this.measureStats).reduce((a, m) => a + m[1], 0) : this.hits
    return {
      mode: this.mode, accuracy: total ? good / total : 0, hits: this.hits, misses: this.misses,
      wrong: this.wrong, measures: { ...this.measureStats }, partial,
    }
  }

  private schedule(now: number) {
    const bps = this.bps
    let horizon = this.beat + 0.12 * bps
    if (this.mode === 'wait') {
      const s = this.steps[this.stepIdx]
      if (s && s.beat < this.rangeEnd) horizon = Math.min(horizon, s.beat)
    }
    horizon = Math.min(horizon, this.rangeEnd)
    const notes = this.song.notes
    while (this.schedIdx < notes.length && notes[this.schedIdx].beat < horizon) {
      const n = notes[this.schedIdx++]
      if (n.beat < this.schedBeat - 1e-6 || !this.autoPlays(n)) continue
      const when = now + (n.beat - this.beat) / bps
      const vel = this.isPractice(n) ? n.vel : n.vel * 0.8
      this.audio.play(n.midi, vel, when, n.dur / bps, 'auto')
    }
    if (this.metronome) {
      while (this.clickIdx < this.clicks.length && this.clicks[this.clickIdx].beat < horizon) {
        const c = this.clicks[this.clickIdx++]
        if (c.beat >= this.beat - 0.05) this.audio.click(now + (c.beat - this.beat) / bps, c.accent)
      }
    }
  }

  private windowBeats() {
    return Math.max((this.micOn ? 0.45 : 0.3) * this.bps, 0.2)
  }
  private earlyBeats() {
    return Math.max(0.45, 0.35 * this.bps)
  }

  /** notes the player is expected to strike right now (used by the microphone listener) */
  expected(): Note[] {
    if (!this.playing) return []
    if (this.mode === 'wait') {
      const s = this.steps[this.stepIdx]
      if (!s || s.beat >= this.rangeEnd || s.beat - this.beat > this.earlyBeats()) return []
      return s.notes.filter((n) => !s.hit.has(n.id))
    }
    if (this.mode === 'perform') {
      const w = this.windowBeats()
      const out: Note[] = []
      for (let i = this.judgeIdx; i < this.practiceNotes.length; i++) {
        const n = this.practiceNotes[i]
        if (n.beat > this.beat + w) break
        if (this.noteState[n.id] === PENDING) out.push(n)
      }
      return out
    }
    return []
  }

  /** pitches the app itself is sounding around now (the hand it accompanies) – for the microphone */
  accompanimentNow(): number[] {
    if (!this.playing || !this.accompany || this.hands === 'both') return []
    const out: number[] = []
    const lo = this.beat - 0.4 * this.bps, hi = this.beat + 0.15 * this.bps
    for (const n of this.song.notes) {
      if (n.beat > hi) break
      if (n.beat >= lo && !this.isPractice(n)) out.push(n.midi)
    }
    return out
  }

  /** a note confirmed by the microphone: counts as a hit, never as a wrong key */
  externalHit(midi: number) {
    if (!this.playing) return
    if (this.mode === 'wait') this.judgeWait(midi)
    else if (this.mode === 'perform') this.judgePerform(midi)
    this.okFlash.set(midi, performance.now() + 260)
  }

  private judgeMissed() {
    const w = this.windowBeats()
    while (this.judgeIdx < this.practiceNotes.length) {
      const n = this.practiceNotes[this.judgeIdx]
      if (n.beat >= this.beat - w || n.beat >= this.rangeEnd) break
      if (this.noteState[n.id] === PENDING) {
        this.noteState[n.id] = MISSED
        this.misses++
        this.combo = 0
        const ms = (this.measureStats[n.measure] ??= [0, 0])
        ms[0]++
      }
      this.judgeIdx++
    }
  }

  private match(a: number, b: number) {
    return this.octaveFree ? (a - b) % 12 === 0 : a === b
  }

  userNoteOn(midi: number, vel = 0.75) {
    this.audio.noteOn(midi, vel, 'user')
    let correct = true
    if (this.playing && this.mode === 'wait') correct = this.judgeWait(midi)
    else if (this.playing && this.mode === 'perform') correct = this.judgePerform(midi)
    if (!correct) {
      this.wrong++
      this.passWrong++
      this.combo = 0
      this.wrongFlash.set(midi, performance.now() + 350)
    }
    this.pressed.set(midi, correct)
  }

  userNoteOff(midi: number) {
    this.audio.noteOff(midi, 'user')
    this.pressed.delete(midi)
  }

  private judgeWait(midi: number): boolean {
    const s = this.steps[this.stepIdx]
    if (!s || s.beat >= this.rangeEnd) return true
    if (s.beat - this.beat > this.earlyBeats()) return true // far from next note: free play
    const target = s.notes.find((n) => this.match(n.midi, midi) && !s.hit.has(n.id))
    if (!target) {
      if (s.notes.some((n) => this.match(n.midi, midi))) return true
      s.mistakes++
      return false
    }
    s.hit.add(target.id)
    this.noteState[target.id] = HIT
    this.hits++
    if (s.hit.size >= s.notes.length || (this.octaveFree && new Set(s.notes.map((n) => n.midi % 12)).size <= new Set([...s.hit].map((id) => this.song.notes[id].midi % 12)).size)) {
      for (const n of s.notes) this.noteState[n.id] = HIT
      const ms = (this.measureStats[s.measure] ??= [0, 0])
      ms[0]++
      if (s.mistakes === 0) {
        ms[1]++
        this.combo++
        this.bestCombo = Math.max(this.bestCombo, this.combo)
      }
      this.stepIdx++
      this.waiting = false
    }
    return true
  }

  private judgePerform(midi: number): boolean {
    const w = this.windowBeats()
    let best: Note | null = null
    for (let i = this.judgeIdx; i < this.practiceNotes.length; i++) {
      const n = this.practiceNotes[i]
      if (n.beat > this.beat + w) break
      if (this.noteState[n.id] !== PENDING || !this.match(n.midi, midi)) continue
      if (!best || Math.abs(n.beat - this.beat) < Math.abs(best.beat - this.beat)) best = n
    }
    if (!best) return false
    this.noteState[best.id] = HIT
    this.hits++
    this.combo++
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    const ms = (this.measureStats[best.measure] ??= [0, 0])
    ms[0]++
    ms[1]++
    return true
  }

  /** pitches the user must press right now (wait mode) */
  requiredNow(): Note[] {
    if (this.mode !== 'wait' || !this.waiting) return []
    const s = this.steps[this.stepIdx]
    return s ? s.notes.filter((n) => !s.hit.has(n.id)) : []
  }
}
