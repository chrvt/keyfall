# Keyfall

Learn piano pieces with falling notes, one hand at a time, at your own tempo – with a
day-by-day learning path that fits the time you actually have.

## Install and run

You need Python 3.9 or newer – nothing else. The app is a web page served from your own
computer; it opens in your browser (Chrome or Edge recommended, they support MIDI keyboards).

**With [uv](https://docs.astral.sh/uv/)** – run it without installing anything permanently:

```bash
uvx --from git+https://github.com/chrvt/keyfall keyfall
```

or install the `keyfall` command for good:

```bash
uv tool install git+https://github.com/chrvt/keyfall
keyfall
```

**With pip:**

```bash
pip install git+https://github.com/chrvt/keyfall
keyfall                 # or: python -m keyfall
```

`keyfall` starts a small local server at http://localhost:8765 and opens it. Stop it with
`Ctrl+C`. Options: `--port 9000` (or `--port 0` for any free port), `--no-browser`.

**Your own pieces:** put MIDI (`.mid`) or MusicXML (`.musicxml`, `.xml`, `.mxl`) files into a
folder called `Keyfall` in your home directory and they appear under *Your pieces* the next
time you load the page (`keyfall --songs /some/other/folder` to use a different one). A file
named `Composer - Title.mid` is listed with that composer and title. You can also drag files
onto the library page; those are stored in the browser instead.

To update: `uv tool upgrade keyfall`, or `pip install --upgrade --force-reinstall git+https://github.com/chrvt/keyfall`.

### Working on the code

The app itself is TypeScript + React (Vite); the Python package only ships the built files.

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload; also reads pieces from ./my-songs
npm test           # unit tests: parsers, plan generator, note detector, jazz course
npm run build:py   # build and copy the result into keyfall/static/ (what pip/uv install)
```

Everything runs in your browser on your own computer. Progress, plans and uploaded scores are stored locally
(localStorage / IndexedDB); nothing is sent anywhere.

## What it does

**Library** – 14 pieces from first steps to Clair de Lune, plus your own uploads
(MusicXML `.musicxml` / `.xml` / `.mxl`, or MIDI `.mid`).

**Player**

| | |
|---|---|
| Waterfall | Notes fall onto an 88-key-aware keyboard that zooms to the piece's range. Blue = left hand, orange = right hand. |
| Three modes | **Watch** (the app plays, you follow), **Practice** (notes wait for you), **Perform** (keep time, get a score). |
| Hands | Left / Both / Right. The other hand is dimmed and can accompany you or stay silent. |
| Speed | 25–150 %, with `↑` / `↓`. |
| Loop | Any range of bars (Shift-drag the timeline, or the Loop menu), "weakest bars", plan sections. |
| Tempo trainer | In a loop, adds 5 % after every clean pass until you reach full tempo. |
| Sheet music | Toggle a score strip that scrolls with the music; click a bar to jump there. |
| Metronome | Click with a one-bar count-in. |
| Input | MIDI keyboard (Web MIDI – Chrome / Edge), microphone for acoustic pianos (experimental), on-screen keys, computer keyboard. |

**Learning path** – "learn this in 20 days at 5 minutes a day". Keyfall splits the piece
into sections by how much *new* material each bar contains (repeated bars are cheap),
then schedules:

1. **Learn** – each section right hand, left hand, then together, with a warm-up review of
   yesterday and spaced "memory refresh" of older sections.
2. **Connect** – join sections into larger parts, then slow run-throughs.
3. **Polish** – weak-spot loops and full runs, ramping to 100 % and a final performance.

Each day becomes a guided session: every task pre-sets the hand, bars, tempo and a timer.
After a task you rate it (hard / okay / easy); "hard" earns that passage an extra slot
tomorrow, and ratings feed the per-bar mastery map. The wizard tells you honestly whether
your schedule is relaxed, balanced, ambitious or heroic.

**Jazz Lab** – a twelve-lesson course in improvising ("free-styling"), from a one-note solo
to a two-handed blues. Each lesson mixes four kinds of step:

- *Idea* – a short explanation in plain language (no reading music required).
- *Learn it* – a scale, lick, shell-voicing exercise or tune opened in the normal player.
- *Call & response* – the teacher's piano plays a phrase, you play it back (or answer it).
- *Jam* – a swing trio (walking bass, ride cymbal, comping piano) loops the chords. Keys that
  fit glow – safe scale notes, chord tones, 3rds and 7ths, left-hand shells – and follow the
  chord changes. What you play rises from the keyboard coloured by how well it fits, a small
  mission ("leave three bars of space", "land on a chord tone on beat one") counts live, and
  a coach comment follows when you stop.

The lessons: swing feel · three notes are enough · the blues scale · call and response ·
left-hand shells · hands together · chord tones · guide tones · ii–V–I · approach notes ·
motifs · your first solo (the head of *Keyfall Blues*, then your own choruses).

**Progress** – streak, minutes, a practice heat-map and per-bar mastery for every piece.

## Keyboard shortcuts

`Space` play/pause · `←` `→` previous/next bar · `↑` `↓` speed · `Enter` restart ·
`A S D F G H J K` white keys, `W E T Y U O P` black keys, `Z` / `X` octave down/up.

## Good to know

- **PDF / photos of sheet music are not supported.** Reading notes from an image (OMR) is
  unreliable; export MusicXML or MIDI from MuseScore, Sibelius, Dorico, flat.io etc.
- **Microphone mode** checks whether the notes the app is waiting for were struck; it does not
  transcribe free playing. For each expected note it looks for that note's own overtone
  pattern, so a neighbouring key, a fifth or (mostly) a wrong octave is not accepted, and it
  adapts to pianos tuned a little flat or sharp. Chords are confirmed note by note. It has
  been measured on recordings of a real piano mixed with simulated room echo and noise
  (`node tests/mic-eval.ts`, needs ffmpeg), not yet in a real room – use headphones so it
  hears only you, and expect bass notes to take a moment longer (about 0.15 s) than treble.
  ⚙ → *any octave* makes it accept the right note in any octave.
- **Jazz Lab with an acoustic piano:** switch on *🎤 use microphone* above the jam keyboard.
  It follows free playing (any note, not only expected ones), which is harder than Practice
  mode: single-note lines are heard well, fast repeated notes, chords and two hands less so,
  and missions are judged more leniently to allow for that. The band's piano is switched off
  while it listens and the bass is recognised and ignored, but keep the speakers moderate or
  wear headphones. A MIDI keyboard remains the most exact input.
- **Repeats** in uploaded MusicXML are played straight through (no repeat expansion), and
  tempo changes inside a piece are ignored – one tempo per piece, adjustable in ⚙.
- For MIDI files and the built-in pieces the sheet is a simplified engraving generated from
  the notes (one voice per hand). Uploaded MusicXML is shown as written.
- Single-track MIDI files are split into hands at middle C; use ⚙ → *Swap hands* if a
  two-track file comes out the wrong way round.

## Credits

- Classical scores: public-domain editions from the [Mutopia Project](https://www.mutopiaproject.org).
- Piano samples: Salamander Grand Piano V3 by Alexander Holm, CC-BY 3.0.
- Notation rendering: [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org); MIDI parsing: `@tonejs/midi`.
- *Petite valse de Montmartre*, *Twinkle*, the *Ode to Joy* arrangement and all Jazz Lab material
  (licks, exercises, *Keyfall Blues*, lesson texts) were written for this app.
  Copyrighted music (film scores etc.) is deliberately not bundled – bring your own files.

## Code map

```
src/music/     song model, MIDI + MusicXML import, notation DSL, MusicXML generator
src/lib/       engine (timing, wait/perform judging), audio sampler, mic listener + note
               detector (pitch.ts), plan generator, storage, song library
src/jazz/      harmony helpers, backing band, lessons, practice pieces, jam session logic
src/ui/        Library, Player (waterfall canvas, sheet strip, session panel), Plan, Progress, Jazz
public/songs   bundled MIDI files      public/samples   piano samples
keyfall/       Python launcher (`keyfall` command) + the built app in keyfall/static/
```

## License

MIT for the code and the material written for this app – see [LICENSE](LICENSE), which also
lists the terms of the bundled piano samples (CC-BY 3.0) and libraries.
