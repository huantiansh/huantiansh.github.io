import { HUGO_TOML, readText, writeText } from './paths.mjs'

function loadLines() {
  return readText(HUGO_TOML).replace(/\r\n/g, '\n').split('\n')
}

function isHeaderLine(line) {
  const text = line.trim()
  if (!text || text.startsWith('#')) return false
  return /^\[\[?.+\]\]?$/.test(text)
}

function findHeader(lines, header) {
  const target = header.trim()
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === target) return i
  }
  return -1
}

function tableEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isHeaderLine(lines[i])) return i
  }
  return lines.length
}

function firstHeader(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (isHeaderLine(lines[i])) return i
  }
  return lines.length
}

function keyPattern(key) {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)
}

function findKey(lines, start, end, key) {
  const pattern = keyPattern(key)
  for (let i = start; i < end; i += 1) {
    if (pattern.test(lines[i])) return i
  }
  return -1
}

function stripComment(raw) {
  let quote = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#') return raw.slice(0, i)
  }
  return raw
}

function bracketDelta(text) {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') depth -= 1
  }
  return depth
}

function parseScalar(raw) {
  const text = stripComment(raw).trim()
  if (!text) return ''
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text) } catch (_) { return text.slice(1, -1) }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function splitArrayItems(text) {
  const items = []
  let current = ''
  let quote = ''
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      current += ch
      if (ch === '\\' && quote === '"') {
        current += text[i + 1] || ''
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '[') depth += 1
    if (ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      if (current.trim()) items.push(parseScalar(current))
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) items.push(parseScalar(current))
  return items
}

function parseArrayText(text) {
  const open = text.indexOf('[')
  const close = text.lastIndexOf(']')
  if (open === -1 || close === -1) return []
  return splitArrayItems(text.slice(open + 1, close))
}

function readArrayInRange(lines, start, end, key) {
  const index = findKey(lines, start, end, key)
  if (index === -1) return []
  const first = lines[index]
  const eq = first.indexOf('=')
  let text = first.slice(eq + 1)
  let depth = bracketDelta(text)
  let last = index
  while (depth > 0 && last + 1 < end) {
    last += 1
    text += `\n${lines[last]}`
    depth += bracketDelta(lines[last])
  }
  return parseArrayText(text)
}

function readScalarInRange(lines, start, end, key) {
  const index = findKey(lines, start, end, key)
  if (index === -1) return undefined
  const eq = lines[index].indexOf('=')
  return parseScalar(lines[index].slice(eq + 1))
}

function readRootScalar(lines, key) {
  return readScalarInRange(lines, 0, firstHeader(lines), key)
}

function readArrayOfTables(lines, name) {
  const header = `[[${name}]]`
  const result = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== header) continue
    const end = tableEnd(lines, i)
    const entry = {}
    for (let j = i + 1; j < end; j += 1) {
      const match = lines[j].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      const raw = match[2]
      if (stripComment(raw).trim().startsWith('[')) {
        const arr = readArrayInRange(lines, j, end, key)
        entry[key] = arr
        let depth = bracketDelta(raw)
        while (depth > 0 && j + 1 < end) {
          j += 1
          depth += bracketDelta(lines[j])
        }
      } else {
        entry[key] = parseScalar(raw)
      }
    }
    result.push(entry)
    i = end - 1
  }
  return result
}

function scalarLine(indent, key, value) {
  let serialized
  if (typeof value === 'boolean' || typeof value === 'number') serialized = String(value)
  else serialized = JSON.stringify(String(value))
  return `${indent}${key} = ${serialized}`
}

function arrayBlock(indent, key, values) {
  const items = (values || []).map((value) => {
    const serialized = typeof value === 'boolean' || typeof value === 'number'
      ? String(value)
      : JSON.stringify(String(value))
    return `${indent}  ${serialized},`
  })
  return [`${indent}${key} = [`, ...items, `${indent}]`]
}

function setScalar(lines, section, key, value) {
  let start = 0
  let end = firstHeader(lines)
  if (section) {
    start = findHeader(lines, section)
    if (start === -1) throw new Error(`找不到配置节 ${section}`)
    end = tableEnd(lines, start)
  }
  const index = findKey(lines, start, end, key)
  if (index !== -1) {
    const indent = (lines[index].match(/^\s*/) || [''])[0]
    lines[index] = scalarLine(indent, key, value)
    return
  }
  const sectionIndent = section ? (lines[start].match(/^\s*/) || [''])[0] : ''
  lines.splice(end, 0, scalarLine(sectionIndent + '  ', key, value))
}

function setArray(lines, section, key, values) {
  const start = section ? findHeader(lines, section) : 0
  if (start === -1) throw new Error(`找不到配置节 ${section}`)
  const end = section ? tableEnd(lines, start) : firstHeader(lines)
  const index = findKey(lines, start, end, key)
  if (index === -1) {
    const sectionIndent = section ? (lines[start].match(/^\s*/) || [''])[0] : ''
    lines.splice(end, 0, ...arrayBlock(sectionIndent + '  ', key, values))
    return
  }
  const indent = (lines[index].match(/^\s*/) || [''])[0]
  let last = index
  let depth = bracketDelta(lines[index].slice(lines[index].indexOf('=') + 1))
  while (depth > 0 && last + 1 < end) {
    last += 1
    depth += bracketDelta(lines[last])
  }
  lines.splice(index, last - index + 1, ...arrayBlock(indent, key, values))
}

function genSocial(entries) {
  if (!entries.length) return []
  const out = []
  entries.forEach((entry, index) => {
    out.push('  [[params.social]]')
    out.push(scalarLine('    ', 'name', entry.name || ''))
    out.push(scalarLine('    ', 'link', entry.link || ''))
    out.push(scalarLine('    ', 'icon', entry.icon || ''))
    out.push(scalarLine('    ', 'color', entry.color || ''))
    if (index !== entries.length - 1) out.push('')
  })
  return out
}

function genNoticeSections(entries) {
  if (!entries.length) return []
  const out = []
  entries.forEach((entry, index) => {
    out.push('    [[params.notice.sections]]')
    out.push(scalarLine('      ', 'label', entry.label || ''))
    out.push('      lines = [')
    for (const line of entry.lines || []) out.push(`        ${JSON.stringify(String(line))},`)
    out.push('      ]')
    if (index !== entries.length - 1) out.push('')
  })
  return out
}

function replaceArrayOfTables(lines, name, generated) {
  const header = `[[${name}]]`
  const starts = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === header) starts.push(i)
  }
  if (!starts.length) {
    if (!generated.length) return
    if (lines.length && lines[lines.length - 1].trim()) lines.push('')
    lines.push(...generated, '')
    return
  }
  const first = starts[0]
  let last = tableEnd(lines, starts[starts.length - 1])
  lines.splice(first, last - first, ...generated, '')
}

export function readConfig() {
  const lines = loadLines()
  const authorStart = findHeader(lines, '[params.author]')
  const heroStart = findHeader(lines, '[params.hero]')
  const footerStart = findHeader(lines, '[params.footer]')
  const noticeStart = findHeader(lines, '[params.notice]')
  const musicStart = findHeader(lines, '[params.music]')
  const live2dStart = findHeader(lines, '[params.live2d]')
  const commentStart = findHeader(lines, '[params.comment]')
  const utterancesStart = findHeader(lines, '[params.utterances]')

  const read = (start, key) => start === -1 ? undefined : readScalarInRange(lines, start, tableEnd(lines, start), key)
  const readArr = (start, key) => start === -1 ? [] : readArrayInRange(lines, start, tableEnd(lines, start), key)
  const readObj = (start) => {
    if (start === -1) return {}
    const end = tableEnd(lines, start)
    const obj = {}
    for (let i = start + 1; i < end; i += 1) {
      const match = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/)
      if (!match) continue
      obj[match[1]] = parseScalar(match[2])
    }
    return obj
  }

  return {
    title: readRootScalar(lines, 'title') ?? '',
    subtitle: read(findHeader(lines, '[params]'), 'subtitle') ?? '',
    description: read(findHeader(lines, '[params]'), 'description') ?? '',
    primaryColor: read(findHeader(lines, '[params]'), 'primaryColor') ?? '#6F86D6',
    favicon: read(findHeader(lines, '[params]'), 'favicon') ?? '/hero/avatar.png',
    defaultCover: read(findHeader(lines, '[params]'), 'defaultCover') ?? '/hero/hero-night.jpg',
    post: {
      fontSize: read(findHeader(lines, '[params.post]'), 'fontSize') ?? '1.25rem'
    },
    author: {
      name: read(authorStart, 'name') ?? '',
      avatar: read(authorStart, 'avatar') ?? '',
      statusEmoji: read(authorStart, 'statusEmoji') ?? '',
      statusMessage: read(authorStart, 'statusMessage') ?? ''
    },
    hero: {
      title: read(heroStart, 'title') ?? '',
      urls: readArr(heroStart, 'urls'),
      motto: readArr(heroStart, 'motto'),
      randomUrls: read(heroStart, 'randomUrls') ?? false,
      enableHitokoto: read(heroStart, 'enableHitokoto') ?? false
    },
    footer: readObj(footerStart),
    notice: {
      title: read(noticeStart, 'title') ?? '',
      rotateInterval: read(noticeStart, 'rotateInterval') ?? 5000,
      sections: readArrayOfTables(lines, 'params.notice.sections')
    },
    social: readArrayOfTables(lines, 'params.social'),
    music: {
      enable: read(musicStart, 'enable') ?? true,
      position: read(musicStart, 'position') ?? 'right',
      type: read(musicStart, 'type') ?? 'local',
      localPlaylist: read(musicStart, 'localPlaylist') ?? '/music/playlist.json'
    },
    live2d: {
      enable: read(live2dStart, 'enable') ?? true,
      minWidth: read(live2dStart, 'minWidth') ?? 768
    },
    comment: {
      provider: read(commentStart, 'provider') ?? 'utterances'
    },
    utterances: {
      repo: read(utterancesStart, 'repo') ?? '',
      issueTerm: read(utterancesStart, 'issueTerm') ?? 'pathname',
      label: read(utterancesStart, 'label') ?? 'comment'
    }
  }
}

export function patchConfig(updates) {
  const lines = loadLines()
  const value = updates || {}

  if (value.title !== undefined) setScalar(lines, null, 'title', value.title)
  if (value.subtitle !== undefined) setScalar(lines, '[params]', 'subtitle', value.subtitle)
  if (value.description !== undefined) setScalar(lines, '[params]', 'description', value.description)
  if (value.primaryColor !== undefined) setScalar(lines, '[params]', 'primaryColor', value.primaryColor)
  if (value.favicon !== undefined) setScalar(lines, '[params]', 'favicon', value.favicon)
  if (value.defaultCover !== undefined) setScalar(lines, '[params]', 'defaultCover', value.defaultCover)
  if (value.post?.fontSize !== undefined) setScalar(lines, '[params.post]', 'fontSize', value.post.fontSize)

  if (value.author) {
    for (const key of ['name', 'avatar', 'statusEmoji', 'statusMessage']) {
      if (value.author[key] !== undefined) setScalar(lines, '[params.author]', key, value.author[key])
    }
  }
  if (value.hero) {
    if (value.hero.title !== undefined) setScalar(lines, '[params.hero]', 'title', value.hero.title)
    if (value.hero.urls !== undefined) setArray(lines, '[params.hero]', 'urls', value.hero.urls)
    if (value.hero.motto !== undefined) setArray(lines, '[params.hero]', 'motto', value.hero.motto)
    if (value.hero.randomUrls !== undefined) setScalar(lines, '[params.hero]', 'randomUrls', value.hero.randomUrls)
    if (value.hero.enableHitokoto !== undefined) setScalar(lines, '[params.hero]', 'enableHitokoto', value.hero.enableHitokoto)
  }
  if (value.footer) {
    for (const key of ['since', 'runtimeSince', 'icp']) {
      if (value.footer[key] !== undefined) setScalar(lines, '[params.footer]', key, value.footer[key])
    }
  }
  if (value.notice) {
    if (value.notice.title !== undefined) setScalar(lines, '[params.notice]', 'title', value.notice.title)
    if (value.notice.rotateInterval !== undefined) setScalar(lines, '[params.notice]', 'rotateInterval', value.notice.rotateInterval)
    if (value.notice.sections !== undefined) {
      replaceArrayOfTables(lines, 'params.notice.sections', genNoticeSections(value.notice.sections))
    }
  }
  if (value.social !== undefined) {
    replaceArrayOfTables(lines, 'params.social', genSocial(value.social))
  }
  if (value.music) {
    for (const key of ['enable', 'position', 'type', 'localPlaylist']) {
      if (value.music[key] !== undefined) setScalar(lines, '[params.music]', key, value.music[key])
    }
  }
  if (value.live2d) {
    for (const key of ['enable', 'minWidth']) {
      if (value.live2d[key] !== undefined) setScalar(lines, '[params.live2d]', key, value.live2d[key])
    }
  }
  if (value.comment?.provider !== undefined) setScalar(lines, '[params.comment]', 'provider', value.comment.provider)
  if (value.utterances) {
    for (const key of ['repo', 'issueTerm', 'label']) {
      if (value.utterances[key] !== undefined) setScalar(lines, '[params.utterances]', key, value.utterances[key])
    }
  }

  writeText(HUGO_TOML, lines.join('\n'))
  return readConfig()
}
