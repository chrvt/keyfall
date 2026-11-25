import type { Song } from '../music/types.ts'
import { estimateDifficulty } from '../music/types.ts'
import { parseMidi } from '../music/midi.ts'
import { songFromDsl } from '../music/dsl.ts'
import { parseMusicXml, unzipMxl } from '../music/musicxml.ts'
import { jazzSongs } from '../jazz/songs.ts'
import { createStore, idbDeleteSong, idbListSongs, idbSaveSong } from './store.ts'

interface MidiDef {
  id: string; file: string; title: string; composer: string; difficulty: number
  bpm: number; fifths: number; pickup?: number; blurb: string
}

const MUTOPIA = 'Typeset by the Mutopia Project (public domain)'
const MIDI_SONGS: MidiDef[] = [
  { id: 'minuet-in-g', file: 'minuet-in-g.mid', title: 'Minuet in G', composer: 'Petzold / J. S. Bach notebook', difficulty: 2, bpm: 112, fifths: 1, blurb: 'Elegant baroque dance – a classic first “real” piece.' },
  { id: 'schumann-foreign-lands', file: 'schumann-foreign-lands.mid', title: 'Of Foreign Lands and People', composer: 'Robert Schumann', difficulty: 2, bpm: 76, fifths: 1, blurb: 'Dreamy opening of “Scenes from Childhood”.' },
  { id: 'chopin-prelude-a-major', file: 'chopin-prelude-a-major.mid', title: 'Prelude in A major, Op. 28 No. 7', composer: 'Frédéric Chopin', difficulty: 2, bpm: 72, fifths: 3, pickup: 1, blurb: 'Sixteen bars of pure charm.' },
  { id: 'gymnopedie-1', file: 'gymnopedie-1.mid', title: 'Gymnopédie No. 1', composer: 'Erik Satie', difficulty: 2, bpm: 66, fifths: 2, blurb: 'Slow, floating French minimalism.' },
  { id: 'burgmuller-arabesque', file: 'burgmuller-arabesque.mid', title: 'Arabesque, Op. 100 No. 2', composer: 'Friedrich Burgmüller', difficulty: 2, bpm: 132, fifths: 0, blurb: 'Fast, fun finger-runs in A minor.' },
  { id: 'bach-prelude-c', file: 'bach-prelude-c.mid', title: 'Prelude in C major, BWV 846', composer: 'Johann Sebastian Bach', difficulty: 3, bpm: 66, fifths: 0, blurb: 'One hypnotic pattern, endless harmony.' },
  { id: 'chopin-prelude-e-minor', file: 'chopin-prelude-e-minor.mid', title: 'Prelude in E minor, Op. 28 No. 4', composer: 'Frédéric Chopin', difficulty: 3, bpm: 60, fifths: 1, pickup: 1, blurb: 'A sighing melody over slowly sinking chords.' },
  { id: 'fur-elise', file: 'fur-elise.mid', title: 'Für Elise', composer: 'Ludwig van Beethoven', difficulty: 3, bpm: 62, fifths: 0, pickup: 0.5, blurb: 'The famous bagatelle – complete.' },
  { id: 'traumerei', file: 'traumerei.mid', title: 'Träumerei', composer: 'Robert Schumann', difficulty: 3, bpm: 60, fifths: -1, pickup: 1, blurb: '“Dreaming” – tender and expressive.' },
  { id: 'entertainer', file: 'entertainer.mid', title: 'The Entertainer', composer: 'Scott Joplin', difficulty: 4, bpm: 80, fifths: 0, blurb: 'The ragtime everyone knows.' },
  { id: 'clair-de-lune', file: 'clair-de-lune.mid', title: 'Clair de Lune', composer: 'Claude Debussy', difficulty: 5, bpm: 66, fifths: -5, blurb: 'Moonlight in D♭ – a long-term goal piece.' },
]

function dslSongs(): Song[] {
  const twinkle = songFromDsl({
    id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', composer: 'Traditional', bpm: 100, num: 4, den: 4,
    right: `C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 |
            C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2`,
    left: `C3:2 E3:2 | F3:2 E3:2 | D3:2 C3:2 | G2:2 C3:2 | E3:2 D3:2 | C3:2 G2:2 | E3:2 D3:2 | C3:2 G2:2 |
           C3:2 E3:2 | F3:2 E3:2 | D3:2 C3:2 | G2:2 C3:2`,
  })
  twinkle.difficulty = 1
  twinkle.blurb = 'Your very first two-hand piece.'
  const ode = songFromDsl({
    id: 'ode-to-joy', title: 'Ode to Joy', composer: 'Ludwig van Beethoven (easy arr.)', bpm: 108, num: 4, den: 4,
    right: `E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2 |
            D4 D4 E4 C4 | D4 E4:.5 F4:.5 E4 C4 | D4 E4:.5 F4:.5 E4 D4 | C4 D4 G3:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2`,
    left: `C3+G3:4 | B2+G3:4 | C3+G3:4 | C3+G3:2 B2+G3:2 | C3+G3:4 | B2+G3:4 | C3+G3:4 | B2+G3:2 C3+G3:2 |
           B2+G3:2 C3+G3:2 | B2+G3:2 C3+G3:2 | B2+G3:2 C3+G3:1 B2+G3:1 | C3+G3:1 A2+F#3:1 G2:2 | C3+G3:4 | B2+G3:4 | C3+G3:4 | B2+G3:2 C3+G3:2`,
  })
  ode.difficulty = 1
  ode.blurb = 'A melody you already know – perfect for starting out.'
  // An original piece written for this app, in the spirit of French café-minimalism.
  const Am = 'A2:.5 E3:.5 A3:.5 C4:.5 A3:.5 E3:.5', F = 'F2:.5 C3:.5 F3:.5 A3:.5 F3:.5 C3:.5'
  const C = 'C3:.5 G3:.5 C4:.5 E4:.5 C4:.5 G3:.5', G = 'G2:.5 D3:.5 G3:.5 B3:.5 G3:.5 D3:.5'
  const prog = `${Am} | ${F} | ${C} | ${G} |`
  const A = `E5:2 C5 | A4:2 C5 | E5 D5 C5 | D5:2 B4 | C5 E5 A5 | A5:2 F5 | G5 E5 C5 | D5:3 |`
  const B = `A4:.5 C5:.5 E5:.5 C5:.5 A5:.5 E5:.5 | A4:.5 C5:.5 F5:.5 C5:.5 A5:.5 F5:.5 | G4:.5 C5:.5 E5:.5 C5:.5 G5:.5 E5:.5 | G4:.5 B4:.5 D5:.5 B4:.5 G5:.5 D5:.5 |
             A5 E5:.5 C5:.5 E5 | F5 C5:.5 A4:.5 C5 | E5 C5:.5 G4:.5 C5 | D5 B4 G4 |`
  const valse = songFromDsl({
    id: 'valse-montmartre', title: 'Petite valse de Montmartre', composer: 'Keyfall original · in the style of French film music', bpm: 132, num: 3, den: 4,
    right: `r:3 | r:3 | r:3 | r:3 | ${A} ${B} ${A} A4+C5+E5:3`,
    left: `${prog} ${prog} ${prog} ${prog} ${prog} ${prog} ${prog} A2+E3+A3:3`,
  })
  valse.difficulty = 2
  valse.blurb = 'Rolling left hand, wistful melody – if you love the Amélie soundtrack, start here.'
  return [twinkle, ode, valse]
}

export const libraryStore = createStore<{ songs: Song[]; loading: boolean }>(null, { songs: [], loading: true })

let started = false
export function loadLibrary() {
  if (started) return
  started = true
  const dsl = [...dslSongs(), ...jazzSongs()]
  libraryStore.set({ songs: dsl, loading: true })
  const jobs = MIDI_SONGS.map(async (def) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}songs/${def.file}`)
      if (!res.ok) throw new Error(res.statusText)
      const song = parseMidi(await res.arrayBuffer(), def)
      return { ...song, source: 'builtin' as const, difficulty: def.difficulty, blurb: def.blurb, credit: MUTOPIA }
    } catch (e) {
      console.warn('could not load', def.id, e)
      return null
    }
  })
  void Promise.all([Promise.all(jobs), idbListSongs(), folderSongs()]).then(([midis, uploads, mine]) => {
    const order = ['twinkle', 'ode-to-joy', 'valse-montmartre', ...MIDI_SONGS.map((m) => m.id), ...jazzSongs().map((s) => s.id)]
    const builtin = [...dsl, ...(midis.filter(Boolean) as Song[])].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    uploads.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    mine.sort((a, b) => a.title.localeCompare(b.title))
    libraryStore.set({ songs: [...uploads, ...mine, ...builtin], loading: false })
  })
}

/** read a score from raw bytes; `fileName` decides the format */
async function parseScore(fileName: string, bytes: ArrayBuffer, id: string, meta: { title?: string; composer?: string } = {}): Promise<Song> {
  const name = fileName.replace(/\.[^.]+$/, '')
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'mid' || ext === 'midi') return parseMidi(bytes, { id, title: name.replace(/[_-]+/g, ' '), ...meta })
  if (ext === 'mxl') return parseMusicXml(await unzipMxl(bytes), { id, title: name, ...meta })
  if (ext === 'xml' || ext === 'musicxml') return parseMusicXml(new TextDecoder().decode(bytes), { id, title: name, ...meta })
  if (ext === 'pdf' || /^(png|jpe?g)$/.test(ext)) {
    throw new Error(
      'PDFs and images are pictures of notes, which Keyfall can’t read reliably. Export the piece as MusicXML or MIDI instead (MuseScore, Sibelius, Finale, Dorico and flat.io can all do this, and musescore.com offers both downloads).',
    )
  }
  throw new Error('Unsupported file type. Please use MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid).')
}

/**
 * Pieces from the player's own songs folder, which the local server lists at my-songs/index.json
 * (see keyfall/__main__.py and vite.config.ts). They are read fresh on every start – nothing is
 * copied – so adding or removing a file there is all it takes.
 */
async function folderSongs(): Promise<Song[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}my-songs/index.json`, { cache: 'no-store' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return []
    const files: string[] = await res.json()
    const songs = await Promise.all(files.map(async (file) => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}my-songs/${encodeURIComponent(file)}`)
        if (!r.ok) throw new Error(r.statusText)
        // "Composer - Title___WWW.SOMESITE.COM.mid" → composer and title
        const clean = file.replace(/\.[^.]+$/, '').replace(/_{2,}.*$/, '').replace(/[_]+/g, ' ').replace(/\s+'/g, '’').trim()
        const cut = clean.indexOf(' - ')
        const meta = cut > 0 ? { composer: clean.slice(0, cut).replace(/^([^.,]+)[.,]\s*(.+)$/, '$2 $1'), title: clean.slice(cut + 3) } : { title: clean }
        const id = 'my-' + file.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
        const song = await parseScore(file, await r.arrayBuffer(), id, meta)
        return { ...song, source: 'folder' as const, difficulty: estimateDifficulty(song) }
      } catch (e) {
        console.warn('could not read', file, e)
        return null
      }
    }))
    return songs.filter(Boolean) as Song[]
  } catch {
    return []
  }
}

export async function importFile(file: File): Promise<Song> {
  const song = await parseScore(file.name, await file.arrayBuffer(), 'up-' + Date.now().toString(36))
  song.source = 'upload'
  song.addedAt = Date.now()
  song.difficulty = estimateDifficulty(song)
  await idbSaveSong(song)
  libraryStore.set((s) => ({ ...s, songs: [song, ...s.songs] }))
  return song
}

export async function removeSong(id: string) {
  await idbDeleteSong(id)
  libraryStore.set((s) => ({ ...s, songs: s.songs.filter((x) => x.id !== id) }))
}

export function patchSong(song: Song) {
  libraryStore.set((s) => ({ ...s, songs: s.songs.map((x) => (x.id === song.id ? song : x)) }))
  if (song.source === 'upload') void idbSaveSong(song)
}
