import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function getBangumiConfig(root = join(import.meta.dirname, '../..')) {
  try {
    const out = execSync('hugo config --format json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const cfg = JSON.parse(out)
    const bangumi = cfg.params?.bangumi || {}
    return {
      ok: true,
      enabled: bangumi.enable === true,
      username: String(bangumi.username || '').trim(),
      profileUrl: String(bangumi.profileUrl || '').trim(),
      quote: String(bangumi.quote || '').trim(),
    }
  } catch {
    return { ok: false, enabled: false, username: '', profileUrl: '', quote: '' }
  }
}

export function writeEmptyBangumi(outputPath, username = '') {
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      username,
      wantWatch: [],
      watching: [],
      watched: [],
    }, null, 2)}\n`,
    'utf8',
  )
}
