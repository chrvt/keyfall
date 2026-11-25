import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * Dev-server twin of the Python launcher's /my-songs/ endpoint: lists and serves the player's
 * own MIDI / MusicXML files from ./my-songs (in this checkout) and ~/Keyfall.
 */
function mySongs(): Plugin {
  const dirs = [join(process.cwd(), 'my-songs'), join(homedir(), 'Keyfall')]
  const list = () => {
    const out = new Map<string, string>()
    for (const d of dirs) {
      if (!existsSync(d)) continue
      for (const f of readdirSync(d)) if (/\.(mid|midi|musicxml|xml|mxl)$/i.test(f) && !f.startsWith('.') && !out.has(f)) out.set(f, join(d, f))
    }
    return out
  }
  return {
    name: 'keyfall-my-songs',
    configureServer(server) {
      server.middlewares.use('/my-songs', (req, res) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''))
        const files = list()
        if (name === 'index.json') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify([...files.keys()].sort()))
        } else if (files.has(name)) {
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(readFileSync(files.get(name)!))
        } else {
          res.statusCode = 404
          res.end()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mySongs()],
})
