import type { Engine } from './engine.ts'
import { FRAME, PitchDetector } from './pitch.ts'

/** What the listener should listen for, asked afresh every few milliseconds. */
export interface MicTarget {
  /** candidate pitch → the note it stands for */
  want(): Map<number, number>
  /** notes known to be sounding besides the candidates (see PitchDetector.process) */
  also(): number[]
  /** free playing: the candidates are everything the player might hit, not notes that are due */
  open: boolean
  /** heard notes stay candidates (nothing removes them), so report each strike only once */
  once?: boolean
  /** synthesized notes the app is playing through the speakers right now */
  foreign?(): number[]
  hit(midi: number): void
}

/** Practice mode: listen for exactly the notes the engine is waiting for. */
export function engineTarget(e: Engine): MicTarget {
  return {
    open: false,
    want() {
      // other octaves only if the user allows it
      const want = new Map<number, number>()
      for (const n of e.expected()) want.set(n.midi, n.midi)
      if (e.octaveFree) {
        for (const m of [...want.keys()]) for (const d of [-24, -12, 12, 24]) if (!want.has(m + d)) want.set(m + d, m)
      }
      return want
    },
    also: () => e.accompanimentNow(),
    hit: (m) => e.externalHit(m),
  }
}

/**
 * Acoustic-piano listener. It does not transcribe everything it hears – it verifies that the
 * notes the engine is currently waiting for were freshly struck (see pitch.ts for how).
 */
export class MicListener {
  private analyser: AnalyserNode | null = null
  private buf: Float32Array<ArrayBuffer> = new Float32Array(FRAME)
  private timer = 0
  private stream: MediaStream | null = null
  private source: AudioNode | null = null
  private detector: PitchDetector
  private confirmed = new Map<number, number>()
  private ctx: AudioContext
  private target: MicTarget
  /** loudest piano partial in the last frame, dBFS – for the level meter */
  level = -120

  constructor(ctx: AudioContext, target: MicTarget) {
    this.ctx = ctx
    this.target = target
    this.detector = new PitchDetector(ctx.sampleRate, { once: !!target.once })
  }

  /** cents the instrument is tuned away from A = 440 Hz (estimated while listening) */
  get tuning() {
    return this.detector.tuning
  }

  async start() {
    // the browser's speech processing mangles piano tone – switch all of it off
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
    this.listen(this.ctx.createMediaStreamSource(this.stream))
  }

  /** analyse any audio node (the microphone in real use) */
  listen(node: AudioNode) {
    this.source = node
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = FRAME
    node.connect(this.analyser)
    this.timer = window.setInterval(() => this.poll(), 20)
  }

  stop() {
    clearInterval(this.timer)
    try {
      if (this.source && this.analyser) this.source.disconnect(this.analyser)
    } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.analyser = null
  }

  private poll() {
    const an = this.analyser
    if (!an) return
    an.getFloatTimeDomainData(this.buf)
    const tg = this.target
    const want = tg.want()
    // Notes that explain what is sounding besides the ones still awaited: chord notes confirmed a
    // moment ago, and whatever the app itself plays through the speakers. Without them their
    // overtones could be mistaken for the player hitting a lower octave.
    const now = this.ctx.currentTime
    for (const [m, t] of this.confirmed) if (now - t > 0.8) this.confirmed.delete(m)
    const also = tg.open ? tg.also() : [...this.confirmed.keys(), ...tg.also()]
    const hits = this.detector.process(this.buf, now, want.keys(), also, tg.open, tg.foreign?.() ?? [])
    this.level = this.detector.level
    const done = new Set<number>()
    for (const p of hits) {
      const m = want.get(p)!
      if (done.has(m)) continue
      done.add(m)
      this.confirmed.set(p, now)
      tg.hit(m)
    }
  }
}
