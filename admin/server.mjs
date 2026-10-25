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
import { deleteMusic, listMusic, saveMusic } from './lib/music.mjs'
import { defaultCommitMessage, inspectPublish, publishSite } from '../scripts/lib/publish.mjs'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const MAX_JSON = 35 * 1024 * 1024
const MAX_VIDEO = 220 * 1024 * 1024
const MAX_PUBLISH_LOG = 500

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
let publishJob = null
let publishJobSequence = 0

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

function publicPublishJob() {
  if (!publishJob) return null
  return {
    ...publishJob,
    steps: publishJob.steps.map((step) => ({ ...step })),
    log: publishJob.log.slice(-MAX_PUBLISH_LOG)
  }
}

function recordPublishEvent(jobId, event) {
  if (!publishJob || publishJob.id !== jobId) return
  publishJob.updatedAt = new Date().toISOString()
  if (event.type === 'step') {
    let step = publishJob.steps.find((item) => item.key === event.key)
    if (!step) {
      step = { key: event.key, label: event.label, status: 'pending', detail: '' }
      publishJob.steps.push(step)
    }
    step.label = event.label || step.label
    step.status = event.status || step.status
    step.detail = event.detail || ''
    publishJob.stage = step.label
    return
  }
  if (event.type === 'log') {
    const time = new Date(event.at || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })
    publishJob.log.push(`[${time}] ${event.level === 'warn' ? '警告：' : ''}${event.message}`)
    if (publishJob.log.length > MAX_PUBLISH_LOG) {
      publishJob.log.splice(0, publishJob.log.length - MAX_PUBLISH_LOG)
    }
  }
}

function startPublishJob(message) {
  if (publishJob?.status === 'running') {
    throw new Error('已有一个发布任务正在运行，请等待它结束。')
  }
  const id = `publish-${Date.now()}-${++publishJobSequence}`
  const now = new Date().toISOString()
  publishJob = {
    id,
    status: 'running',
    stage: '准备中',
    message: String(message || defaultCommitMessage()).trim().slice(0, 200) || defaultCommitMessage(),
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    steps: [],
    log: [],
    result: null,
    error: null
  }

  publishSite({
    message: publishJob.message,
    onEvent: (event) => recordPublishEvent(id, event)
  }).then((result) => {
    if (!publishJob || publishJob.id !== id) return
    const finishedAt = new Date().toISOString()
    publishJob.status = 'success'
    publishJob.stage = result.noChanges ? '没有改动' : '发布完成'
    publishJob.finishedAt = finishedAt
    publishJob.updatedAt = finishedAt
    publishJob.result = result
    if (result.noChanges) {
      publishJob.log.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 没有需要上线的改动。`)
    } else if (result.siteUrl) {
      publishJob.log.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 发布成功：${result.siteUrl}`)
    }
  }).catch((error) => {
    if (!publishJob || publishJob.id !== id) return
    const finishedAt = new Date().toISOString()
    publishJob.status = 'failed'
    publishJob.stage = error.pushed ? '已推送，构建未完成' : '发布失败'
    publishJob.finishedAt = finishedAt
    publishJob.updatedAt = finishedAt
    publishJob.error = error.message
    publishJob.result = {
      pushed: Boolean(error.pushed),
      remoteCommit: error.remoteCommit || '',
      runUrl: error.runUrl || '',
      actionsUrl: error.actionsUrl || ''
    }
    publishJob.log.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 失败：${error.message}`)
  })

  return publicPublishJob()
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
    musicFiles: listMusic(),
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

  if (req.method === 'POST' && route === '/api/music/upload') {
    const name = url.searchParams.get('name') || `music-${Date.now()}.mp3`
    const album = url.searchParams.get('album') || ''
    const buffer = await readBody(req, MAX_VIDEO)
    return json(res, 200, { ok: true, media: saveMusic({ buffer, name, album }) })
  }

  if (req.method === 'POST' && route === '/api/music/delete') {
    const payload = await readJson(req)
    return json(res, 200, { ok: true, ...deleteMusic(payload.name, payload.album) })
  }

  if (req.method === 'POST' && route === '/api/music/rebuild') {
    const result = run(process.execPath, ['scripts/build-music-playlist.mjs'])
    return json(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, ...result, musicFiles: listMusic() })
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

  if (req.method === 'GET' && route === '/api/publish/preflight') {
    const data = await inspectPublish()
    return json(res, 200, data)
  }

  if (req.method === 'GET' && route === '/api/publish/status') {
    return json(res, 200, {
      ok: true,
      job: publicPublishJob(),
      defaultMessage: defaultCommitMessage()
    })
  }

  if (req.method === 'POST' && route === '/api/publish') {
    const payload = await readJson(req)
    try {
      const job = startPublishJob(payload.message)
      return json(res, 202, { ok: true, job })
    } catch (error) {
      return fail(res, error, 409)
    }
  }

  if (req.method === 'POST' && route === '/api/git') {
    const payload = await readJson(req)
    const action = payload.action || 'status'
    if (action === 'status') return json(res, 200, { ok: true, git: gitStatus() })
    return fail(res, new Error('单独的提交/推送已停用，请使用“提交、推送并上线”。'), 400)
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

function openAdminBrowser(url) {
  try {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(command, commandArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => {})
    child.unref()
  } catch (_) {
    /* 浏览器打开失败不影响后台服务 */
  }
}

ensureUploadDirs()
ensureDir(path.join(PROJECT_ROOT, 'admin', 'backups'))
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`后台端口 ${ADMIN_PORT} 已被占用。请关闭占用该端口的程序后重试。`)
  } else {
    console.error(`后台启动失败：${error.message}`)
  }
  process.exit(1)
})
server.listen(ADMIN_PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${ADMIN_PORT}/`
  console.log(`Admin: ${url}`)
  console.log(`Project: ${PROJECT_ROOT}`)
  console.log(`PID: ${process.pid}`)
  if (process.argv.includes('--open')) openAdminBrowser(url)
})

process.on('SIGINT', () => { stopPreview(); process.exit(0) })
process.on('SIGTERM', () => { stopPreview(); process.exit(0) })
