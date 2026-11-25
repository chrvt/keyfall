import { useMemo, useState } from 'react'
import type { Song } from '../music/types.ts'
import { songDurationSec } from '../music/types.ts'
import { createPlan, currentDay, planProgress, planShape } from '../lib/plan.ts'
import type { Plan } from '../lib/plan.ts'
import { addDays, dayStr, daysBetween, plansStore, statsStore, useStore } from '../lib/store.ts'
import { KIND_ICON, setTaskDone } from './SessionPanel.tsx'
import { fmtTime } from './Player.tsx'

const PACE = {
  relaxed: { label: 'Relaxed', text: 'Plenty of time – expect it to feel easy and secure.', cls: 'good' },
  balanced: { label: 'Balanced', text: 'A healthy stretch. Very doable with regular practice.', cls: 'good' },
  ambitious: { label: 'Ambitious', text: 'Tight but possible. Add days or minutes if it starts to feel rushed.', cls: 'mid' },
  heroic: { label: 'Heroic', text: 'That’s a lot of new notes per minute. Consider more days or longer sessions.', cls: 'bad' },
}

const fmtDate = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

export function MasteryStrip({ song, plan }: { song: Song; plan?: Plan }) {
  const stats = useStore(statsStore).songs[song.id]
  const total = song.totalBeats
  return (
    <div className="mastery">
      <div className="mastery-bar">
        {song.measures.map((m) => {
          const s = stats?.measures[m.index]
          const q = s && s[0] >= 0.5 ? s[1] / s[0] : -1
          return <i key={m.index} title={`Bar ${m.index + 1}`} className={q < 0 ? '' : q > 0.85 ? 'good' : q > 0.55 ? 'mid' : 'bad'} style={{ width: (m.len / total) * 100 + '%' }} />
        })}
      </div>
      {plan && (
        <div className="mastery-secs">
          {plan.sections.map((s) => {
            const a = song.measures[s.from], b = song.measures[s.to]
            return <span key={s.id} style={{ width: ((b.beat + b.len - a.beat) / total) * 100 + '%' }}>{s.id + 1}</span>
          })}
        </div>
      )}
    </div>
  )
}

function Wizard({ song }: { song: Song }) {
  const [days, setDays] = useState(20)
  const [minutes, setMinutes] = useState(5)
  const shape = useMemo(() => planShape(song, { days, minutes, startDate: dayStr() }), [song, days, minutes])
  const pace = PACE[shape.pace]
  const create = () => {
    const plan = createPlan(song, { days, minutes, startDate: dayStr() })
    plansStore.set((p) => ({ ...p, [song.id]: plan }))
  }
  return (
    <div className="wizard card">
      <h2>Build your learning path</h2>
      <p className="muted">Tell Keyfall how much time you have. It splits the piece into bite-sized sections, teaches each hand separately, then joins them and brings everything up to tempo.</p>
      <div className="wiz-grid">
        <label>
          <span>I want to play it in</span>
          <div className="big-num"><b>{days}</b> day{days === 1 ? '' : 's'}</div>
          <input type="range" min={1} max={60} value={days} onChange={(e) => setDays(+e.target.value)} />
          <div className="chips">{[7, 14, 20, 30, 45].map((d) => <button key={d} className={'chip' + (d === days ? ' on' : '')} onClick={() => setDays(d)}>{d}</button>)}</div>
        </label>
        <label>
          <span>practising</span>
          <div className="big-num"><b>{minutes}</b> min / day</div>
          <input type="range" min={3} max={60} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
          <div className="chips">{[5, 10, 15, 20, 30].map((d) => <button key={d} className={'chip' + (d === minutes ? ' on' : '')} onClick={() => setMinutes(d)}>{d}</button>)}</div>
        </label>
      </div>
      <div className="phases">
        <div className="ph learn" style={{ flex: shape.learn }}><b>{shape.learn}</b> day{shape.learn > 1 ? 's' : ''} learning {shape.sections} section{shape.sections > 1 ? 's' : ''}</div>
        {shape.connect > 0 && <div className="ph connect" style={{ flex: shape.connect }}><b>{shape.connect}</b> connecting</div>}
        {shape.polish > 0 && <div className="ph polish" style={{ flex: shape.polish }}><b>{shape.polish}</b> polishing</div>}
      </div>
      <div className={'pace ' + pace.cls}>
        <b>{pace.label} pace</b>
        <span>{pace.text}</span>
      </div>
      <div className="row between">
        <span className="muted">{fmtTime(days * minutes * 60).replace(/:00$/, '')} min total · finish on <b>{fmtDate(addDays(dayStr(), days - 1))}</b></span>
        <button className="btn primary lg" onClick={create}>Create my plan</button>
      </div>
    </div>
  )
}

export function PlanView({ song }: { song: Song }) {
  const plan = useStore(plansStore)[song.id]
  const [openDay, setOpenDay] = useState<number | null>(null)

  const header = (
    <div className="page-head">
      <a className="btn ghost" href={song.tag === 'jazz' ? '#/jazz' : '#/'}>← {song.tag === 'jazz' ? 'Jazz Lab' : 'Library'}</a>
      <div className="song-title lg">
        <b>{song.title}</b>
        <span>{song.composer} · {song.measures.length} bars · {fmtTime(songDurationSec(song))}</span>
      </div>
      <div className="spacer" />
      <a className="btn" href={`#/play/${song.id}`}>Free play</a>
    </div>
  )

  if (!plan) {
    return (
      <div className="page narrow">
        {header}
        <Wizard song={song} />
      </div>
    )
  }

  const cur = currentDay(plan)
  const finished = cur >= plan.days.length
  const expected = Math.min(plan.days.length - 1, Math.max(0, daysBetween(plan.startDate, dayStr())))
  const behind = finished ? 0 : expected - cur
  const doneToday = !finished && cur > expected
  const progress = planProgress(plan)
  const shown = openDay ?? Math.min(cur, plan.days.length - 1)
  const shift = () => plansStore.set((p) => ({ ...p, [song.id]: { ...plan, startDate: addDays(dayStr(), -cur) } }))
  const remove = () => {
    if (confirm('Delete this learning plan? Your practice statistics are kept.')) {
      plansStore.set((p) => {
        const { [song.id]: _, ...rest } = p
        return rest
      })
    }
  }

  return (
    <div className="page narrow">
      {header}
      <div className="card plan-hero">
        <div className="ring" style={{ ['--p' as any]: progress }}>
          <b>{Math.round(progress * 100)}%</b>
        </div>
        <div className="plan-hero-body">
          {finished ? (
            <>
              <h2>Plan complete 🎉</h2>
              <p className="muted">You worked through all {plan.days.length} days. Keep the piece alive with a run-through now and then.</p>
            </>
          ) : doneToday ? (
            <>
              <span className="eyebrow">Day {cur} of {plan.days.length} complete</span>
              <h2>Done for today ✓</h2>
              <p className="status good">Rest is part of learning. Tomorrow: {plan.days[cur].focus.toLowerCase()}.</p>
            </>
          ) : (
            <>
              <span className="eyebrow">Day {cur + 1} of {plan.days.length} · {plan.minutesPerDay} min</span>
              <h2>{plan.days[cur].focus}</h2>
              <p className={'status ' + (behind > 0 ? 'mid' : 'good')}>
                {behind > 0 ? `${behind} day${behind > 1 ? 's' : ''} behind schedule` : 'Right on schedule'}
                {behind > 0 && <button className="link" onClick={shift}>shift the schedule to today</button>}
              </p>
            </>
          )}
        </div>
        {!finished && (doneToday
          ? <a className="btn" href={`#/play/${song.id}?day=${cur}`}>Get ahead: day {cur + 1}</a>
          : <a className="btn primary lg" href={`#/play/${song.id}?day=${cur}`}>▶ Start today’s session</a>)}
      </div>

      <div className="card">
        <h3>Where you stand</h3>
        <MasteryStrip song={song} plan={plan} />
        <p className="muted small">Each block is a bar; numbers mark the plan’s sections. Colours come from your ratings and Practice / Perform runs: <i className="dot good" /> secure <i className="dot mid" /> shaky <i className="dot bad" /> needs work.</p>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Your {plan.days.length}-day path</h3>
          <button className="link danger" onClick={remove}>Delete plan</button>
        </div>
        <div className="daystrip">
          {plan.days.map((d, i) => {
            const done = d.tasks.every((t) => t.done)
            return (
              <button key={i} className={`day ${d.phase}` + (done ? ' done' : '') + (i === cur ? ' cur' : '') + (i === shown ? ' sel' : '')} onClick={() => setOpenDay(i)} title={`${fmtDate(addDays(plan.startDate, i))} – ${d.focus}`}>
                {done ? '✓' : i + 1}
              </button>
            )
          })}
        </div>
        <div className="legend"><i className="dot learn" /> learn <i className="dot connect" /> connect <i className="dot polish" /> polish</div>
        <div className="day-detail">
          <div className="row between">
            <div>
              <span className="eyebrow">Day {shown + 1} · {fmtDate(addDays(plan.startDate, shown))}</span>
              <h4>{plan.days[shown].focus}</h4>
            </div>
            <a className="btn" href={`#/play/${song.id}?day=${shown}`}>▶ Practise this day</a>
          </div>
          <ol className="tasks static">
            {plan.days[shown].tasks.map((t) => (
              <li key={t.id} className={t.done ? 'done' : ''}>
                <button className="t-icon check" title={t.done ? 'Mark as not done' : 'Mark as done'} onClick={() => setTaskDone(song.id, shown, t.id, { done: !t.done })}>{t.done ? '✓' : KIND_ICON[t.kind]}</button>
                <a className="t-body" href={`#/play/${song.id}?day=${shown}&task=${t.id}`}>
                  <b>{t.title}</b>
                  <span>{t.detail} · {t.speed}% tempo{t.rating ? ` · felt ${t.rating}` : ''}</span>
                </a>
                <span className="t-min">{t.minutes}′</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
