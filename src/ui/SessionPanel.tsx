import { useEffect, useRef, useState } from 'react'
import type { Engine } from '../lib/engine.ts'
import type { Song } from '../music/types.ts'
import { audio } from '../lib/audio.ts'
import { allot, weakSpot } from '../lib/plan.ts'
import type { Plan, Task } from '../lib/plan.ts'
import { plansStore, statsStore, streak, useStore } from '../lib/store.ts'
import { fmtTime } from './Player.tsx'

export const KIND_ICON: Record<Task['kind'], string> = {
  listen: '👂', learn: '✨', review: '🔁', connect: '🧵', run: '▶', weak: '🎯', perform: '🎉',
}

function updatePlan(songId: string, fn: (p: Plan) => Plan) {
  plansStore.set((all) => (all[songId] ? { ...all, [songId]: fn(all[songId]) } : all))
}

export function setTaskDone(songId: string, dayIndex: number, taskId: string, patch: Partial<Task>) {
  updatePlan(songId, (p) => ({
    ...p,
    days: p.days.map((d, i) => (i !== dayIndex ? d : { ...d, tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })),
  }))
}

/** a "hard" rating earns the passage an extra slot tomorrow */
function addExtraPractice(songId: string, dayIndex: number, task: Task) {
  updatePlan(songId, (p) => {
    const next = p.days[dayIndex + 1]
    if (!next || next.tasks.some((t) => t.done) || next.tasks.some((t) => t.id === 'x-' + task.id)) return p
    const extra: Task = {
      ...task, id: 'x-' + task.id, kind: 'review', title: 'Extra practice', done: false, rating: undefined,
      detail: `Yesterday’s tricky spot, bars ${task.from + 1}–${task.to + 1}`, minutes: p.minutesPerDay * 0.2,
      speed: Math.max(40, task.speed - 5),
    }
    const tasks = allot([extra, ...next.tasks], p.minutesPerDay)
    return { ...p, days: p.days.map((d, i) => (i === dayIndex + 1 ? { ...d, tasks } : d)) }
  })
}

function rateMeasures(songId: string, task: Task, rating: NonNullable<Task['rating']>) {
  const q = rating === 'hard' ? 0.3 : rating === 'ok' ? 0.7 : 1
  statsStore.set((s) => {
    const song = { ...(s.songs[songId] ?? { sec: 0, last: 0, runs: 0, measures: {} }) }
    const m = { ...song.measures }
    for (let i = task.from; i <= task.to; i++) {
      const prev = m[i] ?? [0, 0]
      m[i] = [prev[0] * 0.5 + 1, prev[1] * 0.5 + q]
    }
    song.measures = m
    return { ...s, songs: { ...s.songs, [songId]: song } }
  })
}

export function SessionPanel({ engine, song, dayIndex, startTask }: { engine: Engine; song: Song; dayIndex: number; startTask?: string }) {
  const plan = useStore(plansStore)[song.id]
  const stats = useStore(statsStore)
  const day = plan?.days[dayIndex]
  const [activeId, setActiveId] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [phase, setPhase] = useState<'run' | 'rate' | 'done'>('run')
  const [timerOn, setTimerOn] = useState(true)
  const applied = useRef<string | null>(null)

  const apply = (t: Task) => {
    const last = song.measures.length - 1
    let range = { from: t.from, to: t.to }
    if (t.kind === 'weak') {
      range = weakSpot(song, statsStore.get().songs[song.id]?.measures, Math.max(2, Math.min(6, Math.round(song.measures.length / 8))))
    }
    const whole = range.from <= 0 && range.to >= last
    engine.pause()
    engine.set('hands', t.hand)
    if (t.mode) engine.set('mode', t.mode)
    engine.set('autoSpeed', null)
    engine.setSpeed(t.speed / 100)
    const a = song.measures[range.from], b = song.measures[Math.min(range.to, last)]
    engine.setLoop(whole ? null : { from: a.beat, to: b.beat + b.len })
    engine.restart()
    setActiveId(t.id)
    setLeft(Math.round(t.minutes * 60))
    setPhase('run')
    setTimerOn(true)
    applied.current = t.id
  }

  // pick the first open task when the session opens
  useEffect(() => {
    if (!day || applied.current) return
    const first = day.tasks.find((t) => t.id === startTask && !t.done) ?? day.tasks.find((t) => !t.done)
    if (first) apply(first)
    else setPhase('done')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, engine])

  useEffect(() => {
    if (phase !== 'run' || !timerOn || !activeId) return
    const iv = setInterval(() => {
      if (document.hidden) return
      setLeft((s) => {
        if (s <= 1) {
          audio.chime()
          setPhase('rate')
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, timerOn, activeId])

  if (!plan || !day) return null
  const active = day.tasks.find((t) => t.id === activeId)
  const doneMin = day.tasks.filter((t) => t.done).reduce((a, t) => a + t.minutes, 0)
  const totalMin = day.tasks.reduce((a, t) => a + t.minutes, 0)

  const finish = (rating: NonNullable<Task['rating']>) => {
    if (!active) return
    setTaskDone(song.id, dayIndex, active.id, { done: true, rating })
    if (active.kind !== 'listen') rateMeasures(song.id, active, rating)
    if (rating === 'hard' && active.kind !== 'listen' && active.to - active.from < song.measures.length - 1) addExtraPractice(song.id, dayIndex, active)
    const rest = day.tasks.filter((t) => !t.done && t.id !== active.id)
    if (rest.length) apply(rest[0])
    else {
      engine.pause()
      setActiveId(null)
      setPhase('done')
      audio.chime()
    }
  }

  return (
    <aside className="session">
      <div className="session-head">
        <span className="eyebrow">Day {dayIndex + 1} of {plan.days.length} · {day.phase}</span>
        <b>{day.focus}</b>
        <div className="meter"><i style={{ width: (totalMin ? (doneMin / totalMin) * 100 : 0) + '%' }} /></div>
      </div>
      <ol className="tasks">
        {day.tasks.map((t) => {
          const isActive = t.id === activeId && phase !== 'done'
          return (
            <li key={t.id} className={(t.done ? 'done ' : '') + (isActive ? 'active' : '')} onClick={() => !isActive && apply(t)}>
              <span className="t-icon">{t.done ? '✓' : KIND_ICON[t.kind]}</span>
              <div className="t-body">
                <b>{t.title}</b>
                <span>{t.detail} · {t.speed}% tempo</span>
                {isActive && phase === 'run' && (
                  <div className="t-timer">
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); setTimerOn(!timerOn) }} title={timerOn ? 'Pause timer' : 'Resume timer'}>{timerOn ? '❚❚' : '▶'}</button>
                    <b className="clock">{fmtTime(left)}</b>
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); setPhase('rate') }}>Done</button>
                  </div>
                )}
                {isActive && phase === 'rate' && (
                  <div className="t-rate" onClick={(e) => e.stopPropagation()}>
                    <span>How did it feel?</span>
                    <div className="row">
                      <button className="btn sm" onClick={() => finish('hard')}>😣 Hard</button>
                      <button className="btn sm" onClick={() => finish('ok')}>🙂 Okay</button>
                      <button className="btn sm" onClick={() => finish('easy')}>😎 Easy</button>
                    </div>
                    <button className="link" onClick={() => { setLeft(60); setPhase('run') }}>+1 more minute</button>
                  </div>
                )}
              </div>
              <span className="t-min">{t.minutes}′</span>
            </li>
          )
        })}
      </ol>
      {phase === 'done' && (
        <div className="session-done">
          <div className="confetti">🎉</div>
          <b>Day {dayIndex + 1} complete!</b>
          <span>{streak(stats.log) > 1 ? `${streak(stats.log)}-day streak – keep it going.` : 'Nice work. See you tomorrow.'}</span>
          <a className="btn primary" href={`#/plan/${song.id}`}>Back to plan</a>
        </div>
      )}
      {phase !== 'done' && <p className="muted small session-tip">Tip: stay in <b>Watch</b> to play along on an acoustic piano, or switch to <b>Practice</b> with a MIDI keyboard so the notes wait for you.</p>}
    </aside>
  )
}
