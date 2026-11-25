import { libraryStore } from '../lib/songs.ts'
import { addDays, dayStr, plansStore, statsStore, streak, useStore } from '../lib/store.ts'
import { planProgress } from '../lib/plan.ts'
import { MasteryStrip } from './PlanView.tsx'

export function Progress() {
  const stats = useStore(statsStore)
  const { songs } = useStore(libraryStore)
  const plans = useStore(plansStore)
  const today = dayStr()
  const weeks = 26
  // grid starts on a Monday
  const dow = (new Date(today + 'T12:00:00').getDay() + 6) % 7
  const start = addDays(today, -(weeks - 1) * 7 - dow)
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  const total = Object.values(stats.log).reduce((a, b) => a + b, 0)
  const days = Object.values(stats.log).filter((s) => s >= 30).length
  const week = Array.from({ length: 7 }, (_, i) => stats.log[addDays(today, -i)] ?? 0).reduce((a, b) => a + b, 0)
  const played = songs.filter((s) => stats.songs[s.id]?.sec).sort((a, b) => stats.songs[b.id].last - stats.songs[a.id].last)
  const level = (sec: number) => (sec < 30 ? 0 : sec < 300 ? 1 : sec < 900 ? 2 : sec < 1800 ? 3 : 4)

  return (
    <div className="page narrow">
      <div className="page-head">
        <a className="btn ghost" href="#/">← Library</a>
        <div className="song-title lg"><b>Your progress</b></div>
      </div>
      <div className="stat-row">
        <div className="card stat"><b>{streak(stats.log)}</b><span>day streak</span></div>
        <div className="card stat"><b>{Math.round(week / 60)}</b><span>minutes this week</span></div>
        <div className="card stat"><b>{(total / 3600).toFixed(1)}</b><span>hours in total</span></div>
        <div className="card stat"><b>{days}</b><span>days practised</span></div>
      </div>
      <div className="card">
        <h3>Last {weeks} weeks</h3>
        <div className="heat">
          {cells.map((d) => (
            <i key={d} className={'l' + level(stats.log[d] ?? 0) + (d > today ? ' future' : '') + (d === today ? ' today' : '')} title={`${d}: ${Math.round((stats.log[d] ?? 0) / 60)} min`} />
          ))}
        </div>
      </div>
      <div className="card">
        <h3>Pieces</h3>
        {!played.length && <p className="muted">Nothing here yet – play something and your practice shows up automatically.</p>}
        {played.map((s) => {
          const st = stats.songs[s.id]
          const plan = plans[s.id]
          return (
            <div className="prog-song" key={s.id}>
              <div className="row between">
                <a href={`#/play/${s.id}`}><b>{s.title}</b></a>
                <span className="muted">
                  {Math.round(st.sec / 60)} min{st.best !== undefined ? ` · best ${Math.round(st.best * 100)}%` : ''}{plan ? ` · plan ${Math.round(planProgress(plan) * 100)}%` : ''}
                </span>
              </div>
              <MasteryStrip song={s} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
