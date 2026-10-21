(() => {
  'use strict'

  if (!window.OML2D || typeof window.OML2D.loadOml2d !== 'function') return
  if (window.__unicornLive2dMounted) return
  window.__unicornLive2dMounted = true

  const BASE = '/live2d/unicorn/'
  const VOICE_BASE = BASE + 'voice/'

  const LINES = {
    login: '欢迎回来，哥哥……今天也要出击吗？',
    home: '舰队…平安回港…哥哥辛苦了…膝枕…也可以的喔？',
    main_1: '毁灭模式什么的，是不存在的喔？',
    main_2: '优酱的角…是不会变形的喔？',
    main_3: 'NーTーD？对不起…独角兽不知道哥哥在说什么',
    touch_head: '哥哥…独角兽是乖孩子吧…？',
    touch_body: '嘻嘻…好痒的啦…哥哥…',
    touch_special: '哥哥的话…可以喔？',
    mission: '任务…不要忘记…',
    mission_complete: '奖励…不能错过…',
    mail: '邮件…要去看看吗？',
    wedding: '这么…重要的…独角兽真的…可以吗…？独角兽…会加油的…因为…最喜欢哥哥了',
    feeling1: '哥哥…差劲…',
    feeling2: '这孩子叫做优酱，独角兽（unicorn）的优酱…是我的挚友喔…嘻嘻…',
    feeling3: '遇到危险的时候，优酱会保护我的——有哥哥在就不会有危险？嘻嘻，哥哥好像独角兽的骑士呢…',
    feeling4: '独角兽一直很努力…支援姐姐们也好…出击任务也好…运输任务也好…独角兽是乖孩子吧？有派上用场吧？哥哥…',
    feeling5: '在哥哥面前…任性也可以吗…？撒娇也可以吗…？独角兽…其实不是那么听话的孩子…这样也可以吗…？'
  }

  const TOUCH = ['touch_head', 'touch_body', 'touch_special']
  const CHAT = ['main_1', 'main_2', 'main_3', 'feeling1', 'feeling2', 'feeling3', 'feeling4', 'feeling5', 'home', 'mail', 'login', 'mission', 'mission_complete']
  const bags = new Map()
  const state = { widget: null, audio: null }

  function pick(pool) {
    let bag = bags.get(pool)
    if (!bag || !bag.length) {
      bag = pool.slice()
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = bag[i]
        bag[i] = bag[j]
        bag[j] = tmp
      }
      bags.set(pool, bag)
    }
    return bag.pop()
  }

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
    if (!line) return
    try {
      if (state.audio) {
        state.audio.pause()
        state.audio.currentTime = 0
      }
      const audio = new Audio(VOICE_BASE + key + '.wav')
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

  function pickTouch() {
    if (Math.random() < 0.02) return 'wedding'
    return pick(TOUCH)
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
    if (canvas.dataset.unicornVoice === '1') return true
    canvas.dataset.unicornVoice = '1'
    canvas.addEventListener('pointerdown', () => playVoice(pickTouch()), { passive: true })
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
        volume: 0
      }],
      dockedPosition: 'left',
      mobileDisplay: false,
      primaryColor: '#6F86D6',
      transitionTime: 800,
      tips: {
        idleTips: {
          wordTheDay: false,
          message: ['点一下独角兽，听听她说话吧。', '哥哥——。', '今天也要好好休息哦。'],
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
            onClick: () => playVoice(pick(CHAT))
          },
          {
            id: 'UnicornHeadpat',
            icon: 'unicorn-icon-heart',
            title: '摸摸头',
            onClick: () => playVoice('touch_head')
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
      const audio = new Audio(VOICE_BASE + key + '.wav')
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
    get widget() { return state.widget }
  }
})()
