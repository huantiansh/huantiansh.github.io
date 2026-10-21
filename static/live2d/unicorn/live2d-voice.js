(() => {
  'use strict'

  if (!window.OML2D || typeof window.OML2D.loadOml2d !== 'function') return
  if (window.__unicornLive2dMounted) return
  window.__unicornLive2dMounted = true

  const BASE = '/live2d/unicorn/'
  const VOICE_BASE = BASE + 'voice/'

  const LINES = {
    main_1: '哥哥…坐过山车的时候，能握着你的手吗？',
    main_2: '摩天轮…推荐情侣共乘…诶，啊，哥哥。没、没什么…！',
    main_3: '旋转木马…好漂亮…诶？可以和哥哥一起…坐吗？',
    touch_body: '像这样…在游乐园和哥哥手牵手，总觉得…就像恋人一样呢，嘻嘻……',
    touch_special: '哥、哥哥，这里人有点多…',
    mission: '哥哥，有重要的事的话，先去也没关系哦…？独角兽，会等着哥哥的…',
    home: '不用那么急也没关系哦？独角兽会一直等着哥哥的',
    touch_head: '哥哥…独角兽是乖孩子吧…？',
    mail: '邮件…要去看看吗？',
    mission_complete: '奖励…不能错过…'
  }

  const VOICE_FILES = {
    main_1: 'main_1_3.wav',
    main_2: 'main_2_3.wav',
    main_3: 'main_3_3.wav',
    touch_body: 'touch_1_3.wav',
    touch_special: 'touch_2_3.wav',
    mission: 'task_3.wav',
    home: 'home_3.wav',
    touch_head: 'touch_head.wav',
    mail: 'mail.wav',
    mission_complete: 'mission_complete.wav'
  }

  const PAIRS = [
    ['main_1', 'main_1'],
    ['main_2', 'main_2'],
    ['main_3', 'main_3'],
    ['touch_body', 'touch_body'],
    ['touch_special', 'touch_special'],
    ['mission', 'mission'],
    ['home', 'home']
  ]

  const MOTION_INDEX = {
    idle: 0,
    touch_body: 1,
    touch_head: 2,
    wedding: 3,
    main_1: 4,
    main_3: 5,
    complete: 6,
    home: 7,
    main_2: 8,
    touch_special: 9,
    mission_complete: 10,
    mission: 11,
    mail: 12
  }

  let pairBag = []
  const state = { widget: null, audio: null, lastPair: null }

  function injectIcons() {
    if (document.getElementById('unicorn-live2d-icons')) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = 'unicorn-live2d-icons'
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
    svg.innerHTML = [
      '<symbol id="unicorn-icon-voice" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></symbol>',
      '<symbol id="unicorn-icon-heart" viewBox="0 0 24 24"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></symbol>'
    ].join('')
    document.body.appendChild(svg)
  }

  function showTip(line, duration) {
    const tips = state.widget && state.widget.tips
    if (tips && typeof tips.notification === 'function') {
      tips.notification(line, duration, 3)
    }
  }

  function playVoice(key) {
    const line = LINES[key]
    const file = VOICE_FILES[key]
    if (!line || !file) return
    try {
      if (state.audio) {
        state.audio.pause()
        state.audio.currentTime = 0
      }
      const audio = new Audio(VOICE_BASE + file)
      audio.preload = 'auto'
      audio.volume = 0.85
      state.audio = audio
      let shown = false
      const show = () => {
        if (shown) return
        shown = true
        const seconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 6
        showTip(line, Math.max(6000, Math.ceil(seconds * 1000) + 800))
      }
      audio.addEventListener('loadedmetadata', show, { once: true })
      if (audio.readyState >= 1) show()
      const played = audio.play()
      if (played && typeof played.catch === 'function') played.catch(() => {})
    } catch (err) {
      // 语音只是装饰，失败时保留看板娘本身
    }
  }

  function shuffle(list) {
    const out = list.slice()
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
    }
    return out
  }

  function nextPair() {
    if (!pairBag.length) pairBag = shuffle(PAIRS)
    return pairBag.pop()
  }

  function playMotion(name) {
    const index = MOTION_INDEX[name]
    if (index == null) return
    const models = state.widget && state.widget.models
    if (!models) return
    try {
      if (typeof models.playMotion === 'function') {
        models.playMotion('', index)
      } else if (models.model && typeof models.model.motion === 'function') {
        models.model.motion('', index)
      }
    } catch (err) {
      // 动作失败时仍然保留语音
    }
  }

  function unbindRandomHitMotion() {
    const model = state.widget && state.widget.models && state.widget.models.model
    if (!model || model.__unicornHitCleared) return
    model.__unicornHitCleared = true
    try {
      const listeners = typeof model.listeners === 'function' ? model.listeners('hit') : []
      listeners.forEach((fn) => model.off('hit', fn))
    } catch (err) {
      // 忽略：不同版本的 pixi-live2d-display 事件 API 可能不同
    }
  }

  function playPair(pair) {
    if (!pair) return
    const voiceKey = pair[0]
    const motionName = pair[1]
    state.lastPair = { voice: voiceKey, motion: motionName }
    playMotion(motionName)
    playVoice(voiceKey)
  }

  function rest(instance) {
    const status = instance && instance.options ? instance.options.statusBar : null
    if (!instance) return
    instance.statusBarOpen(status ? status.restMessage : '看板娘休息中')
    instance.clearTips()
    instance.setStatusBarClickEvent(() => {
      instance.statusBarClose()
      instance.stageSlideIn()
      instance.statusBarClearEvents()
    })
    instance.stageSlideOut()
  }

  function bindCanvas() {
    let canvas = document.getElementById('oml2d-canvas')
    if (!canvas) canvas = document.querySelector('.oml2d-stage canvas')
    if (!canvas) {
      canvas = Array.from(document.querySelectorAll('canvas')).find((el) => el.width > 100 && el.height > 100) || null
    }
    if (!canvas) return false
    if (canvas.dataset.unicornVoice === '1') {
      unbindRandomHitMotion()
      return true
    }
    canvas.dataset.unicornVoice = '1'
    unbindRandomHitMotion()
    canvas.addEventListener('pointerdown', () => playPair(nextPair()), { passive: true })
    return true
  }

  function installStageStyle() {
    if (document.getElementById('unicorn-live2d-style')) return
    const style = document.createElement('style')
    style.id = 'unicorn-live2d-style'
    style.textContent = [
      '#oml2d-stage { transition: opacity .3s ease; }',
      'body.unicorn-sidebar-visible #oml2d-stage { opacity: 0 !important; pointer-events: none !important; }'
    ].join('\n')
    document.head.appendChild(style)
  }

  let sidebarObserver = null
  let sidebarEl = null

  function bindSidebarGuard() {
    const next = document.querySelector('.home-list-sidebar')
    if (next === sidebarEl && sidebarObserver) return
    if (sidebarObserver) {
      sidebarObserver.disconnect()
      sidebarObserver = null
    }
    sidebarEl = next
    if (!next) {
      document.body.classList.remove('unicorn-sidebar-visible')
      return
    }
    sidebarObserver = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.02)
      document.body.classList.toggle('unicorn-sidebar-visible', visible)
    }, { threshold: [0, 0.02, 0.1] })
    sidebarObserver.observe(next)
  }

  injectIcons()
  installStageStyle()

  const height = Math.round(Math.min(900, Math.max(500, window.innerHeight * 0.58)))
  const ratio = height / 620

  let widget
  try {
    widget = window.OML2D.loadOml2d({
      models: [{
        path: BASE + 'dujiaoshou_4/dujiaoshou_4.model3.json',
        position: [0, Math.round(40 * ratio)],
        scale: 0.09 * ratio,
        stageStyle: { height },
        motionPreloadStrategy: 'ALL',
        volume: 0
      }],
      dockedPosition: 'left',
      mobileDisplay: false,
      primaryColor: '#6F86D6',
      transitionTime: 800,
      tips: {
        idleTips: {
          wordTheDay: false,
          message: [
            '点一下独角兽，听听她说话吧。',
            '哥哥…坐过山车的时候，能握着你的手吗？',
            '摩天轮…推荐情侣共乘…诶，啊，哥哥。没、没什么…！'
          ],
          duration: 6000,
          interval: 30000,
          priority: 2
        }
      },
      menus: {
        items: [
          {
            id: 'UnicornVoice',
            icon: 'unicorn-icon-voice',
            title: '听她说',
            onClick: () => playPair(nextPair())
          },
          {
            id: 'UnicornHeadpat',
            icon: 'unicorn-icon-heart',
            title: '摸摸头',
            onClick: () => playPair(['touch_head', 'touch_head'])
          },
          {
            id: 'UnicornRest',
            icon: 'icon-rest',
            title: '休息',
            onClick: (instance) => rest(instance)
          },
          {
            id: 'UnicornAbout',
            icon: 'icon-about',
            title: '关于本站',
            onClick: () => { window.location.href = '/about/' }
          }
        ]
      }
    })
  } catch (err) {
    console.warn('[unicorn-live2d] init failed:', err)
    return
  }

  state.widget = widget

  bindSidebarGuard()
  window.addEventListener('sakura:page-content-visible', bindSidebarGuard)
  window.addEventListener('popstate', bindSidebarGuard)

  let tries = 0
  const timer = window.setInterval(() => {
    tries += 1
    if (bindCanvas() || tries > 240) window.clearInterval(timer)
  }, 250)

  const preload = () => {
    for (const key of ['touch_head', 'touch_body', 'touch_special']) {
      const file = VOICE_FILES[key]
      if (!file) continue
      const audio = new Audio(VOICE_BASE + file)
      audio.preload = 'auto'
      audio.load()
    }
  }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(preload, { timeout: 8000 })
  } else {
    window.setTimeout(preload, 5000)
  }

  window.__unicornVoice = {
    playVoice,
    playPair,
    get widget() { return state.widget },
    get lastPair() { return state.lastPair }
  }
})()
