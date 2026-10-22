const DEFAULT_STORAGE_KEY = 'sakura-music-state'
const API_CACHE_KEY = 'sakura-music-api'
const APLAYER_CSS_URL = '/vendor/aplayer/APlayer.min.css'
const APLAYER_SCRIPT_URL = '/vendor/aplayer/APlayer.min.js'
const METING_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/meting@2/dist/Meting.min.js'
const LOCAL_PLAYLIST_DEFAULT = '/music/playlist.json'
const DEFAULT_APIS = [
  'https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r',
  'https://api.injahow.cn/meting/?server=:server&type=:type&id=:id',
  'https://meting.qjqq.cn/?server=:server&type=:type&id=:id',
]
const PAGE_LOAD_START = typeof performance !== 'undefined' ? performance.now() : Date.now()
const START_DELAY_MIN = 10000
const START_DELAY_MAX = 30000
const TRACK_GAP_MS = 5000
const FADE_OUT_LEAD_MS = 3000
const FADE_OUT_MS = 2200
const FADE_IN_MS = 1800

function readState(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}')
  } catch {
    return {}
  }
}

function writeState(storageKey, state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    /* storage unavailable */
  }
}

function readJsonData(el, fallback) {
  if (!el) return fallback
  try {
    const raw = JSON.parse(el.textContent || '')
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function readApiList() {
  const parsed = readJsonData(document.getElementById('sakura-music-apis'), null)
  if (Array.isArray(parsed) && parsed.length) return parsed.filter(Boolean)
  return [...DEFAULT_APIS]
}

function prioritizeApiList(apis) {
  try {
    const cached = sessionStorage.getItem(API_CACHE_KEY)
    if (cached && apis.includes(cached)) {
      return [cached, ...apis.filter((item) => item !== cached)]
    }
  } catch {
    /* ignore */
  }
  return apis
}

function rememberWorkingApi(api) {
  try {
    sessionStorage.setItem(API_CACHE_KEY, api)
  } catch {
    /* ignore */
  }
}

function loadStylesheet(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`Failed to load ${href}`))
    document.head.appendChild(link)
  })
}

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.body.appendChild(script)
  })
}

let musicLibsPromise = null
let musicLibsNeedMeting = null

async function ensureMusicLibs(needMeting = true) {
  if (window.APlayer && (!needMeting || customElements.get('meting-js'))) return
  if (!musicLibsPromise || (needMeting && musicLibsNeedMeting === false)) {
    musicLibsNeedMeting = needMeting
    musicLibsPromise = Promise.all([
      loadStylesheet(APLAYER_CSS_URL),
      loadScript(APLAYER_SCRIPT_URL),
      ...(needMeting ? [loadScript(METING_SCRIPT_URL)] : []),
    ]).then(() => waitForMusicLibs(needMeting))
  }
  await musicLibsPromise
}

function waitForMusicLibs(needMeting = true, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (window.APlayer && (!needMeting || customElements.get('meting-js'))) {
        resolve()
        return
      }
      if (Date.now() - started > timeout) {
        reject(new Error('music libs timeout'))
        return
      }
      window.setTimeout(tick, 80)
    }
    tick()
  })
}

function buildMetingApiUrl(metingEl, apiTemplate) {
  const read = (name) => metingEl.getAttribute(name) || ''
  const api = apiTemplate || read('api') || DEFAULT_APIS[0]
  return api
    .replace(':server', read('server'))
    .replace(':type', read('type'))
    .replace(':id', read('id'))
    .replace(':auth', read('auth'))
    .replace(':r', String(Math.random()))
}

async function fetchPlaylist(metingEl, apiTemplate) {
  let res
  try {
    res = await fetch(buildMetingApiUrl(metingEl, apiTemplate), { cache: 'no-store' })
  } catch (err) {
    throw new Error(`无法连接 API（${err?.message || 'network error'}）`)
  }
  if (!res.ok) throw new Error(`API 响应 ${res.status}`)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('API 返回格式无效')
  }
  if (Array.isArray(data) && data.length) return data
  const message = data?.message || data?.msg || '歌单为空或 API 不可用'
  throw new Error(message)
}

function createMetingElement(root, apiTemplate) {
  const metingEl = document.createElement('meting-js')
  metingEl.setAttribute('api', apiTemplate)
  metingEl.setAttribute('server', root.dataset.server || 'netease')
  metingEl.setAttribute('type', root.dataset.type || 'playlist')
  metingEl.setAttribute('id', root.dataset.id || '')
  metingEl.setAttribute('fixed', 'false')
  metingEl.setAttribute('mini', 'false')
  metingEl.setAttribute('list-folded', 'false')
  metingEl.setAttribute('list-max-height', '220px')
  metingEl.setAttribute('preload', 'metadata')
  metingEl.setAttribute('mutex', 'true')
  metingEl.setAttribute('theme', root.dataset.theme || '#DF9193')
  return metingEl
}

function resetMetingHost(host) {
  host.querySelectorAll('meting-js').forEach((el) => el.remove())
}

function waitForAPlayer(metingEl, timeout = 18000) {
  return new Promise((resolve, reject) => {
    if (!metingEl) {
      reject(new Error('meting element missing'))
      return
    }

    const started = Date.now()
    const tick = () => {
      const ap = metingEl.aplayer || metingEl.__aplayer
      if (ap?.list?.audios?.length) {
        resolve(ap)
        return
      }
      if (Date.now() - started > timeout) {
        reject(new Error('播放器初始化超时'))
        return
      }
      window.setTimeout(tick, 120)
    }
    tick()
  })
}

async function mountWithApi(root, host, apiTemplate) {
  resetMetingHost(host)
  const metingEl = createMetingElement(root, apiTemplate)
  host.appendChild(metingEl)
  await fetchPlaylist(metingEl, apiTemplate)
  const ap = await waitForAPlayer(metingEl)
  return { ap, metingEl, apiTemplate }
}

async function mountWithFallback(root, host) {
  const apis = prioritizeApiList(readApiList())
  let lastError = null

  for (const apiTemplate of apis) {
    try {
      const result = await mountWithApi(root, host, apiTemplate)
      rememberWorkingApi(apiTemplate)
      return result
    } catch (err) {
      lastError = err
      console.warn('[music-player] api failed:', apiTemplate, err)
      resetMetingHost(host)
    }
  }

  throw lastError || new Error('所有音乐 API 均不可用')
}

function resetMusicHost(host) {
  host.querySelectorAll('meting-js').forEach((el) => el.remove())
  host.querySelectorAll('.sakura-music__aplayer').forEach((el) => el.remove())
}

function normalizeLocalPlaylist(data) {
  const rawAlbums = Array.isArray(data?.albums)
    ? data.albums
    : [{
      id: 'default',
      name: '默认专辑',
      artist: '',
      cover: '',
      tracks: Array.isArray(data) ? data : data?.audio,
    }]

  const albums = rawAlbums
    .map((album, index) => ({
      id: String(album?.id || album?.name || `album-${index}`),
      name: album?.name || album?.title || `专辑 ${index + 1}`,
      artist: album?.artist || '',
      cover: album?.cover || '',
      tracks: Array.isArray(album?.tracks)
        ? album.tracks
        : (Array.isArray(album?.audio) ? album.audio : []),
    }))
    .filter((album) => album.tracks.length > 0)

  if (!albums.length) {
    throw new Error('本地音乐库为空：请把音频放进 static/music/ 后运行 npm run music')
  }

  const defaultAlbum = albums.some((album) => album.id === data?.defaultAlbum)
    ? data.defaultAlbum
    : albums[0].id

  return { albums, defaultAlbum }
}

async function fetchLocalPlaylist(root) {
  const url = root.dataset.localPlaylist || LOCAL_PLAYLIST_DEFAULT
  let res
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (err) {
    throw new Error(`本地歌单加载失败（${err?.message || 'network error'}）`)
  }
  if (!res.ok) throw new Error(`本地歌单加载失败（HTTP ${res.status}）`)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('本地歌单格式无效')
  }
  return normalizeLocalPlaylist(data)
}

async function mountLocalPlayer(root, host, tracks) {
  resetMusicHost(host)
  const container = document.createElement('div')
  container.className = 'sakura-music__aplayer'
  host.appendChild(container)
  const ap = new window.APlayer({
    container,
    audio: tracks,
    listFolded: false,
    listMaxHeight: '220px',
    preload: 'metadata',
    mutex: true,
    order: 'list',
    loop: 'all',
    theme: root.dataset.theme || '#DF9193',
  })
  return { ap }
}

function bindPlayingIndicator(ap, root, toggle) {
  const sync = () => {
    const playing = !ap.audio.paused
    root.classList.toggle('is-playing', playing)
    toggle?.setAttribute('aria-label', playing ? '音乐播放中，打开播放器' : '打开音乐播放器')
  }

  ap.on('play', sync)
  ap.on('pause', sync)
  ap.on('ended', sync)
  sync()
}

function bindStatePersistence(ap, storageKey, getPanelOpen, getAlbumId) {
  let saveTimer = 0

  const save = () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      writeState(storageKey, {
        ...readState(storageKey),
        index: ap.list.index,
        time: ap.audio.currentTime || 0,
        volume: ap.audio.volume,
        paused: ap.audio.paused,
        panelOpen: getPanelOpen(),
        ...(getAlbumId?.() ? { albumId: getAlbumId() } : {}),
      })
    }, 200)
  }

  ap.on('play', save)
  ap.on('pause', save)
  ap.on('ended', save)
  ap.on('listswitch', save)
  ap.on('volumechange', save)
  ap.audio.addEventListener('timeupdate', save)

  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save()
  })
}

function restorePlaybackState(ap, storageKey, albumId) {
  const state = readState(storageKey)
  if (typeof state.volume === 'number') {
    ap.volume(state.volume, true, false)
  }

  // 新版本按专辑保存播放进度；旧版没有 albumId，不能拿旧索引去套新专辑。
  const canRestoreTrack = !albumId || state.albumId === albumId
  const index = canRestoreTrack && Number.isInteger(state.index) ? state.index : 0
  const time = canRestoreTrack && typeof state.time === 'number' ? state.time : 0

  const apply = () => {
    if (index > 0 && index < ap.list.audios.length) {
      ap.list.switch(index)
    }
    if (time > 0) ap.seek(time)
  }

  if (ap.list.audios.length) apply()
  else ap.on('loadeddata', apply)
  return canRestoreTrack ? state : { ...state, index, time }
}

function bindPlaybackEnhancements(ap, restoredState) {
  const audio = ap?.audio
  if (!audio) return

  let startTimer = 0
  let gapTimer = 0
  let fadeFrame = 0
  let fadeToken = 0
  let fading = false
  let transitioning = false
  let started = false
  let gestureArmed = false
  let userPaused = restoredState?.paused === true
  let desiredVolume = clamp(
    Number.isFinite(audio.volume) && audio.volume > 0.02 ? audio.volume : 0.7,
    0.05,
    1
  )

  const clearStartTimer = () => {
    if (startTimer) {
      window.clearTimeout(startTimer)
      startTimer = 0
    }
  }

  const cancelFade = () => {
    fadeToken += 1
    if (fadeFrame) window.cancelAnimationFrame(fadeFrame)
    fadeFrame = 0
    fading = false
  }

  const fadeTo = (target, duration, done) => {
    const token = ++fadeToken
    if (fadeFrame) window.cancelAnimationFrame(fadeFrame)
    fading = true
    const from = audio.volume
    const startedAt = performance.now()
    const tick = (now) => {
      if (token !== fadeToken) return
      const progress = Math.min(1, (now - startedAt) / duration)
      audio.volume = from + (target - from) * progress
      if (progress < 1) {
        fadeFrame = window.requestAnimationFrame(tick)
        return
      }
      fading = false
      fadeFrame = 0
      if (target > 0.02 && typeof ap.volume === 'function') {
        ap.volume(target, true, false)
      }
      done?.()
    }
    fadeFrame = window.requestAnimationFrame(tick)
  }

  const armGestureFallback = () => {
    if (gestureArmed) return
    gestureArmed = true
    const retry = () => {
      document.removeEventListener('pointerdown', retry)
      document.removeEventListener('keydown', retry)
      gestureArmed = false
      started = false
      startPlayback()
    }
    document.addEventListener('pointerdown', retry, { once: true })
    document.addEventListener('keydown', retry, { once: true })
  }

  const startPlayback = () => {
    if (userPaused || transitioning || (!audio.paused && started)) return
    clearStartTimer()
    started = true
    desiredVolume = clamp(audio.volume > 0.02 ? audio.volume : desiredVolume || 0.7, 0.05, 1)
    audio.volume = 0
    let played
    try {
      played = ap.play()
    } catch (_) {
      started = false
      armGestureFallback()
      return
    }
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        started = false
        armGestureFallback()
      })
    }
    window.setTimeout(() => {
      if (audio.paused && !userPaused && !transitioning) {
        started = false
        armGestureFallback()
      }
    }, 900)
  }

  const scheduleDelayedStart = () => {
    if (userPaused || started) return
    clearStartTimer()
    const targetDelay = START_DELAY_MIN + Math.random() * (START_DELAY_MAX - START_DELAY_MIN)
    const elapsed = performance.now() - PAGE_LOAD_START
    const wait = Math.max(1200, targetDelay - elapsed)
    startTimer = window.setTimeout(() => {
      startTimer = 0
      startPlayback()
    }, wait)
  }

  const beginTrackTransition = () => {
    if (transitioning || !ap.list.audios.length) return
    transitioning = true
    clearStartTimer()
    desiredVolume = clamp(audio.volume > 0.02 ? audio.volume : desiredVolume || 0.7, 0.05, 1)
    fadeTo(0, FADE_OUT_MS, () => {
      try {
        ap.pause()
      } catch (_) { /* ignore */ }
      gapTimer = window.setTimeout(() => {
        gapTimer = 0
        const next = (ap.list.index + 1) % ap.list.audios.length
        ap.list.switch(next)
        audio.volume = 0
        let played
        try {
          played = ap.play()
        } catch (_) {
          transitioning = false
          return
        }
        const finish = () => {
          if (!transitioning) return
          fadeTo(desiredVolume, FADE_IN_MS, () => {
            transitioning = false
          })
        }
        if (played && typeof played.then === 'function') {
          played.then(finish).catch(() => { transitioning = false })
        } else {
          window.setTimeout(finish, 80)
        }
      }, TRACK_GAP_MS)
    })
  }

  const onTimeUpdate = () => {
    if (transitioning || userPaused || audio.paused) return
    const remaining = audio.duration - audio.currentTime
    if (Number.isFinite(remaining) && remaining > 0.05 && remaining <= FADE_OUT_LEAD_MS / 1000) {
      beginTrackTransition()
    }
  }

  ap.on('play', () => {
    if (transitioning) return
    userPaused = false
    started = true
    clearStartTimer()
    if (audio.volume < 0.02) {
      fadeTo(desiredVolume || 0.7, FADE_IN_MS)
    }
  })

  ap.on('pause', () => {
    if (transitioning) return
    userPaused = true
    clearStartTimer()
    cancelFade()
  })

  ap.on('listswitch', () => {
    if (transitioning) return
    clearStartTimer()
    if (audio.paused) return
    userPaused = false
    started = true
    desiredVolume = clamp(audio.volume > 0.02 ? audio.volume : desiredVolume || 0.7, 0.05, 1)
    audio.volume = 0
    window.setTimeout(() => {
      if (!audio.paused && !transitioning) fadeTo(desiredVolume, FADE_IN_MS)
    }, 80)
  })

  ap.on('volumechange', () => {
    if (!fading && !transitioning && audio.volume > 0.02) {
      desiredVolume = audio.volume
    }
  })

  audio.addEventListener('timeupdate', onTimeUpdate, { passive: true })

  if (!userPaused) {
    if (ap.list.audios.length) scheduleDelayedStart()
    else window.setTimeout(scheduleDelayedStart, 500)
  }

  return () => {
    clearStartTimer()
    if (gapTimer) {
      window.clearTimeout(gapTimer)
      gapTimer = 0
    }
    cancelFade()
    transitioning = false
    started = false
  }
}

function refreshAPlayerLayout(ap, onLayout) {
  if (!ap) return
  window.dispatchEvent(new Event('resize'))
  if (typeof ap.resize === 'function') ap.resize()
  onLayout?.()
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function readMusicGap(root) {
  const raw = getComputedStyle(root).getPropertyValue('--sakura-music-gap').trim()
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 10
}

function clampMusicRootPosition(root, x, y) {
  const maxX = Math.max(0, window.innerWidth - root.offsetWidth)
  const maxY = Math.max(0, window.innerHeight - root.offsetHeight)
  return {
    x: clamp(x, 0, maxX),
    y: clamp(y, 0, maxY),
  }
}

function resetMusicPanelPosition(panel) {
  if (!panel) return
  panel.style.top = ''
  panel.style.left = ''
  panel.style.bottom = ''
  panel.style.right = ''
  panel.style.transform = ''
  panel.classList.remove('is-fitted')
}

function fitMusicPanelInViewport(root, panel, toggle) {
  if (!panel || !toggle) return
  if (!panel.classList.contains('is-visible')) return

  const margin = 12
  const gap = readMusicGap(root)
  const toggleRect = toggle.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  const panelWidth = panel.offsetWidth
  if (!panelWidth) return

  const toggleCenterX = toggleRect.left + toggleRect.width / 2
  let left = toggleCenterX - panelWidth / 2
  if (left + panelWidth > window.innerWidth - margin) {
    left = window.innerWidth - margin - panelWidth
  }
  if (left < margin) {
    left = margin
  }

  panel.style.right = 'auto'
  panel.style.transform = 'none'
  panel.style.left = `${left - rootRect.left}px`

  // 底部对齐按钮上方，歌单展开时面板向上增高，避免压住按钮或突变
  panel.style.bottom = `calc(var(--sakura-music-size) + var(--sakura-music-gap))`
  panel.style.top = 'auto'

  const panelRect = panel.getBoundingClientRect()
  if (panelRect.top < margin) {
    panel.style.bottom = 'auto'
    const panelHeight = panel.offsetHeight
    const minTop = margin - rootRect.top
    const maxTop = window.innerHeight - margin - panelHeight - rootRect.top
    const belowTop = toggleRect.bottom + gap - rootRect.top
    panel.style.top = `${clamp(belowTop, minTop, Math.max(minTop, maxTop))}px`
  }

  panel.classList.add('is-fitted')
}

function scheduleMusicPanelFit(root, panel, toggle) {
  window.requestAnimationFrame(() => {
    fitMusicPanelInViewport(root, panel, toggle)
  })
}

function bindMusicPanelLayoutSync(ap, root, panel, toggle, getPanelOpen) {
  if (!ap || !panel) return

  let fitTimer = 0
  const refit = () => {
    if (!getPanelOpen()) return
    window.clearTimeout(fitTimer)
    fitTimer = window.setTimeout(() => {
      scheduleMusicPanelFit(root, panel, toggle)
    }, 16)
  }

  ap.on('listshow', refit)
  ap.on('listhide', refit)

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(refit)
    observer.observe(panel)
  }
}

function parseCssPx(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getMusicEdgeInsets(root) {
  const style = getComputedStyle(root)
  const isMobile = window.matchMedia('(max-width: 480px)').matches
  const fallbackX = isMobile ? 12 : 16
  const fallbackY = isMobile ? 16 : 20
  const inset = parseCssPx(style.getPropertyValue('--sakura-music-edge-x'), fallbackX)
  const bottom = parseCssPx(style.getPropertyValue('--sakura-music-edge-y'), fallbackY)
  return {
    left: inset,
    right: inset,
    top: bottom,
    bottom,
  }
}

function isEdgeDockEnabled(root) {
  if (!root || root.dataset.edgeDock === 'false') return false
  return root.classList.contains('sakura-music--left') || root.classList.contains('sakura-music--right')
}

function syncEdgeDock(root) {
  if (!root) return
  const enabled = isEdgeDockEnabled(root)
  root.classList.toggle('is-edge-dock', enabled)
  if (!enabled) root.classList.remove('is-edge-expanded')
}

function bindEdgeDock(root) {
  if (!root || root.dataset.edgeDockBound === '1') return
  root.dataset.edgeDockBound = '1'

  let collapseTimer = 0

  const canAutoCollapse = () => isEdgeDockEnabled(root)
    && !root.classList.contains('is-open')
    && !root.classList.contains('is-dragging')

  const expand = () => {
    if (!isEdgeDockEnabled(root)) return
    window.clearTimeout(collapseTimer)
    root.classList.add('is-edge-expanded')
  }

  const scheduleCollapse = () => {
    if (!canAutoCollapse()) return
    window.clearTimeout(collapseTimer)
    collapseTimer = window.setTimeout(() => {
      root.classList.remove('is-edge-expanded')
    }, 320)
  }

  root.addEventListener('mouseenter', expand)
  root.addEventListener('mouseleave', scheduleCollapse)
  root.addEventListener('focusin', expand)
  root.addEventListener('focusout', scheduleCollapse)
  root.addEventListener('pointerdown', (event) => {
    if (!isEdgeDockEnabled(root)) return
    if (root.classList.contains('is-open') || root.classList.contains('is-dragging')) return
    if (event.pointerType === 'mouse' && root.classList.contains('is-edge-expanded')) return
    expand()
  }, { capture: true })
}

function applyMusicDock(root, dock) {
  root.classList.toggle('sakura-music--left', dock === 'left')
  root.classList.toggle('sakura-music--right', dock === 'right')
  root.dataset.position = dock
  syncEdgeDock(root)
}

function snapMusicRootPosition(root, x, y) {
  const width = root.offsetWidth
  const height = root.offsetHeight
  const maxX = Math.max(0, window.innerWidth - width)
  const maxY = Math.max(0, window.innerHeight - height)
  const insets = getMusicEdgeInsets(root)
  const edgeDock = isEdgeDockEnabled(root)

  const pickNearest = (current, options) => {
    let best = options[0]
    let bestDist = Math.abs(current - best.value)
    options.slice(1).forEach((option) => {
      const dist = Math.abs(current - option.value)
      if (dist < bestDist) {
        best = option
        bestDist = dist
      }
    })
    return best
  }

  const snapX = pickNearest(x, [
    { value: edgeDock ? 0 : insets.left, dock: 'left' },
    { value: edgeDock ? maxX : maxX - insets.right, dock: 'right' },
  ])
  const snapY = pickNearest(y, [
    { value: insets.top, vDock: 'top' },
    { value: maxY - insets.bottom, vDock: 'bottom' },
  ])

  return {
    x: clamp(snapX.value, 0, maxX),
    y: clamp(snapY.value, 0, maxY),
    dock: snapX.dock,
    vDock: snapY.vDock,
  }
}

function applySnappedMusicPosition(root, storageKey, snapped) {
  applyMusicDock(root, snapped.dock)
  root.classList.add('is-custom-position')
  root.style.left = `${snapped.x}px`
  root.style.top = `${snapped.y}px`
  root.style.right = 'auto'
  root.style.bottom = 'auto'

  const state = readState(storageKey)
  writeState(storageKey, {
    ...state,
    position: { x: snapped.x, y: snapped.y },
    dock: snapped.dock,
    vDock: snapped.vDock,
  })
}

function resolveMusicPositionFromState(root, state) {
  const width = root.offsetWidth
  const height = root.offsetHeight
  const maxX = Math.max(0, window.innerWidth - width)
  const maxY = Math.max(0, window.innerHeight - height)
  const insets = getMusicEdgeInsets(root)
  const dock = state.dock || root.dataset.position || 'left'
  const vDock = state.vDock || 'bottom'

  const x = dock === 'right'
    ? (edgeDock ? maxX : maxX - insets.right)
    : (edgeDock ? 0 : insets.left)
  const y = vDock === 'top' ? insets.top : maxY - insets.bottom

  return snapMusicRootPosition(root, x, y)
}

function applyMusicPosition(root, storageKey) {
  if (root.dataset.draggable !== 'true') return

  const state = readState(storageKey)
  const position = state.position

  if (state.dock) {
    applyMusicDock(root, state.dock)
  }

  if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    const snapped = state.dock && state.vDock
      ? resolveMusicPositionFromState(root, state)
      : snapMusicRootPosition(root, position.x, position.y)
    applySnappedMusicPosition(root, storageKey, snapped)
  }
}

function bindMusicDrag(root, storageKey, toggle, panel) {
  if (root.dataset.draggable !== 'true' || !toggle) return

  let pointerId = null
  let startX = 0
  let startY = 0
  let originX = 0
  let originY = 0
  let moved = false

  toggle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    const rect = root.getBoundingClientRect()
    originX = rect.left
    originY = rect.top
    moved = false
    toggle.setPointerCapture(event.pointerId)
  })

  toggle.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!moved && Math.hypot(dx, dy) < 8) return

    moved = true
    root.dataset.dragMoved = '1'
    root.classList.add('is-custom-position', 'is-dragging')

    const maxX = Math.max(0, window.innerWidth - root.offsetWidth)
    const maxY = Math.max(0, window.innerHeight - root.offsetHeight)
    const x = clamp(originX + dx, 0, maxX)
    const y = clamp(originY + dy, 0, maxY)

    root.style.left = `${x}px`
    root.style.top = `${y}px`
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  })

  const finishDrag = (event) => {
    if (pointerId !== event.pointerId) return
    pointerId = null
    root.classList.remove('is-dragging')
    if (toggle.hasPointerCapture(event.pointerId)) {
      toggle.releasePointerCapture(event.pointerId)
    }
    if (moved) {
      const rect = root.getBoundingClientRect()
      const snapped = snapMusicRootPosition(root, rect.left, rect.top)
      applySnappedMusicPosition(root, storageKey, snapped)
      if (panel?.classList.contains('is-visible')) {
        scheduleMusicPanelFit(root, panel, toggle)
      }
    }
  }

  toggle.addEventListener('pointerup', finishDrag)
  toggle.addEventListener('pointercancel', finishDrag)
}

export function initMusicPlayer() {
  const root = document.getElementById('sakura-music')
  if (!root || root.dataset.shellReady === '1') return

  const toggle = document.getElementById('sakura-music-toggle')
  const closeBtn = document.getElementById('sakura-music-close')
  const panel = document.getElementById('sakura-music-panel')
  const host = document.getElementById('sakura-music-meting-host')
  const loadingEl = document.getElementById('sakura-music-loading')
  const errorEl = document.getElementById('sakura-music-error')
  const albumPicker = document.getElementById('sakura-music-album-picker')
  const albumSelect = document.getElementById('sakura-music-album')
  if (!toggle || !panel || !host || !loadingEl || !errorEl) return

  root.dataset.shellReady = '1'

  const storageKey = root.dataset.storageKey || DEFAULT_STORAGE_KEY
  const isLocal = root.dataset.type === 'local'

  applyMusicPosition(root, storageKey)
  syncEdgeDock(root)
  bindEdgeDock(root)
  bindMusicDrag(root, storageKey, toggle, panel)

  let panelOpen = false
  let aplayerRef = null
  let playerReadyPromise = null
  let playerBound = false
  let albumData = null
  let currentAlbumId = ''
  let playbackEnhancementsReset = null

  const setStatus = (state, message = '') => {
    loadingEl.hidden = state !== 'loading'
    errorEl.hidden = state !== 'error'
    if (state === 'error' && message) errorEl.textContent = message
    if (state === 'error') {
      errorEl.hidden = false
      loadingEl.hidden = true
    }
  }

  const findAlbum = (albumId) => albumData?.albums.find((album) => album.id === albumId) || null

  const syncAlbumPicker = () => {
    if (!albumPicker || !albumSelect) return
    if (!albumData) {
      albumPicker.hidden = true
      return
    }

    if (albumSelect.dataset.populated !== '1') {
      albumSelect.replaceChildren()
      for (const album of albumData.albums) {
        const option = document.createElement('option')
        option.value = album.id
        option.textContent = album.artist ? `${album.name} · ${album.artist}` : album.name
        albumSelect.appendChild(option)
      }
      albumSelect.dataset.populated = '1'
    }

    const multipleAlbums = albumData.albums.length > 1
    albumPicker.hidden = !multipleAlbums
    albumSelect.disabled = !multipleAlbums
    if (currentAlbumId) albumSelect.value = currentAlbumId
  }

  const chooseInitialAlbum = () => {
    const state = readState(storageKey)
    const saved = albumData?.albums.find((album) => album.id === state.albumId)
    return saved
      || findAlbum(albumData?.defaultAlbum)
      || albumData?.albums[0]
      || null
  }

  const loadAlbumData = async () => {
    if (albumData) return albumData
    albumData = await fetchLocalPlaylist(root)
    syncAlbumPicker()
    return albumData
  }

  const bindPlayer = (ap, album) => {
    if (playerBound) return ap
    playerBound = true
    aplayerRef = ap
    currentAlbumId = album?.id || ''
    if (currentAlbumId) root.dataset.album = currentAlbumId
    syncAlbumPicker()
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
      window.__sakuraMusic = ap
      window.__sakuraAlbum = album || null
    }
    const restoredState = restorePlaybackState(ap, storageKey, currentAlbumId)
    playbackEnhancementsReset = bindPlaybackEnhancements(ap, restoredState)
    bindStatePersistence(ap, storageKey, () => panelOpen, () => currentAlbumId)
    bindPlayingIndicator(ap, root, toggle)
    bindMusicPanelLayoutSync(ap, root, panel, toggle, () => panelOpen)
    setStatus('ready')
    refreshAPlayerLayout(ap, () => scheduleMusicPanelFit(root, panel, toggle))
    return ap
  }

  const switchAlbum = async (albumId) => {
    if (!isLocal) return ensurePlayer()
    if (!albumData) await loadAlbumData()

    const album = findAlbum(albumId)
    if (!album) return aplayerRef || ensurePlayer()

    if (!aplayerRef) return ensurePlayer(album.id)
    if (album.id === currentAlbumId) {
      syncAlbumPicker()
      return aplayerRef
    }

    const ap = aplayerRef
    const wasPlaying = !ap.audio.paused
    const previousVolume = ap.audio.volume
    currentAlbumId = album.id
    root.dataset.album = album.id
    playbackEnhancementsReset?.()

    try {
      ap.list.clear()
      ap.list.add(album.tracks)
      ap.list.switch(0)
      if (previousVolume > 0.02) ap.audio.volume = previousVolume
      if (wasPlaying) {
        const played = ap.play()
        if (played && typeof played.catch === 'function') played.catch(() => {})
      }
      if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        window.__sakuraAlbum = album
      }
      syncAlbumPicker()
      setStatus('ready')
      refreshAPlayerLayout(ap, () => scheduleMusicPanelFit(root, panel, toggle))
    } catch (err) {
      console.warn('[music-player] album switch failed:', err)
      setStatus('error', `专辑切换失败：${err?.message || '未知错误'}`)
      throw err
    }

    return ap
  }

  const ensurePlayer = (requestedAlbumId = '') => {
    if (aplayerRef) {
      if (requestedAlbumId && requestedAlbumId !== currentAlbumId) {
        return switchAlbum(requestedAlbumId)
      }
      return Promise.resolve(aplayerRef)
    }
    if (playerReadyPromise) return playerReadyPromise

    playerReadyPromise = (async () => {
      setStatus('loading')
      await ensureMusicLibs(!isLocal)
      if (!isLocal) {
        const { ap } = await mountWithFallback(root, host)
        return bindPlayer(ap, null)
      }
      await loadAlbumData()
      const album = (requestedAlbumId && findAlbum(requestedAlbumId)) || chooseInitialAlbum()
      const { ap } = await mountLocalPlayer(root, host, album.tracks)
      return bindPlayer(ap, album)
    })().catch((err) => {
      console.warn('[music-player]', err)
      const message = err?.message
        ? `音乐加载失败：${err.message}`
        : '音乐播放器加载失败，请稍后重试'
      setStatus('error', message)
      toggle?.setAttribute('aria-label', '音乐播放器加载失败')
      playerReadyPromise = null
      throw err
    })

    return playerReadyPromise
  }

  const setPanelOpen = (open, persist = true) => {
    panelOpen = open
    panel.classList.toggle('is-visible', open)
    panel.setAttribute('aria-hidden', open ? 'false' : 'true')
    root.classList.toggle('is-open', open)
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) {
      root.classList.add('is-edge-expanded')
    } else if (isEdgeDockEnabled(root)) {
      root.classList.remove('is-edge-expanded')
    }
    if (open) {
      scheduleMusicPanelFit(root, panel, toggle)
      window.requestAnimationFrame(() => {
        refreshAPlayerLayout(aplayerRef, () => scheduleMusicPanelFit(root, panel, toggle))
      })
    } else {
      resetMusicPanelPosition(panel)
    }
    if (persist) {
      const state = readState(storageKey)
      writeState(storageKey, { ...state, panelOpen: open })
    }
  }

  const openPanel = ({ autoplay = true } = {}) => {
    setPanelOpen(true)
    ensurePlayer().then((ap) => {
      refreshAPlayerLayout(ap, () => scheduleMusicPanelFit(root, panel, toggle))
      if (!autoplay || !panelOpen || !ap?.audio || !ap.audio.paused) return
      try {
        const played = ap.play()
        if (played && typeof played.catch === 'function') played.catch(() => {})
      } catch {
        /* 用户仍可点播放按钮 */
      }
    }).catch(() => {})
  }

  window.addEventListener('resize', () => {
    if (root.classList.contains('is-custom-position')) {
      const rect = root.getBoundingClientRect()
      const { x, y } = clampMusicRootPosition(root, rect.left, rect.top)
      root.style.left = `${x}px`
      root.style.top = `${y}px`
      if (root.dataset.draggable === 'true') {
        const state = readState(storageKey)
        writeState(storageKey, { ...state, position: { x, y } })
      }
    }
    if (panelOpen) scheduleMusicPanelFit(root, panel, toggle)
  })

  const stored = readState(storageKey)
  if (stored.panelOpen) {
    openPanel({ autoplay: false })
  } else {
    // 即使用户上次暂停过，也提前把播放器准备好；点开时不必再等“加载中”。
    const warm = () => {
      ensurePlayer().catch(() => {})
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(warm, { timeout: 1500 })
    } else {
      window.setTimeout(warm, 700)
    }
  }

  toggle?.addEventListener('click', (event) => {
    event.stopPropagation()
    if (root.dataset.dragMoved === '1') {
      root.dataset.dragMoved = '0'
      return
    }
    if (panelOpen) setPanelOpen(false)
    else openPanel()
  })

  closeBtn?.addEventListener('click', (event) => {
    event.stopPropagation()
    setPanelOpen(false)
  })

  albumSelect?.addEventListener('change', () => {
    switchAlbum(albumSelect.value).catch(() => {})
  })

  document.addEventListener('click', (event) => {
    if (!panelOpen) return
    if (root.contains(event.target)) return
    setPanelOpen(false)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelOpen) setPanelOpen(false)
  })
}

export function scheduleMusicPlayerInit() {
  const root = document.getElementById('sakura-music')
  if (!root) return

  // 立即绑定播放器按钮，避免用户很快点击时还没有响应；音频本身仍在后台预热。
  initMusicPlayer()
}
