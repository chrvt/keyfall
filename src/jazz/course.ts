import type { BandMix } from './band.ts'
import { EASY_CALLS, LICKS } from './songs.ts'

/** a measurable target for a jam – a nudge, never a gate */
export type Goal =
  | { type: 'notes'; min: number; label: string }
  | { type: 'only'; pcs: number[]; pct: number; label: string }
  | { type: 'restBars'; min: number; label: string }
  | { type: 'distinct'; min?: number; max?: number; label: string }
  | { type: 'uses'; pc: number; min: number; label: string }
  | { type: 'chordToneOnOne'; min: number; label: string }
  | { type: 'guideOnOne'; min: number; label: string }
  | { type: 'shellBars'; min: number; label: string }

export type Guide = 'scale' | 'chord' | 'guide'

export type Step =
  | { kind: 'read'; title: string; body: string[] }
  | { kind: 'song'; title: string; body: string; songId: string; cta: string }
  | {
      kind: 'jam'; title: string; body: string; form: string; bpm: number; guide: Guide
      /** restrict the highlighted "safe" notes to these pitch classes */
      pcs?: number[]
      scale?: string
      mix?: Partial<BandMix>
      showShell?: boolean
      goals: Goal[]
    }
  | { kind: 'echo'; title: string; body: string; bpm: number; calls: string[]; answer?: boolean }

export interface Lesson { id: string; unit: string; title: string; summary: string; minutes: number; steps: Step[] }

const C = 0, Eb = 3, F = 5, Fs = 6, G = 7, Bb = 10
const WHITE = [0, 2, 4, 5, 7, 9, 11]

export const LESSONS: Lesson[] = [
  {
    id: 'swing', unit: 'Feel', title: 'Swing: rhythm before notes', minutes: 5,
    summary: 'Play one single note and make it groove.',
    steps: [
      { kind: 'read', title: 'Improvising is talking', body: [
        'Free-styling at the piano is not about knowing a thousand scales. It is **speaking in short sentences**: say something, breathe, say something else. This course gives you a few words at a time and a band to practise them with.',
        'The first ingredient is not a note at all – it is **swing**. Jazz eighth-notes are uneven: *long – short, long – short*, like “**doo**-ba **doo**-ba”. The band below swings; your job is to fall into it.',
        'You don’t need to read music for any of this. Glowing keys are always safe to play.',
      ] },
      { kind: 'jam', title: 'One-note solo', form: 'vamp', bpm: 96, guide: 'scale', pcs: [C],
        body: 'Play only the note **C** (any C on the keyboard). Tap along with the ride cymbal, then try short bursts: “doo-ba doo … (rest) … doo-ba-doo-ba doo”. Great soloists can make one note swing.',
        goals: [
          { type: 'notes', min: 16, label: 'Play at least 16 notes' },
          { type: 'only', pcs: [C], pct: 0.9, label: 'Stay on C' },
          { type: 'restBars', min: 1, label: 'Leave one whole bar empty' },
        ] },
    ],
  },
  {
    id: 'three-notes', unit: 'Feel', title: 'Three notes are enough', minutes: 6,
    summary: 'C, E♭ and F over a real 12-bar blues.',
    steps: [
      { kind: 'read', title: 'Fewer notes, more music', body: [
        'Beginners think improvising means choosing from all 88 keys. Professionals do the opposite: they **limit themselves** and get creative with rhythm, repetition and silence.',
        'Take three notes: **C, E♭, F**. Over a blues in C, none of them can ever sound wrong. Try: *C – E♭ – F … F – E♭ – C … C C – E♭*. Repeat an idea you like; change only its ending.',
      ] },
      { kind: 'echo', title: 'Copy the teacher', bpm: 92, calls: EASY_CALLS,
        body: 'The piano plays a short phrase (watch the notes fall), then it is **your turn** to play it back in the next two bars. Don’t worry about perfect timing – get the shape.' },
      { kind: 'jam', title: 'Three-note blues', form: 'bluesBasic', bpm: 96, guide: 'scale', pcs: [C, Eb, F],
        body: 'Now make up your own phrases with **C, E♭, F**. Play a short idea, then **wait** and listen to the band before the next one.',
        goals: [
          { type: 'notes', min: 20, label: 'Play at least 20 notes' },
          { type: 'only', pcs: [C, Eb, F], pct: 0.85, label: 'Keep to C, E♭, F' },
          { type: 'restBars', min: 3, label: 'Leave 3 bars of space' },
        ] },
    ],
  },
  {
    id: 'blues-scale', unit: 'Vocabulary', title: 'The blues scale', minutes: 8,
    summary: 'Six notes that always work – including the famous “blue note”.',
    steps: [
      { kind: 'read', title: 'Your safe notes', body: [
        'Add three notes to the ones you know and you have the **C blues scale**: **C – E♭ – F – F♯ – G – B♭**. Every one of them fits every chord of a blues in C. That is why the blues is where almost everyone learns to improvise.',
        'The spicy one is **F♯**, the *blue note*. Don’t sit on it – **pass through** it: F – F♯ – G going up, G – F♯ – F coming down.',
      ] },
      { kind: 'song', title: 'Learn the scale', songId: 'jazz-blues-scale', cta: 'Open in the player',
        body: 'Play the scale up and down with falling notes – first straight, then swung. Use Practice mode so it waits for you.' },
      { kind: 'jam', title: 'Blues-scale solo', form: 'blues', bpm: 100, guide: 'scale', scale: 'blues',
        body: 'All six notes glow. Wander up and down the scale in **short phrases**, and slip the blue note F♯ in between F and G.',
        goals: [
          { type: 'notes', min: 30, label: 'Play at least 30 notes' },
          { type: 'distinct', min: 5, label: 'Use at least 5 different notes' },
          { type: 'uses', pc: Fs, min: 2, label: 'Touch the blue note F♯ twice' },
          { type: 'restBars', min: 2, label: 'Leave 2 bars of space' },
        ] },
    ],
  },
  {
    id: 'call-response', unit: 'Vocabulary', title: 'Call and response', minutes: 8,
    summary: 'Echo real blues licks, then answer with your own.',
    steps: [
      { kind: 'read', title: 'How jazz musicians learn', body: [
        'Nobody invents a language from scratch. Jazz players **copy phrases by ear** (“licks”), then bend them into their own. Call and response – someone plays, someone answers – is the oldest form of the blues.',
      ] },
      { kind: 'echo', title: 'Echo the licks', bpm: 92, calls: LICKS,
        body: 'Four classic-sounding licks. Listen and watch for two bars, play it back for two bars. Each lick comes twice.' },
      { kind: 'echo', title: 'Now answer back', bpm: 92, calls: LICKS, answer: true,
        body: 'Same calls – but this time **don’t copy**. Answer with your own phrase from the blues scale, as if replying to a question. Try starting your answer on the note the call ended on.' },
      { kind: 'song', title: 'Keep the licks', songId: 'jazz-licks', cta: 'Practise the four licks',
        body: 'Want them under your fingers? Loop two bars at a time in the player, slow it down, and add the left hand when you are ready.' },
    ],
  },
  {
    id: 'shells', unit: 'Left hand', title: 'Left-hand shells', minutes: 8,
    summary: 'Two notes per chord are all a jazz left hand needs.',
    steps: [
      { kind: 'read', title: 'Root + 7th', body: [
        'Jazz pianists rarely play big chords in the left hand. They play **shells**: just the **root** and the **7th**. For C7 that is **C + B♭**; for F7, **F + E♭**; for G7, **G + F**. Two notes, lots of space for the right hand.',
        'A 12-bar blues uses only those three chords. Learn three hand shapes and you can accompany yourself through the whole form.',
      ] },
      { kind: 'song', title: 'Shells through the blues', songId: 'jazz-shells', cta: 'Practise the shells',
        body: 'Left hand only, one shell per bar. Say the chord names out loud as you go – you are memorising the **form**.' },
      { kind: 'song', title: 'Add the Charleston rhythm', songId: 'jazz-shells-charleston', cta: 'Practise the rhythm',
        body: 'Same shells on a classic comping rhythm: beat **one**, then the **“and” of two**. It leaves holes for your right hand to answer.' },
      { kind: 'jam', title: 'Comp with the band', form: 'blues', bpm: 96, guide: 'chord', showShell: true, mix: { comp: false },
        body: 'The band’s pianist has gone home – **you** are the left hand now. Play the glowing blue shell when each bar starts. A MIDI keyboard helps here; on a computer keyboard press <kbd>Z</kbd> to reach the lower octave.',
        goals: [{ type: 'shellBars', min: 9, label: 'Hit the shell in 9 of 12 bars' }] },
    ],
  },
  {
    id: 'hands-together', unit: 'Left hand', title: 'Hands together', minutes: 8,
    summary: 'Shells in the left, blues scale in the right.',
    steps: [
      { kind: 'read', title: 'The trick: take turns', body: [
        'Coordinating both hands is easier than it looks if they **take turns**. Left hand plays the shell on beat one and holds it. Right hand answers in the gap. Think *chord … phrase … chord … phrase*.',
        'If it falls apart, drop the right hand for a chorus and just keep the shells going – the form matters more than the solo.',
      ] },
      { kind: 'jam', title: 'Your first two-handed blues', form: 'blues', bpm: 92, guide: 'scale', scale: 'blues', showShell: true, mix: { comp: false },
        body: 'Blue keys: left-hand shell for the current chord. Orange keys: blues scale for the right hand. Keep the right hand simple – three notes are still enough.',
        goals: [
          { type: 'shellBars', min: 8, label: 'Shell in 8 of 12 bars' },
          { type: 'notes', min: 20, label: '20 right-hand notes' },
          { type: 'restBars', min: 2, label: '2 bars of right-hand space' },
        ] },
    ],
  },
  {
    id: 'chord-tones', unit: 'Playing the changes', title: 'Chord tones', minutes: 8,
    summary: 'Make your solo follow the chords.',
    steps: [
      { kind: 'read', title: 'From “safe” to “right”', body: [
        'The blues scale is safe everywhere, which is also its weakness: it sounds the same over every chord. To sound like you **hear the changes**, land on notes that belong to the chord of the moment – its **chord tones** (root, 3rd, 5th, 7th).',
        'You don’t have to play only chord tones. Play anything in between, but **arrive on one on beat one** of the bar. The screen now shows the current chord’s tones brightest, and they change as the band moves.',
      ] },
      { kind: 'jam', title: 'Land on the chord', form: 'blues', bpm: 92, guide: 'chord', scale: 'blues',
        body: 'Watch the chord strip. When a new bar begins, be on a **bright** key. Dim keys are the blues scale – fine for getting there.',
        goals: [
          { type: 'chordToneOnOne', min: 7, label: 'Chord tone on beat one in 7 of 12 bars' },
          { type: 'notes', min: 30, label: 'Play at least 30 notes' },
        ] },
    ],
  },
  {
    id: 'guide-tones', unit: 'Playing the changes', title: 'Guide tones: 3rds and 7ths', minutes: 8,
    summary: 'The two notes that define every chord.',
    steps: [
      { kind: 'read', title: 'Tiny moves, big effect', body: [
        'Of the four chord tones, the **3rd** and the **7th** carry all the colour. And here is the beautiful part: when chords change, these notes barely move. C7’s 3rd is **E**; F7’s 7th is **E♭** – one half-step down. C7’s 7th is **B♭**; F7’s 3rd is **A** – again one half-step.',
        'A line built from guide tones makes listeners hear the harmony even with no band at all.',
      ] },
      { kind: 'song', title: 'Guide-tone lines', songId: 'jazz-guide-tones', cta: 'Play the lines',
        body: 'One long note per bar: first the E / E♭ line, then the B♭ / A line. Listen to how each chord change is just a tiny step.' },
      { kind: 'jam', title: 'Decorate the guide tones', form: 'blues', bpm: 92, guide: 'guide', scale: 'blues',
        body: 'Only the 3rd and 7th of each chord are bright. Hit one at the start of the bar, then decorate with the notes around it.',
        goals: [
          { type: 'guideOnOne', min: 6, label: '3rd or 7th on beat one in 6 of 12 bars' },
          { type: 'restBars', min: 1, label: 'Leave a bar of space' },
        ] },
    ],
  },
  {
    id: 'two-five-one', unit: 'Playing the changes', title: 'ii – V – I', minutes: 9,
    summary: 'The chord progression inside almost every jazz standard.',
    steps: [
      { kind: 'read', title: 'Leaving the blues', body: [
        'Most jazz tunes are chains of one three-chord pattern: **ii – V – I**. In C major that is **Dm7 – G7 – Cmaj7**. Good news: all three chords use only the **white keys**, so the C major scale is your safe zone.',
        'The line you are about to learn is the most common sentence in jazz: run **up the chord**, come **down the scale**, and land on the **3rd** of the next chord.',
      ] },
      { kind: 'song', title: 'A ii – V – I line', songId: 'jazz-two-five-one', cta: 'Learn the line',
        body: 'Right hand first, slowly. Notice bar 2 starts on B (the 3rd of G7) and bar 3 on E (the 3rd of Cmaj7).' },
      { kind: 'jam', title: 'White-key improvisation', form: 'twoFiveOne', bpm: 96, guide: 'chord', scale: 'major',
        body: 'Play white keys only and aim for a bright key whenever the chord changes. Try starting each phrase on a different chord tone.',
        goals: [
          { type: 'only', pcs: WHITE, pct: 0.9, label: 'Stay on the white keys' },
          { type: 'chordToneOnOne', min: 6, label: 'Chord tone on beat one in 6 bars' },
          { type: 'notes', min: 24, label: 'Play at least 24 notes' },
        ] },
      { kind: 'jam', title: 'The turnaround', form: 'turnaround', bpm: 96, guide: 'chord', scale: 'major',
        body: 'Four chords, one per bar: **Cmaj7 – Am7 – Dm7 – G7**. It loops forever and appears at the end of countless tunes. Still white keys only.',
        goals: [{ type: 'chordToneOnOne', min: 8, label: 'Chord tone on beat one in 8 bars' }] },
    ],
  },
  {
    id: 'approach', unit: 'Playing the changes', title: 'Approach notes', minutes: 7,
    summary: 'The “wrong” notes that make it sound like jazz.',
    steps: [
      { kind: 'read', title: 'Any note is one step from a good one', body: [
        'Jazz is full of notes that are outside the scale – and they sound great because they **resolve**. Slide into any chord tone from the key **a half-step below** it and you get that unmistakable jazzy lean: E♭→**E**, F♯→**G**, A→**B♭**.',
        'This also rescues mistakes: if you land on a strange note, move one key up or down and pretend you meant it. (Everybody does.)',
      ] },
      { kind: 'song', title: 'Approach from below', songId: 'jazz-approach', cta: 'Try the exercise',
        body: 'Each chord tone of C7 and F7, approached from the key just below.' },
      { kind: 'jam', title: 'Lean into it', form: 'blues', bpm: 92, guide: 'chord', scale: 'blues',
        body: 'Aim at the bright keys – but arrive via the key just below. Dark keys are allowed today as long as they lead somewhere.',
        goals: [
          { type: 'chordToneOnOne', min: 6, label: 'Chord tone on beat one in 6 bars' },
          { type: 'distinct', min: 7, label: 'Use at least 7 different notes' },
        ] },
    ],
  },
  {
    id: 'motifs', unit: 'Telling a story', title: 'Motifs: say it again', minutes: 7,
    summary: 'Repeat, vary, develop – how a solo becomes a story.',
    steps: [
      { kind: 'read', title: 'Repetition is not cheating', body: [
        'What separates noodling from a solo is **memory**. Play a tiny idea (a *motif* – three or four notes). Then: **repeat** it. **Repeat** it with a different ending. **Move** it up or down. **Stretch** its rhythm. The listener hears a story because they recognise the character.',
        'A simple recipe for 12 bars: idea – same idea – idea with a twist (bars 1–4), the same again a bit higher (5–8), something new and a return (9–12).',
      ] },
      { kind: 'echo', title: 'Vary the call', bpm: 92, calls: EASY_CALLS, answer: true,
        body: 'The piano plays a motif. Answer with **the same motif, slightly changed**: a different last note, a different rhythm, or one octave higher.' },
      { kind: 'jam', title: 'One idea, twelve bars', form: 'blues', bpm: 96, guide: 'scale', scale: 'blues',
        body: 'Pick a three- or four-note motif and stick with it for the whole chorus. Fewer different notes, more repetition, plenty of air.',
        goals: [
          { type: 'distinct', max: 5, label: 'Use at most 5 different notes' },
          { type: 'notes', min: 24, label: 'Play at least 24 notes' },
          { type: 'restBars', min: 3, label: 'Leave 3 bars of space' },
        ] },
    ],
  },
  {
    id: 'first-solo', unit: 'Telling a story', title: 'Your first solo', minutes: 12,
    summary: 'Play a tune, improvise two choruses, play the tune again.',
    steps: [
      { kind: 'read', title: 'Head – solos – head', body: [
        'A jazz performance has a simple shape: play the melody (the **head**), improvise over the same chords, then play the head again. You now have everything you need to do exactly that.',
        'Plan your solo like a story: **chorus 1** – sparse, a motif, lots of space. **Chorus 2** – higher, busier, chord tones on the downbeats, then wind down into the head.',
      ] },
      { kind: 'song', title: 'Learn the head', songId: 'jazz-keyfall-blues', cta: 'Learn “Keyfall Blues”',
        body: 'A riff blues written for this course: one two-bar riff, repeated with small changes – a motif in action. You can build a learning path for it like any other piece.' },
      { kind: 'jam', title: 'Take your solo', form: 'bluesBasic', bpm: 104, guide: 'chord', scale: 'blues', showShell: true,
        body: 'Play the head once from memory if you can, then solo. Use what you know: space, the blue note, landing on chord tones, a motif that comes back. Then stop, read your feedback and go again.',
        goals: [
          { type: 'notes', min: 40, label: 'Play at least 40 notes' },
          { type: 'restBars', min: 3, label: 'Leave 3 bars of space' },
          { type: 'chordToneOnOne', min: 6, label: 'Chord tone on beat one in 6 bars' },
          { type: 'uses', pc: Fs, min: 1, label: 'Use the blue note' },
        ] },
      { kind: 'read', title: 'Where to go from here', body: [
        '**Transpose**: try the blues in F (shells F+E♭, B♭+A♭, C+B♭; blues scale F A♭ B♭ B C E♭). **Listen**: put on a slow blues recording and sing along with the solos – your ears are learning vocabulary. **Steal**: figure out one phrase you love by ear and play it in the jam screens here.',
        'And keep the habit that got you here: a few minutes a day, a small limit, and a band that never gets tired.',
      ] },
    ],
  },
]
