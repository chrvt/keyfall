import { useEffect, useRef, useState } from 'react'
import type { Song } from '../music/types.ts'
import { songDurationSec } from '../music/types.ts'
import { importFile, libraryStore, removeSong } from '../lib/songs.ts'
import { dayStr, daysBetween, plansStore, statsStore, streak, useStore } from '../lib/store.ts'
import { currentDay, planProgress } from '../lib/plan.ts'
import { drawThumb } from './waterfall.ts'
import { fmtTime } from './Player.tsx'
import { jazzProgress, jazzStore } from './Jazz.tsx'

const LEVELS = ['', 'Beginner', 'Easy', 'Intermediate', 'Advanced', 'Virtuoso']

function Thumb({ song }: { song: Song }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) drawThumb(ref.current, song)
  }, [song])
  return <canvas ref={ref} className="thumb" />
}

function SongCard({ song }: { song: Song }) {
  const plan = useStore(plansStore)[song.id]
  const stats = useStore(statsStore).songs[song.id]
  const d = song.difficulty ?? 2
  return (
    <div className="song-card">
      <a href={`#/play/${song.id}`} className="thumb-wrap" title="Open in the player">
        <Thumb song={song} />
        <span className="play-badge">▶</span>
      </a>
      <div className="sc-body">
        <b>{song.title}</b>
        <span className="muted">{song.composer || (song.source === 'upload' ? 'Your upload' : song.source === 'folder' ? 'From your songs folder' : '')}</span>
        {song.blurb && <p>{song.blurb}</p>}
        <div className="sc-meta">
          <span className="level" title={LEVELS[d]}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= d ? 'on' : ''} />)} {LEVELS[d]}</span>
          <span>{fmtTime(songDurationSec(song))}</span>
          <span>{song.measures.length} bars</span>
          {stats?.best !== undefined && <span className="best">best {Math.round(stats.best * 100)}%</span>}
        </div>
      </div>
      <div className="sc-actions">
        <a className="btn primary" href={`#/play/${song.id}`}>Play</a>
        <a className="btn" href={`#/plan/${song.id}`}>{plan ? `Plan · ${Math.round(planProgress(plan) * 100)}%` : 'Learning path'}</a>
        {song.source === 'upload' && (
          <button className="btn ghost danger" title="Remove from library" onClick={() => confirm(`Remove “${song.title}”?`) && removeSong(song.id)}>✕</button>
        )}
      </div>
    </div>
  )
}

export function Library() {
  const { songs, loading } = useStore(libraryStore)
  const plans = useStore(plansStore)
  const stats = useStore(statsStore)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [level, setLevel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const jazz = jazzProgress(useStore(jazzStore).done)

  const handle = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    setBusy(true)
    try {
      let last: Song | null = null
      for (const f of Array.from(files)) last = await importFile(f)
      if (last) location.hash = `#/play/${last.id}`
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const active = Object.values(plans)
    .map((p) => ({ plan: p, song: songs.find((s) => s.id === p.songId), day: currentDay(p) }))
    .filter((x) => x.song && x.day < x.plan.days.length)
  const today = Math.round((stats.log[dayStr()] ?? 0) / 60)
  const st = streak(stats.log)
  const uploads = songs.filter((s) => s.source !== 'builtin')
  const builtin = songs.filter((s) => s.source === 'builtin' && !s.tag && (!level || s.difficulty === level))

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Learn the pieces you love,<br /><em>one falling note at a time.</em></h1>
          <p>Pick a piece or drop in your own sheet music. Slow it down, take one hand at a time, loop the tricky bars – or let Keyfall plan the whole journey for you.</p>
        </div>
        <div className="hero-stats">
          <div><b>{st}</b><span>day streak {st > 0 ? '🔥' : ''}</span></div>
          <div><b>{today}</b><span>min today</span></div>
        </div>
      </section>

      {active.length > 0 && (
        <section>
          <h3 className="sec-title">Today’s practice</h3>
          <div className="today-grid">
            {active.map(({ plan, song, day }) => {
              const doneToday = day > Math.max(0, daysBetween(plan.startDate, dayStr()))
              return doneToday ? (
                <a key={plan.songId} className="today-card done" href={`#/plan/${plan.songId}`}>
                  <div className="ring sm" style={{ ['--p' as any]: planProgress(plan) }}><b>✓</b></div>
                  <div>
                    <span className="eyebrow">Day {day} of {plan.days.length} complete</span>
                    <b>{song!.title}</b>
                    <span className="muted">Done for today – see you tomorrow.</span>
                  </div>
                  <span className="btn">View plan</span>
                </a>
              ) : (
                <a key={plan.songId} className="today-card" href={`#/play/${plan.songId}?day=${day}`}>
                  <div className="ring sm" style={{ ['--p' as any]: planProgress(plan) }}><b>{day + 1}</b></div>
                  <div>
                    <span className="eyebrow">Day {day + 1} of {plan.days.length} · {plan.minutesPerDay} min</span>
                    <b>{song!.title}</b>
                    <span className="muted">{plan.days[day].focus}</span>
                  </div>
                  <span className="btn primary">▶ Start</span>
                </a>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <div
          className={'drop' + (over ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files) }}
          onClick={() => input.current?.click()}
        >
          <input ref={input} type="file" hidden multiple accept=".mid,.midi,.xml,.musicxml,.mxl,.pdf" onChange={(e) => { void handle(e.target.files); e.target.value = '' }} />
          <div className="drop-icon">♫</div>
          <div>
            <b>{busy ? 'Reading your score…' : 'Add your own sheet music'}</b>
            <span>Drop a <u>MusicXML</u> (.musicxml, .mxl) or <u>MIDI</u> (.mid) file here, or click to browse. Files placed in your songs folder (<code>~/Keyfall</code>) show up by themselves. Everything stays on your device.</span>
          </div>
        </div>
        {error && <div className="error" onClick={() => setError(null)}>{error}</div>}
        <p className="muted small tip-line">Looking for Amélie, Einaudi or other film music? Modern pieces are still under copyright, so they can’t be bundled – but any MusicXML or MIDI file you have works here. Try <i>Petite valse de Montmartre</i> below for that same wistful French mood.</p>
      </section>

      <a className="jazz-promo" href="#/jazz">
        <span className="jazz-promo-icon">🎷</span>
        <div>
          <span className="eyebrow">New · Jazz Lab</span>
          <b>Learn to free-style</b>
          <span className="muted">Twelve short lessons from a one-note solo to improvising over a blues – with a swing trio that plays along and keys that light up when they fit.</span>
        </div>
        <span className="btn primary">{jazz > 0 ? `Continue · ${Math.round(jazz * 100)}%` : 'Start'}</span>
      </a>

      {uploads.length > 0 && (
        <section>
          <h3 className="sec-title">Your pieces</h3>
          <div className="grid">{uploads.map((s) => <SongCard key={s.id} song={s} />)}</div>
        </section>
      )}

      <section>
        <div className="row between">
          <h3 className="sec-title">Library</h3>
          <div className="chips">
            {[0, 1, 2, 3, 4, 5].map((l) => <button key={l} className={'chip' + (level === l ? ' on' : '')} onClick={() => setLevel(l)}>{l ? LEVELS[l] : 'All'}</button>)}
          </div>
        </div>
        <div className="grid">{builtin.map((s) => <SongCard key={s.id} song={s} />)}</div>
        {loading && <p className="muted">Loading pieces…</p>}
        {!loading && !builtin.length && <p className="muted">No pieces at this level yet.</p>}
      </section>
      <footer className="foot">Scores of the classical pieces are public-domain editions from the Mutopia Project. Piano sound: Salamander Grand Piano by Alexander Holm (CC-BY 3.0).</footer>
    </div>
  )
}
