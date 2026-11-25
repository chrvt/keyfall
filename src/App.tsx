import { useEffect, useState } from 'react'
import { libraryStore, loadLibrary } from './lib/songs.ts'
import { useStore } from './lib/store.ts'
import { Library } from './ui/Library.tsx'
import { Player } from './ui/Player.tsx'
import { PlanView } from './ui/PlanView.tsx'
import { Progress } from './ui/Progress.tsx'
import { JazzHome, JazzLesson } from './ui/Jazz.tsx'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const h = () => setHash(location.hash)
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return hash
}

export default function App() {
  const hash = useHash()
  const { songs, loading } = useStore(libraryStore)
  useEffect(loadLibrary, [])

  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [page, id] = path.split('/')
  const params = new URLSearchParams(query)
  const song = id ? songs.find((s) => s.id === decodeURIComponent(id)) : undefined

  if (page === 'play' || page === 'plan') {
    if (!song) {
      return (
        <div className="page narrow center-msg">
          {loading ? <p className="muted">Loading…</p> : <><p>That piece isn’t in your library.</p><a className="btn" href="#/">Back to library</a></>}
        </div>
      )
    }
    if (page === 'play') {
      const day = params.get('day')
      return <Player key={song.id + '|' + (day ?? '')} song={song} sessionDay={day !== null ? +day : null} startTask={params.get('task') ?? undefined} back={params.get('back') ?? (song.tag === 'jazz' ? 'jazz' : undefined)} />
    }
    return (
      <>
        <Nav />
        <PlanView song={song} />
      </>
    )
  }
  if (page === 'jazz') {
    return (
      <>
        <Nav />
        {id ? <JazzLesson lessonId={id} stepParam={+(params.get('step') ?? 0)} /> : <JazzHome />}
      </>
    )
  }
  return (
    <>
      <Nav />
      {page === 'progress' ? <Progress /> : <Library />}
    </>
  )
}

function Nav() {
  const hash = useHash()
  return (
    <nav className="nav">
      <a className="logo" href="#/">
        <span className="logo-mark"><i /><i /><i /></span>
        Keyfall
      </a>
      <div className="spacer" />
      <a className={'nav-link' + (!hash.includes('progress') && !hash.includes('jazz') ? ' on' : '')} href="#/">Library</a>
      <a className={'nav-link' + (hash.includes('jazz') ? ' on' : '')} href="#/jazz">Jazz Lab</a>
      <a className={'nav-link' + (hash.includes('progress') ? ' on' : '')} href="#/progress">Progress</a>
    </nav>
  )
}
