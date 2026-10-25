import { spawn } from 'node:child_process'
import { inspectPublish, publishSite } from './lib/publish.mjs'

const args = process.argv.slice(2)
let message = ''
let checkOnly = false
let waitForDeploy = true
let openSite = true

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--check' || arg === '--dry-run') {
    checkOnly = true
  } else if (arg === '--no-wait') {
    waitForDeploy = false
  } else if (arg === '--no-open') {
    openSite = false
  } else if (arg === '--message') {
    message = args[index + 1] || ''
    index += 1
  } else if (arg.startsWith('--message=')) {
    message = arg.slice('--message='.length)
  } else if (arg === '--help' || arg === '-h') {
    printHelp()
    process.exit(0)
  } else {
    console.error(`未知参数：${arg}`)
    printHelp()
    process.exit(2)
  }
}

function printHelp() {
  console.log(`用法：node scripts/publish.mjs [选项]

  --check, --dry-run   只检查本地、线上和待发布文件，不提交、不推送
  --message <文字>      指定 Git 提交说明
  --no-wait            推送后不等待 GitHub Pages 构建
  --no-open            成功后不自动打开网站
  -h, --help           显示帮助`)
}

function openUrl(url) {
  if (!url) return
  let command
  let commandArgs
  if (process.platform === 'win32') {
    command = 'cmd.exe'
    commandArgs = ['/c', 'start', '', url]
  } else if (process.platform === 'darwin') {
    command = 'open'
    commandArgs = [url]
  } else {
    command = 'xdg-open'
    commandArgs = [url]
  }
  try {
    const child = spawn(command, commandArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => {})
    child.unref()
  } catch (_) {
    /* 打不开浏览器不影响发布结果 */
  }
}

const shownSteps = new Map()
function onEvent(event) {
  if (event.type === 'step') {
    const key = `${event.key}:${event.status}:${event.detail || ''}`
    if (shownSteps.get(event.key) === key) return
    shownSteps.set(event.key, key)
    if (event.status === 'running') {
      console.log(`\n[...] ${event.label}${event.detail ? ` — ${event.detail}` : ''}`)
    } else if (event.status === 'success') {
      console.log(`[OK]  ${event.label}${event.detail ? ` — ${event.detail}` : ''}`)
    } else if (event.status === 'error') {
      console.log(`[ERR] ${event.label}${event.detail ? ` — ${event.detail}` : ''}`)
    }
    return
  }
  if (event.type === 'log') {
    const prefix = event.level === 'warn' ? '[!]' : '   '
    console.log(`${prefix} ${event.message}`)
  }
}

function printInspection(data) {
  console.log('发布预检')
  console.log(`  仓库：${data.repo}`)
  console.log(`  分支：${data.branch}`)
  console.log(`  本地：${data.localHead.slice(0, 7)}（${data.localTree.slice(0, 7)}）`)
  console.log(`  线上：${data.remoteHead.slice(0, 7)}（${data.remoteTree.slice(0, 7)}）`)
  console.log(`  线上提交：${data.remoteMessage || '（无说明）'}`)
  console.log(`  待提交：${data.changeCount} 个文件`)
  console.log(`  待推送：${data.pendingCommits} 个本地提交`)
  console.log(`  结论：${data.needsPublish ? '可以发布' : '没有需要上线的改动'}`)
  if (data.changes.length) {
    console.log('\n改动文件：')
    for (const change of data.changes) console.log(`  ${change.code.padEnd(2)} ${change.path}`)
  }
  if (data.siteUrl) console.log(`\n站点：${data.siteUrl}`)
  if (data.lastPublish?.updatedAt) {
    console.log(`上次发布：${data.lastPublish.updatedAt} · ${String(data.lastPublish.remoteCommit || '').slice(0, 7)}`)
  }
}

async function main() {
  if (checkOnly) {
    console.log('正在检查发布环境…')
    const data = await inspectPublish({ onEvent })
    printInspection(data)
    return
  }

  console.log('开始一键发布…')
  const result = await publishSite({
    message,
    onEvent,
    waitForDeploy
  })

  if (result.noChanges) {
    console.log('\n没有需要上线的改动。')
    console.log(`当前线上提交：${result.remoteCommit.slice(0, 7)}`)
    return
  }

  console.log('\n发布成功')
  console.log(`  本地提交：${result.commit.slice(0, 7)}`)
  console.log(`  线上提交：${result.remoteCommit.slice(0, 7)}（${result.pushMethod === 'api' ? 'GitHub API 回退' : 'git push'}）`)
  if (result.siteUrl) console.log(`  网站：${result.siteUrl}`)
  if (result.run?.html_url) console.log(`  构建：${result.run.html_url}`)

  if (waitForDeploy && openSite && result.siteUrl) openUrl(result.siteUrl)
}

main().catch((error) => {
  console.error(`\n发布未完成：${error.message}`)
  if (error.pushed) {
    console.error('代码已经推送到 GitHub，只是后续构建或确认阶段失败。')
    if (error.remoteCommit) console.error(`远端提交：${error.remoteCommit}`)
    if (error.runUrl) console.error(`构建页面：${error.runUrl}`)
  }
  process.exitCode = 1
})
