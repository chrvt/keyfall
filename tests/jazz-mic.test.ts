import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRAME, PitchDetector } from '../src/lib/pitch.ts'
import { FORMS, chord, chordPcs, guidePcs, scalePcs, shell } from '../src/jazz/theory.ts'
import { LICKS, jazzSongs, phraseNotes } from '../src/jazz/songs.ts'
import { LESSONS } from '../src/jazz/course.ts'

const SR = 48000
/** a plucked harmonic tone starting at 0.5 s */
function tone(midi: number, seconds = 1.2) {
  const f = 440 * Math.pow(2, (midi - 69) / 12)
  const x = new Float32Array(Math.round(seconds * SR))
  for (let i = SR / 2; i < x.length; i++) {
    const t = (i - SR / 2) / SR
    let v = 0
    for (let k = 1; k <= 6; k++) v += (Math.sin(2 * Math.PI * f * k * t) / k) * Math.exp(-t * (1.5 + k))
    x[i] = 0.2 * v * Math.min(1, t / 0.004) + (Math.random() - 0.5) * 0.0004
  }
  return x
}
function heard(audio: Float32Array, expected: number[]) {
  const det = new PitchDetector(SR)
  const out = new Set<number>()
  for (let pos = FRAME; pos < audio.length; pos += 960) for (const p of det.process(audio.subarray(pos - FRAME, pos), pos / SR, expected)) out.add(p)
  return [...out]
}

test('microphone detector: confirms the struck note only', () => {
  for (const m of [45, 52, 60, 67, 76, 84]) {
    const a = tone(m)
    assert.deepEqual(heard(a, [m]), [m], `note ${m} should be confirmed`)
    assert.deepEqual(heard(a, [m + 1]), [], `${m} must not pass for the key above`)
    assert.deepEqual(heard(a, [m - 2]), [], `${m} must not pass for a whole tone below`)
    assert.deepEqual(heard(a, [m + 7]), [], `${m} must not pass for the fifth above`)
  }
})

test('microphone detector: an octave too low is not accepted', () => {
  assert.deepEqual(heard(tone(48), [60]), [])
  assert.deepEqual(heard(tone(60), [72]), [])
  assert.deepEqual(heard(tone(60), [48]), [])
})

test('microphone detector: free playing reports the struck note, once, without its octave', () => {
  const all = Array.from({ length: 37 }, (_, i) => 48 + i)
  for (const m of [55, 60, 67, 74]) {
    const a = tone(m, 1.6)
    const det = new PitchDetector(SR)
    const out: number[] = []
    for (let pos = FRAME; pos < a.length; pos += 960) out.push(...det.process(a.subarray(pos - FRAME, pos), pos / SR, all, [], true))
    assert.deepEqual(out, [m], `free playing: ${m}`)
  }
})

test('jazz theory', () => {
  const c7 = chord('C7')
  assert.deepEqual(chordPcs(c7), [0, 4, 7, 10])
  assert.deepEqual(guidePcs(chord('F7')), [9, 3])
  assert.deepEqual(scalePcs(0, 'blues'), [0, 3, 5, 6, 7, 10])
  assert.deepEqual(shell(c7), [48, 58])
  assert.equal(chord('Bm7b5').symbol, 'Bm7♭5')
  for (const f of Object.values(FORMS)) for (const s of f.bars) assert.ok(shell(chord(s)).every((m) => m < 60), 'shells stay below middle C')
  assert.equal(FORMS.blues.bars.length, 12)
})

test('jazz course content is consistent', () => {
  const songs = jazzSongs()
  for (const s of songs) assert.equal(s.totalBeats % 4, 0, s.id + ' fills whole bars')
  for (const l of LICKS) assert.ok(phraseNotes(l).every((n) => n.beat < 8), 'licks fit in two bars')
  const ids = new Set(songs.map((s) => s.id))
  assert.equal(LESSONS.length, 12)
  for (const l of LESSONS) {
    for (const st of l.steps) {
      if (st.kind === 'song') assert.ok(ids.has(st.songId), `${l.id}: unknown piece ${st.songId}`)
      if (st.kind === 'jam') assert.ok(FORMS[st.form], `${l.id}: unknown form ${st.form}`)
    }
  }
})
