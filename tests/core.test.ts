import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMidi } from '../src/music/midi.ts'
import { songFromDsl } from '../src/music/dsl.ts'
import { songToMusicXml } from '../src/music/toMusicXml.ts'
import { createPlan, planShape, splitSections, weakSpot } from '../src/lib/plan.ts'

const elise = () =>
  parseMidi(readFileSync(new URL('../public/songs/fur-elise.mid', import.meta.url)), {
    id: 'fe', title: 'Für Elise', pickup: 0.5, bpm: 62, fifths: 0,
  })

test('MIDI import: bars, hands and pickup', () => {
  const s = elise()
  assert.equal(s.measures.length, 105)
  assert.equal(s.measures[0].len, 0.5)
  assert.ok(s.notes.some((n) => n.hand === 'L') && s.notes.some((n) => n.hand === 'R'))
  assert.deepEqual(s.notes.slice(0, 2).map((n) => n.midi), [76, 75]) // E5, D#5
  assert.ok(s.notes.every((n) => n.measure >= 0 && n.measure < 105))
})

test('notation DSL', () => {
  const s = songFromDsl({ id: 'x', title: 'x', composer: '', bpm: 100, num: 4, den: 4, right: 'C4 D4 E4:2 | C4+E4+G4:4', left: 'C3:4 | r:2 G2:2' })
  assert.equal(s.measures.length, 2)
  assert.equal(s.notes.length, 8)
  assert.equal(s.totalBeats, 8)
})

test('generated MusicXML has one <measure> per bar', () => {
  const s = elise()
  const xml = songToMusicXml(s)
  assert.equal(xml.match(/<measure /g)?.length, s.measures.length)
  assert.ok(xml.includes('<fifths>0</fifths>'))
})

test('learning plans always fill exactly the daily minutes', () => {
  const s = elise()
  for (const [days, minutes] of [[1, 15], [3, 5], [7, 10], [20, 5], [30, 20], [60, 45]]) {
    const plan = createPlan(s, { days, minutes, startDate: '2026-01-01' })
    assert.equal(plan.days.length, days)
    for (const d of plan.days) {
      assert.equal(d.tasks.reduce((a, t) => a + t.minutes, 0), minutes)
      for (const t of d.tasks) assert.ok(t.from >= 0 && t.to < s.measures.length && t.from <= t.to)
    }
    // any plan of two or more days finishes with a full-tempo run
    if (days > 1) assert.equal(plan.days.at(-1)!.tasks.at(-1)!.speed, 100)
  }
})

test('sections cover every bar exactly once', () => {
  const s = elise()
  for (const n of [1, 2, 5, 13, 52]) {
    const secs = splitSections(s, n)
    assert.equal(secs.length, n)
    assert.equal(secs[0].from, 0)
    assert.equal(secs.at(-1)!.to, s.measures.length - 1)
    secs.slice(1).forEach((x, i) => assert.equal(x.from, secs[i].to + 1))
  }
})

test('pace estimate and weak spots', () => {
  const s = elise()
  assert.equal(planShape(s, { days: 2, minutes: 5, startDate: '' }).pace, 'heroic')
  assert.equal(planShape(s, { days: 60, minutes: 30, startDate: '' }).pace, 'relaxed')
  const w = weakSpot(s, { 40: [4, 0], 41: [4, 1], 42: [4, 0], 43: [4, 1] })
  assert.ok(w.from >= 37 && w.to <= 46)
})
