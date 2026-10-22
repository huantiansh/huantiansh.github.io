import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import {
  STATIC_DIR,
  UPLOADS_DIR,
  backupFile,
  ensureDir,
  isInside,
  safeJoin,
  staticRel
} from './paths.mjs'

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg'])

function kindFor(ext) {
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return null
}

function walk(dir, list, depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(abs, list, depth + 1)
      continue
    }
    const ext = path.extname(entry.name).toLowerCase()
    const kind = kindFor(ext)
    if (!kind) continue
    let stat
    try { stat = fs.statSync(abs) } catch (_) { continue }
    const rel = staticRel(abs)
    list.push({
      rel,
      path: `/${rel}`,
      preview: `/media/${rel}`,
      name: entry.name,
      kind,
      size: stat.size,
      mtime: stat.mtimeMs
    })
  }
}

export function listMedia() {
  const list = []
  walk(UPLOADS_DIR, list)
  walk(path.join(STATIC_DIR, 'hero'), list)
  list.sort((a, b) => b.mtime - a.mtime)
  return list
}

function sanitizeName(name, fallback = 'image') {
  const base = path.basename(String(name || ''))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 90)
  return base || fallback
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function targetAbs(targetRel) {
  const rel = String(targetRel || '').replace(/^\/+/, '').replace(/^media\//, '')
  if (!rel.startsWith('uploads/') && !rel.startsWith('hero/')) {
    throw new Error('写入目标只允许 static/uploads 或 static/hero')
  }
  const abs = safeJoin(STATIC_DIR, rel)
  if (!isInside(STATIC_DIR, abs)) throw new Error('目标路径越界')
  return { abs, rel: staticRel(abs) }
}

function decodeSource(source) {
  const text = String(source || '')
  const match = text.match(/^data:([^;,]+)?;base64,(.*)$/s)
  if (match) return Buffer.from(match[2], 'base64')
  let rel = text
  if (rel.startsWith('/media/')) rel = rel.slice('/media/'.length)
  rel = rel.replace(/^\/+/, '')
  if (!rel.startsWith('uploads/') && !rel.startsWith('hero/')) {
    throw new Error('图片来源必须是 data URL 或 static/uploads、static/hero 下的文件')
  }
  const abs = safeJoin(STATIC_DIR, rel)
  if (!fs.existsSync(abs)) throw new Error('找不到图片文件')
  return fs.readFileSync(abs)
}

function outputFormat(absTarget) {
  const ext = path.extname(absTarget).toLowerCase()
  if (ext === '.png') return 'png'
  if (ext === '.webp') return 'webp'
  return 'jpeg'
}

export async function cropImage({ source, crop, target, width, height, quality = 92 }) {
  const buffer = decodeSource(source)
  const targetInfo = targetAbs(target)
  const metadata = await sharp(buffer).metadata()
  const imageW = metadata.width || 0
  const imageH = metadata.height || 0
  if (!imageW || !imageH) throw new Error('无法读取图片尺寸')

  const x = Math.max(0, Math.round(Number(crop?.x) || 0))
  const y = Math.max(0, Math.round(Number(crop?.y) || 0))
  const w = Math.max(1, Math.min(Math.round(Number(crop?.width) || imageW), imageW - x))
  const h = Math.max(1, Math.min(Math.round(Number(crop?.height) || imageH), imageH - y))

  let pipeline = sharp(buffer).rotate().extract({ left: x, top: y, width: w, height: h })
  if (width && height) {
    pipeline = pipeline.resize(Number(width), Number(height), { fit: 'cover' })
  }

  const format = outputFormat(targetInfo.abs)
  if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 })
  else if (format === 'webp') pipeline = pipeline.webp({ quality: Number(quality) })
  else pipeline = pipeline.jpeg({ quality: Number(quality), mozjpeg: true })

  const output = await pipeline.toBuffer()
  ensureDir(path.dirname(targetInfo.abs))
  backupFile(targetInfo.abs)
  fs.writeFileSync(targetInfo.abs, output)
  return { path: `/${targetInfo.rel}`, rel: targetInfo.rel, size: output.length }
}

export function saveUpload({ dataUrl, name, dir = 'uploads/originals' }) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?;base64,(.*)$/s)
  if (!match) throw new Error('图片数据格式不正确')
  const ext = (String(name || '').match(/\.[A-Za-z0-9]+$/) || ['.png'])[0].toLowerCase()
  const safeName = sanitizeName(name || `upload${ext}`, `upload${ext}`)
  const filename = `${stamp()}-${safeName}`
  const rel = `${dir}/${filename}`
  const info = targetAbs(rel)
  ensureDir(path.dirname(info.abs))
  backupFile(info.abs)
  const buffer = Buffer.from(match[2], 'base64')
  fs.writeFileSync(info.abs, buffer)
  return { path: `/${info.rel}`, rel: info.rel, size: buffer.length, kind: kindFor(path.extname(info.abs).toLowerCase()) }
}

export function saveVideo({ buffer, name }) {
  const ext = (String(name || '').match(/\.[A-Za-z0-9]+$/) || ['.mp4'])[0].toLowerCase()
  if (!VIDEO_EXTS.has(ext)) throw new Error('只支持 mp4 / webm / ogg 视频')
  const safeName = sanitizeName(name || `video${ext}`, `video${ext}`)
  const filename = `${stamp()}-${safeName}`
  const info = targetAbs(`uploads/videos/${filename}`)
  ensureDir(path.dirname(info.abs))
  backupFile(info.abs)
  fs.writeFileSync(info.abs, buffer)
  return { path: `/${info.rel}`, rel: info.rel, size: buffer.length, kind: 'video' }
}

export function deleteMedia(rel) {
  const target = String(rel || '').replace(/^\/+/, '')
  if (!target.startsWith('uploads/') && !target.startsWith('hero/')) {
    throw new Error('只能删除 uploads 或 hero 下的媒体')
  }
  const abs = safeJoin(STATIC_DIR, target)
  if (!fs.existsSync(abs)) throw new Error('文件不存在')
  backupFile(abs)
  fs.unlinkSync(abs)
  return { deleted: `/${staticRel(abs)}` }
}
