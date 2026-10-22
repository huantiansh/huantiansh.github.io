import fs from 'node:fs'
import path from 'node:path'
import { MUSIC_DIR, backupFile, ensureDir, safeJoin, staticRel } from './paths.mjs'

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav'])

function sanitizeName(name) {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim()
  return base || `music-${Date.now()}.mp3`
}

export function listMusic() {
  if (!fs.existsSync(MUSIC_DIR)) return []
  return fs.readdirSync(MUSIC_DIR)
    .filter((name) => AUDIO_EXTS.has(path.extname(name).toLowerCase()))
    .map((name) => {
      const abs = path.join(MUSIC_DIR, name)
      const stat = fs.statSync(abs)
      return {
        name,
        path: `/music/${name}`,
        preview: `/media/${staticRel(abs)}`,
        size: stat.size,
        mtime: stat.mtimeMs
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

export function saveMusic({ buffer, name }) {
  const ext = path.extname(String(name || '')).toLowerCase()
  if (!AUDIO_EXTS.has(ext)) throw new Error('只支持 mp3 / flac / m4a / ogg / wav')
  const filename = sanitizeName(name)
  ensureDir(MUSIC_DIR)
  const abs = safeJoin(MUSIC_DIR, filename)
  backupFile(abs)
  fs.writeFileSync(abs, buffer)
  return { name: filename, path: `/music/${filename}`, preview: `/media/${staticRel(abs)}`, size: buffer.length }
}

export function deleteMusic(name) {
  const filename = sanitizeName(name)
  const abs = safeJoin(MUSIC_DIR, filename)
  if (!fs.existsSync(abs)) throw new Error('音乐文件不存在')
  backupFile(abs)
  fs.unlinkSync(abs)
  return { deleted: filename }
}
