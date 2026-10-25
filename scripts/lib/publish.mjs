import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(LIB_DIR, '..', '..')
const BRANCH = 'main'
const WORKFLOW_PATH = '.github/workflows/pages.yml'
const LOCK_FILE = path.join(PROJECT_ROOT, '.git', 'blog-publish.lock')
const STATE_FILE = path.join(PROJECT_ROOT, '.git', 'blog-publish-state.json')
const MAX_MESSAGE_LENGTH = 200
const HISTORY_LIMIT = 500
const MAX_API_BLOB = 95 * 1024 * 1024
const WORKFLOW_APPEAR_TIMEOUT_MS = 180_000
const WORKFLOW_TIMEOUT_MS = 15 * 60_000
const WORKFLOW_POLL_MS = 4_000
const REQUEST_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 180_000

export class PublishError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'PublishError'
    Object.assign(this, details)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return
  try {
    onEvent({ at: new Date().toISOString(), ...event })
  } catch (_) {
    /* 进度回调不应影响发布 */
  }
}

function emitStep(onEvent, key, label, status, detail = '') {
  emit(onEvent, { type: 'step', key, label, status, detail })
}

function emitLog(onEvent, message, level = 'info') {
  emit(onEvent, { type: 'log', level, message })
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/)[0].trim()
}

function ensureTrailingSlash(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.endsWith('/') ? text : `${text}/`
}

export function defaultCommitMessage(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  return `chore: update via admin ${stamp}`
}

function normalizeMessage(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH)
  return text || defaultCommitMessage()
}

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never'
  }
}

function execGit(args, {
  allowFailure = false,
  raw = false,
  input,
  timeout = 120_000,
  maxBuffer
} = {}) {
  const result = spawnSync('git', args, {
    cwd: PROJECT_ROOT,
    input,
    timeout,
    windowsHide: true,
    encoding: raw ? 'buffer' : 'utf8',
    maxBuffer: maxBuffer || (raw ? 256 * 1024 * 1024 : 32 * 1024 * 1024),
    env: gitEnv()
  })
  const code = result.status ?? -1
  const stdout = result.stdout ?? (raw ? Buffer.alloc(0) : '')
  const stderr = result.stderr ?? (raw ? Buffer.alloc(0) : '')
  if (!allowFailure && (result.error || code !== 0)) {
    const output = raw
      ? Buffer.concat([stderr, stdout]).toString('utf8')
      : `${stderr}${stdout}`
    throw new PublishError(`Git 命令失败：git ${args.join(' ')}\n${output.trim() || result.error?.message || ''}`.trim())
  }
  return { code, stdout, stderr, error: result.error }
}

function gitText(args, options = {}) {
  return String(execGit(args, options).stdout || '').replace(/\r\n/g, '\n').trim()
}

function getBranch() {
  return gitText(['branch', '--show-current'], { allowFailure: true }) || 'detached'
}

function getRemoteRepo() {
  const result = execGit(['remote', 'get-url', 'origin'], { allowFailure: true })
  if (result.code !== 0) {
    throw new PublishError('没有找到 origin 远端，无法发布。')
  }
  const url = String(result.stdout || '').trim()
  const cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '')
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/)
  if (!match) {
    throw new PublishError(`origin 不是 GitHub 仓库：${url}`)
  }
  return {
    owner: match[1],
    name: match[2],
    slug: `${match[1]}/${match[2]}`,
    url
  }
}

function getConfiguredSiteUrl() {
  try {
    const text = fs.readFileSync(path.join(PROJECT_ROOT, 'hugo.toml'), 'utf8')
    const match = text.match(/^\s*baseURL\s*=\s*(['"])(.*?)\1/m)
    if (match?.[2] && match[2] !== '/') return ensureTrailingSlash(match[2])
  } catch (_) {
    /* ignore */
  }
  return ''
}

function resolveGitHubToken() {
  const fromEnv = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  if (fromEnv) return fromEnv

  const result = spawnSync('git', ['credential', 'fill'], {
    cwd: PROJECT_ROOT,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    env: gitEnv()
  })
  if (result.error || result.status !== 0) {
    throw new PublishError('未找到 GitHub 凭据。请先在本机完成一次 GitHub 登录或配置凭据管理器。')
  }
  const output = String(result.stdout || '')
  const token = output.match(/^password=(.+)$/m)?.[1]?.trim()
    || output.match(/^oauth_token=(.+)$/m)?.[1]?.trim()
  if (!token) {
    throw new PublishError('GitHub 凭据中没有可用的 Token。请先在凭据管理器中更新 GitHub 登录。')
  }
  return token
}

function createGitHubApi(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Claudian-Blog-Publish/1.0',
    'Content-Type': 'application/json'
  }

  return async function api(method, apiPath, body, {
    timeout = REQUEST_TIMEOUT_MS,
    allow404 = false
  } = {}) {
    let response
    try {
      response = await fetch(`https://api.github.com${apiPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      })
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new PublishError(`GitHub API 请求超时：${method} ${apiPath}`)
      }
      throw new PublishError(`无法连接 GitHub API：${error.message}`)
    }

    const text = await response.text()
    let data = null
    if (text) {
      try { data = JSON.parse(text) } catch (_) { data = null }
    }

    if (!response.ok) {
      if (allow404 && response.status === 404) return null
      let message = data?.message || text.slice(0, 300) || '未知错误'
      if (response.status === 401) {
        message = 'GitHub Token 已失效或无权限，请重新登录凭据管理器。'
      } else if (response.status === 403 && /rate limit/i.test(text)) {
        message = 'GitHub API 已触发限流，请稍后再试。'
      }
      throw new PublishError(`GitHub API ${method} ${apiPath} 失败（${response.status}）：${message}`)
    }
    return data
  }
}

async function fetchRemote(api, repo, { withTree = true } = {}) {
  const ref = await api('GET', `/repos/${repo}/git/ref/heads/${BRANCH}`)
  const sha = ref?.object?.sha
  if (!sha) throw new PublishError('无法读取远端 main 分支。')
  const commit = await api('GET', `/repos/${repo}/git/commits/${sha}`, undefined, { timeout: 60_000 })
  const remote = {
    sha,
    tree: commit?.tree?.sha,
    message: commit?.message || '',
    authorDate: commit?.author?.date || ''
  }
  if (!remote.tree) throw new PublishError('无法读取远端提交树。')

  if (withTree) {
    const data = await api(
      'GET',
      `/repos/${repo}/git/trees/${remote.tree}?recursive=1`,
      undefined,
      { timeout: 60_000 }
    )
    if (data?.truncated) {
      throw new PublishError('仓库文件太多，GitHub 返回的树被截断，无法安全校验发布内容。')
    }
    const map = new Map()
    for (const entry of data?.tree || []) {
      if (entry.type === 'blob') {
        map.set(entry.path, { sha: entry.sha, mode: entry.mode })
      } else if (entry.type === 'commit') {
        throw new PublishError('仓库包含子模块（gitlink），当前一键发布不支持子模块。')
      }
    }
    remote.map = map
  }
  return remote
}

function readLocalHead() {
  return {
    sha: gitText(['rev-parse', 'HEAD']),
    tree: gitText(['rev-parse', 'HEAD^{tree}'])
  }
}

function readHistoryTrees() {
  const output = gitText(['log', `-n${HISTORY_LIMIT}`, '--format=%H%x09%T'])
  return output.split('\n').filter(Boolean).map((line) => {
    const [sha, tree] = line.split('\t')
    return { sha, tree }
  }).filter((item) => item.sha && item.tree)
}

function readWorkingChanges() {
  const result = execGit(['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all'], {
    allowFailure: true
  })
  const text = String(result.stdout || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
  const changes = text ? text.split('\n').filter(Boolean).map((line) => ({
    code: line.slice(0, 2).trim() || '??',
    path: line.slice(3)
  })) : []
  return { text, changes }
}

function readIndex() {
  const result = execGit(['ls-files', '-s', '-z'], {
    raw: true,
    maxBuffer: 128 * 1024 * 1024
  })
  const buffer = result.stdout
  const map = new Map()
  let offset = 0
  while (offset < buffer.length) {
    const end = buffer.indexOf(0, offset)
    if (end < 0) break
    const record = buffer.subarray(offset, end)
    offset = end + 1
    const tab = record.indexOf(9)
    if (tab < 0) continue
    const [mode, sha, stage] = record.subarray(0, tab).toString('utf8').split(' ')
    const filePath = record.subarray(tab + 1).toString('utf8')
    if (stage !== '0') throw new PublishError(`暂存区存在未解决的冲突（${filePath}），请先处理冲突。`)
    if (mode === '160000') throw new PublishError(`暂存区包含子模块（${filePath}），当前一键发布不支持子模块。`)
    map.set(filePath, { mode, sha })
  }
  return map
}

function readGitIdentity() {
  const name = gitText(['config', 'user.name'], { allowFailure: true }) || 'huantiansh'
  const email = gitText(['config', 'user.email'], { allowFailure: true }) || 'huantiansh@users.noreply.github.com'
  const date = new Date().toISOString()
  return { name, email, date }
}

function readLastPublish() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (_) {
    return null
  }
}

function saveLastPublish(data) {
  try {
    fs.writeFileSync(STATE_FILE, `${JSON.stringify({
      ...data,
      updatedAt: new Date().toISOString()
    }, null, 2)}\n`, 'utf8')
  } catch (_) {
    /* 本地状态文件写失败不影响发布 */
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function acquireLock() {
  const id = `${process.pid}-${Date.now()}`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx')
      fs.writeFileSync(fd, `${JSON.stringify({ id, pid: process.pid, startedAt: new Date().toISOString() })}\n`, 'utf8')
      fs.closeSync(fd)
      return () => {
        try {
          const current = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
          if (current?.id === id) fs.unlinkSync(LOCK_FILE)
        } catch (_) {
          /* ignore */
        }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw new PublishError(`无法创建发布锁：${error.message}`)
      let info = null
      try { info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) } catch (_) { info = null }
      const age = info?.startedAt ? Date.now() - new Date(info.startedAt).getTime() : Infinity
      const alive = isProcessAlive(Number(info?.pid))
      if (!alive || age > 45 * 60_000) {
        try { fs.unlinkSync(LOCK_FILE) } catch (_) { /* ignore */ }
        continue
      }
      throw new PublishError('已有一个发布任务正在运行，请等它结束。')
    }
  }
  throw new PublishError('无法获取发布锁，请稍后重试。')
}

async function preparePublish({ onEvent } = {}) {
  emitStep(onEvent, 'check', '检查发布环境', 'running')
  try {
    const branch = getBranch()
    if (branch !== BRANCH) {
      throw new PublishError(`当前分支是 ${branch || 'detached'}，一键发布只允许从 main 分支执行。`)
    }

    const repoInfo = getRemoteRepo()
    const token = resolveGitHubToken()
    const api = createGitHubApi(token)
    const remote = await fetchRemote(api, repoInfo.slug, { withTree: true })
    const local = readLocalHead()
    const history = readHistoryTrees()
    const base = history.find((item) => item.tree === remote.tree)

    if (!base) {
      throw new PublishError(
        `线上 main（${remote.sha.slice(0, 7)}）的内容与本地历史不一致，为防止覆盖线上改动已停止发布。请先核对线上提交后再试。`
      )
    }

    const conflictCheck = gitText(['ls-files', '-u'], { allowFailure: true })
    if (conflictCheck) {
      throw new PublishError('工作区存在未解决的 Git 冲突，请先处理冲突。')
    }

    const status = readWorkingChanges()
    const pendingCommits = base.sha === local.sha
      ? 0
      : Number(gitText(['rev-list', '--count', `${base.sha}..HEAD`], { allowFailure: true }) || 0) || 0
    const needsPublish = status.changes.length > 0 || local.tree !== remote.tree
    const siteUrl = getConfiguredSiteUrl()

    const detail = []
    detail.push(`线上 ${remote.sha.slice(0, 7)}`)
    if (status.changes.length) detail.push(`${status.changes.length} 个待提交文件`)
    if (pendingCommits) detail.push(`${pendingCommits} 个待推送提交`)
    if (!needsPublish) detail.push('没有待发布改动')
    emitStep(onEvent, 'check', '检查发布环境', 'success', detail.join(' · '))

    return {
      branch,
      repoInfo,
      api,
      remote,
      local,
      base,
      status,
      pendingCommits,
      needsPublish,
      siteUrl
    }
  } catch (error) {
    emitStep(onEvent, 'check', '检查发布环境', 'error', error.message)
    throw error
  }
}

function inspectContext(context) {
  const { remote, local, base, status, pendingCommits, needsPublish, repoInfo, branch, siteUrl } = context
  return {
    ok: true,
    repo: repoInfo.slug,
    branch,
    localHead: local.sha,
    localTree: local.tree,
    remoteHead: remote.sha,
    remoteTree: remote.tree,
    remoteMessage: firstLine(remote.message),
    baseCommit: base.sha,
    dirty: status.changes.length > 0,
    changeCount: status.changes.length,
    changes: status.changes,
    statusText: status.text || '工作区干净',
    pendingCommits,
    needsPublish,
    siteUrl,
    workflowPath: WORKFLOW_PATH,
    lastPublish: readLastPublish()
  }
}

export async function inspectPublish({ onEvent } = {}) {
  const context = await preparePublish({ onEvent })
  return inspectContext(context)
}

async function commitLocalChanges(context, message, onEvent) {
  emitStep(onEvent, 'commit', '提交本地改动', 'running')
  try {
    execGit(['add', '-A'])
    const staged = execGit(['diff', '--cached', '--quiet'], { allowFailure: true })
    if (staged.code === 0) {
      emitStep(onEvent, 'commit', '提交本地改动', 'success', '没有新的文件改动，使用已有本地提交')
      return { ...context.local, committed: false }
    }
    if (staged.code !== 1) {
      throw new PublishError(`无法检查暂存区：${String(staged.stderr || staged.error?.message || '').trim()}`)
    }

    const identity = readGitIdentity()
    const commit = execGit([
      '-c', `user.name=${identity.name}`,
      '-c', `user.email=${identity.email}`,
      'commit', '-m', message
    ], { allowFailure: true, timeout: 180_000 })
    if (commit.code !== 0) {
      const detail = `${commit.stderr || ''}${commit.stdout || ''}`.trim() || commit.error?.message || '未知错误'
      throw new PublishError(`本地提交失败：${detail}`)
    }
    const head = readLocalHead()
    emitStep(onEvent, 'commit', '提交本地改动', 'success', `${head.sha.slice(0, 7)} · ${message}`)
    return { ...head, committed: true }
  } catch (error) {
    emitStep(onEvent, 'commit', '提交本地改动', 'error', error.message)
    throw error
  }
}

async function syncViaGitHubApi(context, local, message, onEvent) {
  const { api, repoInfo, remote } = context
  const current = await fetchRemote(api, repoInfo.slug, { withTree: false })

  if (current.sha === local.sha || current.tree === local.tree) {
    emitLog(onEvent, `远端已包含本次提交（${current.sha.slice(0, 7)}），跳过 API 推送。`)
    return { sha: current.sha, tree: current.tree, method: 'api', alreadyThere: true }
  }
  if (current.tree !== remote.tree) {
    throw new PublishError('推送过程中远端 main 发生了变化，为避免覆盖已停止。请重新检查后再发布。')
  }

  const indexTree = gitText(['write-tree'])
  if (indexTree !== local.tree) {
    throw new PublishError('暂存区内容与本地提交不一致，请重新保存后再发布。')
  }

  const index = readIndex()
  const uploads = []
  const deletions = []

  for (const [filePath, item] of index) {
    const remoteItem = remote.map.get(filePath)
    if (!remoteItem || remoteItem.sha !== item.sha || remoteItem.mode !== item.mode) {
      uploads.push([filePath, item])
    }
  }
  for (const [filePath, item] of remote.map) {
    if (!index.has(filePath)) deletions.push([filePath, item])
  }

  emitLog(onEvent, `GitHub API 回退：上传 ${uploads.length} 个文件，删除 ${deletions.length} 个文件。`)
  const treeEntries = []

  for (const [filePath, item] of uploads) {
    const content = execGit(['cat-file', 'blob', item.sha], {
      raw: true,
      maxBuffer: 256 * 1024 * 1024
    }).stdout
    if (content.length > MAX_API_BLOB) {
      throw new PublishError(
        `文件 ${filePath} 大小为 ${formatBytes(content.length)}，超过 GitHub API 回退上传上限。请恢复直连 git push 后重试。`
      )
    }
    emitLog(onEvent, `上传 ${filePath}（${formatBytes(content.length)}）`)
    const blob = await api('POST', `/repos/${repoInfo.slug}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64'
    }, { timeout: UPLOAD_TIMEOUT_MS })
    treeEntries.push({
      path: filePath,
      mode: item.mode,
      type: 'blob',
      sha: blob.sha
    })
  }

  for (const [filePath, item] of deletions) {
    emitLog(onEvent, `删除 ${filePath}`)
    treeEntries.push({
      path: filePath,
      mode: item.mode || '100644',
      type: 'blob',
      sha: null
    })
  }

  const tree = await api('POST', `/repos/${repoInfo.slug}/git/trees`, {
    base_tree: current.tree,
    tree: treeEntries
  }, { timeout: UPLOAD_TIMEOUT_MS })

  if (tree.sha !== local.tree) {
    throw new PublishError(
      `远端生成的树与本地提交不一致（远端 ${String(tree.sha).slice(0, 7)} / 本地 ${local.tree.slice(0, 7)}），已停止更新 main。`
    )
  }

  const identity = readGitIdentity()
  const commit = await api('POST', `/repos/${repoInfo.slug}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [current.sha],
    author: identity,
    committer: identity
  }, { timeout: UPLOAD_TIMEOUT_MS })

  try {
    await api('PATCH', `/repos/${repoInfo.slug}/git/refs/heads/${BRANCH}`, {
      sha: commit.sha,
      force: false
    })
  } catch (error) {
    // 请求可能已生效但响应在网络中丢失，重新读取一次远端再决定。
    let after = null
    try { after = await fetchRemote(api, repoInfo.slug, { withTree: false }) } catch (_) { /* ignore */ }
    if (after?.tree === local.tree) {
      emitLog(onEvent, `更新 main 的响应异常，但远端已指向本次内容：${after.sha.slice(0, 7)}`, 'warn')
      return { sha: after.sha, tree: after.tree, method: 'api', alreadyThere: false }
    }
    throw error
  }
  emitLog(onEvent, `GitHub API 已更新 main：${commit.sha.slice(0, 7)}`)
  return { sha: commit.sha, tree: tree.sha, method: 'api', alreadyThere: false }
}

async function pushToGitHub(context, local, message, onEvent) {
  emitStep(onEvent, 'push', '推送 GitHub', 'running')
  emitLog(onEvent, '先尝试普通 git push，最长等待 45 秒…')
  const direct = execGit(['push', 'origin', BRANCH], {
    allowFailure: true,
    timeout: 45_000
  })
  if (direct.code === 0) {
    emitStep(onEvent, 'push', '推送 GitHub', 'success', `git push · ${local.sha.slice(0, 7)}`)
    emitLog(onEvent, '普通 git push 成功。')
    return { sha: local.sha, tree: local.tree, method: 'git', alreadyThere: false }
  }

  const reason = `${direct.stderr || ''}${direct.stdout || ''}`.trim() || direct.error?.message || '连接失败'
  emitLog(onEvent, `普通 git push 失败，自动切换 GitHub API：${reason.split(/\r?\n/).slice(-4).join(' ').slice(0, 500)}`, 'warn')

  try {
    const result = await syncViaGitHubApi(context, local, message, onEvent)
    emitStep(onEvent, 'push', '推送 GitHub', 'success', `GitHub API · ${result.sha.slice(0, 7)}`)
    return result
  } catch (error) {
    emitStep(onEvent, 'push', '推送 GitHub', 'error', error.message)
    throw error
  }
}

async function waitForDeployment(context, remoteSha, onEvent) {
  const { api, repoInfo, siteUrl: configuredSiteUrl } = context
  emitStep(onEvent, 'deploy', '等待 Pages 构建上线', 'running', '等待 GitHub Actions 启动…')
  const startedAt = Date.now()
  let run = null

  while (Date.now() - startedAt < WORKFLOW_APPEAR_TIMEOUT_MS) {
    const data = await api(
      'GET',
      `/repos/${repoInfo.slug}/actions/runs?branch=${BRANCH}&per_page=30`,
      undefined,
      { timeout: 30_000 }
    )
    const matches = (data?.workflow_runs || []).filter((item) => item.head_sha === remoteSha)
    run = matches.find((item) => item.path === WORKFLOW_PATH) || matches[0] || null
    if (run) break
    await sleep(3_000)
  }

  if (!run) {
    const actionsUrl = `https://github.com/${repoInfo.slug}/actions`
    throw new PublishError(
      `代码已推送，但 3 分钟内没有找到对应的 GitHub Actions。请打开 ${actionsUrl} 检查工作流是否被禁用。`,
      { pushed: true, remoteCommit: remoteSha, actionsUrl }
    )
  }

  emitLog(onEvent, `已找到构建任务 #${run.run_number || run.id}：${run.html_url}`)
  while (run.status !== 'completed') {
    if (Date.now() - startedAt > WORKFLOW_TIMEOUT_MS) {
      throw new PublishError(`代码已推送，但等待 Actions 超过 15 分钟。请打开 ${run.html_url} 查看进度。`, {
        pushed: true,
        remoteCommit: remoteSha,
        runUrl: run.html_url
      })
    }
    const statusText = run.status === 'queued' ? '排队中' : run.status === 'in_progress' ? '构建中' : run.status
    emitStep(onEvent, 'deploy', '等待 Pages 构建上线', 'running', `${statusText} · 任务 #${run.run_number || run.id}`)
    await sleep(WORKFLOW_POLL_MS)
    run = await api('GET', `/repos/${repoInfo.slug}/actions/runs/${run.id}`, undefined, { timeout: 30_000 })
  }

  if (run.conclusion !== 'success') {
    emitStep(onEvent, 'deploy', '等待 Pages 构建上线', 'error', `Actions ${run.conclusion} · ${run.html_url}`)
    throw new PublishError(
      `代码已推送，但 GitHub Pages 构建未成功（${run.conclusion}）。请打开 ${run.html_url} 查看日志。`,
      { pushed: true, remoteCommit: remoteSha, runUrl: run.html_url, conclusion: run.conclusion }
    )
  }

  let siteUrl = configuredSiteUrl
  try {
    const pages = await api('GET', `/repos/${repoInfo.slug}/pages`, undefined, {
      timeout: 30_000,
      allow404: true
    })
    if (pages?.html_url) siteUrl = ensureTrailingSlash(pages.html_url)
  } catch (_) {
    /* 有 baseURL 兜底即可 */
  }

  emitStep(onEvent, 'deploy', '等待 Pages 构建上线', 'success', siteUrl || '构建成功')
  return {
    run: {
      id: run.id,
      number: run.run_number,
      html_url: run.html_url,
      conclusion: run.conclusion
    },
    siteUrl
  }
}

export async function publishSite({ message, onEvent, waitForDeploy = true } = {}) {
  const release = acquireLock()
  try {
    const context = await preparePublish({ onEvent })
    const commitMessage = normalizeMessage(message)

    if (!context.needsPublish) {
      const summary = inspectContext(context)
      emitLog(onEvent, '工作区与线上内容一致，没有需要发布的改动。')
      return {
        ...summary,
        noChanges: true,
        pushed: false,
        commit: context.local.sha,
        remoteCommit: context.remote.sha,
        message: commitMessage
      }
    }

    const local = await commitLocalChanges(context, commitMessage, onEvent)
    if (local.tree === context.remote.tree) {
      emitLog(onEvent, '提交后的内容与线上一致，无需推送。')
      const summary = inspectContext({ ...context, local })
      return {
        ...summary,
        noChanges: true,
        pushed: false,
        commit: local.sha,
        remoteCommit: context.remote.sha,
        message: commitMessage
      }
    }

    const pushResult = await pushToGitHub(context, local, commitMessage, onEvent)

    let deployment = null
    if (waitForDeploy) {
      try {
        deployment = await waitForDeployment(context, pushResult.sha, onEvent)
      } catch (error) {
        if (error && typeof error === 'object') {
          error.pushed = true
          error.remoteCommit = error.remoteCommit || pushResult.sha
        }
        throw error
      }
    } else {
      emitStep(onEvent, 'deploy', '等待 Pages 构建上线', 'success', '已跳过等待，请到 GitHub Actions 查看进度')
    }

    const result = {
      ok: true,
      noChanges: false,
      pushed: true,
      repo: context.repoInfo.slug,
      branch: BRANCH,
      commit: local.sha,
      remoteCommit: pushResult.sha,
      remoteTree: pushResult.tree,
      pushMethod: pushResult.method,
      message: commitMessage,
      run: deployment?.run || null,
      siteUrl: deployment?.siteUrl || context.siteUrl,
      actionsUrl: deployment?.run?.html_url
        || (pushResult.sha
          ? `https://github.com/${context.repoInfo.slug}/actions?query=branch%3A${BRANCH}`
          : '')
    }
    saveLastPublish(result)
    return result
  } finally {
    release()
  }
}
