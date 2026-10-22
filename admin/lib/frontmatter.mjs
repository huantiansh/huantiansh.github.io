import { readText, writeText } from './paths.mjs'

const DOC_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

export function splitDoc(raw) {
  const match = raw.match(DOC_RE)
  if (!match) return { fmLines: [], body: raw, hasFrontMatter: false }
  return {
    fmLines: match[1].split(/\r?\n/),
    body: raw.slice(match[0].length),
    hasFrontMatter: true
  }
}

function unquote(value) {
  const text = value.trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    const body = text.slice(1, -1)
    if (text[0] === '"') {
      try { return JSON.parse(text) } catch (_) { return body }
    }
    return body.replace(/''/g, "'")
  }
  return text
}

export function parseScalar(raw) {
  const text = raw.trim()
  if (!text) return ''
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return unquote(text)
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function parseInlineArray(text) {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!inner.trim()) return []
  const items = []
  let current = ''
  let quote = ''
  for (const ch of inner) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ',') {
      if (current.trim()) items.push(parseScalar(current))
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) items.push(parseScalar(current))
  return items
}

export function parseFm(lines) {
  const data = {}
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const rest = match[2].trim()
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = parseInlineArray(rest)
      continue
    }
    if (!rest) {
      const items = []
      let j = i + 1
      while (j < lines.length) {
        const item = lines[j].match(/^\s*-\s+(.*)$/)
        if (!item) break
        items.push(parseScalar(item[1]))
        j += 1
      }
      if (items.length) {
        data[key] = items
        i = j - 1
        continue
      }
      data[key] = ''
      continue
    }
    data[key] = parseScalar(rest)
  }
  return data
}

export function readDoc(file) {
  const raw = readText(file)
  const { fmLines, body, hasFrontMatter } = splitDoc(raw)
  return {
    raw,
    fmLines,
    body,
    hasFrontMatter,
    frontMatter: parseFm(fmLines)
  }
}

function formatScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

function keyPattern(key) {
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`)
}

export function patchFmLines(lines, updates) {
  const out = lines.slice()
  for (const [key, value] of Object.entries(updates || {})) {
    const index = out.findIndex((line) => keyPattern(key).test(line))
    if (value === null) {
      if (index !== -1) {
        let end = index + 1
        while (end < out.length && /^\s*-\s+/.test(out[end])) end += 1
        out.splice(index, end - index)
      }
      continue
    }
    let block
    if (Array.isArray(value)) {
      block = value.length
        ? [`${key}:`, ...value.map((item) => `  - ${formatScalar(item)}`)]
        : [`${key}: []`]
    } else {
      block = [`${key}: ${formatScalar(value)}`]
    }
    if (index === -1) {
      out.push(...block)
      continue
    }
    let end = index + 1
    while (end < out.length && /^\s*-\s+/.test(out[end])) end += 1
    out.splice(index, end - index, ...block)
  }
  return out
}

export function writeDoc(file, updates, body) {
  const current = readDoc(file)
  const fmLines = patchFmLines(current.fmLines, updates)
  const cleanBody = String(body ?? current.body).replace(/^\n+/, '')
  writeText(file, `---\n${fmLines.join('\n')}\n---\n\n${cleanBody}`)
}

export function createDoc(file, frontMatter, body) {
  const lines = []
  for (const [key, value] of Object.entries(frontMatter || {})) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (!value.length) lines.push(`${key}: []`)
      else lines.push(`${key}:`, ...value.map((item) => `  - ${formatScalar(item)}`))
    } else {
      lines.push(`${key}: ${formatScalar(value)}`)
    }
  }
  writeText(file, `---\n${lines.join('\n')}\n---\n\n${String(body || '').replace(/^\n+/, '')}`)
}
