import JSZip from 'jszip'
import type { Note, Song, Measure } from './types.ts'
import { finalizeSong } from './types.ts'

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const UNIT: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }

const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.tagName === name)
const kid = (el: Element | null | undefined, name: string) =>
  el ? (Array.from(el.children).find((c) => c.tagName === name) ?? null) : null
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').trim()

/** Unzip a compressed .mxl file and return the contained MusicXML text. */
export async function unzipMxl(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data)
  let path: string | undefined
  const container = zip.file('META-INF/container.xml')
  if (container) {
    const c = await container.async('string')
    path = /full-path="([^"]+)"/.exec(c)?.[1]
  }
  if (!path || !zip.file(path)) {
    path = Object.keys(zip.files).find((f) => !f.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(f))
  }
  if (!path) throw new Error('No MusicXML found inside the .mxl archive.')
  return zip.file(path)!.async('string')
}

export function parseMusicXml(xml: string, opts: { id: string; title?: string }): Song {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid MusicXML.')
  const root = doc.documentElement
  if (root.tagName !== 'score-partwise') {
    throw new Error('Only "score-partwise" MusicXML files are supported.')
  }
  const title =
    txt(doc.querySelector('work > work-title')) || txt(doc.querySelector('movement-title')) || opts.title || 'Untitled'
  const composer = txt(doc.querySelector('identification > creator[type="composer"]'))
  const parts = kids(root, 'part')
  if (!parts.length) throw new Error('The score has no parts.')

  let bpm = 0
  let fifths: number | null = null
  const measures: Measure[] = []
  const raw: (Note & { key: number })[] = []

  parts.forEach((part, pi) => {
    let divisions = 1
    let num = 4
    let den = 4
    let mStart = 0
    const open = new Map<string, Note>()
    kids(part, 'measure').forEach((m, mi) => {
      let cursor = 0
      let maxCursor = 0
      let lastStart = 0
      for (const el of Array.from(m.children)) {
        switch (el.tagName) {
          case 'attributes': {
            const d = kid(el, 'divisions')
            if (d) divisions = parseFloat(txt(d)) || 1
            const t = kid(el, 'time')
            if (t) {
              num = parseInt(txt(kid(t, 'beats'))) || num
              den = parseInt(txt(kid(t, 'beat-type'))) || den
            }
            const k = kid(kid(el, 'key'), 'fifths')
            if (k && fifths === null) fifths = parseInt(txt(k)) || 0
            break
          }
          case 'backup':
            cursor -= parseFloat(txt(kid(el, 'duration'))) / divisions
            break
          case 'forward':
            cursor += parseFloat(txt(kid(el, 'duration'))) / divisions
            maxCursor = Math.max(maxCursor, cursor)
            break
          case 'direction':
          case 'sound': {
            if (!bpm) {
              const s = el.tagName === 'sound' ? el : el.querySelector('sound[tempo]')
              const t = s?.getAttribute('tempo')
              if (t) bpm = parseFloat(t)
              const met = el.querySelector('metronome')
              if (!bpm && met) {
                const pm = parseFloat(txt(kid(met, 'per-minute')))
                const unit = UNIT[txt(kid(met, 'beat-unit'))] ?? 1
                const dot = kid(met, 'beat-unit-dot') ? 1.5 : 1
                if (pm) bpm = pm * unit * dot
              }
            }
            break
          }
          case 'note': {
            if (kid(el, 'grace')) break
            const dur = (parseFloat(txt(kid(el, 'duration'))) || 0) / divisions
            const chord = !!kid(el, 'chord')
            const start = chord ? lastStart : cursor
            if (!chord) {
              lastStart = cursor
              cursor += dur
              maxCursor = Math.max(maxCursor, cursor)
            }
            const pitch = kid(el, 'pitch')
            if (!pitch || el.getAttribute('print-object') === 'no') break
            const midi =
              STEP[txt(kid(pitch, 'step'))] +
              Math.round(parseFloat(txt(kid(pitch, 'alter')) || '0')) +
              (parseInt(txt(kid(pitch, 'octave'))) + 1) * 12
            const staff = parseInt(txt(kid(el, 'staff')) || '1')
            const ties = kids(el, 'tie').map((t) => t.getAttribute('type'))
            const key = pi * 10 + staff
            const tk = key + ':' + midi
            if (ties.includes('stop') && open.has(tk)) {
              const prev = open.get(tk)!
              prev.dur = mStart + start + dur - prev.beat
              if (!ties.includes('start')) open.delete(tk)
              break
            }
            const n = { id: 0, midi, beat: mStart + start, dur, hand: 'R' as const, vel: 0.7, measure: 0, key }
            raw.push(n)
            if (ties.includes('start')) open.set(tk, n)
            break
          }
        }
      }
      const nominal = (num * 4) / den
      if (pi === 0) {
        const len = maxCursor > 0.01 ? maxCursor : nominal
        measures.push({ index: mi, beat: mStart, len, num, den })
        mStart += len
      } else {
        mStart = measures[mi + 1]?.beat ?? mStart + (measures[mi]?.len ?? nominal)
      }
    })
  })

  if (!raw.length) throw new Error('No playable notes found in this score.')
  const keys = [...new Set(raw.map((n) => n.key))].sort((a, b) => a - b)
  const lastKey = keys[keys.length - 1]
  const notes: Note[] = raw.map(({ key, ...n }) => ({
    ...n,
    hand: keys.length === 1 ? (n.midi >= 60 ? 'R' : 'L') : key === lastKey ? 'L' : 'R',
    vel: 0.7,
  }))
  return finalizeSong({
    id: opts.id,
    title,
    composer,
    bpm: Math.max(20, Math.min(300, Math.round(bpm || 100))),
    fifths: fifths ?? 0,
    notes,
    measures,
    source: 'upload',
    xml,
  })
}
