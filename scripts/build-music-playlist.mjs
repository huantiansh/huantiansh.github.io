import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, sep } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MUSIC_DIR = join(ROOT, 'static', 'music')
const OUTPUT = join(MUSIC_DIR, 'playlist.json')
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav'])
const COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const DEFAULT_ALBUM = '芸开了'
const LEGACY_ALBUM = '未分类'

if (!existsSync(MUSIC_DIR)) mkdirSync(MUSIC_DIR, { recursive: true })

function encodeMusicPath(abs) {
  const rel = relative(MUSIC_DIR, abs).split(sep).map(encodeURIComponent).join('/')
  return `/music/${rel}`
}

function findCover(dir, stem = '') {
  const candidates = stem
    ? COVER_EXTS.flatMap((ext) => [`${stem}${ext}`, `${stem}${ext.toUpperCase()}`])
    : []
  for (const candidate of candidates) {
    const abs = join(dir, candidate)
    if (existsSync(abs)) return abs
  }
  for (const ext of COVER_EXTS) {
    const abs = join(dir, `cover${ext}`)
    if (existsSync(abs)) return abs
  }
  return ''
}

function parseTrack(file, dir, albumCover) {
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

  const trackCover = findCover(dir, stem) || albumCover || ''
  const lrcPath = join(dir, `${stem}.lrc`)

  return {
    name,
    artist,
    ...(track ? { track } : {}),
    url: encodeMusicPath(join(dir, file)),
    cover: trackCover ? encodeMusicPath(trackCover) : '',
    ...(existsSync(lrcPath) ? { lrc: encodeMusicPath(lrcPath), lrcType: 3 } : {}),
  }
}

function buildAlbum(id, dir, files) {
  const coverAbs = findCover(dir)
  const tracks = files
    .filter((file) => AUDIO_EXTS.has(extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    .map((file) => parseTrack(file, dir, coverAbs))

  const artist = tracks.find((track) => track.artist)?.artist || ''
  return {
    id,
    name: id,
    artist,
    cover: coverAbs ? encodeMusicPath(coverAbs) : '',
    tracks,
  }
}

const entries = readdirSync(MUSIC_DIR, { withFileTypes: true })
const albums = entries
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => {
    const dir = join(MUSIC_DIR, entry.name)
    return buildAlbum(entry.name, dir, readdirSync(dir))
  })
  .filter((album) => album.tracks.length > 0)

const rootAudio = entries
  .filter((entry) => entry.isFile() && AUDIO_EXTS.has(extname(entry.name).toLowerCase()))
  .map((entry) => entry.name)

if (rootAudio.length) {
  albums.push(buildAlbum(LEGACY_ALBUM, MUSIC_DIR, rootAudio))
}

if (!albums.length) {
  console.warn('[music] no audio files found under static/music/')
}

const defaultAlbum = albums.find((album) => album.name === DEFAULT_ALBUM)?.id
  || albums[0]?.id
  || ''
albums.sort((a, b) => {
  if (a.id === defaultAlbum) return -1
  if (b.id === defaultAlbum) return 1
  return a.name.localeCompare(b.name, 'zh-CN')
})

writeFileSync(OUTPUT, `${JSON.stringify({ defaultAlbum, albums }, null, 2)}\n`, 'utf8')
console.log(`[music] wrote ${albums.length} album(s), ${albums.reduce((sum, album) => sum + album.tracks.length, 0)} track(s) -> static/music/playlist.json`)
