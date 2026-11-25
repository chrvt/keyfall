/** Small sampled piano (Salamander Grand, CC-BY 3.0, Alexander Holm) with a synth fallback. */
const SAMPLE_NAMES = ['A', 'C', 'Ds', 'Fs']

interface Voice { src: AudioScheduledSourceNode[]; gain: GainNode; midi: number; tag: string; end: number }

export class PianoAudio {
  ctx: AudioContext | null = null
  master!: GainNode
  private buffers = new Map<number, AudioBuffer>()
  private loading = false
  loaded = false
  private voices: Voice[] = []
  private _volume = 0.9
  onLoaded?: () => void

  get now() {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000
  }

  /** must be called from a user gesture at least once */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      this.ctx = new AC({ latencyHint: 'interactive' })
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 4
      this.master = this.ctx.createGain()
      this.master.gain.value = this._volume
      this.master.connect(comp).connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    if (!this.loading) {
      this.loading = true
      void this.loadSamples()
    }
  }

  set volume(v: number) {
    this._volume = v
    if (this.ctx) this.master.gain.value = v
  }
  get volume() {
    return this._volume
  }

  private async loadSamples() {
    const ctx = this.ctx!
    const jobs: Promise<void>[] = []
    for (let midi = 21; midi <= 108; midi += 3) {
      const oct = Math.floor(midi / 12) - 1
      const name = SAMPLE_NAMES[((midi - 21) / 3) % 4] + oct
      jobs.push(
        fetch(`${import.meta.env.BASE_URL}samples/${name}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
          .then((b) => ctx.decodeAudioData(b))
          .then((buf) => void this.buffers.set(midi, buf))
          .catch(() => {}),
      )
    }
    await Promise.all(jobs)
    this.loaded = this.buffers.size > 8
    this.onLoaded?.()
  }

  private start(midi: number, vel: number, when: number, tag: string): Voice | null {
    const ctx = this.ctx
    if (!ctx) return null
    const t = Math.max(when, ctx.currentTime)
    const gain = ctx.createGain()
    gain.connect(this.master)
    const src: AudioScheduledSourceNode[] = []
    const level = 0.18 + vel * 0.75
    let sampleMidi = 21 + Math.round((midi - 21) / 3) * 3
    if (!this.buffers.has(sampleMidi)) {
      const near = [...this.buffers.keys()].sort((a, b) => Math.abs(a - midi) - Math.abs(b - midi))[0]
      if (near !== undefined && Math.abs(near - midi) <= 7) sampleMidi = near
    }
    const buf = this.buffers.get(sampleMidi)
    if (buf) {
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12)
      s.connect(gain)
      gain.gain.setValueAtTime(level, t)
      s.start(t)
      src.push(s)
    } else {
      const f = 440 * Math.pow(2, (midi - 69) / 12)
      const decay = Math.max(0.5, 3.2 - (midi - 21) / 30)
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(level * 0.5, t + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0008, t + decay)
      for (const [type, mult, g] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3, 0.12]] as const) {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.value = f * mult
        const og = ctx.createGain()
        og.gain.value = g
        o.connect(og).connect(gain)
        o.start(t)
        o.stop(t + decay + 0.1)
        src.push(o)
      }
    }
    const v: Voice = { src, gain, midi, tag, end: t + 12 }
    this.voices.push(v)
    if (this.voices.length > 90) this.voices = this.voices.filter((x) => x.end > ctx.currentTime)
    return v
  }

  private release(v: Voice, when: number, fast = false) {
    const ctx = this.ctx!
    const t = Math.max(when, ctx.currentTime)
    const tc = fast ? 0.02 : 0.09
    try {
      v.gain.gain.cancelScheduledValues(t)
      v.gain.gain.setTargetAtTime(0, t, tc)
      for (const s of v.src) s.stop(t + tc * 8)
    } catch { /* already stopped */ }
    v.end = t + tc * 8
  }

  noteOn(midi: number, vel = 0.75, tag = 'user') {
    this.ensure()
    this.start(midi, vel, 0, tag)
  }

  noteOff(midi: number, tag = 'user') {
    if (!this.ctx) return
    for (const v of this.voices) if (v.midi === midi && v.tag === tag && v.end > this.ctx.currentTime + 1) this.release(v, 0)
  }

  /** schedule a full note */
  play(midi: number, vel: number, when: number, durSec: number, tag = 'auto') {
    const v = this.start(midi, vel, when, tag)
    if (v) this.release(v, Math.max(when, this.ctx!.currentTime) + Math.max(durSec, 0.08))
  }

  stopAll(tag?: string) {
    if (!this.ctx) return
    for (const v of this.voices) if (!tag || v.tag === tag) this.release(v, 0, true)
    this.voices = this.voices.filter((v) => tag && v.tag !== tag)
  }

  click(when: number, accent: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    const t = Math.max(when, ctx.currentTime)
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = accent ? 1560 : 1040
    g.gain.setValueAtTime(accent ? 0.35 : 0.22, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.08)
  }

  /** plucked upright-bass-like tone for the Jazz Lab band */
  bass(midi: number, when: number, durSec: number, vel = 0.7) {
    const ctx = this.ctx
    if (!ctx) return
    const t = Math.max(when, ctx.currentTime)
    const f = 440 * Math.pow(2, (midi - 69) / 12)
    const g = ctx.createGain()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.25)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.16 * vel, t + 0.3)
    g.gain.setTargetAtTime(0, t + durSec, 0.05)
    const src: AudioScheduledSourceNode[] = []
    for (const [type, mult, lvl] of [['triangle', 1, 1], ['sawtooth', 1, 0.25], ['sine', 2, 0.3]] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f * mult
      const og = ctx.createGain()
      og.gain.value = lvl
      o.connect(og).connect(lp)
      o.start(t)
      o.stop(t + durSec + 0.4)
      src.push(o)
    }
    lp.connect(g).connect(this.master)
    this.voices.push({ src, gain: g, midi, tag: 'band', end: t + durSec + 0.4 })
  }

  private noise: AudioBuffer | null = null
  /** tiny synthesized jazz kit: ride cymbal, hi-hat "chick", brushed snare, soft kick, stick click */
  drum(kind: 'ride' | 'hat' | 'snare' | 'kick' | 'stick', when: number, vel = 0.6) {
    const ctx = this.ctx
    if (!ctx) return
    const t = Math.max(when, ctx.currentTime)
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    const g = ctx.createGain()
    g.connect(this.master)
    if (kind === 'kick') {
      const o = ctx.createOscillator()
      o.frequency.setValueAtTime(110, t)
      o.frequency.exponentialRampToValueAtTime(45, t + 0.1)
      g.gain.setValueAtTime(0.5 * vel, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      o.connect(g)
      o.start(t)
      o.stop(t + 0.2)
      return
    }
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const f = ctx.createBiquadFilter()
    const [type, freq, q, level, decay] = (
      { ride: ['bandpass', 7200, 1.2, 0.2, 0.32], hat: ['highpass', 8500, 0.7, 0.16, 0.045], snare: ['bandpass', 2400, 0.8, 0.22, 0.11], stick: ['bandpass', 1900, 6, 0.6, 0.03] } as const
    )[kind]
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    g.gain.setValueAtTime(level * vel, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + decay)
    n.connect(f).connect(g)
    n.start(t, Math.random() * 0.5)
    n.stop(t + decay + 0.02)
    if (kind === 'ride') {
      // a little metallic "ping" on top of the wash
      const o = ctx.createOscillator()
      const og = ctx.createGain()
      o.type = 'square'
      o.frequency.value = 5300
      og.gain.setValueAtTime(0.018 * vel, t)
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.12)
      o.connect(og).connect(this.master)
      o.start(t)
      o.stop(t + 0.14)
    }
  }

  chime() {
    this.ensure()
    const t = this.ctx!.currentTime
    ;[72, 76, 79, 84].forEach((m, i) => this.play(m, 0.5, t + i * 0.09, 0.5, 'fx'))
  }
}

export const audio = new PianoAudio()
