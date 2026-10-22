import fs from 'node:fs'
import path from 'node:path'
import { MUSIC_DIR, backupFile, ensureDir, safeJoin, staticRel } from './paths.mjs'

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav'])

function sanitizeName(name) {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim()
  return base || `music-${Date.now()}.mp3`
}

function encodePath(rel) {
  return `/${rel.split('/').map(encodeURIComponent).join('/')}`
}

function musicFilesIn(album = '') {
  const dir = album ? safeJoin(MUSIC_DIR, album) : MUSIC_DIR
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const abs = path.join(dir, entry.name)
      const stat = fs.statSync(abs)
      const rel = staticRel(abs).split(path.sep).join('/')
      return {
        name: entry.name,
        album,
        path: encodePath(rel),
        preview: encodeURI(`/media/${rel}`),
        size: stat.size,
        mtime: stat.mtimeMs
      }
    })
}

export function listMusic() {
  if (!fs.existsSync(MUSIC_DIR)) return []

  const entries = fs.readdirSync(MUSIC_DIR, { withFileTypes: true })
  const albums = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))

  return [
    ...albums.flatMap((album) => musicFilesIn(album)),
    ...musicFilesIn()
  ].sort((a, b) => {
    const albumOrder = String(a.album).localeCompare(String(b.album), 'zh-CN')
    return albumOrder || a.name.localeCompare(b.name, 'zh-CN')
  })
}

export function saveMusic({ buffer, name, album = '' }) {
  const ext = path.extname(String(name || '')).toLowerCase()
  if (!AUDIO_EXTS.has(ext)) throw new Error('只支持 mp3 / flac / m4a / ogg / wav')

  const cleanAlbum = album ? sanitizeName(album) : ''
  const targetDir = cleanAlbum ? safeJoin(MUSIC_DIR, cleanAlbum) : MUSIC_DIR
  ensureDir(targetDir)

  const filename = sanitizeName(name)
  const abs = safeJoin(targetDir, filename)
  backupFile(abs)
  fs.writeFileSync(abs, buffer)

  const rel = staticRel(abs).split(path.sep).join('/')
  return {
    name: filename,
    album: cleanAlbum,
    path: encodePath(rel),
    preview: encodeURI(`/media/${rel}`),
    size: buffer.length
  }
}

export function deleteMusic(name, album = '') {
  const cleanAlbum = album ? sanitizeName(album) : ''
  const targetDir = cleanAlbum ? safeJoin(MUSIC_DIR, cleanAlbum) : MUSIC_DIR
  const filename = sanitizeName(name)
  const abs = safeJoin(targetDir, filename)
  if (!fs.existsSync(abs)) throw new Error('音乐文件不存在')
  backupFile(abs)
  fs.unlinkSync(abs)
  return { deleted: filename, album: cleanAlbum }
}
