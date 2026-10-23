const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]))
const today = () => new Date().toISOString().slice(0, 10)
const timestamp = () => Date.now()
const safeBase = (value) => String(value || 'image').replace(/[^\w一-龥-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image'

const VIEW_TITLES = {
  overview: '概览',
  site: '站点设置',
  headers: '头图中心',
  posts: '文章',
  'post-edit': '编辑文章',
  pages: '页面',
  'page-edit': '编辑页面',
  media: '媒体库',
  appearance: '外观与组件',
  publish: '预览与发布'
}

let DATA = null
let VIEW = 'overview'
let EDITING = null
let STATUS_TIMER = null

function setStatus(message, type = '') {
  const el = $('#status')
  if (!el) return
  el.textContent = message || ''
  el.className = `status ${type}`.trim()
  clearTimeout(STATUS_TIMER)
  if (message) {
    STATUS_TIMER = setTimeout(() => {
      el.textContent = ''
      el.className = 'status'
    }, 6000)
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, options)
  let data
  try { data = await response.json() } catch (_) { throw new Error(`HTTP ${response.status}`) }
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function postJson(url, body = {}) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function runAction(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  try { return await response.json() } catch (_) { return { ok: false, error: `HTTP ${response.status}` } }
}

function previewUrl(value) {
  if (!value) return ''
  const text = String(value)
  if (/^(https?:|data:)/.test(text) || text.startsWith('/media/')) return text
  return `/media${text.startsWith('/') ? text : `/${text}`}`
}

function isVideoPath(value) {
  return /\.(mp4|webm|ogg)(?:$|\?)/i.test(String(value || ''))
}

function mediaMarkup(path, alt = '') {
  if (!path) return '<div class="empty">未设置</div>'
  const url = esc(previewUrl(path))
  if (isVideoPath(path)) {
    return `<video src="${url}" muted loop autoplay playsinline></video>`
  }
  return `<img src="${url}" alt="${esc(alt)}">`
}

function mediaOptions(selected, { empty = false, kind = 'all' } = {}) {
  const items = (DATA?.media || []).filter((item) => kind === 'all' || item.kind === kind)
  const values = new Set(items.map((item) => item.path))
  const rows = []
  if (empty) rows.push(`<option value="">（无 / 使用默认）</option>`)
  for (const item of items) {
    rows.push(`<option value="${esc(item.path)}" ${item.path === selected ? 'selected' : ''}>${esc(item.name)} — ${esc(item.path)}</option>`)
  }
  if (selected && !values.has(selected)) {
    rows.push(`<option value="${esc(selected)}" selected>当前：${esc(selected)}</option>`)
  }
  return rows.join('')
}

async function reload() {
  try {
    DATA = await api('/api/state')
    render()
  } catch (error) {
    setStatus(error.message, 'error')
  }
}

function render() {
  if (!DATA) return
  const title = $('#view-title')
  if (title) title.textContent = VIEW_TITLES[VIEW] || '后台'
  $$('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === VIEW))
  const view = $('#view')
  if (!view) return
  if (VIEW === 'overview') renderOverview(view)
  else if (VIEW === 'site') renderSite(view)
  else if (VIEW === 'headers') renderHeaders(view)
  else if (VIEW === 'posts') renderPosts(view)
  else if (VIEW === 'post-edit') renderPostEditor(view)
  else if (VIEW === 'pages') renderPages(view)
  else if (VIEW === 'page-edit') renderPageEditor(view)
  else if (VIEW === 'media') renderMedia(view)
  else if (VIEW === 'appearance') renderAppearance(view)
  else if (VIEW === 'publish') renderPublish(view)
}

function renderOverview(view) {
  const git = DATA.git || {}
  view.innerHTML = `
    <div class="grid grid-4">
      <div class="card stat"><span class="muted">文章</span><strong>${DATA.posts.length}</strong></div>
      <div class="card stat"><span class="muted">页面</span><strong>${DATA.pages.length}</strong></div>
      <div class="card stat"><span class="muted">媒体</span><strong>${DATA.media.length}</strong></div>
      <div class="card stat"><span class="muted">分支</span><strong>${esc(git.branch || '-')}</strong></div>
    </div>
    <div class="card">
      <div class="row-between">
        <h2>站点</h2>
        <div class="actions">
          <a class="btn" href="https://huantiansh.github.io/" target="_blank" rel="noopener">线上站点</a>
          <a class="btn" href="http://127.0.0.1:1313/" target="_blank" rel="noopener">本地预览</a>
        </div>
      </div>
      <p><strong>${esc(DATA.config.title)}</strong> — ${esc(DATA.config.subtitle)}</p>
      <p class="muted">${esc(DATA.config.description)}</p>
    </div>
    <div class="card">
      <h3>Git</h3>
      <p class="small">最近提交：<span class="code">${esc(git.last || '无')}</span></p>
      <pre class="output">${esc(git.status || '工作区干净')}</pre>
      <p class="muted small">提交和推送在“预览与发布”里操作。</p>
    </div>
    <div class="card">
      <h3>快捷入口</h3>
      <div class="actions">
        <button class="btn" data-go="headers">改头图</button>
        <button class="btn" data-go="posts">写文章</button>
        <button class="btn" data-go="media">媒体库</button>
        <button class="btn" data-go="publish">发布</button>
      </div>
    </div>
  `
  $$('[data-go]', view).forEach((button) => {
    button.onclick = () => { VIEW = button.dataset.go; EDITING = null; render() }
  })
}

function renderSite(view) {
  const c = DATA.config
  const a = c.author || {}
  view.innerHTML = `
    <form id="site-form">
      <div class="card">
        <h2>基本信息</h2>
        <div class="grid grid-2">
          <div class="field"><label>站点名</label><input type="text" id="site-title" value="${esc(c.title)}"></div>
          <div class="field"><label>副标题</label><input type="text" id="site-subtitle" value="${esc(c.subtitle)}"></div>
        </div>
        <div class="field"><label>站点描述</label><textarea id="site-description">${esc(c.description)}</textarea></div>
        <div class="grid grid-2">
          <div class="field"><label>主题色</label><input type="text" id="site-primary" value="${esc(c.primaryColor)}"></div>
          <div class="field"><label>文章字号</label><input type="text" id="site-font-size" value="${esc(c.post?.fontSize || '1.25rem')}"></div>
        </div>
      </div>

      <div class="card">
        <h2>作者与品牌图</h2>
        <div class="grid grid-2">
          <div>
            <div class="field"><label>作者名</label><input type="text" id="site-author-name" value="${esc(a.name)}"></div>
            <div class="grid grid-2">
              <div class="field"><label>状态 emoji</label><input type="text" id="site-status-emoji" value="${esc(a.statusEmoji)}"></div>
              <div class="field"><label>状态文字</label><input type="text" id="site-status-message" value="${esc(a.statusMessage)}"></div>
            </div>
            <div class="actions">
              <label class="btn">上传头像<input type="file" id="avatar-file" accept="image/*" hidden></label>
              <label class="btn">上传 favicon<input type="file" id="favicon-file" accept="image/*" hidden></label>
            </div>
            <p class="help">头像裁剪为 1:1，favicon 为 64×64 PNG；会覆盖当前文件并自动备份。</p>
          </div>
          <div>
            <div class="grid grid-2">
              <div>
                <div class="preview square">${mediaMarkup(a.avatar, 'avatar')}</div>
                <p class="code">${esc(a.avatar || '')}</p>
              </div>
              <div>
                <div class="preview square">${mediaMarkup(c.favicon, 'favicon')}</div>
                <p class="code">${esc(c.favicon || '')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>默认封面与页脚</h2>
        <div class="field"><label>文章默认封面</label><select id="site-default-cover">${mediaOptions(c.defaultCover, { empty: true })}</select></div>
        <div class="actions" style="margin-bottom:12px">
          <label class="btn small">上传并裁剪默认封面<input type="file" id="site-default-cover-file" accept="image/*" hidden></label>
          <span class="muted small">图片会按 16:9 裁剪并立即保存。</span>
        </div>
        <div class="grid grid-3">
          <div class="field"><label>版权起始年</label><input type="text" id="site-footer-since" value="${esc(c.footer?.since ?? '')}"></div>
          <div class="field"><label>运行计时起点</label><input type="text" id="site-footer-runtime" value="${esc(c.footer?.runtimeSince ?? '')}"></div>
          <div class="field"><label>ICP</label><input type="text" id="site-footer-icp" value="${esc(c.footer?.icp ?? '')}"></div>
        </div>
      </div>

      <div class="actions">
        <button class="btn primary" type="submit">保存站点设置</button>
      </div>
    </form>
  `

  const save = async () => {
    const config = {
      title: $('#site-title').value.trim(),
      subtitle: $('#site-subtitle').value.trim(),
      description: $('#site-description').value.trim(),
      primaryColor: $('#site-primary').value.trim(),
      defaultCover: $('#site-default-cover').value,
      post: { fontSize: $('#site-font-size').value.trim() || '1.25rem' },
      author: {
        name: $('#site-author-name').value.trim(),
        statusEmoji: $('#site-status-emoji').value.trim(),
        statusMessage: $('#site-status-message').value.trim()
      },
      footer: {
        since: $('#site-footer-since').value.trim(),
        runtimeSince: $('#site-footer-runtime').value.trim(),
        icp: $('#site-footer-icp').value.trim()
      }
    }
    try {
      await postJson('/api/config', { config })
      setStatus('站点设置已保存', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
  $('#site-form').onsubmit = (event) => { event.preventDefault(); save() }

  $('#avatar-file').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const source = await readFileAsDataURL(file)
    openCropper({ source, aspect: 1, target: 'hero/avatar.png', width: 512, height: 512, update: 'avatar', onDone: reload })
  }
  $('#favicon-file').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const source = await readFileAsDataURL(file)
    openCropper({ source, aspect: 1, target: 'hero/favicon.png', width: 64, height: 64, update: 'favicon', onDone: reload })
  }
  $('#site-default-cover-file').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const source = await readFileAsDataURL(file)
    openCropper({
      source,
      aspect: 16 / 9,
      target: `uploads/covers/default-${timestamp()}.jpg`,
      width: 1600,
      height: 900,
      onDone: async (path) => {
        try {
          await postJson('/api/config', { config: { defaultCover: path } })
          setStatus('默认封面已更新', 'ok')
          await reload()
        } catch (error) { setStatus(error.message, 'error') }
      }
    })
  }
}

async function saveHero(urls) {
  try {
    await postJson('/api/config', { config: { hero: { urls } } })
    setStatus('首页头图已更新', 'ok')
    await reload()
  } catch (error) { setStatus(error.message, 'error') }
}

function renderHeaders(view) {
  const c = DATA.config
  const heroUrls = Array.isArray(c.hero?.urls) ? c.hero.urls : []
  const pages = DATA.pages
  view.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div><h2>首页 Hero</h2><p class="muted small">按顺序轮播，支持图片和 mp4/webm/ogg 视频。</p></div>
        <div class="actions">
          <label class="btn">添加图片<input type="file" id="hero-image" accept="image/*" hidden></label>
          <label class="btn">添加视频<input type="file" id="hero-video" accept="video/mp4,video/webm,video/ogg" hidden></label>
        </div>
      </div>
      <div class="hero-list" id="hero-list">
        ${heroUrls.length ? heroUrls.map((url, index) => `
          <div class="hero-item" data-index="${index}">
            <div class="preview">${mediaMarkup(url, `hero-${index}`)}</div>
            <div><div class="path">${esc(url)}</div><div class="muted small">${isVideoPath(url) ? '视频' : '图片'}</div></div>
            <div class="row">
              <button class="btn small" data-hero-up="${index}" ${index === 0 ? 'disabled' : ''}>上移</button>
              <button class="btn small" data-hero-down="${index}" ${index === heroUrls.length - 1 ? 'disabled' : ''}>下移</button>
              <button class="btn small danger" data-hero-remove="${index}">删除</button>
            </div>
          </div>
        `).join('') : '<p class="muted">还没有 Hero 图。</p>'}
      </div>
    </div>

    <div class="card">
      <div class="section-title"><div><h2>版块头图</h2><p class="muted small">修改页面 front matter 的 cover，支持图片和视频。</p></div></div>
      <div class="grid grid-2">
        ${pages.map((page) => `
          <div class="card" data-page-key="${esc(page.key)}">
            <div class="section-title"><h3>${esc(page.label)}</h3><span class="badge">${esc(page.path)}</span></div>
            <div class="preview">${mediaMarkup(page.cover, page.title)}</div>
            <p class="code">${esc(page.cover || '未设置')}</p>
            <div class="field"><label>选择图片/视频</label><select data-page-select>${mediaOptions(page.cover, { empty: true })}</select></div>
            <div class="actions">
              <button class="btn primary small" data-page-apply>应用所选</button>
              <label class="btn small">上传图片<input type="file" data-page-image accept="image/*" hidden></label>
              <label class="btn small">上传视频<input type="file" data-page-video accept="video/mp4,video/webm,video/ogg" hidden></label>
              <button class="btn small danger" data-page-remove>移除</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `

  $$('[data-hero-up]', view).forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.heroUp)
      if (index <= 0) return
      const next = heroUrls.slice()
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      saveHero(next)
    }
  })
  $$('[data-hero-down]', view).forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.heroDown)
      if (index >= heroUrls.length - 1) return
      const next = heroUrls.slice()
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      saveHero(next)
    }
  })
  $$('[data-hero-remove]', view).forEach((button) => {
    button.onclick = () => {
      const next = heroUrls.filter((_, index) => index !== Number(button.dataset.heroRemove))
      if (confirm('删除这张 Hero 图？')) saveHero(next)
    }
  })

  $('#hero-image').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const source = await readFileAsDataURL(file)
    openCropper({
      source,
      aspect: 16 / 9,
      target: `uploads/hero/hero-${timestamp()}.jpg`,
      width: 1920,
      height: 1080,
      onDone: (path) => saveHero([...heroUrls, path])
    })
  }
  $('#hero-video').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const path = await uploadVideo(file)
      await saveHero([...heroUrls, path])
    } catch (error) { setStatus(error.message, 'error') }
  }

  $$('[data-page-key]', view).forEach((card) => {
    const page = DATA.pages.find((item) => item.key === card.dataset.pageKey)
    if (!page) return
    const apply = async (cover) => {
      try {
        await postJson('/api/cover', { path: page.path, cover })
        setStatus(`${page.label}头图已更新`, 'ok')
        await reload()
      } catch (error) { setStatus(error.message, 'error') }
    }
    $('[data-page-apply]', card).onclick = () => apply($('[data-page-select]', card).value)
    $('[data-page-remove]', card).onclick = () => apply('')
    $('[data-page-image]', card).onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      event.target.value = ''
      const source = await readFileAsDataURL(file)
      openCropper({
        source,
        aspect: 16 / 9,
        target: `uploads/covers/${safeBase(page.key)}-${timestamp()}.jpg`,
        width: 1600,
        height: 900,
        onDone: (path) => apply(path)
      })
    }
    $('[data-page-video]', card).onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      event.target.value = ''
      try {
        const path = await uploadVideo(file)
        await apply(path)
      } catch (error) { setStatus(error.message, 'error') }
    }
  })
}

function renderPosts(view) {
  view.innerHTML = `
    <div class="row-between" style="margin-bottom:12px">
      <p class="muted">共 ${DATA.posts.length} 篇文章。标题、封面、正文都在这里改。</p>
      <button class="btn primary" id="new-post">新建文章</button>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>封面</th><th>标题</th><th>日期</th><th>状态</th><th></th></tr></thead>
        <tbody>
          ${DATA.posts.map((post) => `
            <tr>
              <td>${post.cover ? `<div>${mediaMarkup(post.cover, post.title)}</div>` : '<span class="muted">默认</span>'}</td>
              <td><strong>${esc(post.title)}</strong><div class="muted small">${esc(post.path)}</div></td>
              <td>${esc(post.date || '')}</td>
              <td>${post.pinned ? '<span class="pill on">置顶</span>' : ''}${post.draft ? '<span class="pill warn">草稿</span>' : ''}</td>
              <td class="row">
                <button class="btn small" data-edit-post="${esc(post.path)}">编辑</button>
                <button class="btn small danger" data-delete-post="${esc(post.path)}">删除</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="muted">还没有文章。</td></tr>'}
        </tbody>
      </table>
    </div>
  `
  $('#new-post').onclick = () => {
    EDITING = {
      path: null,
      isNew: true,
      doc: {
        frontMatter: {
          title: '', description: '', date: today(), author: 'Claudian',
          categories: ['随笔'], tags: [], cover: '', pinned: false, draft: false
        },
        body: ''
      }
    }
    VIEW = 'post-edit'
    render()
  }
  $$('[data-edit-post]', view).forEach((button) => {
    button.onclick = () => openPostEditor(button.dataset.editPost)
  })
  $$('[data-delete-post]', view).forEach((button) => {
    button.onclick = async () => {
      if (!confirm('删除这篇文章？服务器会先备份文件。')) return
      try {
        await postJson('/api/post/delete', { path: button.dataset.deletePost })
        setStatus('文章已删除', 'ok')
        await reload()
      } catch (error) { setStatus(error.message, 'error') }
    }
  })
}

async function openPostEditor(path) {
  try {
    const doc = await api(`/api/content?path=${encodeURIComponent(path)}`)
    EDITING = { path, isNew: false, doc }
    VIEW = 'post-edit'
    render()
  } catch (error) { setStatus(error.message, 'error') }
}

function renderPostEditor(view) {
  const doc = EDITING?.doc || {}
  const fm = doc.frontMatter || {}
  const isNew = EDITING?.isNew
  const slug = isNew ? '' : String(EDITING.path).replace(/^content\/posts\//, '').replace(/\.md$/, '')
  view.innerHTML = `
    <div class="card">
      <div class="section-title">
        <h2>${isNew ? '新建文章' : '编辑文章'}</h2>
        <button class="btn" id="back-posts">返回文章列表</button>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>标题</label><input type="text" id="post-title" value="${esc(fm.title)}"></div>
        <div class="field"><label>${isNew ? '文件名 / slug' : '路径'}</label><input type="text" id="post-slug" value="${esc(slug)}" ${isNew ? '' : 'readonly'}></div>
        <div class="field"><label>日期</label><input type="text" id="post-date" value="${esc(fm.date || today())}"></div>
        <div class="field"><label>作者</label><input type="text" id="post-author" value="${esc(fm.author || 'Claudian')}"></div>
      </div>
      <div class="field"><label>描述</label><textarea id="post-description">${esc(fm.description)}</textarea></div>
      <div class="grid grid-2">
        <div class="field"><label>分类（逗号分隔）</label><input type="text" id="post-categories" value="${esc((fm.categories || []).join(', '))}"></div>
        <div class="field"><label>标签（逗号分隔）</label><input type="text" id="post-tags" value="${esc((fm.tags || []).join(', '))}"></div>
      </div>
      <div class="field"><label>封面</label><select id="post-cover">${mediaOptions(fm.cover, { empty: true })}</select></div>
      <div class="actions">
        <label class="btn small">上传封面图<input type="file" id="post-cover-image" accept="image/*" hidden></label>
        <label class="btn small">上传封面视频<input type="file" id="post-cover-video" accept="video/mp4,video/webm,video/ogg" hidden></label>
        <span class="muted small">图片会按 16:9 裁剪；视频直接使用。</span>
      </div>
      <div class="preview" id="post-cover-preview" style="margin-top:10px">${mediaMarkup(fm.cover, fm.title)}</div>
      <div class="field" style="margin-top:10px"><label>正文 Markdown</label><textarea id="post-body" style="min-height:360px">${esc(doc.body || '')}</textarea></div>
      <div class="row" style="margin:10px 0">
        <label class="check"><input type="checkbox" id="post-pinned" ${fm.pinned ? 'checked' : ''}> 置顶</label>
        <label class="check"><input type="checkbox" id="post-draft" ${fm.draft ? 'checked' : ''}> 草稿</label>
      </div>
      <div class="actions">
        <button class="btn primary" id="save-post">保存文章</button>
        ${isNew ? '' : '<button class="btn danger" id="delete-post">删除文章</button>'}
      </div>
    </div>
  `

  const coverSelect = $('#post-cover')
  const updateCoverPreview = () => {
    $('#post-cover-preview').innerHTML = mediaMarkup(coverSelect.value, $('#post-title')?.value || '')
  }
  coverSelect.onchange = updateCoverPreview

  $('#back-posts').onclick = () => { VIEW = 'posts'; EDITING = null; render() }
  $('#post-cover-image').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const source = await readFileAsDataURL(file)
    openCropper({
      source,
      aspect: 16 / 9,
      target: `uploads/covers/${safeBase(slug || $('#post-title').value || 'post')}-${timestamp()}.jpg`,
      width: 1600,
      height: 900,
      onDone: (path) => {
        const option = document.createElement('option')
        option.value = path
        option.textContent = `刚上传：${path}`
        option.selected = true
        coverSelect.appendChild(option)
        updateCoverPreview()
      }
    })
  }
  $('#post-cover-video').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const path = await uploadVideo(file)
      const option = document.createElement('option')
      option.value = path
      option.textContent = `刚上传：${path}`
      option.selected = true
      coverSelect.appendChild(option)
      updateCoverPreview()
    } catch (error) { setStatus(error.message, 'error') }
  }
  const deletePostButton = $('#delete-post')
  if (deletePostButton) {
    deletePostButton.onclick = async () => {
      if (!confirm('删除这篇文章？')) return
      try {
        await postJson('/api/post/delete', { path: EDITING.path })
        VIEW = 'posts'; EDITING = null
        setStatus('文章已删除', 'ok')
        await reload()
      } catch (error) { setStatus(error.message, 'error') }
    }
  }
  $('#save-post').onclick = async () => {
    const title = $('#post-title').value.trim()
    if (!title) { setStatus('标题不能为空', 'error'); return }
    const categories = $('#post-categories').value.split(',').map((s) => s.trim()).filter(Boolean)
    const tags = $('#post-tags').value.split(',').map((s) => s.trim()).filter(Boolean)
    const frontMatter = {
      title,
      description: $('#post-description').value.trim(),
      date: $('#post-date').value.trim() || today(),
      lastmod: today(),
      author: $('#post-author').value.trim() || 'Claudian',
      categories: categories.length ? categories : ['随笔'],
      tags,
      cover: coverSelect.value || null,
      pinned: $('#post-pinned').checked,
      draft: $('#post-draft').checked
    }
    try {
      if (isNew) {
        await postJson('/api/post', {
          ...frontMatter,
          slug: $('#post-slug').value.trim() || title,
          body: $('#post-body').value
        })
      } else {
        await postJson('/api/content', {
          path: EDITING.path,
          frontMatter,
          body: $('#post-body').value
        })
      }
      VIEW = 'posts'; EDITING = null
      setStatus('文章已保存', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
}

function renderPages(view) {
  view.innerHTML = `
    <div class="card">
      <h2>页面</h2>
      <p class="muted">改页面的标题、头图和正文；归档/分类/标签主要改头图。</p>
      <table>
        <thead><tr><th>页面</th><th>标题</th><th>头图</th><th></th></tr></thead>
        <tbody>
          ${DATA.pages.map((page) => `
            <tr>
              <td><strong>${esc(page.label)}</strong><div class="code">${esc(page.path)}</div></td>
              <td>${esc(page.title)}</td>
              <td>${page.cover ? `<span class="code">${esc(page.cover)}</span>` : '<span class="muted">未设置</span>'}</td>
              <td><button class="btn small" data-edit-page="${esc(page.key)}">编辑</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
  $$('[data-edit-page]', view).forEach((button) => {
    button.onclick = () => openPageEditor(button.dataset.editPage)
  })
}

async function openPageEditor(key) {
  const page = DATA.pages.find((item) => item.key === key)
  if (!page) return
  try {
    const doc = await api(`/api/content?path=${encodeURIComponent(page.path)}`)
    EDITING = { page, doc }
    VIEW = 'page-edit'
    render()
  } catch (error) { setStatus(error.message, 'error') }
}

function renderPageEditor(view) {
  const page = EDITING.page
  const doc = EDITING.doc
  const fm = doc.frontMatter || {}
  view.innerHTML = `
    <div class="card">
      <div class="section-title"><h2>编辑：${esc(page.label)}</h2><button class="btn" id="back-pages">返回页面列表</button></div>
      <div class="field"><label>标题</label><input type="text" id="page-title" value="${esc(fm.title)}"></div>
      <div class="field"><label>头图</label><select id="page-cover">${mediaOptions(fm.cover, { empty: true })}</select></div>
      <div class="actions">
        <label class="btn small">上传头图<input type="file" id="page-cover-image" accept="image/*" hidden></label>
        <label class="btn small">上传视频<input type="file" id="page-cover-video" accept="video/mp4,video/webm,video/ogg" hidden></label>
      </div>
      <div class="preview" id="page-cover-preview" style="margin-top:10px">${mediaMarkup(fm.cover, fm.title)}</div>
      ${page.body ? `<div class="field" style="margin-top:12px"><label>正文 Markdown</label><textarea id="page-body" style="min-height:360px">${esc(doc.body || '')}</textarea></div>` : ''}
      <div class="actions"><button class="btn primary" id="save-page">保存页面</button></div>
    </div>
  `
  const coverSelect = $('#page-cover')
  const updatePreview = () => { $('#page-cover-preview').innerHTML = mediaMarkup(coverSelect.value, $('#page-title').value) }
  coverSelect.onchange = updatePreview
  $('#back-pages').onclick = () => { VIEW = 'pages'; EDITING = null; render() }
  $('#page-cover-image').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const source = await readFileAsDataURL(file)
    openCropper({
      source,
      aspect: 16 / 9,
      target: `uploads/covers/page-${safeBase(page.key)}-${timestamp()}.jpg`,
      width: 1600,
      height: 900,
      onDone: (path) => {
        const option = document.createElement('option')
        option.value = path
        option.textContent = `刚上传：${path}`
        option.selected = true
        coverSelect.appendChild(option)
        updatePreview()
      }
    })
  }
  $('#page-cover-video').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const path = await uploadVideo(file)
      const option = document.createElement('option')
      option.value = path
      option.textContent = `刚上传：${path}`
      option.selected = true
      coverSelect.appendChild(option)
      updatePreview()
    } catch (error) { setStatus(error.message, 'error') }
  }
  $('#save-page').onclick = async () => {
    const frontMatter = { title: $('#page-title').value.trim(), cover: coverSelect.value || null }
    const body = page.body ? $('#page-body').value : doc.body
    try {
      await postJson('/api/content', { path: page.path, frontMatter, body })
      VIEW = 'pages'; EDITING = null
      setStatus('页面已保存', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
}

function renderMedia(view) {
  view.innerHTML = `
    <div class="card">
      <div class="section-title">
        <div><h2>媒体库</h2><p class="muted small">图片可裁剪；视频用于 Hero 或页面封面。文件在 static/uploads 和 static/hero。</p></div>
        <div class="actions">
          <label class="btn">上传图片<input type="file" id="media-image" accept="image/*" hidden></label>
          <label class="btn">上传视频<input type="file" id="media-video" accept="video/mp4,video/webm,video/ogg" hidden></label>
        </div>
      </div>
      <div class="grid media-grid">
        ${DATA.media.map((item) => `
          <div class="media-card">
            <div class="preview">${mediaMarkup(item.path, item.name)}</div>
            <div class="path">${esc(item.path)}<br><span class="muted">${(item.size / 1024).toFixed(0)} KB</span></div>
            <div class="actions">
              ${item.kind === 'image' ? `<button class="btn small" data-crop="${esc(item.path)}">裁剪</button><button class="btn small" data-avatar="${esc(item.path)}">设为头像</button>` : ''}
              <button class="btn small" data-copy="${esc(item.path)}">复制路径</button>
              <button class="btn small danger" data-delete-media="${esc(item.path)}">删除</button>
            </div>
          </div>
        `).join('') || '<p class="muted">媒体库是空的。</p>'}
      </div>
    </div>
  `
  $('#media-image').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const dataUrl = await readFileAsDataURL(file)
      await postJson('/api/media/upload', { dataUrl, name: file.name })
      setStatus('图片已上传', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
  $('#media-video').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      await uploadVideo(file)
      setStatus('视频已上传', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
  $$('[data-crop]', view).forEach((button) => {
    button.onclick = () => {
      const source = button.dataset.crop
      openCropper({
        source,
        aspect: 16 / 9,
        target: `uploads/crops/${safeBase(source.split('/').pop())}-${timestamp()}.jpg`,
        width: 1600,
        height: 900,
        onDone: () => reload()
      })
    }
  })
  $$('[data-avatar]', view).forEach((button) => {
    button.onclick = () => {
      openCropper({
        source: button.dataset.avatar,
        aspect: 1,
        target: 'hero/avatar.png',
        width: 512,
        height: 512,
        update: 'avatar',
        onDone: reload
      })
    }
  })
  $$('[data-copy]', view).forEach((button) => {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
        setStatus('路径已复制', 'ok')
      } catch (_) { setStatus('复制失败，请手动复制', 'error') }
    }
  })
  $$('[data-delete-media]', view).forEach((button) => {
    button.onclick = async () => {
      if (!confirm(`删除 ${button.dataset.deleteMedia}？会先备份。`)) return
      try {
        await postJson('/api/media/delete', { rel: button.dataset.deleteMedia.replace(/^\//, '') })
        setStatus('已删除', 'ok')
        await reload()
      } catch (error) { setStatus(error.message, 'error') }
    }
  })
}

function noticeRowHtml(section = { label: '', lines: [] }) {
  return `
    <div class="notice-row">
      <div class="field"><label>标题</label><input type="text" data-notice-label value="${esc(section.label || '')}"></div>
      <div class="field"><label>行（每行一条）</label><textarea data-notice-lines>${esc((section.lines || []).join('\n'))}</textarea></div>
      <button class="btn small danger" data-remove-row>删除</button>
    </div>
  `
}

function socialRowHtml(item = {}) {
  return `
    <div class="social-row">
      <div class="field"><label>名称</label><input type="text" data-social-name value="${esc(item.name || '')}"></div>
      <div class="field"><label>链接</label><input type="text" data-social-link value="${esc(item.link || '')}"></div>
      <div class="field"><label>Iconify 图标</label><input type="text" data-social-icon value="${esc(item.icon || '')}"></div>
      <div class="field"><label>颜色</label><input type="text" data-social-color value="${esc(item.color || '')}"></div>
      <button class="btn small danger" data-remove-row>删除</button>
    </div>
  `
}

function renderAppearance(view) {
  const c = DATA.config
  view.innerHTML = `
    <form id="appearance-form">
      <div class="card">
        <h2>首页文案</h2>
        <div class="field"><label>Hero 标题</label><input type="text" id="hero-title" value="${esc(c.hero?.title)}"></div>
        <div class="field"><label>Hero 标语（每行一条，随机显示）</label><textarea id="hero-motto" style="min-height:160px">${esc((c.hero?.motto || []).join('\n'))}</textarea></div>
      </div>

      <div class="card">
        <div class="section-title"><h2>公告栏</h2><button class="btn small" type="button" id="add-notice">添加公告段</button></div>
        <div class="grid grid-2">
          <div class="field"><label>标题</label><input type="text" id="notice-title" value="${esc(c.notice?.title)}"></div>
          <div class="field"><label>轮播间隔（毫秒）</label><input type="number" id="notice-interval" value="${esc(c.notice?.rotateInterval)}"></div>
        </div>
        <div id="notice-rows">${(c.notice?.sections || []).map(noticeRowHtml).join('')}</div>
      </div>

      <div class="card">
        <div class="section-title"><h2>社交图标</h2><button class="btn small" type="button" id="add-social">添加</button></div>
        <div id="social-rows">${(c.social || []).map(socialRowHtml).join('')}</div>
      </div>

      <div class="card">
        <div class="section-title">
          <div><h2>音乐库</h2><p class="muted small">文件放 static/music/&lt;专辑&gt;/，命名「序号 - 曲名 - 作者.m4a」；同名 .lrc 和专辑 cover.jpg 会被播放器识别。</p></div>
          <div class="actions">
            ${(() => {
              const albums = [...new Set((DATA.musicFiles || []).map((item) => item.album).filter(Boolean))]
              const options = albums.length ? albums : ['芸开了']
              return `<select id="music-upload-album" aria-label="上传到专辑">${options.map((album) => `<option value="${esc(album)}" ${album === '芸开了' ? 'selected' : ''}>${esc(album)}</option>`).join('')}</select>`
            })()}
            <label class="btn">上传音乐<input type="file" id="music-file" accept=".mp3,.flac,.m4a,.ogg,.wav,audio/*" hidden></label>
            <button class="btn" type="button" id="rebuild-music">重建歌单</button>
          </div>
        </div>
        <div class="grid">
          ${(DATA.musicFiles || []).map((item) => `
            <div class="media-card">
              <div class="path">${esc(item.name)}<br><span class="muted">${esc(item.album || '未分类')} · ${(item.size / 1024 / 1024).toFixed(1)} MB</span></div>
              <audio controls preload="none" src="${esc(previewUrl(item.path))}" style="width:100%;margin:8px 0"></audio>
              <div class="actions"><button class="btn small danger" type="button" data-delete-music="${esc(item.name)}" data-delete-music-album="${esc(item.album || '')}">删除</button></div>
            </div>
          `).join('') || '<p class="muted">还没有音乐文件。</p>'}
        </div>
      </div>

      <div class="card">
        <h2>组件</h2>
        <div class="grid grid-2">
          <div class="field"><label class="check"><input type="checkbox" id="music-enable" ${c.music?.enable ? 'checked' : ''}> 启用音乐播放器</label></div>
          <div class="field"><label>播放器位置</label><select id="music-position"><option value="right" ${c.music?.position === 'right' ? 'selected' : ''}>右下</option><option value="left" ${c.music?.position === 'left' ? 'selected' : ''}>左下</option></select></div>
          <div class="field"><label class="check"><input type="checkbox" id="live2d-enable" ${c.live2d?.enable ? 'checked' : ''}> 启用 Live2D</label></div>
          <div class="field"><label>Live2D 最小宽度</label><input type="number" id="live2d-min-width" value="${esc(c.live2d?.minWidth)}"></div>
        </div>
      </div>

      <div class="card">
        <h2>评论</h2>
        <div class="grid grid-2">
          <div class="field"><label>Provider</label><select id="comment-provider"><option value="utterances" ${c.comment?.provider === 'utterances' ? 'selected' : ''}>utterances</option></select></div>
          <div class="field"><label>Utterances 仓库</label><input type="text" id="utterances-repo" value="${esc(c.utterances?.repo)}"></div>
          <div class="field"><label>Issue term</label><input type="text" id="utterances-term" value="${esc(c.utterances?.issueTerm)}"></div>
          <div class="field"><label>Label</label><input type="text" id="utterances-label" value="${esc(c.utterances?.label)}"></div>
        </div>
      </div>

      <div class="actions"><button class="btn primary" type="submit">保存外观设置</button></div>
    </form>
  `

  const bindRemove = (root) => {
    $$('[data-remove-row]', root).forEach((button) => {
      button.onclick = () => button.closest('.notice-row, .social-row').remove()
    })
  }
  bindRemove(view)
  $('#add-notice').onclick = () => {
    $('#notice-rows').insertAdjacentHTML('beforeend', noticeRowHtml())
    bindRemove(view)
  }
  $('#add-social').onclick = () => {
    $('#social-rows').insertAdjacentHTML('beforeend', socialRowHtml())
    bindRemove(view)
  }
  $('#music-file').onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const album = $('#music-upload-album')?.value || ''
      const response = await fetch(`/api/music/upload?name=${encodeURIComponent(file.name)}&album=${encodeURIComponent(album)}`, { method: 'POST', body: file })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
      setStatus('音乐已上传，记得重建歌单', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
  $('#rebuild-music').onclick = async () => {
    const data = await runAction('/api/music/rebuild')
    if (data.ok) {
      setStatus('歌单已重建', 'ok')
      await reload()
    } else {
      setStatus(data.error || data.stderr || '重建失败', 'error')
    }
  }
  $$('[data-delete-music]', view).forEach((button) => {
    button.onclick = async () => {
      if (!confirm('删除这首歌？')) return
      try {
        await postJson('/api/music/delete', { name: button.dataset.deleteMusic, album: button.dataset.deleteMusicAlbum || '' })
        setStatus('音乐已删除，记得重建歌单', 'ok')
        await reload()
      } catch (error) { setStatus(error.message, 'error') }
    }
  })
  $('#appearance-form').onsubmit = async (event) => {
    event.preventDefault()
    const noticeSections = $$('.notice-row', view).map((row) => ({
      label: $('[data-notice-label]', row).value.trim(),
      lines: $('[data-notice-lines]', row).value.split('\n').map((line) => line.trim()).filter(Boolean)
    }))
    const social = $$('.social-row', view).map((row) => ({
      name: $('[data-social-name]', row).value.trim(),
      link: $('[data-social-link]', row).value.trim(),
      icon: $('[data-social-icon]', row).value.trim(),
      color: $('[data-social-color]', row).value.trim()
    }))
    const config = {
      hero: {
        title: $('#hero-title').value.trim(),
        motto: $('#hero-motto').value.split('\n').map((line) => line.trim()).filter(Boolean)
      },
      notice: {
        title: $('#notice-title').value.trim(),
        rotateInterval: Number($('#notice-interval').value) || 5000,
        sections: noticeSections
      },
      social,
      music: { enable: $('#music-enable').checked, position: $('#music-position').value },
      live2d: { enable: $('#live2d-enable').checked, minWidth: Number($('#live2d-min-width').value) || 768 },
      comment: { provider: $('#comment-provider').value },
      utterances: {
        repo: $('#utterances-repo').value.trim(),
        issueTerm: $('#utterances-term').value.trim(),
        label: $('#utterances-label').value.trim()
      }
    }
    try {
      await postJson('/api/config', { config })
      setStatus('外观设置已保存', 'ok')
      await reload()
    } catch (error) { setStatus(error.message, 'error') }
  }
}

function renderPublish(view) {
  const git = DATA.git || {}
  const preview = DATA.preview || {}
  view.innerHTML = `
    <div class="card">
      <h2>构建与预览</h2>
      <div class="actions">
        <button class="btn primary" id="build-btn">构建站点</button>
        <button class="btn" id="preview-start">启动本地预览</button>
        <button class="btn" id="preview-stop">停止预览</button>
        <a class="btn" href="http://127.0.0.1:1313/" target="_blank" rel="noopener">打开 1313</a>
      </div>
      <p class="muted small">构建会执行 hugo --minify --cleanDestinationDir；预览会启动 hugo server -D。</p>
      <pre class="output" id="publish-output">${esc(preview.running ? '预览正在运行：http://127.0.0.1:1313/' : '还没有操作。')}</pre>
    </div>
    <div class="card">
      <h2>Git</h2>
      <p class="small">分支：<span class="code">${esc(git.branch || '-')}</span></p>
      <p class="small">最近提交：<span class="code">${esc(git.last || '无')}</span></p>
      <pre class="output">${esc(git.status || '工作区干净')}</pre>
      <div class="field"><label>提交说明</label><input type="text" id="commit-message" value="chore: update via admin"></div>
      <div class="actions">
        <button class="btn" id="git-refresh">刷新 Git 状态</button>
        <button class="btn primary" id="git-commit">提交全部改动</button>
        <button class="btn" id="git-push">推送</button>
      </div>
    </div>
  `
  const output = $('#publish-output')
  const show = (text) => { output.textContent = text }

  $('#build-btn').onclick = async () => {
    output.textContent = '构建中…'
    const data = await runAction('/api/build')
    show([data.stdout, data.stderr].filter(Boolean).join('\n') || (data.ok ? '构建成功。' : '构建失败。'))
    setStatus(data.ok ? '构建成功' : '构建失败', data.ok ? 'ok' : 'error')
  }
  $('#preview-start').onclick = async () => {
    const data = await runAction('/api/preview/start')
    if (data.ok) {
      DATA.preview = { running: true, url: data.url, logs: [] }
      show('预览已启动：http://127.0.0.1:1313/')
      setStatus('预览已启动', 'ok')
    } else {
      show(data.error || '启动失败')
      setStatus('启动预览失败', 'error')
    }
  }
  $('#preview-stop').onclick = async () => {
    const data = await runAction('/api/preview/stop')
    if (data.ok) {
      DATA.preview = { running: false }
      show('预览已停止。')
      setStatus('预览已停止', 'ok')
    } else {
      show(data.error || '停止失败')
    }
  }
  $('#git-refresh').onclick = async () => {
    const data = await runAction('/api/git', { action: 'status' })
    if (data.ok) {
      DATA.git = data.git
      render()
      setStatus('Git 状态已刷新', 'ok')
    } else setStatus(data.error || '刷新失败', 'error')
  }
  $('#git-commit').onclick = async () => {
    const data = await runAction('/api/git', { action: 'commit', message: $('#commit-message').value })
    if (data.git) DATA.git = data.git
    show([data.add?.stdout, data.add?.stderr, data.commit?.stdout, data.commit?.stderr, data.error].filter(Boolean).join('\n') || '提交完成。')
    setStatus(data.ok ? '已提交' : '提交失败', data.ok ? 'ok' : 'error')
    if (data.ok) render()
  }
  $('#git-push').onclick = async () => {
    output.textContent = '推送中…'
    const data = await runAction('/api/git', { action: 'push' })
    if (data.git) DATA.git = data.git
    show([data.push?.stdout, data.push?.stderr, data.error].filter(Boolean).join('\n') || '推送完成。')
    setStatus(data.ok ? '已推送' : '推送失败', data.ok ? 'ok' : 'error')
    if (data.ok) render()
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function uploadVideo(file) {
  const response = await fetch(`/api/media/video?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file
  })
  const data = await response.json()
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data.media.path
}

function closeModal() {
  const root = $('#modal-root')
  if (root) root.innerHTML = ''
}

function openCropper({ source, aspect = 16 / 9, target, width, height, update = '', onDone = null }) {
  const root = $('#modal-root')
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>裁剪图片</h2>
        <p class="help">拖动图片调整位置，滑块缩放。裁剪框就是最终画面。</p>
        <canvas id="crop-canvas"></canvas>
        <div class="crop-tools">
          <span class="muted small">缩放</span>
          <input type="range" id="crop-zoom" min="1" max="3" step="0.01" value="1">
          <span class="muted small" id="crop-zoom-label">1.00×</span>
        </div>
        <div class="modal-actions">
          <button class="btn" id="crop-cancel">取消</button>
          <button class="btn primary" id="crop-save">保存裁剪</button>
        </div>
      </div>
    </div>
  `
  const canvas = $('#crop-canvas')
  const ctx = canvas.getContext('2d')
  const displayWidth = 720
  canvas.width = displayWidth
  canvas.height = Math.round(displayWidth / aspect)
  const img = new Image()
  let scale = 1
  let minScale = 1
  let offsetX = 0
  let offsetY = 0
  let dragging = false
  let dragStart = null

  const clampOffsets = () => {
    const drawnW = img.naturalWidth * scale
    const drawnH = img.naturalHeight * scale
    offsetX = Math.min(0, Math.max(canvas.width - drawnW, offsetX))
    offsetY = Math.min(0, Math.max(canvas.height - drawnH, offsetY))
  }
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#0d0f14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (!img.naturalWidth) return
    ctx.drawImage(img, offsetX, offsetY, img.naturalWidth * scale, img.naturalHeight * scale)
  }
  const applyZoom = (value) => {
    const centerX = (canvas.width / 2 - offsetX) / scale
    const centerY = (canvas.height / 2 - offsetY) / scale
    scale = minScale * Number(value)
    offsetX = canvas.width / 2 - centerX * scale
    offsetY = canvas.height / 2 - centerY * scale
    clampOffsets()
    draw()
  }
  img.onload = () => {
    minScale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
    scale = minScale
    offsetX = (canvas.width - img.naturalWidth * scale) / 2
    offsetY = (canvas.height - img.naturalHeight * scale) / 2
    draw()
  }
  img.onerror = () => setStatus('图片加载失败', 'error')
  img.src = source.startsWith('data:') ? source : previewUrl(source)

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true
    dragStart = { x: event.clientX, y: event.clientY, offsetX, offsetY }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || !dragStart) return
    offsetX = dragStart.offsetX + (event.clientX - dragStart.x)
    offsetY = dragStart.offsetY + (event.clientY - dragStart.y)
    clampOffsets()
    draw()
  })
  const endDrag = () => { dragging = false; dragStart = null }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  $('#crop-zoom').oninput = (event) => {
    $('#crop-zoom-label').textContent = `${Number(event.target.value).toFixed(2)}×`
    applyZoom(event.target.value)
  }
  $('#crop-cancel').onclick = closeModal
  $('.modal-backdrop').onclick = (event) => { if (event.target === event.currentTarget) closeModal() }
  $('#crop-save').onclick = async () => {
    if (!img.naturalWidth) return
    const button = $('#crop-save')
    button.disabled = true
    try {
      const crop = {
        x: Math.max(0, (0 - offsetX) / scale),
        y: Math.max(0, (0 - offsetY) / scale),
        width: Math.min(img.naturalWidth, canvas.width / scale),
        height: Math.min(img.naturalHeight, canvas.height / scale)
      }
      const data = await postJson('/api/crop', { source, crop, target, width, height, update })
      closeModal()
      setStatus('图片已保存', 'ok')
      if (update) await reload()
      else if (onDone) await onDone(data.media.path)
    } catch (error) {
      button.disabled = false
      setStatus(error.message, 'error')
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $$('.nav button').forEach((button) => {
    button.onclick = () => {
      VIEW = button.dataset.view
      EDITING = null
      render()
    }
  })
  reload()
})
