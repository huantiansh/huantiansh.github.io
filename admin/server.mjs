import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ADMIN_PORT,
  CONTENT_DIR,
  POSTS_DIR,
  PREVIEW_PORT,
  PROJECT_ROOT,
  STATIC_DIR,
  backupFile,
  ensureDir,
  ensureUploadDirs,
  projectRel,
  readText,
  safeJoin,
  toPosix
} from './lib/paths.mjs'
import { createDoc, readDoc, writeDoc } from './lib/frontmatter.mjs'
import { readConfig, patchConfig } from './lib/toml.mjs'
import { cropImage, deleteMedia, listMedia, saveUpload, saveVideo } from './lib/media.mjs'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const MAX_JSON = 35 * 1024 * 1024
const MAX_VIDEO = 220 * 1024 * 1024

const PAGE_DEFS = [
  { key: 'about', label: '关于', path: 'content/about.md', body: true },
  { key: 'archives', label: '归档', path: 'content/archives/_index.md', body: false },
  { key: 'categories', label: '分类', path: 'content/categories/_index.md', body: false },
  { key: 'tags', label: '标签', path: 'content/tags/_index.md', body: false },
  { key: 'links', label: '友链', path: 'content/links.md', body: true },
  { key: 'bangumi', label: '追番', path: 'content/bangumi.md', body: true },
  { key: 'comment', label: '留言', path: 'content/comment.md', body: true },
  { key: 'search', label: '搜索', path: 'content/search.md', body: false }
]
const PAGE_PATHS = new Set(PAGE_DEFS.map((page) => page.path))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

let previewProcess = null
let previewLogs = []

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function fail(res, error, status = 500) {
  json(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) })
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const buffer = await readBody(req, MAX_JSON)
  return JSON.parse(buffer.toString('utf8') || '{}')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 30 * 1024 * 1024,
    ...options
  })
  return {
    code: result.status ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : ''
  }
}

function hugoBin() {
  if (process.platform === 'win32') {
    const portable = path.join(PROJECT_ROOT, 'tools', 'hugo', 'hugo.exe')
    if (fs.existsSync(portable)) return portable
  }
  return 'hugo'
}

function gitStatus() {
  const branch = run('git', ['branch', '--show-current'])
  const status = run('git', ['status', '--short'])
  const last = run('git', ['log', '-1', '--pretty=%h %s'])
  return {
    branch: branch.stdout.trim(),
    status: status.stdout.trim(),
    last: last.stdout.trim()
  }
}

function listPosts() {
  if (!fs.existsSync(POSTS_DIR)) return []
  return fs.readdirSync(POSTS_DIR)
    .filter((name) => name.endsWith('.md') && name !== '_index.md')
    .map((name) => {
      const abs = path.join(POSTS_DIR, name)
      const doc = readDoc(abs)
      const data = doc.frontMatter
      return {
        path: projectRel(abs),
        slug: name.replace(/\.md$/, ''),
        title: data.title || name.replace(/\.md$/, ''),
        description: data.description || '',
        date: data.date || '',
        lastmod: data.lastmod || '',
        cover: data.cover || '',
        categories: Array.isArray(data.categories) ? data.categories : [],
        tags: Array.isArray(data.tags) ? data.tags : [],
        pinned: data.pinned === true,
        draft: data.draft === true,
        author: data.author || '',
        mtime: fs.statSync(abs).mtimeMs
      }
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

function listPages() {
  return PAGE_DEFS.map((page) => {
    const abs = path.join(PROJECT_ROOT, page.path)
    if (!fs.existsSync(abs)) return null
    const doc = readDoc(abs)
    return {
      ...page,
      title: doc.frontMatter.title || page.label,
      cover: doc.frontMatter.cover || '',
      icon: doc.frontMatter.icon || '',
      layout: doc.frontMatter.layout || ''
    }
  }).filter(Boolean)
}

function getState() {
  return {
    config: readConfig(),
    pages: listPages(),
    posts: listPosts(),
    media: listMedia(),
    git: gitStatus(),
    preview: {
      running: Boolean(previewProcess),
      url: `http://127.0.0.1:${PREVIEW_PORT}/`,
      logs: previewLogs.slice(-80)
    }
  }
}

function isAllowedContentPath(rel) {
  if (!rel) return false
  const normalized = toPosix(rel).replace(/^\/+/, '')
  if (!normalized.startsWith('content/') || !normalized.endsWith('.md')) return false
  if (normalized.startsWith('content/posts/') && !normalized.includes('/../')) return true
  return PAGE_PATHS.has(normalized)
}

function contentAbs(rel) {
  if (!isAllowedContentPath(rel)) throw new Error('不允许访问这个内容文件')
  const abs = safeJoin(PROJECT_ROOT, rel)
  if (!fs.existsSync(abs)) throw new Error('文件不存在')
  return abs
}

function saveContent({ path: rel, frontMatter, body }) {
  const abs = contentAbs(rel)
  const current = readDoc(abs)
  const nextBody = body === undefined ? current.body : body
  writeDoc(abs, frontMatter || {}, nextBody)
  return { path: rel }
}

function saveCover({ path: rel, cover }) {
  const abs = contentAbs(rel)
  const current = readDoc(abs)
  writeDoc(abs, { cover: cover || null }, current.body)
  return { path: rel, cover: cover || '' }
}

function createPost(payload) {
  const rawSlug = String(payload.slug || payload.title || '').trim()
  const slug = rawSlug
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  if (!slug || slug === '.' || slug === '..') throw new Error('请填写合法的文件名/slug')
  const abs = path.join(POSTS_DIR, `${slug}.md`)
  if (fs.existsSync(abs)) throw new Error('同名文章已存在')
  const today = new Date().toISOString().slice(0, 10)
  const frontMatter = {
    title: payload.title || slug,
    description: payload.description || '',
    date: payload.date || today,
    lastmod: payload.date || today,
    author: payload.author || 'Claudian',
    categories: payload.categories?.length ? payload.categories : ['随笔'],
    tags: payload.tags || [],
    cover: payload.cover || null,
    pinned: payload.pinned === true,
    draft: payload.draft === true
  }
  createDoc(abs, frontMatter, payload.body || '')
  return { path: projectRel(abs), slug }
}

function deletePost(rel) {
  const normalized = toPosix(rel).replace(/^\/+/, '')
  if (!normalized.startsWith('content/posts/') || !normalized.endsWith('.md')) {
    throw new Error('只能删除 content/posts 下的文章')
  }
  const abs = safeJoin(PROJECT_ROOT, normalized)
  if (!fs.existsSync(abs)) throw new Error('文章不存在')
  backupFile(abs)
  fs.unlinkSync(abs)
  return { deleted: normalized }
}

function stopPreview() {
  if (!previewProcess) return false
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(previewProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      previewProcess.kill('SIGTERM')
    }
  } catch (_) { /* ignore */ }
  previewProcess = null
  return true
}

function startPreview() {
  if (previewProcess) return { running: true, url: `http://127.0.0.1:${PREVIEW_PORT}/` }
  previewLogs = []
  const proc = spawn(hugoBin(), ['server', '-D', '--bind', '127.0.0.1', '--port', String(PREVIEW_PORT)], {
    cwd: PROJECT_ROOT,
    windowsHide: true
  })
  previewProcess = proc
  const push = (chunk) => {
    const text = chunk.toString()
    previewLogs.push(...text.split(/\r?\n/).filter(Boolean))
    if (previewLogs.length > 200) previewLogs = previewLogs.slice(-120)
  }
  proc.stdout?.on('data', push)
  proc.stderr?.on('data', push)
  proc.on('exit', () => { previewProcess = null })
  proc.on('error', (err) => { previewLogs.push(`ERR ${err.message}`); previewProcess = null })
  return { running: true, url: `http://127.0.0.1:${PREVIEW_PORT}/` }
}

function serveFile(res, abs) {
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  const ext = path.extname(abs).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  })
  fs.createReadStream(abs).pipe(res)
}

async function handleApi(req, res, url) {
  const route = url.pathname

  if (req.method === 'GET' && route === '/api/state') {
    return json(res, 200, { ok: true, ...getState() })
  }

  if (req.method === 'GET' && route === '/api/content') {
    const rel = url.searchParams.get('path') || ''
    const abs = contentAbs(rel)
    const doc = readDoc(abs)
    return json(res, 200, { ok: true, path: rel, frontMatter: doc.frontMatter, body: doc.body })
  }

  if (req.method === 'POST' && route === '/api/content') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, ...saveContent(payload) })
  }

  if (req.method === 'POST' && route === '/api/cover') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, ...saveCover(payload) })
  }

  if (req.method === 'POST' && route === '/api/config') {
    const payload = await readJson(req)
    const config = patchConfig(payload.config || payload)
    return json(res, 200, { ok: true, config })
  }

  if (req.method === 'POST' && route === '/api/post') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, ...createPost(payload) })
  }

  if (req.method === 'POST' && route === '/api/post/delete') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, ...deletePost(payload.path) })
  }

  if (req.method === 'POST' && route === '/api/crop') {
    const payload = await readJson(req)
    const media = await cropImage(payload)
    let config
    if (payload.update === 'avatar') {
      config = patchConfig({ author: { avatar: media.path } })
    } else if (payload.update === 'favicon') {
      config = patchConfig({ favicon: media.path })
    }
    return json(res, 200, { ok: true, media, config })
  }

  if (req.method === 'POST' && route === '/api/media/upload') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, media: saveUpload(payload) })
  }

  if (req.method === 'POST' && route === '/api/media/video') {
    const name = url.searchParams.get('name') || `video-${Date.now()}.mp4`
    const buffer = await readBody(req, MAX_VIDEO)
    return json(res, 200, { ok: true, media: saveVideo({ buffer, name }) })
  }

  if (req.method === 'POST' && route === '/api/media/delete') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, ...deleteMedia(payload.rel) })
  }

  if (req.method === 'POST' && route === '/api/build') {
    const result = run(hugoBin(), ['--minify', '--cleanDestinationDir'])
    return json(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, ...result })
  }

  if (req.method === 'POST' && route === '/api/preview/start') {
    return json(res, 200, { ok: true, ...startPreview() })
  }

  if (req.method === 'POST' && route === '/api/preview/stop') {
    return json(res, 200, { ok: true, stopped: stopPreview() })
  }

  if (req.method === 'GET' && route === '/api/preview/status') {
    return json(res, 200, { ok: true, running: Boolean(previewProcess), url: `http://127.0.0.1:${PREVIEW_PORT}/`, logs: previewLogs.slice(-80) })
  }

  if (req.method === 'POST' && route === '/api/git') {
    const payload = await readJson(req)
    const action = payload.action || 'status'
    if (action === 'status') return json(res, 200, { ok: true, git: gitStatus() })
    if (action === 'commit') {
      const message = String(payload.message || '').trim().slice(0, 200) || `chore: update via admin ${new Date().toISOString()}`
      const add = run('git', ['add', '-A'])
      const commit = run('git', ['commit', '-m', message])
      return json(res, 200, { ok: add.code === 0 && (commit.code === 0 || commit.stdout.includes('nothing to commit')), add, commit, git: gitStatus() })
    }
    if (action === 'push') {
      const push = run('git', ['push'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
      return json(res, push.code === 0 ? 200 : 500, { ok: push.code === 0, push, git: gitStatus() })
    }
    return fail(res, new Error('未知 git 操作'), 400)
  }

  return fail(res, new Error('接口不存在'), 404)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    if (url.pathname.startsWith('/media/')) {
      const rel = decodeURIComponent(url.pathname.slice('/media/'.length))
      const abs = safeJoin(STATIC_DIR, rel)
      serveFile(res, abs)
      return
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveFile(res, path.join(PUBLIC_DIR, 'index.html'))
      return
    }
    if (req.method === 'GET' && (url.pathname === '/app.js' || url.pathname === '/style.css')) {
      serveFile(res, path.join(PUBLIC_DIR, url.pathname.slice(1)))
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  } catch (error) {
    fail(res, error)
  }
})

ensureUploadDirs()
ensureDir(path.join(PROJECT_ROOT, 'admin', 'backups'))
server.listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`Admin: http://127.0.0.1:${ADMIN_PORT}`)
  console.log(`Project: ${PROJECT_ROOT}`)
})

process.on('SIGINT', () => { stopPreview(); process.exit(0) })
process.on('SIGTERM', () => { stopPreview(); process.exit(0) })
