import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ADMIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PROJECT_ROOT = path.resolve(ADMIN_ROOT, '..')
export const CONTENT_DIR = path.join(PROJECT_ROOT, 'content')
export const POSTS_DIR = path.join(CONTENT_DIR, 'posts')
export const STATIC_DIR = path.join(PROJECT_ROOT, 'static')
export const UPLOADS_DIR = path.join(STATIC_DIR, 'uploads')
export const BACKUP_DIR = path.join(ADMIN_ROOT, 'backups')
export const HUGO_TOML = path.join(PROJECT_ROOT, 'hugo.toml')
export const ADMIN_PORT = 4321
export const PREVIEW_PORT = 1313

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function safeJoin(root, rel) {
  const target = path.resolve(root, rel)
  if (!isInside(root, target)) throw new Error(`路径越界：${rel}`)
  return target
}

export function toPosix(value) {
  return value.split(path.sep).join('/')
}

export function projectRel(abs) {
  return toPosix(path.relative(PROJECT_ROOT, abs))
}

export function staticRel(abs) {
  return toPosix(path.relative(STATIC_DIR, abs))
}

export function mediaUrl(abs) {
  return `/media/${staticRel(abs)}`
}

export function backupFile(abs) {
  if (!fs.existsSync(abs)) return null
  const rel = projectRel(abs)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(BACKUP_DIR, stamp, rel)
  ensureDir(path.dirname(dest))
  fs.copyFileSync(abs, dest)
  return dest
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

export function writeText(file, text) {
  ensureDir(path.dirname(file))
  backupFile(file)
  fs.writeFileSync(file, text, 'utf8')
}

export function ensureUploadDirs() {
  for (const dir of ['covers', 'hero', 'videos', 'originals']) {
    ensureDir(path.join(UPLOADS_DIR, dir))
  }
}
