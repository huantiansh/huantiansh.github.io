import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join, basename } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MUSIC_DIR = join(ROOT, 'static', 'music')
const OUTPUT = join(MUSIC_DIR, 'playlist.json')
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav'])

if (!existsSync(MUSIC_DIR)) mkdirSync(MUSIC_DIR, { recursive: true })

const files = readdirSync(MUSIC_DIR).filter((file) => AUDIO_EXTS.has(extname(file).toLowerCase()))
files.sort((a, b) => a.localeCompare(b, 'zh-CN'))

const defaultCover = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp']
  .find((name) => existsSync(join(MUSIC_DIR, name))) || ''

function encodePath(name) {
  return `/music/${encodeURIComponent(name)}`
}

const audio = files.map((file) => {
  const ext = extname(file)
  const stem = basename(file, ext)
  let artist = ''
  let name = stem
  let track = ''

  const numbered = stem.match(/^(\d{1,3})\s*-\s*(.+?)\s*-\s*(.+)$/)
  if (numbered) {
    track = numbered[1].trim()
    name = numbered[2].trim()
    artist = numbered[3].trim()
  } else {
    const matched = stem.match(/^(.+?)\s*-\s*(.+)$/)
    if (matched) {
      artist = matched[1].trim()
      name = matched[2].trim()
    }
  }

  const coverFile = [`${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, `${stem}.webp`]
    .find((candidate) => existsSync(join(MUSIC_DIR, candidate))) || defaultCover
  const lrcFile = `${stem}.lrc`

  return {
    name,
    artist,
    ...(track ? { track } : {}),
    url: encodePath(file),
    cover: coverFile ? encodePath(coverFile) : '',
    ...(existsSync(join(MUSIC_DIR, lrcFile))
      ? { lrc: encodePath(lrcFile), lrcType: 3 }
      : {}),
  }
})

writeFileSync(OUTPUT, `${JSON.stringify({ audio }, null, 2)}\n`, 'utf8')
console.log(`[music] wrote ${audio.length} track(s) -> static/music/playlist.json`)
