import { useSyncExternalStore } from 'react'
import type { Song } from '../music/types.ts'
import type { Plan } from './plan.ts'
import type { RunResult } from './engine.ts'

export function createStore<T>(key: string | null, initial: T) {
  let value = initial
  if (key) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) value = { ...initial, ...JSON.parse(raw) }
    } catch { /* ignore */ }
  }
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set(v: T | ((prev: T) => T)) {
      value = typeof v === 'function' ? (v as (p: T) => T)(value) : v
      if (key) {
        try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota */ }
      }
      subs.forEach((s) => s())
    },
    subscribe(fn: () => void) {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
  }
}
export type Store<T> = ReturnType<typeof createStore<T>>
export function useStore<T>(s: Store<T>): T {
  return useSyncExternalStore(s.subscribe, s.get)
}

export interface Settings {
  volume: number
  showNames: boolean
  showSheet: boolean
  fullKeyboard: boolean
  zoom: number
  kbOctave: number
  octaveFree: boolean
  seenTips: boolean
}
export const settingsStore = createStore<Settings>('keyfall.settings', {
  volume: 0.85, showNames: true, showSheet: false, fullKeyboard: false, zoom: 4, kbOctave: 4, octaveFree: false, seenTips: false,
})

export const plansStore = createStore<Record<string, Plan>>('keyfall.plans', {})

export interface SongStats {
  sec: number
  last: number
  best?: number
  runs: number
  /** per measure [attempts, clean] */
  measures: Record<number, [number, number]>
}
export interface Stats {
  log: Record<string, number>
  songs: Record<string, SongStats>
}
export const statsStore = createStore<Stats>('keyfall.stats', { log: {}, songs: {} })

export const dayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return dayStr(d)
}
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)

const emptySong = (): SongStats => ({ sec: 0, last: 0, runs: 0, measures: {} })

export function addPracticeTime(songId: string, sec: number) {
  statsStore.set((s) => {
    const day = dayStr()
    const song = { ...(s.songs[songId] ?? emptySong()) }
    song.sec += sec
    song.last = Date.now()
    return { log: { ...s.log, [day]: (s.log[day] ?? 0) + sec }, songs: { ...s.songs, [songId]: song } }
  })
}

export function recordRun(songId: string, r: RunResult) {
  statsStore.set((s) => {
    const song = { ...(s.songs[songId] ?? emptySong()) }
    song.runs++
    if (!r.partial) song.best = Math.max(song.best ?? 0, r.accuracy)
    const m = { ...song.measures }
    for (const [k, [a, c]] of Object.entries(r.measures)) {
      const prev = m[+k] ?? [0, 0]
      // exponential forgetting keeps the map responsive to recent practice
      m[+k] = [prev[0] * 0.6 + a, prev[1] * 0.6 + c]
    }
    song.measures = m
    return { ...s, songs: { ...s.songs, [songId]: song } }
  })
}

export function streak(log: Record<string, number>): number {
  let day = dayStr()
  if ((log[day] ?? 0) < 30) day = addDays(day, -1)
  let n = 0
  while ((log[day] ?? 0) >= 30) {
    n++
    day = addDays(day, -1)
  }
  return n
}

/* ---------- uploaded songs (IndexedDB) ---------- */
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('keyfall', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
export async function idbSaveSong(song: Song) {
  const d = await db()
  await new Promise<void>((res, rej) => {
    const tx = d.transaction('songs', 'readwrite')
    tx.objectStore('songs').put(song)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}
export async function idbListSongs(): Promise<Song[]> {
  try {
    const d = await db()
    return await new Promise((res, rej) => {
      const r = d.transaction('songs').objectStore('songs').getAll()
      r.onsuccess = () => res(r.result as Song[])
      r.onerror = () => rej(r.error)
    })
  } catch {
    return []
  }
}
export async function idbDeleteSong(id: string) {
  const d = await db()
  await new Promise<void>((res) => {
    const tx = d.transaction('songs', 'readwrite')
    tx.objectStore('songs').delete(id)
    tx.oncomplete = () => res()
  })
}
