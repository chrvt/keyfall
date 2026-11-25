import { useEffect, useRef, useState } from 'react'
import type { Engine } from '../lib/engine.ts'
import { measureAt } from '../music/types.ts'
import { songToMusicXml } from '../music/toMusicXml.ts'

interface Box { x: number; y: number; w: number; h: number }

/** Horizontal, auto-scrolling sheet-music strip that follows playback. */
export function SheetView({ engine }: { engine: Engine }) {
  const scroller = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const hl = useRef<HTMLDivElement>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const boxes = useRef<Box[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const song = engine.song

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    boxes.current = []
    const el = host.current!
    el.innerHTML = ''
    ;(async () => {
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
        if (cancelled) return
        const osmd = new OpenSheetMusicDisplay(el, {
          backend: 'svg',
          autoResize: false,
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawPartNames: false,
          drawMeasureNumbers: true,
          drawMetronomeMarks: false,
          renderSingleHorizontalStaffline: true,
          autoBeam: !song.xml,
          followCursor: false,
        })
        await osmd.load(song.xml ?? songToMusicXml(song))
        if (cancelled) return
        const rules = (osmd as any).EngravingRules
        if (rules) {
          rules.PageTopMargin = 1.5
          rules.PageBottomMargin = 1
          rules.PageLeftMargin = 2
          rules.PageRightMargin = 6
        }
        osmd.zoom = window.innerWidth < 700 ? 0.5 : 0.72
        osmd.render()
        const unit = 10 * osmd.zoom
        const list = (osmd as any).GraphicSheet?.MeasureList as any[][] | undefined
        const out: Box[] = []
        for (const staves of list ?? []) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
          for (const gm of staves ?? []) {
            const ps = gm?.PositionAndShape
            if (!ps) continue
            const ax = ps.AbsolutePosition.x, ay = ps.AbsolutePosition.y
            x0 = Math.min(x0, ax)
            y0 = Math.min(y0, ay)
            x1 = Math.max(x1, ax + ps.Size.width)
            y1 = Math.max(y1, ay + Math.max(ps.Size.height, 4))
          }
          if (x0 === Infinity) out.push(out[out.length - 1] ?? { x: 0, y: 0, w: 0, h: 0 })
          else out.push({ x: x0 * unit, y: (y0 - 2.5) * unit, w: (x1 - x0) * unit, h: (y1 - y0 + 5) * unit })
        }
        boxes.current = out
        setStatus('ready')
      } catch (err) {
        console.error(err)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [song])

  useEffect(() => {
    let lastM = -1
    return engine.onFrame(() => {
      const bs = boxes.current
      if (!bs.length || !hl.current || !cursor.current || !scroller.current) return
      const b = Math.max(0, engine.beat)
      const mi = Math.min(measureAt(song.measures, b), bs.length - 1)
      const box = bs[mi]
      const m = song.measures[mi]
      const frac = Math.max(0, Math.min(1, (b - m.beat) / m.len))
      // notes start after clef/key at the first bar; a small inset keeps the line plausible
      const inset = Math.min(box.w * 0.12, 14)
      cursor.current.style.transform = `translate(${box.x + inset + frac * (box.w - inset)}px, ${box.y}px)`
      cursor.current.style.height = box.h + 'px'
      if (mi !== lastM) {
        lastM = mi
        const s = hl.current.style
        s.transform = `translate(${box.x}px, ${box.y}px)`
        s.width = box.w + 'px'
        s.height = box.h + 'px'
        const sc = scroller.current
        const target = box.x - sc.clientWidth * 0.25
        if (Math.abs(sc.scrollLeft - target) > 4) sc.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
      }
    })
  }, [engine, song])

  const click = (e: React.MouseEvent) => {
    const r = host.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const i = boxes.current.findIndex((b) => x >= b.x && x <= b.x + b.w)
    if (i >= 0 && song.measures[i]) engine.seek(song.measures[i].beat)
  }

  return (
    <div className="sheet" ref={scroller}>
      {status === 'loading' && <div className="sheet-msg">Engraving the score…</div>}
      {status === 'error' && <div className="sheet-msg">Couldn’t render the sheet for this piece.</div>}
      <div className="sheet-inner" onClick={click}>
        <div ref={host} />
        <div ref={hl} className="sheet-hl" style={{ display: status === 'ready' ? 'block' : 'none' }} />
        <div ref={cursor} className="sheet-cursor" style={{ display: status === 'ready' ? 'block' : 'none' }} />
      </div>
      {!song.xml && status === 'ready' && <div className="sheet-note">simplified notation generated from the notes</div>}
    </div>
  )
}
