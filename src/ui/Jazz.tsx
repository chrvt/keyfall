import { useEffect, useMemo, useRef, useState } from 'react'
import { audio } from '../lib/audio.ts'
import { attachKeyboard, attachMidi } from '../lib/input.ts'
import { addPracticeTime, createStore, settingsStore, useStore } from '../lib/store.ts'
import { LESSONS } from '../jazz/course.ts'
import type { Lesson, Step } from '../jazz/course.ts'
import { JamSession } from '../jazz/session.ts'
import { MicListener } from '../lib/mic.ts'
import type { EchoRound, GoalState } from '../jazz/session.ts'
import { keyAt } from './waterfall.ts'

/** lesson id → indexes of the steps completed */
export const jazzStore = createStore<{ done: Record<string, number[]> }>('keyfall.jazz', { done: {} })

const markDone = (lesson: string, step: number) =>
  jazzStore.set((s) => (s.done[lesson]?.includes(step) ? s : { done: { ...s.done, [lesson]: [...(s.done[lesson] ?? []), step] } }))

export const lessonProgress = (l: Lesson, done: Record<string, number[]>) => (done[l.id]?.length ?? 0) / l.steps.length
export const jazzProgress = (done: Record<string, number[]>) =>
  LESSONS.reduce((a, l) => a + (done[l.id]?.length ?? 0), 0) / LESSONS.reduce((a, l) => a + l.steps.length, 0)

/** the tiny markup used in lesson texts: **bold**, *italic*, <kbd> */
const rich = (s: string) => ({ __html: s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>') })

const STEP_ICON: Record<Step['kind'], string> = { read: '📖', song: '🎹', jam: '🎷', echo: '👂' }
const STEP_KIND: Record<Step['kind'], string> = { read: 'Idea', song: 'Learn it', jam: 'Jam', echo: 'Call & response' }

export function JazzHome() {
  const { done } = useStore(jazzStore)
  const next = LESSONS.find((l) => lessonProgress(l, done) < 1) ?? LESSONS[0]
  const units = [...new Set(LESSONS.map((l) => l.unit))]
  const total = jazzProgress(done)
  return (
    <div className="page narrow">
      <section className="hero jazz-hero">
        <div>
          <span className="eyebrow">Jazz Lab</span>
          <h1>Learn to free-style,<br /><em>one small idea at a time.</em></h1>
          <p>Twelve short lessons take you from a one-note solo to improvising over a blues with both hands. A swing trio plays with you, the keys that fit light up, and every jam has a small mission.</p>
          <div className="row wrap" style={{ marginTop: 14 }}>
            <a className="btn primary lg" href={`#/jazz/${next.id}`}>{total > 0 ? `Continue: ${next.title}` : 'Start lesson 1'}</a>
            <span className="muted small">No reading music needed · works with MIDI keyboard, computer keys or touch</span>
          </div>
        </div>
        <div className="ring" style={{ ['--p' as any]: total }}><b>{Math.round(total * 100)}%</b></div>
      </section>
      {units.map((u) => (
        <section key={u}>
          <h3 className="sec-title">{u}</h3>
          <div className="lesson-list">
            {LESSONS.filter((l) => l.unit === u).map((l) => {
              const p = lessonProgress(l, done)
              return (
                <a key={l.id} className={'lesson-card' + (p >= 1 ? ' done' : '') + (l === next ? ' next' : '')} href={`#/jazz/${l.id}`}>
                  <span className="lesson-num">{p >= 1 ? '✓' : LESSONS.indexOf(l) + 1}</span>
                  <div>
                    <b>{l.title}</b>
                    <span className="muted">{l.summary}</span>
                  </div>
                  <span className="lesson-meta">
                    <span className="lesson-icons">{l.steps.map((s, i) => <i key={i} className={done[l.id]?.includes(i) ? 'on' : ''} title={STEP_KIND[s.kind]}>{STEP_ICON[s.kind]}</i>)}</span>
                    <span className="muted small">{l.minutes} min</span>
                  </span>
                </a>
              )
            })}
          </div>
        </section>
      ))}
      <p className="muted small">Playing an acoustic piano? Switch on <b>🎤 use microphone</b> under the keyboard in any jam or copy exercise. It hears single-note lines well; fast runs, chords and a loud band from the speakers confuse it, so keep the volume moderate or wear headphones. A MIDI keyboard is still the most exact.</p>
    </div>
  )
}

export function JazzLesson({ lessonId, stepParam }: { lessonId: string; stepParam: number }) {
  const lesson = LESSONS.find((l) => l.id === lessonId)
  const { done } = useStore(jazzStore)
  if (!lesson) return <div className="page narrow center-msg"><p>That lesson doesn’t exist.</p><a className="btn" href="#/jazz">Back to Jazz Lab</a></div>
  const idx = Math.max(0, Math.min(lesson.steps.length - 1, stepParam))
  const step = lesson.steps[idx]
  const li = LESSONS.indexOf(lesson)
  const nextLesson = LESSONS[li + 1]
  const go = (i: number) => (location.hash = `#/jazz/${lesson.id}?step=${i}`)
  const advance = () => {
    markDone(lesson.id, idx)
    if (idx < lesson.steps.length - 1) go(idx + 1)
    else location.hash = nextLesson ? `#/jazz/${nextLesson.id}` : '#/jazz'
  }
  return (
    <div className="page narrow jazz-lesson">
      <div className="page-head">
        <a className="btn ghost" href="#/jazz">← Jazz Lab</a>
        <div className="song-title lg">
          <b>{lesson.title}</b>
          <span>Lesson {li + 1} of {LESSONS.length} · {lesson.unit}</span>
        </div>
      </div>
      <div className="steps-bar">
        {lesson.steps.map((s, i) => (
          <button key={i} className={'step-pill' + (i === idx ? ' cur' : '') + (done[lesson.id]?.includes(i) ? ' done' : '')} onClick={() => go(i)}>
            <span>{done[lesson.id]?.includes(i) ? '✓' : STEP_ICON[s.kind]}</span> {s.title}
          </button>
        ))}
      </div>
      <div className="card">
        <span className="eyebrow">{STEP_KIND[step.kind]}</span>
        <h2>{step.title}</h2>
        {step.kind === 'read'
          ? step.body.map((p, i) => <p key={i} className="lesson-text" dangerouslySetInnerHTML={rich(p)} />)
          : <p className="lesson-text" dangerouslySetInnerHTML={rich(step.body)} />}
        {step.kind === 'song' && (
          <div className="row wrap">
            <a className="btn primary" href={`#/play/${step.songId}?back=${encodeURIComponent(`jazz/${lesson.id}?step=${idx}`)}`} onClick={() => markDone(lesson.id, idx)}>🎹 {step.cta}</a>
            <a className="btn" href={`#/plan/${step.songId}`}>Build a learning path for it</a>
          </div>
        )}
      </div>
      {(step.kind === 'jam' || step.kind === 'echo') && <Stage key={lesson.id + idx} step={step} onDone={() => markDone(lesson.id, idx)} />}
      <div className="row between">
        <button className="btn" disabled={idx === 0} onClick={() => go(idx - 1)}>← Back</button>
        <button className="btn primary" onClick={advance}>
          {idx < lesson.steps.length - 1 ? 'Next →' : nextLesson ? `Finish · next: ${nextLesson.title} →` : 'Finish the course 🎉'}
        </button>
      </div>
    </div>
  )
}

/** the microphone stays on from one exercise to the next once the player has switched it on */
let micWanted = false

function Stage({ step, onDone }: { step: Extract<Step, { kind: 'jam' | 'echo' }>; onDone: () => void }) {
  const session = useMemo(() => new JamSession(audio, step), [step])
  if (import.meta.env.DEV) (window as any).__jam = { session, audio, MicListener }
  const canvas = useRef<HTMLCanvasElement>(null)
  const settings = useStore(settingsStore)
  const [, tick] = useState(0)
  const [bpm, setBpm] = useState(step.bpm)
  const [mix, setMix] = useState({ ...session.band.mix })
  const [midi, setMidi] = useState<string[]>([])
  const [review, setReview] = useState<{ goals: GoalState[]; tips: string[]; rounds: EchoRound[] } | null>(null)
  const celebrated = useRef(false)
  const mic = useRef<MicListener | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [micErr, setMicErr] = useState('')
  const [heard, setHeard] = useState(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const stop = () => {
    if (!session.band.playing) return
    session.stop()
    addPracticeTime('jazz-lab', session.elapsed)
    session.elapsed = 0
    setReview({ goals: session.goalStates(), tips: session.isEcho ? [] : session.feedback(), rounds: [...session.rounds] })
    tick((n) => n + 1)
  }
  const start = () => {
    setReview(null)
    celebrated.current = false
    session.band.bpm = bpm
    // the band's piano would be heard by the microphone as the player's own
    Object.assign(session.band.mix, mix, session.mic ? { comp: false } : {})
    session.start()
    tick((n) => n + 1)
  }
  const toggle = () => (session.band.playing ? stop() : start())
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle

  // input: an acoustic piano through the microphone
  const micStart = async () => {
    try {
      audio.ensure()
      const m = new MicListener(audio.ctx!, session.micTarget())
      await m.start()
      mic.current?.stop()
      mic.current = m
      session.mic = true
      session.band.mix.comp = false
      micWanted = true
      setMicErr('')
      setMicOn(true)
    } catch {
      micWanted = false
      setMicErr('Microphone not available – allow it in the browser’s address bar and try again.')
    }
  }
  const micStop = () => {
    mic.current?.stop()
    mic.current = null
    session.mic = false
    setMicOn(false)
  }
  useEffect(() => {
    if (micWanted) micStart()
    return () => { mic.current?.stop(); mic.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // input: MIDI, computer keyboard, pointer
  useEffect(() => {
    const sink = {
      on: (m: number, v: number) => { audio.noteOn(m, v); session.noteOn(m) },
      off: (m: number) => { audio.noteOff(m); session.noteOff(m) },
    }
    const offKb = attachKeyboard(sink, () => settingsStore.get().kbOctave, (d) => settingsStore.set((s) => ({ ...s, kbOctave: Math.max(1, Math.min(6, s.kbOctave + d)) })))
    const offMidi = attachMidi(sink, setMidi)
    const space = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input,button')) { e.preventDefault(); toggleRef.current() }
    }
    window.addEventListener('keydown', space)
    const cv = canvas.current!
    const pointers = new Map<number, number>()
    const at = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      const l = session.currentLayout
      return l ? keyAt(l, e.clientX - r.left, e.clientY - r.top) : null
    }
    const down = (e: PointerEvent) => {
      const m = at(e)
      if (m === null) return
      cv.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, m)
      sink.on(m, 0.75)
    }
    const up = (e: PointerEvent) => {
      const m = pointers.get(e.pointerId)
      if (m !== undefined) sink.off(m)
      pointers.delete(e.pointerId)
    }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    return () => {
      offKb(); offMidi()
      window.removeEventListener('keydown', space)
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
      session.stop()
      if (session.elapsed) addPracticeTime('jazz-lab', session.elapsed)
    }
  }, [session])

  // drawing + a slow UI refresh for the goal counters
  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    let raf = 0
    let last = 0
    const fit = () => {
      const r = cv.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      session.resize(r.width, r.height)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(cv)
    fit()
    const loop = (t: number) => {
      session.draw(ctx)
      if ((session.band.playing || mic.current) && t - last > 200) {
        last = t
        setHeard(session.heard)
        tick((n) => n + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [session])

  const st = session.status()
  const goals = session.band.playing ? session.goalStates() : review?.goals ?? session.goalStates()
  const allMet = goals.length > 0 && goals.every((g) => g.met)
  useEffect(() => {
    if (allMet && !celebrated.current) {
      celebrated.current = true
      audio.chime()
      doneRef.current()
    }
  }, [allMet])
  useEffect(() => {
    if (session.echoFinished && session.band.playing) {
      stop()
      doneRef.current()
    }
  })

  const form = session.band.form
  const rounds = session.band.playing ? session.rounds : review?.rounds ?? []
  const echo = step.kind === 'echo'
  const phaseText = st.phase === 'count' ? 'Count-in…' : st.phase === 'listen' ? '👂 Listen' : st.phase === 'play' ? (step.kind === 'echo' && step.answer ? '🎹 Your answer' : '🎹 Your turn – play it back') : ''

  return (
    <div className="card stage">
      <div className="stage-top">
        <button className={'btn lg ' + (st.playing ? '' : 'primary')} onClick={toggle}>{st.playing ? '■ Stop' : '▶ Start the band'}</button>
        <div className="chord-strip" style={{ gridTemplateColumns: `repeat(${Math.min(form.bars.length, echo ? 4 : 12)}, 1fr)` }}>
          {echo
            ? ['Listen', 'Listen', 'You', 'You'].map((t, i) => <div key={i} className={'chord-box' + (st.playing && st.beat >= 0 && st.bar % 4 === i ? ' cur' : '') + (i > 1 ? ' you' : '')}><b>{t}</b><span>C7</span></div>)
            : form.bars.map((c, i) => (
              <div key={i} className={'chord-box' + (st.playing && st.beat >= 0 && st.barInForm === i ? ' cur' : '')}>
                <b>{session.band.chords[i].symbol}</b>
                <span>{i + 1}</span>
              </div>
            ))}
        </div>
      </div>
      <div className="stage-status">
        <span className="beats">{[0, 1, 2, 3].map((i) => <i key={i} className={st.playing && st.beatInBar === i ? 'on' : ''} />)}</span>
        <span className="phase">{st.playing ? phaseText || `${form.name} · chorus ${st.chorus}` : form.name}</span>
        <button className={'chip mic-chip' + (micOn ? ' on' : '')} title="Playing an acoustic piano? Let the app listen through the microphone" onClick={() => (micOn ? (micWanted = false, micStop()) : micStart())}>🎤 {micOn ? 'listening' : 'use microphone'}</button>
        <span className="spacer" />
        <span className="legend-keys">
          {step.kind === 'jam' && step.guide !== 'scale' && <><i className="dot" style={{ background: '#7ee787' }} /> {step.guide === 'guide' ? '3rd & 7th' : 'chord tones'}</>}
          <i className="dot" style={{ background: '#ffb454' }} /> safe notes
          {step.kind === 'jam' && step.showShell && <><i className="dot" style={{ background: '#5ccfe6' }} /> left-hand shell</>}
        </span>
      </div>
      <canvas ref={canvas} className="jam-canvas" />
      <div className="stage-controls">
        <label className="row">Tempo <input type="range" min={60} max={160} value={bpm} onChange={(e) => { const v = +e.target.value; setBpm(v); if (!session.band.playing) session.band.bpm = v }} disabled={st.playing} /> <b>{bpm}</b></label>
        {(['bass', 'drums', 'comp'] as const).map((k) => (
          <button key={k} className={'chip' + (mix[k] && !(micOn && k === 'comp') ? ' on' : '')} disabled={micOn && k === 'comp'} title={micOn && k === 'comp' ? 'Off while the microphone listens – it would be mistaken for your playing' : undefined} onClick={() => { const m = { ...mix, [k]: !mix[k] }; setMix(m); Object.assign(session.band.mix, m) }}>
            {k === 'comp' ? 'band piano' : k}
          </button>
        ))}
        <span className="spacer" />
        <span className="muted small">{micErr ? micErr : micOn ? <>🎤 <span className="mic-meter" title="Input level"><i style={{ width: Math.max(0, Math.min(100, ((mic.current?.level ?? -120) + 80) * 1.6)) + '%' }} /></span> {heard ? `${heard} notes heard` : 'play a note – its key should light up'} · keep the speakers low or use headphones</> : midi.length ? `🎹 ${midi[0]}` : <>Keys <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>… = C{settings.kbOctave} up, <kbd>W</kbd><kbd>E</kbd><kbd>T</kbd> black, <kbd>Z</kbd>/<kbd>X</kbd> octave</>} · <kbd>Space</kbd> start/stop</span>
      </div>
      {goals.length > 0 && (
        <div className="goals">
          <span className="eyebrow">Mission {allMet && '· complete ✓'}</span>
          {goals.map((g, i) => (
            <div key={i} className={'goal' + (g.met ? ' met' : '')}>
              <span className="goal-check">{g.met ? '✓' : ''}</span>
              <span>{g.label}</span>
              <span className="goal-val">{g.text}</span>
              <span className="goal-bar"><i style={{ width: Math.min(100, (100 * g.value) / g.target) + '%' }} /></span>
            </div>
          ))}
        </div>
      )}
      {echo && rounds.length > 0 && (
        <div className="goals">
          <span className="eyebrow">{step.kind === 'echo' && step.answer ? 'Your answers' : 'Your echoes'}</span>
          <div className="rounds">
            {rounds.map((r, i) => (
              <span key={i} className={'round ' + (step.kind === 'echo' && step.answer ? (r.played >= 2 ? 'good' : 'bad') : r.matched >= r.total - (session.mic && r.total > 4 ? 1 : 0) ? 'good' : r.matched >= r.total * 0.6 ? 'mid' : 'bad')}>
                {step.kind === 'echo' && step.answer ? (r.played >= 2 ? `${r.played} notes` : 'silent') : `${r.matched}/${r.total}`}
              </span>
            ))}
          </div>
        </div>
      )}
      {review && !st.playing && (
        <div className="coach-note">
          <b>{echo ? (session.echoFinished ? 'Round complete 🎉' : 'Stopped') : allMet ? 'Mission complete 🎉' : 'Coach'}</b>
          {echo
            ? <p>{step.kind === 'echo' && step.answer ? 'There is no right answer here – if you replied every time, you were improvising. Go again and try starting each answer on the last note of the call.' : rounds.length ? `You matched ${rounds.reduce((a, r) => a + r.matched, 0)} of ${rounds.reduce((a, r) => a + r.total, 0)} notes. Shapes matter more than perfection – go again or move on.` : 'Press Start, listen for two bars, then play the phrase back.'}</p>
            : review.tips.map((t, i) => <p key={i}>{t}</p>)}
        </div>
      )}
    </div>
  )
}
