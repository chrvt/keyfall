import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Song } from '../music/types.ts'
import { measureAt } from '../music/types.ts'
import { Engine } from '../lib/engine.ts'
import type { HandSel, Mode, RunResult } from '../lib/engine.ts'
import { audio } from '../lib/audio.ts'
import { attachKeyboard, attachMidi } from '../lib/input.ts'
import { addPracticeTime, plansStore, recordRun, settingsStore, statsStore, useStore } from '../lib/store.ts'
import type { Settings } from '../lib/store.ts'
import { weakSpot } from '../lib/plan.ts'
import { patchSong } from '../lib/songs.ts'
import { draw, keyAt, makeLayout, songRange } from './waterfall.ts'
import type { Layout } from './waterfall.ts'
import { SheetView } from './SheetView.tsx'
import { SessionPanel } from './SessionPanel.tsx'
import { MicListener, engineTarget } from '../lib/mic.ts'

const MODES: { id: Mode; label: string; tip: string }[] = [
  { id: 'watch', label: 'Watch', tip: 'The app plays – follow along on your piano' },
  { id: 'wait', label: 'Practice', tip: 'The notes wait until you press the right keys' },
  { id: 'perform', label: 'Perform', tip: 'Keep up with the music and get a score' },
]
const HANDS: { id: HandSel; label: string }[] = [
  { id: 'L', label: 'Left' },
  { id: 'both', label: 'Both' },
  { id: 'R', label: 'Right' },
]

export function fmtTime(sec: number) {
  sec = Math.max(0, Math.round(sec))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function Popover({ label, title, children, active }: { label: ReactNode; title?: string; children: ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', h)
    return () => window.removeEventListener('pointerdown', h)
  }, [open])
  return (
    <div className="pop" ref={ref}>
      <button className={'btn' + (open || active ? ' on' : '')} title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && <div className="pop-body">{children}</div>}
    </div>
  )
}

function Toggle({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
      <span>
        {children}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

function Waterfall({ engine, settings }: { engine: Engine; settings: Settings }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const opts = useRef(settings)
  opts.current = settings
  const song = engine.song
  const range = useMemo(() => songRange(song, settings.fullKeyboard), [song, settings.fullKeyboard])

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      layout.current = makeLayout(range[0], range[1], w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const off = engine.onFrame(() => {
      if (layout.current) draw(ctx, layout.current, engine, { showNames: opts.current.showNames, zoom: opts.current.zoom, fifths: song.fifths })
    })
    return () => {
      ro.disconnect()
      off()
    }
  }, [engine, range, song])

  // pointer: keys play, the falling area scrubs / toggles
  const ptr = useRef(new Map<number, { key: number | null; y: number; beat: number; moved: boolean }>())
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: React.PointerEvent) => {
    const l = layout.current
    if (!l) return
    audio.ensure()
    ref.current!.setPointerCapture(e.pointerId)
    const { x, y } = pos(e)
    const key = keyAt(l, x, y)
    ptr.current.set(e.pointerId, { key, y, beat: engine.beat, moved: false })
    if (key !== null) engine.userNoteOn(key)
  }
  const move = (e: React.PointerEvent) => {
    const l = layout.current
    const p = ptr.current.get(e.pointerId)
    if (!l || !p) return
    const { x, y } = pos(e)
    if (p.key !== null) {
      const key = keyAt(l, x, y)
      if (key !== null && key !== p.key) {
        engine.userNoteOff(p.key)
        engine.userNoteOn(key)
        p.key = key
      }
    } else if (Math.abs(y - p.y) > 6 || p.moved) {
      p.moved = true
      const ppb = l.fallH / ((opts.current.zoom * song.bpm) / 60)
      engine.seek(p.beat + (y - p.y) / ppb)
    }
  }
  const up = (e: React.PointerEvent) => {
    const p = ptr.current.get(e.pointerId)
    if (!p) return
    ptr.current.delete(e.pointerId)
    if (p.key !== null) engine.userNoteOff(p.key)
    else if (!p.moved) engine.toggle()
  }
  const wheel = (e: React.WheelEvent) => {
    const l = layout.current
    if (!l) return
    const ppb = l.fallH / ((opts.current.zoom * song.bpm) / 60)
    engine.seek(engine.beat - e.deltaY / ppb)
  }
  return <canvas ref={ref} className="fall" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />
}

function Timeline({ engine }: { engine: Engine }) {
  const song = engine.song
  const stats = useStore(statsStore).songs[song.id]
  const bar = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const total = song.totalBeats
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  useEffect(
    () =>
      engine.onFrame(() => {
        if (head.current) head.current.style.left = (Math.max(0, engine.beat) / total) * 100 + '%'
      }),
    [engine, total],
  )
  const beatAt = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total
  }
  const drag = useRef<{ loop: boolean; a: number } | null>(null)
  const down = (e: React.PointerEvent) => {
    bar.current!.setPointerCapture(e.pointerId)
    const b = beatAt(e)
    drag.current = { loop: e.shiftKey, a: b }
    if (e.shiftKey) setSel({ a: b, b })
    else engine.seek(b)
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return
    const b = beatAt(e)
    if (drag.current.loop) setSel({ a: drag.current.a, b })
    else engine.seek(b)
  }
  const up = () => {
    if (drag.current?.loop && sel) {
      const m0 = song.measures[measureAt(song.measures, Math.min(sel.a, sel.b))]
      const m1 = song.measures[measureAt(song.measures, Math.max(sel.a, sel.b))]
      engine.setLoop({ from: m0.beat, to: m1.beat + m1.len })
      engine.seek(engine.startBeat())
    }
    drag.current = null
    setSel(null)
  }
  const loop = sel ? { from: Math.min(sel.a, sel.b), to: Math.max(sel.a, sel.b) } : engine.loop
  return (
    <div className="timeline" ref={bar} onPointerDown={down} onPointerMove={move} onPointerUp={up} title="Click to jump · Shift-drag to loop a passage">
      <div className="tl-track">
        {song.measures.map((m) => {
          const s = stats?.measures[m.index]
          let bg = 'transparent'
          if (s && s[0] >= 0.5) {
            const q = s[1] / s[0]
            bg = q > 0.85 ? 'var(--good)' : q > 0.55 ? 'var(--mid)' : 'var(--bad)'
          }
          return <i key={m.index} style={{ left: (m.beat / total) * 100 + '%', width: (m.len / total) * 100 + '%', background: bg }} />
        })}
      </div>
      {loop && <div className="tl-loop" style={{ left: (loop.from / total) * 100 + '%', width: ((loop.to - loop.from) / total) * 100 + '%' }} />}
      <div className="tl-head" ref={head} />
    </div>
  )
}

function ResultCard({ r, engine, onClose }: { r: RunResult; engine: Engine; onClose: () => void }) {
  const pct = Math.round(r.accuracy * 100)
  const stars = pct >= 95 ? 3 : pct >= 80 ? 2 : pct >= 55 ? 1 : 0
  const song = engine.song
  const msg = stars === 3 ? 'Beautiful playing!' : stars === 2 ? 'Really solid.' : stars === 1 ? 'Getting there!' : 'Every pass counts.'
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal result" onClick={(e) => e.stopPropagation()}>
        <div className="stars">{[0, 1, 2].map((i) => <span key={i} className={i < stars ? 'lit' : ''}>★</span>)}</div>
        <h2>{pct}%</h2>
        <p className="muted">{msg} {r.mode === 'wait' ? 'Share of notes you got right first time.' : 'Share of notes you hit in time.'}</p>
        <div className="result-stats">
          <div><b>{r.hits}</b><span>hit</span></div>
          {r.mode === 'perform' && <div><b>{r.misses}</b><span>missed</span></div>}
          <div><b>{r.wrong}</b><span>wrong keys</span></div>
          <div><b>{engine.bestCombo}</b><span>best streak</span></div>
        </div>
        <div className="row center">
          <button className="btn primary" onClick={() => { onClose(); engine.restart(); engine.play() }}>Play again</button>
          {song.measures.length > 6 && (
            <button className="btn" onClick={() => {
              const w = weakSpot(song, statsStore.get().songs[song.id]?.measures)
              const a = song.measures[w.from], b = song.measures[w.to]
              engine.setLoop({ from: a.beat, to: b.beat + b.len })
              engine.restart()
              onClose()
            }}>Loop my weakest bars</button>
          )}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

export function Player({ song, sessionDay, startTask, back }: { song: Song; sessionDay: number | null; startTask?: string; back?: string }) {
  const settings = useStore(settingsStore)
  const plan = useStore(plansStore)[song.id]
  const [engine, setEngine] = useState<Engine | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [midi, setMidi] = useState<string[]>([])
  const [sampled, setSampled] = useState(audio.loaded)

  useEffect(() => {
    const e = new Engine(song, audio)
    e.octaveFree = settingsStore.get().octaveFree
    e.onPracticeTime = (sec) => addPracticeTime(song.id, sec)
    e.onFinish = (r) => {
      if (r.mode !== 'watch' && r.hits + r.misses + r.wrong > 0) {
        recordRun(song.id, r)
        setResult(r)
      }
    }
    e.onLoop = () => {
      if (e.mode !== 'watch') {
        recordRun(song.id, e.result(true))
        e.resetRun()
      }
    }
    setEngine(e)
    if (import.meta.env.DEV) (window as any).__kf = { engine: e, audio, MicListener, engineTarget }
    audio.onLoaded = () => setSampled(audio.loaded)
    const sink = { on: (m: number, v: number) => e.userNoteOn(m, v), off: (m: number) => e.userNoteOff(m) }
    const offKb = attachKeyboard(
      sink,
      () => settingsStore.get().kbOctave,
      (d) => settingsStore.set((s) => ({ ...s, kbOctave: Math.max(1, Math.min(6, s.kbOctave + d)) })),
    )
    const offMidi = attachMidi(sink, setMidi)
    return () => {
      offKb()
      offMidi()
      e.dispose()
      setEngine(null)
    }
  }, [song])

  useEffect(() => {
    audio.volume = settings.volume
  }, [settings.volume])

  useEffect(() => {
    if (!engine) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
      const ms = engine.song.measures
      const mi = measureAt(ms, Math.max(0, engine.beat))
      if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
      } else if (e.code === 'ArrowLeft') engine.seek(ms[Math.max(0, engine.beat - ms[mi].beat < 0.3 ? mi - 1 : mi)].beat)
      else if (e.code === 'ArrowRight') engine.seek(ms[Math.min(ms.length - 1, mi + 1)].beat)
      else if (e.code === 'ArrowUp') {
        e.preventDefault()
        engine.setSpeed(engine.speed + 0.05)
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        engine.setSpeed(engine.speed - 0.05)
      } else if (e.code === 'Home' || e.code === 'Enter') engine.restart()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [engine])

  if (!engine) return <div className="player" />
  return (
    <PlayerInner
      engine={engine} song={song} settings={settings} midi={midi} sampled={sampled}
      result={result} setResult={setResult} sessionDay={plan ? sessionDay : null} startTask={startTask} back={back}
    />
  )
}

function PlayerInner({ engine, song, settings, midi, sampled, result, setResult, sessionDay, startTask, back }: {
  engine: Engine; song: Song; settings: Settings; midi: string[]; sampled: boolean
  result: RunResult | null; setResult: (r: RunResult | null) => void; sessionDay: number | null; startTask?: string; back?: string
}) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  const plan = useStore(plansStore)[song.id]
  const set = (p: Partial<Settings>) => settingsStore.set((s) => ({ ...s, ...p }))
  const ms = song.measures
  const mi = measureAt(ms, Math.max(0, engine.beat))
  const loopBars = engine.loop
    ? { from: measureAt(ms, engine.loop.from), to: measureAt(ms, engine.loop.to - 0.01) }
    : null
  const setLoopBars = (from: number, to: number) => {
    from = Math.max(0, Math.min(ms.length - 1, from))
    to = Math.max(from, Math.min(ms.length - 1, to))
    engine.setLoop({ from: ms[from].beat, to: ms[to].beat + ms[to].len })
  }
  const secPerBeat = 60 / (song.bpm * engine.speed)
  const interactive = engine.mode !== 'watch'
  const mic = useRef<MicListener | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [micErr, setMicErr] = useState<string | null>(null)
  useEffect(() => () => {
    mic.current?.stop()
    mic.current = null
  }, [engine])
  const toggleMic = async () => {
    setMicErr(null)
    if (mic.current) {
      mic.current.stop()
      mic.current = null
      engine.micOn = false
      setMicOn(false)
      return
    }
    try {
      audio.ensure()
      const m = new MicListener(audio.ctx!, engineTarget(engine))
      await m.start()
      mic.current = m
      engine.micOn = true
      setMicOn(true)
      if (engine.mode === 'watch') engine.set('mode', 'wait')
    } catch {
      setMicErr('Microphone access was blocked. Allow it in your browser’s site settings and try again.')
    }
  }

  return (
    <div className="player">
      <header className="topbar">
        <a className="btn ghost back" href={'#/' + (back ?? '')} title={back ? 'Back to the Jazz Lab' : 'Back to library'}>←</a>
        <div className="song-title">
          <b>{song.title}</b>
          <span>{song.composer}</span>
        </div>
        <div className="seg" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} className={engine.mode === m.id ? 'on' : ''} title={m.tip} onClick={() => engine.set('mode', m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="seg hands">
          {HANDS.map((h) => (
            <button key={h.id} className={(engine.hands === h.id ? 'on ' : '') + 'h-' + h.id} onClick={() => engine.set('hands', h.id)} title={h.id === 'both' ? 'Practise both hands' : `Practise the ${h.label.toLowerCase()} hand only`}>
              <i /> {h.label}
            </button>
          ))}
        </div>
        <div className="speed" title="Playback speed (↑ / ↓)">
          <button className="btn sm" onClick={() => engine.setSpeed(engine.speed - 0.05)}>−</button>
          <div className="speed-val">
            <b>{Math.round(engine.speed * 100)}%</b>
            <span>{Math.round(song.bpm * engine.speed)} bpm</span>
          </div>
          <button className="btn sm" onClick={() => engine.setSpeed(engine.speed + 0.05)}>+</button>
          <input type="range" min={25} max={150} step={5} value={Math.round(engine.speed * 100)} onChange={(e) => engine.setSpeed(+e.target.value / 100)} />
        </div>
        <div className="spacer" />
        <Popover label={<>⟲ Loop{loopBars ? ` ${loopBars.from + 1}–${loopBars.to + 1}` : ''}</>} active={!!engine.loop} title="Repeat a passage">
          <h4>Loop a passage</h4>
          <div className="row">
            <span>Bars</span>
            <input type="number" min={1} max={ms.length} value={(loopBars?.from ?? mi) + 1} onChange={(e) => setLoopBars(+e.target.value - 1, Math.max(+e.target.value - 1, loopBars?.to ?? mi))} />
            <span>to</span>
            <input type="number" min={1} max={ms.length} value={(loopBars?.to ?? mi) + 1} onChange={(e) => setLoopBars(Math.min(loopBars?.from ?? mi, +e.target.value - 1), +e.target.value - 1)} />
          </div>
          <div className="row wrap">
            <button className="btn sm" onClick={() => setLoopBars(mi, mi)}>This bar</button>
            <button className="btn sm" onClick={() => setLoopBars(mi, mi + 1)}>2 bars</button>
            <button className="btn sm" onClick={() => setLoopBars(mi, mi + 3)}>4 bars</button>
            <button className="btn sm" onClick={() => setLoopBars(mi, mi + 7)}>8 bars</button>
            <button className="btn sm" onClick={() => {
              const w = weakSpot(song, statsStore.get().songs[song.id]?.measures)
              setLoopBars(w.from, w.to)
              engine.seek(engine.startBeat())
            }}>Weakest bars</button>
          </div>
          {plan && (
            <>
              <h4>Plan sections</h4>
              <div className="row wrap">
                {plan.sections.map((s) => (
                  <button key={s.id} className="btn sm" onClick={() => { setLoopBars(s.from, s.to); engine.seek(engine.startBeat()) }} title={`Bars ${s.from + 1}–${s.to + 1}`}>{s.id + 1}</button>
                ))}
              </div>
            </>
          )}
          <Toggle checked={!!engine.autoSpeed} onChange={(v) => engine.set('autoSpeed', v ? { step: 0.05, target: 1 } : null)} hint="+5% after every clean loop, up to full tempo">
            Tempo trainer
          </Toggle>
          <div className="row">
            <button className="btn sm" disabled={!engine.loop} onClick={() => engine.setLoop(null)}>Clear loop</button>
            <small className="muted">Tip: Shift-drag on the timeline</small>
          </div>
        </Popover>
        <button className={'btn' + (micOn ? ' on' : '')} title="Experimental: listen to your acoustic piano through the microphone, so Practice mode can wait for you" onClick={toggleMic}>🎤{micOn ? ' Listening' : ' Mic'}</button>
        <button className={'btn' + (engine.metronome ? ' on' : '')} title="Metronome with count-in" onClick={() => engine.set('metronome', !engine.metronome)}>◷ Click</button>
        <button className={'btn' + (settings.showSheet ? ' on' : '')} title="Show sheet music" onClick={() => set({ showSheet: !settings.showSheet })}>𝄞 Sheet</button>
        <Popover label="?" title="How it works">
          <h4>Three ways to learn</h4>
          <p className="small"><b>Watch</b> – the app plays; follow the falling notes on your own piano.<br /><b>Practice</b> – the notes wait until you play them (MIDI keyboard, microphone, on-screen keys or computer keyboard).<br /><b>Perform</b> – keep up in time and get a score.</p>
          <h4>Shortcuts</h4>
          <p className="small"><kbd>Space</kbd> play / pause · <kbd>←</kbd> <kbd>→</kbd> previous / next bar<br /><kbd>↑</kbd> <kbd>↓</kbd> faster / slower · <kbd>Enter</kbd> back to start<br />Drag the falling notes or scroll to scrub · Shift-drag the timeline to loop<br /><kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd> white keys, <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd> black keys, <kbd>Z</kbd> <kbd>X</kbd> octave</p>
          <h4>Colours</h4>
          <p className="small"><i className="dot" style={{ background: 'var(--lh)', marginLeft: 0 }} /> left hand &nbsp; <i className="dot" style={{ background: 'var(--rh)' }} /> right hand</p>
        </Popover>
        <Popover label="⚙" title="Settings">
          <h4>Sound</h4>
          <div className="row">
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => set({ volume: +e.target.value })} />
          </div>
          <Toggle checked={engine.accompany} onChange={(v) => engine.set('accompany', v)} hint="When practising one hand, the app plays the other">
            Accompany with the other hand
          </Toggle>
          <Toggle checked={engine.demoSound} onChange={(v) => engine.set('demoSound', v)} hint="Turn off in Watch mode to hear only your own piano">
            Play my part aloud
          </Toggle>
          <h4>Display</h4>
          <Toggle checked={settings.showNames} onChange={(v) => set({ showNames: v })}>Note names</Toggle>
          <Toggle checked={settings.fullKeyboard} onChange={(v) => set({ fullKeyboard: v })}>Full 88-key keyboard</Toggle>
          <div className="row">
            <span>Look-ahead</span>
            <input type="range" min={2} max={8} step={0.5} value={settings.zoom} onChange={(e) => set({ zoom: +e.target.value })} />
          </div>
          <h4>Playing along</h4>
          <Toggle checked={settings.octaveFree} onChange={(v) => { set({ octaveFree: v }); engine.set('octaveFree', v) }} hint="Handy for small keyboards and computer keys">
            Accept any octave
          </Toggle>
          <h4>This piece</h4>
          {song.source === 'upload' && (
            <div className="row">
              <span>Title</span>
              <input type="text" defaultValue={song.title} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== song.title) patchSong({ ...song, title: v }) }} />
            </div>
          )}
          <div className="row">
            <span>Tempo</span>
            <input type="number" min={30} max={240} value={song.bpm} onChange={(e) => { const v = +e.target.value; if (v >= 30 && v <= 240) patchSong({ ...song, bpm: v }) }} />
            <span>bpm</span>
            <button className="btn sm" title="If the hands are coloured the wrong way round" onClick={() => patchSong({ ...song, notes: song.notes.map((n) => ({ ...n, hand: n.hand === 'L' ? 'R' : 'L' })) })}>Swap hands</button>
          </div>
          <p className="muted small">{sampled ? 'Piano: Salamander Grand (CC-BY, A. Holm)' : 'Piano samples load on first play'}{song.credit ? ` · ${song.credit}` : ''}</p>
        </Popover>
      </header>

      <div className="stage">
        <div className="stage-main">
          {settings.showSheet && <SheetView engine={engine} />}
          <div className="fall-wrap">
            <Waterfall engine={engine} settings={settings} />
            {interactive && (
              <div className="hint-chip">
                {micErr ? micErr : micOn ? <>🎤 Listening to your piano <span className="mic-meter" title="Input level"><i style={{ width: Math.max(0, Math.min(100, ((mic.current?.level ?? -120) + 80) * 1.6)) + '%' }} /></span> – headphones help the app hear only you</> : midi.length ? <>🎹 {midi[0]}</> : <>No MIDI keyboard found – click the keys or type <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd>… (octave C{settings.kbOctave}, <kbd>Z</kbd>/<kbd>X</kbd> to shift)</>}
              </div>
            )}
            {engine.waiting && <div className="wait-chip">Your turn – play the glowing keys</div>}
            {interactive && engine.playing && engine.combo >= 5 && <div className="combo">{engine.combo}<span>streak</span></div>}
            {!settings.seenTips && (
              <div className="coach">
                <b>Welcome – here’s the idea</b>
                <ul>
                  <li>Notes fall onto the keys: <i className="dot" style={{ background: 'var(--lh)' }} /> left hand, <i className="dot" style={{ background: 'var(--rh)' }} /> right hand.</li>
                  <li>Press <kbd>Space</kbd> to play, slow it down with <b>− / +</b>, and pick <b>Left</b> or <b>Right</b> to learn one hand at a time.</li>
                  <li><b>Practice</b> makes the notes wait for you – with a MIDI keyboard, or <b>🎤 Mic</b> for an acoustic piano.</li>
                  <li><b>⟲ Loop</b> repeats a tricky passage; <b>𝄞 Sheet</b> shows the score.</li>
                </ul>
                <button className="btn sm primary" onClick={() => set({ seenTips: true })}>Got it</button>
              </div>
            )}
            {!engine.playing && !result && (
              <button className="big-play" onClick={() => engine.play()} aria-label="Play">
                <svg viewBox="0 0 24 24" width="42" height="42"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
              </button>
            )}
          </div>
          <footer className="transport">
            <button className="btn icon" title="Back to start (Enter)" onClick={() => engine.restart()}>⏮</button>
            <button className="btn icon primary" title="Play / pause (Space)" onClick={() => engine.toggle()}>
              {engine.playing ? '❚❚' : '▶'}
            </button>
            <span className="bar-no">Bar <b>{mi + 1}</b> / {ms.length}</span>
            <Timeline engine={engine} />
            <span className="time">{fmtTime(Math.max(0, engine.beat) * secPerBeat)} / {fmtTime(song.totalBeats * secPerBeat)}</span>
          </footer>
        </div>
        {plan && sessionDay !== null && <SessionPanel engine={engine} song={song} dayIndex={sessionDay} startTask={startTask} />}
      </div>
      {result && <ResultCard r={result} engine={engine} onClose={() => setResult(null)} />}
    </div>
  )
}
