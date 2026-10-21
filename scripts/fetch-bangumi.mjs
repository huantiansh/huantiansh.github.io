import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBangumiConfig, writeEmptyBangumi } from './lib/bangumi-config.mjs'

const ROOT = join(import.meta.dirname, '..')
const OUTPUT = join(ROOT, 'data', 'bangumi.json')
const API_BASE = 'https://api.bgm.tv/v0/users'
const PAGE_SIZE = 50
const FETCH_TIMEOUT_MS = 20000
const MAX_RETRIES = 3
const REQUEST_GAP_MS = 300
const USER_AGENT = 'AIOVTUE-Blog/1.0 (https://huantiansh.github.io/)'

const STATUS_KEYS = [
  { type: 1, key: 'wantWatch' },
  { type: 2, key: 'watching' },
  { type: 3, key: 'watched' },
]

function readCache() {
  try {
    if (!existsSync(OUTPUT)) return null
    return JSON.parse(readFileSync(OUTPUT, 'utf8'))
  } catch {
    return null
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function mapItem(entry) {
  const subject = entry?.subject || {}
  const images = subject.images || {}
  const eps = Number(subject.eps) || 0
  return {
    title: normalizeText(subject.name_cn || subject.name),
    cover: images.large || images.common || images.medium || images.grid || '',
    url: subject.id ? `https://bgm.tv/subject/${subject.id}` : '',
    score: typeof subject.score === 'number' ? subject.score : null,
    collectionTotal: typeof subject.collection_total === 'number' ? subject.collection_total : null,
    rank: typeof subject.rank === 'number' ? subject.rank : null,
    summary: normalizeText(subject.short_summary),
    totalCount: eps > 0 ? `全 ${eps} 话` : '',
    newEp: '',
    updatedAt: String(entry?.updated_at || ''),
  }
}

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function fetchStatusList(username, type) {
  let offset = 0
  let total = Infinity
  const items = []

  while (offset < total) {
    const url = `${API_BASE}/${encodeURIComponent(username)}/collections?subject_type=2&type=${type}&limit=${PAGE_SIZE}&offset=${offset}`
    const data = await fetchJson(url)
    total = Number(data?.total ?? 0)
    const page = Array.isArray(data?.data) ? data.data : []

    for (const entry of page) {
      const item = mapItem(entry)
      if (item.title && item.url) items.push(item)
    }

    if (!page.length) break
    offset += page.length
    if (offset < total) await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS))
  }

  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return items
}

const config = getBangumiConfig(ROOT)
const cache = readCache()

if (!config.ok) {
  console.warn('[bangumi] 无法读取站点配置（hugo 不在 PATH？），保留现有 data/bangumi.json')
  process.exit(0)
}

if (!config.enabled || !config.username) {
  writeEmptyBangumi(OUTPUT, config.username)
  console.log('[bangumi] disabled or missing username, wrote empty data/bangumi.json')
  process.exit(0)
}

const result = { wantWatch: [], watching: [], watched: [] }
let failures = 0

for (const { type, key } of STATUS_KEYS) {
  try {
    result[key] = await fetchStatusList(config.username, type)
    console.log(`[bangumi] ${key}: ${result[key].length} item(s)`)
  } catch (err) {
    failures += 1
    const fallback = Array.isArray(cache?.[key]) ? cache[key] : []
    result[key] = fallback
    console.warn(`[bangumi] ${key} 拉取失败（${err.message || err}），使用缓存 ${fallback.length} 条`)
  }
}

const total = result.wantWatch.length + result.watching.length + result.watched.length
if (!total && failures === STATUS_KEYS.length && cache) {
  console.warn('[bangumi] 全部拉取失败且缓存为空，保留原 data/bangumi.json')
  process.exit(0)
}

const data = {
  updatedAt: new Date().toISOString(),
  username: config.username,
  ...result,
}
writeFileSync(OUTPUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
console.log(`[bangumi] wrote ${total} item(s) -> data/bangumi.json`)
