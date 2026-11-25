// Copies the built web app (dist/) into the Python package (keyfall/static/).
import { cpSync, rmSync } from 'node:fs'

const from = new URL('../dist/', import.meta.url)
const to = new URL('../keyfall/static/', import.meta.url)
rmSync(to, { recursive: true, force: true })
// personal MIDI files dropped into public/songs are not part of the app
cpSync(from, to, { recursive: true, filter: (src) => !/MIDISFREE/i.test(src) })
console.log('keyfall/static updated')
