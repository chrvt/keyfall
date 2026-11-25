import type { Song } from '../music/types.ts'
import type { HandSel, Mode } from './engine.ts'

export interface Section { id: number; from: number; to: number }
export type TaskKind = 'listen' | 'learn' | 'review' | 'connect' | 'run' | 'weak' | 'perform'
export interface Task {
  id: string
  kind: TaskKind
  title: string
  detail: string
  /** measure range, inclusive */
  from: number
  to: number
  hand: HandSel
  /** percent of full tempo */
  speed: number
  minutes: number
  done: boolean
  mode?: Mode
  rating?: 'hard' | 'ok' | 'easy'
}
export interface PlanDay { focus: string; phase: 'learn' | 'connect' | 'polish'; tasks: Task[] }
export interface Plan {
  songId: string
  createdAt: number
  startDate: string
  minutesPerDay: number
  sections: Section[]
  days: PlanDay[]
}

export interface PlanOptions { days: number; minutes: number; startDate: string }

const HAND_LABEL = { R: 'Right hand', L: 'Left hand', both: 'Hands together' }

/** How much "new" material each measure holds – repeated measures are cheap. */
export function measureEffort(song: Song): number[] {
  const sig: string[] = song.measures.map(() => '')
  const count = song.measures.map(() => 0)
  for (const n of song.notes) {
    const m = song.measures[n.measure]
    sig[n.measure] += `${n.hand}${n.midi}@${Math.round((n.beat - m.beat) * 24)};`
    count[n.measure]++
  }
  const seen = new Set<string>()
  return sig.map((s, i) => {
    const novel = !seen.has(s)
    seen.add(s)
    return count[i] === 0 ? 0.2 : count[i] * (novel ? 1 : 0.2) + 1
  })
}

export function splitSections(song: Song, count: number): Section[] {
  const effort = measureEffort(song)
  const n = song.measures.length
  count = Math.max(1, Math.min(count, n))
  const total = effort.reduce((a, b) => a + b, 0)
  const out: Section[] = []
  let from = 0
  let cum = 0
  for (let i = 0; i < n; i++) {
    cum += effort[i]
    const remainingMeasures = n - 1 - i
    const remainingSections = count - out.length - 1
    if (
      remainingSections > 0 &&
      (cum >= (total * (out.length + 1)) / count - 1e-9 || remainingMeasures <= remainingSections) &&
      remainingMeasures >= remainingSections
    ) {
      out.push({ id: out.length, from, to: i })
      from = i + 1
    }
  }
  out.push({ id: out.length, from, to: n - 1 })
  return out
}

export function planShape(song: Song, o: PlanOptions) {
  const D = Math.max(1, Math.round(o.days))
  const polish = D >= 4 ? Math.min(4, Math.max(1, Math.round(D * 0.15))) : D >= 2 ? 1 : 0
  const connect = D >= 5 ? Math.min(4, Math.max(1, Math.round(D * 0.2))) : 0
  const learn = Math.max(1, D - polish - connect)
  const newPerDay = Math.max(1, Math.floor((o.minutes * 0.7) / 3))
  const sections = Math.max(1, Math.min(learn * newPerDay, Math.floor(song.measures.length / 2) || 1))
  // feasibility: how many *new* notes per practice minute
  const effort = measureEffort(song).reduce((a, b) => a + b, 0)
  const load = effort / (D * o.minutes)
  const pace = load < 3 ? 'relaxed' : load < 7 ? 'balanced' : load < 14 ? 'ambitious' : 'heroic'
  return { D, polish, connect, learn, sections, pace: pace as 'relaxed' | 'balanced' | 'ambitious' | 'heroic', load }
}

const mRange = (a: number, b: number) => (a === b ? `bar ${a + 1}` : `bars ${a + 1}–${b + 1}`)

export function createPlan(song: Song, o: PlanOptions): Plan {
  const shape = planShape(song, o)
  const sections = splitSections(song, shape.sections)
  const S = sections.length
  const last = song.measures.length - 1
  const hasHand = (h: 'L' | 'R', from: number, to: number) =>
    song.notes.some((n) => n.hand === h && n.measure >= from && n.measure <= to)
  let tid = 0
  type Draft = Omit<Task, 'id' | 'minutes' | 'done'> & { w: number }
  const days: { focus: string; phase: PlanDay['phase']; drafts: Draft[] }[] = []
  const secName = (s: Section) => `Section ${s.id + 1}`
  const learnSpeed = 55

  if (shape.D === 1) {
    const d: Draft[] = [
      { kind: 'listen', title: 'Listen & watch', detail: 'Get the piece in your ear', from: 0, to: last, hand: 'both', speed: 100, w: 0.6, mode: 'watch' },
    ]
    for (const h of ['R', 'L'] as const)
      if (hasHand(h, 0, last)) d.push({ kind: 'learn', title: `${HAND_LABEL[h]} alone`, detail: 'Whole piece, slowly', from: 0, to: last, hand: h, speed: 60, w: 1.2 })
    d.push({ kind: 'run', title: 'Hands together', detail: 'Whole piece, slowly', from: 0, to: last, hand: 'both', speed: 60, w: 2 })
    days.push({ focus: 'The whole piece in one sitting', phase: 'learn', drafts: d })
  } else {
    const byDay: Section[][] = Array.from({ length: shape.learn }, () => [])
    sections.forEach((s, i) => byDay[Math.min(shape.learn - 1, Math.floor((i * shape.learn) / S))].push(s))
    const span = (ss: Section[]) => ({ from: ss[0].from, to: ss[ss.length - 1].to })
    byDay.forEach((secs, d) => {
      const drafts: Draft[] = []
      if (d === 0) drafts.push({ kind: 'listen', title: 'Listen & watch', detail: 'Get the whole piece in your ear', from: 0, to: last, hand: 'both', speed: 100, w: 0.7, mode: 'watch' })
      const prev = d > 0 ? byDay.slice(0, d).reverse().find((x) => x.length) : undefined
      if (prev) {
        const r = span(prev)
        drafts.push({ kind: 'review', title: 'Warm-up review', detail: `Yesterday’s ${mRange(r.from, r.to)}`, ...r, hand: 'both', speed: learnSpeed + 10, w: 1.3 })
      }
      const older = d >= 3 && d % 2 === 1 ? byDay[d - 3] : undefined
      if (older?.length) {
        const r = span(older)
        drafts.push({ kind: 'review', title: 'Memory refresh', detail: `Older material, ${mRange(r.from, r.to)}`, ...r, hand: 'both', speed: learnSpeed + 15, w: 0.9 })
      }
      for (const s of secs) {
        const hands = (['R', 'L'] as const).filter((h) => hasHand(h, s.from, s.to))
        if (hands.length === 2) {
          for (const h of hands)
            drafts.push({ kind: 'learn', title: `${secName(s)} · ${HAND_LABEL[h]}`, detail: `New: ${mRange(s.from, s.to)}`, from: s.from, to: s.to, hand: h, speed: learnSpeed + 5, w: 1 })
          drafts.push({ kind: 'learn', title: `${secName(s)} · Hands together`, detail: `Combine both hands, ${mRange(s.from, s.to)}`, from: s.from, to: s.to, hand: 'both', speed: learnSpeed - 5, w: 1.5 })
        } else {
          drafts.push({ kind: 'learn', title: `${secName(s)} · ${HAND_LABEL[hands[0] ?? 'R']}`, detail: `New: ${mRange(s.from, s.to)}`, from: s.from, to: s.to, hand: 'both', speed: learnSpeed, w: 2 })
        }
      }
      if (prev && secs.length) {
        const r = { from: prev[0].from, to: secs[secs.length - 1].to }
        drafts.push({ kind: 'connect', title: 'Stitch it together', detail: `Play through ${mRange(r.from, r.to)}`, ...r, hand: 'both', speed: learnSpeed, w: 1 })
      }
      if (!secs.length && prev) {
        const r = { from: 0, to: prev[prev.length - 1].to }
        drafts.push({ kind: 'connect', title: 'Consolidate', detail: `Everything so far, ${mRange(r.from, r.to)}`, ...r, hand: 'both', speed: learnSpeed + 5, w: 2 })
      }
      const names = secs.map((s) => s.id + 1)
      days.push({
        focus: secs.length ? `Learn section${names.length > 1 ? 's' : ''} ${names.join(', ')} (${mRange(secs[0].from, secs[secs.length - 1].to)})` : 'Consolidate what you know',
        phase: 'learn', drafts,
      })
    })
    for (let c = 0; c < shape.connect; c++) {
      const groups = Math.max(1, Math.min(S, 4, Math.pow(2, shape.connect - c)))
      const speed = Math.min(85, 62 + Math.round((c * 16) / Math.max(1, shape.connect)))
      const drafts: Draft[] = []
      for (let g = 0; g < groups; g++) {
        const a = sections[Math.floor((g * S) / groups)]
        const b = sections[Math.floor(((g + 1) * S) / groups) - 1] ?? a
        drafts.push({ kind: 'connect', title: groups === 1 ? 'Whole piece' : `Part ${g + 1} of ${groups}`, detail: `Smooth transitions, ${mRange(a.from, b.to)}`, from: a.from, to: b.to, hand: 'both', speed, w: 1 })
      }
      drafts.push({ kind: 'run', title: 'Slow run-through', detail: 'Start to finish without stopping', from: 0, to: last, hand: 'both', speed: speed - 2, w: 1.4 })
      days.push({ focus: `Connect the sections into ${groups === 1 ? 'one piece' : groups + ' larger parts'}`, phase: 'connect', drafts })
    }
    for (let p = 0; p < shape.polish; p++) {
      const speed = Math.round(75 + ((p + 1) / shape.polish) * 25)
      const final = p === shape.polish - 1
      const drafts: Draft[] = [
        { kind: 'weak', title: 'Weak spots', detail: 'Your trickiest bars, looped', from: 0, to: last, hand: 'both', speed: Math.max(60, speed - 20), w: 1.4 },
        { kind: 'run', title: `Full piece at ${speed}%`, detail: 'Keep a steady pulse', from: 0, to: last, hand: 'both', speed, w: 2 },
      ]
      if (final) drafts.push({ kind: 'perform', title: 'Performance 🎉', detail: 'One take, full tempo – enjoy it!', from: 0, to: last, hand: 'both', speed: 100, w: 1.2 })
      days.push({ focus: final ? 'Polish & perform' : `Bring it up to ${speed}% tempo`, phase: 'polish', drafts })
    }
  }

  return {
    songId: song.id, createdAt: Date.now(), startDate: o.startDate, minutesPerDay: o.minutes, sections,
    days: days.map((d) => ({
      focus: d.focus, phase: d.phase,
      tasks: allot(fit(d.drafts, o.minutes).map(({ w, ...t }) => ({ ...t, id: 't' + tid++, minutes: w, done: false })), o.minutes),
    })),
  }
}

/** drop the least important tasks when a day has more tasks than minutes */
function fit<T extends { title: string; kind: TaskKind }>(drafts: T[], minutes: number): T[] {
  const out = [...drafts]
  const order = ['Memory refresh', 'Stitch it together', 'Warm-up review', 'Listen & watch']
  for (const title of order) {
    if (out.length <= Math.max(1, Math.floor(minutes))) break
    const i = out.findIndex((t) => t.title === title)
    if (i >= 0) out.splice(i, 1)
  }
  return out
}

/** scale task minutes (currently holding weights) so that they sum to `total` */
export function allot(tasks: Task[], total: number): Task[] {
  const sum = tasks.reduce((a, t) => a + t.minutes, 0) || 1
  const min = total >= tasks.length ? 1 : 0.5
  const out = tasks.map((t) => ({ ...t, minutes: Math.max(min, Math.round(((t.minutes / sum) * total) * 2) / 2) }))
  let diff = Math.round((total - out.reduce((a, t) => a + t.minutes, 0)) * 2) / 2
  const order = [...out].sort((a, b) => b.minutes - a.minutes)
  let i = 0
  let guard = 0
  while (Math.abs(diff) >= 0.5 && guard++ < 200) {
    const t = order[i % order.length]
    const step = diff > 0 ? 0.5 : -0.5
    if (t.minutes + step >= min) {
      t.minutes += step
      diff -= step
    }
    i++
  }
  return out
}

export function currentDay(plan: Plan): number {
  const i = plan.days.findIndex((d) => d.tasks.some((t) => !t.done))
  return i < 0 ? plan.days.length : i
}

export function planProgress(plan: Plan) {
  const all = plan.days.flatMap((d) => d.tasks)
  const done = all.filter((t) => t.done)
  return all.length ? done.reduce((a, t) => a + t.minutes, 0) / all.reduce((a, t) => a + t.minutes, 0) : 0
}

/** worst-scoring window of bars, from recorded mastery; falls back to the densest bars */
export function weakSpot(song: Song, mastery: Record<number, [number, number]> | undefined, width = 4) {
  const n = song.measures.length
  width = Math.min(width, n)
  const effort = measureEffort(song)
  const maxE = Math.max(...effort, 1)
  const score = (i: number) => {
    const m = mastery?.[i]
    if (m && m[0] >= 0.5) return 1 - m[1] / m[0] + 0.15 * (effort[i] / maxE)
    return 0.35 * (effort[i] / maxE) + (mastery ? 0.15 : 0)
  }
  let best = 0
  let bestScore = -1
  for (let i = 0; i + width <= n; i++) {
    let s = 0
    for (let k = 0; k < width; k++) s += score(i + k)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  return { from: best, to: best + width - 1 }
}
