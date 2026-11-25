import type { Engine } from '../lib/engine.ts'
import { HIT, MISSED } from '../lib/engine.ts'
import { isBlack, noteName } from '../music/types.ts'
import type { Song } from '../music/types.ts'

export interface KeyGeom { x: number; w: number; black: boolean }
export interface Layout {
  lo: number
  hi: number
  keys: Map<number, KeyGeom>
  whiteW: number
  kbH: number
  fallH: number
  w: number
  h: number
}

export const COLORS = {
  R: { main: '#ffb454', dark: '#f08a3c', glow: 'rgba(255,170,80,0.55)' },
  L: { main: '#5ccfe6', dark: '#3d8fe0', glow: 'rgba(80,190,240,0.55)' },
  hit: '#7ee787',
  miss: '#ff6b6b',
}

export function songRange(song: Song, full: boolean): [number, number] {
  if (full || !song.notes.length) return [21, 108]
  let lo = 127
  let hi = 0
  for (const n of song.notes) {
    if (n.midi < lo) lo = n.midi
    if (n.midi > hi) hi = n.midi
  }
  lo -= 2
  hi += 2
  while (hi - lo < 35) {
    lo -= 1
    hi += 1
  }
  // snap outwards to C/F at the bottom and E/B at the top so the keyboard looks natural
  lo = Math.max(21, lo)
  hi = Math.min(108, hi)
  while (lo > 21 && lo % 12 !== 0 && lo % 12 !== 5) lo--
  while (hi < 108 && hi % 12 !== 4 && hi % 12 !== 11) hi++
  return [lo, hi]
}

export function makeLayout(lo: number, hi: number, w: number, h: number): Layout {
  let whites = 0
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++
  const whiteW = w / whites
  const keys = new Map<number, KeyGeom>()
  let i = 0
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) {
      keys.set(m, { x: i * whiteW, w: whiteW, black: false })
      i++
    } else {
      const bw = whiteW * 0.62
      keys.set(m, { x: i * whiteW - bw / 2, w: bw, black: true })
    }
  }
  const kbH = Math.round(Math.max(70, Math.min(150, Math.min(h * 0.22, whiteW * 5.2))))
  return { lo, hi, keys, whiteW, kbH, fallH: h - kbH, w, h }
}

export function keyAt(l: Layout, x: number, y: number): number | null {
  if (y < l.fallH) return null
  const inBlackZone = y < l.fallH + l.kbH * 0.62
  if (inBlackZone) for (const [m, k] of l.keys) if (k.black && x >= k.x && x <= k.x + k.w) return m
  for (const [m, k] of l.keys) if (!k.black && x >= k.x && x < k.x + k.w) return m
  return null
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export interface DrawOpts { showNames: boolean; zoom: number; fifths: number }

export function draw(ctx: CanvasRenderingContext2D, l: Layout, e: Engine, o: DrawOpts) {
  const { w, fallH, kbH } = l
  const song = e.song
  const beat = e.beat
  const windowBeats = (o.zoom * song.bpm) / 60
  const ppb = fallH / windowBeats

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, fallH)
  bg.addColorStop(0, '#0d1017')
  bg.addColorStop(1, '#141925')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, fallH)

  // lanes
  for (const [m, k] of l.keys) {
    if (k.black) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(k.x, 0, k.w, fallH)
    } else if (m % 12 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.fillRect(k.x - 0.5, 0, 1, fallH)
    } else if (m % 12 === 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      ctx.fillRect(k.x - 0.5, 0, 1, fallH)
    }
  }

  const yOf = (b: number) => fallH - (b - beat) * ppb

  // loop shading
  if (e.loop) {
    const y1 = yOf(e.loop.from)
    const y0 = yOf(e.loop.to)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    if (y1 < fallH) ctx.fillRect(0, Math.max(0, y1), w, fallH - Math.max(0, y1))
    if (y0 > 0) ctx.fillRect(0, 0, w, Math.min(y0, fallH))
    ctx.strokeStyle = 'rgba(180,140,255,0.8)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    for (const y of [y0, y1]) {
      if (y > 0 && y < fallH) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
    }
    ctx.setLineDash([])
  }

  // measure lines
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  for (const m of song.measures) {
    if (m.beat < beat - 0.01) continue
    if (m.beat > beat + windowBeats) break
    const y = Math.round(yOf(m.beat)) + 0.5
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(0, y, w, 1)
    ctx.fillStyle = 'rgba(255,255,255,0.32)'
    ctx.fillText(String(m.index + 1), 6, y - 3)
  }

  // notes
  const active = new Map<number, 'L' | 'R'>()
  const notes = song.notes
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const nameFont = `700 ${Math.max(9, Math.min(13, l.whiteW * 0.42))}px ui-sans-serif, system-ui, sans-serif`
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (n.beat > beat + windowBeats) break
    if (n.beat + n.dur < beat) continue
    const k = l.keys.get(n.midi)
    if (!k) continue
    const practice = e.isPractice(n)
    const col = COLORS[n.hand]
    const isActive = n.beat <= beat + 1e-4 && n.beat + n.dur > beat
    const state = e.noteState[n.id]
    if (isActive && (practice ? e.mode === 'watch' || state === HIT : e.accompany)) active.set(n.midi, n.hand)
    const y1 = Math.min(yOf(n.beat), fallH)
    const y0 = yOf(n.beat + n.dur) + 1.5
    const hgt = Math.max(y1 - y0, 4)
    const pad = k.black ? 0 : Math.min(3, k.w * 0.12)
    const x = k.x + pad
    const bw = k.w - pad * 2
    ctx.globalAlpha = practice ? 1 : 0.28
    if (isActive && practice) {
      ctx.shadowColor = col.glow
      ctx.shadowBlur = 18
    }
    const g = ctx.createLinearGradient(0, y1 - hgt, 0, y1)
    let c0 = k.black ? col.dark : col.main
    let c1 = col.dark
    if (state === HIT && e.mode !== 'watch') c0 = c1 = COLORS.hit
    else if (state === MISSED) c0 = c1 = COLORS.miss
    g.addColorStop(0, c0)
    g.addColorStop(1, c1)
    ctx.fillStyle = g
    rr(ctx, x, y1 - hgt, bw, hgt, 5)
    ctx.fill()
    ctx.shadowBlur = 0
    if (k.black) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (o.showNames && practice && hgt > 17 && bw > 11) {
      ctx.font = nameFont
      ctx.fillStyle = 'rgba(15,18,28,0.85)'
      ctx.fillText(noteName(n.midi, o.fifths), x + bw / 2, y1 - 5)
    }
    ctx.globalAlpha = 1
  }

  // hit line
  const hl = ctx.createLinearGradient(0, fallH - 26, 0, fallH)
  hl.addColorStop(0, 'rgba(255,255,255,0)')
  hl.addColorStop(1, 'rgba(255,255,255,0.10)')
  ctx.fillStyle = hl
  ctx.fillRect(0, fallH - 26, w, 26)

  // keyboard
  const req = new Map<number, 'L' | 'R'>()
  for (const n of e.requiredNow()) req.set(n.midi, n.hand)
  const pulse = 0.62 + 0.38 * Math.sin(performance.now() / 160)
  const ky = fallH
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, ky, w, kbH)
  const keyColor = (m: number, black: boolean): string | CanvasGradient => {
    if (e.wrongFlash.has(m)) return COLORS.miss
    if (e.okFlash.has(m)) return COLORS.hit
    const p = e.pressed.get(m)
    if (p !== undefined) return e.playing && e.mode !== 'watch' ? (p ? COLORS.hit : COLORS.miss) : '#c9b6ff'
    const a = active.get(m)
    if (a) return black ? COLORS[a].dark : COLORS[a].main
    if (black) {
      const g = ctx.createLinearGradient(0, ky, 0, ky + kbH * 0.62)
      g.addColorStop(0, '#2a2d36')
      g.addColorStop(1, '#0c0d12')
      return g
    }
    const g = ctx.createLinearGradient(0, ky, 0, ky + kbH)
    g.addColorStop(0, '#d9dbe2')
    g.addColorStop(0.12, '#f7f7fa')
    g.addColorStop(1, '#e6e7ee')
    return g
  }
  for (const [m, k] of l.keys) {
    if (k.black) continue
    ctx.fillStyle = keyColor(m, false)
    rr(ctx, k.x + 0.75, ky + 2, k.w - 1.5, kbH - 4, 4)
    ctx.fill()
    const r = req.get(m)
    if (r) {
      ctx.globalAlpha = pulse
      ctx.fillStyle = COLORS[r].main
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (m % 12 === 0 || (o.showNames && k.w > 17)) {
      ctx.font = `600 ${Math.max(8, Math.min(11, k.w * 0.4))}px ui-sans-serif, system-ui, sans-serif`
      ctx.fillStyle = m % 12 === 0 ? 'rgba(20,24,36,0.75)' : 'rgba(20,24,36,0.38)'
      ctx.fillText(m % 12 === 0 ? 'C' + (m / 12 - 1) : noteName(m, 0), k.x + k.w / 2, ky + kbH - 8)
    }
  }
  for (const [m, k] of l.keys) {
    if (!k.black) continue
    ctx.fillStyle = keyColor(m, true)
    rr(ctx, k.x, ky + 1, k.w, kbH * 0.62, 3)
    ctx.fill()
    const r = req.get(m)
    if (r) {
      ctx.globalAlpha = pulse
      ctx.fillStyle = COLORS[r].dark
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
  // felt strip
  ctx.fillStyle = '#7a2230'
  ctx.fillRect(0, ky - 1, w, 3)

  // count-in
  const start = e.rangeStart
  if (e.playing && beat < start - 0.02) {
    const left = Math.ceil(start - beat)
    const frac = 1 - ((start - beat) % 1)
    ctx.globalAlpha = 0.25 + 0.6 * (1 - frac)
    ctx.fillStyle = '#fff'
    ctx.font = `800 ${Math.round(Math.min(fallH * 0.3, 140))}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(left), w / 2, fallH * 0.42)
    ctx.globalAlpha = 1
    ctx.textBaseline = 'alphabetic'
  }
}

/** tiny piano-roll thumbnail for library cards */
export function drawThumb(canvas: HTMLCanvasElement, song: Song) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)
  if (!song.notes.length) return
  let lo = 127
  let hi = 0
  for (const n of song.notes) {
    lo = Math.min(lo, n.midi)
    hi = Math.max(hi, n.midi)
  }
  const span = Math.max(hi - lo, 12)
  const beats = Math.min(song.totalBeats, 48)
  for (const n of song.notes) {
    if (n.beat > beats) break
    const x = (n.beat / beats) * w
    const y = h - 6 - ((n.midi - lo) / span) * (h - 12)
    ctx.fillStyle = COLORS[n.hand].main
    ctx.globalAlpha = 0.9
    rr(ctx, x, y - 2, Math.max(3, (n.dur / beats) * w - 1), 4, 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
