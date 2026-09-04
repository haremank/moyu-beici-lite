'use strict'
// 摸鱼背词 Lite — qwerty-learner 离线桌面壳
// 功能：本地静态服务 + 学习主窗口 + 透明摸鱼悬浮窗 + 老板键 + 托盘 + 自定义词书导入
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, nativeImage, screen } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { parseDictFile } = require('./lib/importer')

app.setName('moyu-lite')

const WEB_ROOT = process.env.MOYU_WEB_ROOT
  || (app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'qwerty-learner', 'build'))
const CUSTOM_DIR = path.join(WEB_ROOT, 'dicts', 'custom')
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json')
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json')

const DEFAULT_CONFIG = {
  bossHide: 'Alt+Q', // 一键隐身 / 恢复
  bossQuit: 'Alt+X', // 一键退出
  opacityUp: 'Alt+Up', // 透明度 +
  opacityDown: 'Alt+Down', // 透明度 -
  miniToggle: 'Alt+M', // 迷你模式
  clickThrough: 'Alt+C', // 鼠标穿透
  keyKnow: 'Alt+2', // 标记认识
  keyWrong: 'Alt+1', // 标记不认识
  keyMaster: 'Alt+3', // 标记熟记（该词从此不再出现）
  autoAdvanceSeconds: 60,
  hideOnMouseOut: false,
  opacity: 0.95, // 悬停时整窗不透明度
  idleOpacity: 0.15, // 未悬停时整窗不透明度（隐身程度）
  textIdleOpacity: 0, // 未悬停时文字透明度（0=完全隐藏）
  textHoverOpacity: 1, // 悬停时文字透明度
  textGlow: true, // 单词发光（text-shadow）
  wordColor: '#7ae6ac', // 单词颜色
  subColor: '#aeb7c2', // 辅助文字颜色（计数/提示）
  transColor: '#d7dce2', // 释义颜色
  transSize: 15, // 释义字号
  transWeight: 400, // 释义字重
  transLines: 2, // 释义最多显示行数（超出省略号截断）
  hideHint: false, // 隐藏底部按键说明行
  hideKnowBtns: false, // 隐藏认识/不认识按钮（热键仍可用）
  wheelSwitch: true, // 滚轮切词开关
  bgColor: '#1e2228', // 卡片背景色
  wordFont: 'Consolas', // 单词字体
  wordFontWeight: 800, // 单词字重
  bookId: null, // null = 跟随主窗口的词库/章节；否则为固定词书 id
}
let config = { ...DEFAULT_CONFIG }
let state = { books: {} }

let mainWin = null
let floatWin = null
let tray = null
let server = null
let serverPort = 0
let mouseOutTimer = null
let floatMini = false
let floatClickThrough = false
function floatEvent(name, data) { if (floatWin) floatWin.webContents.send('float-event', name, data) }
function rememberFloatBounds() {
  if (!floatWin) return
  const b = floatWin.getBounds()
  config.floatBounds = { x: b.x, y: b.y, w: b.width, h: b.height }
  saveConfig()
}

function log(...args) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'moyu-lite.log'), `[${new Date().toISOString()}] ${args.join(' ')}\n`)
  } catch {}
}
function loadJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch { return fallback }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)) } catch (e) { log('saveJson失败', file, e.message) }
}
function saveConfig() { saveJson(CONFIG_FILE(), config) }
function saveState() { saveJson(STATE_FILE(), state) }

// ---------- 词书 ----------
const CURATED_BUILTIN = [
  { file: 'CET4_T.json', name: 'CET-4（内置）' },
  { file: 'CET6_T.json', name: 'CET-6（内置）' },
  { file: '2025KaoYanHongBaoShu.json', name: '考研词汇（内置）' },
  { file: 'Categorized_TOEFL_Vocabulary_by_Zhanghongyan.json', name: 'TOEFL（内置）' },
  { file: 'GRE3000_3_T.json', name: 'GRE3000（内置）' },
  { file: 'DuckCircle_IELTS.json', name: 'IELTS（内置）' },
]

function listCustomBooks() {
  try { return JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, 'index.json'), 'utf8')) } catch { return [] }
}
function listBooks() {
  const custom = listCustomBooks()
  const builtin = CURATED_BUILTIN.filter((b) => fs.existsSync(path.join(WEB_ROOT, 'dicts', b.file))).map((b) => ({
    id: 'builtin:' + b.file,
    name: b.name,
    url: '/dicts/' + b.file,
    length: 0,
  }))
  return [...custom, ...builtin]
}
function readBookEntries(bookId) {
  const book = listBooks().find((b) => b.id === bookId)
  if (!book) return null
  const file = path.join(WEB_ROOT, book.url.replace(/^\//, '').replace(/\//g, path.sep))
  try { return { book, words: JSON.parse(fs.readFileSync(file, 'utf8')) } } catch (e) { log('词书读取失败', bookId, e.message); return null }
}
function rebuildCustomIndex() {
  fs.mkdirSync(CUSTOM_DIR, { recursive: true })
  const entries = []
  for (const f of fs.readdirSync(CUSTOM_DIR)) {
    if (!f.endsWith('.json') || f === 'index.json') continue
    try {
      const words = JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, f), 'utf8'))
      entries.push({
        id: 'custom:' + f.replace(/\.json$/, ''),
        name: f.replace(/\.json$/, ''),
        description: `导入词书，共 ${words.length} 词`,
        category: '自定义',
        tags: ['自定义'],
        url: '/dicts/custom/' + f,
        length: words.length,
        language: 'en',
        languageCategory: 'en',
      })
    } catch (e) { log('跳过损坏词书', f, e.message) }
  }
  fs.writeFileSync(path.join(CUSTOM_DIR, 'index.json'), JSON.stringify(entries, null, 2))
  return entries
}
function fallbackBookId() {
  if (config.bookId) return config.bookId
  const books = listBooks()
  return books.length ? books[0].id : null
}

// ---------- 跟随主窗口的词库/章节 ----------
// qwerty-learner 把当前词库 id 存在 localStorage.currentDict、章节号存在 currentChapter（0 基）
const CHAPTER_LENGTH = 20 // qwerty-learner/src/constants CHAPTER_LENGTH
let syncInfo = { dictId: null, chapter: -1 }
let syncedBook = { dictId: null, chapter: 0, name: '', words: null }
let dictInfoMap = null

function buildDictInfoMap() {
  // 从 qwerty-learner 源码解析 id → {name, url} 映射（词书资源声明的唯一权威位置）
  // 打包模式下 dictionary.ts 作为额外资源放在 resources 根目录
  try {
    const src = fs.readFileSync(
      app.isPackaged ? path.join(process.resourcesPath, 'dictionary.ts') : path.join(WEB_ROOT, '..', 'src', 'resources', 'dictionary.ts'),
      'utf8')
    const map = {}
    const re = /id:\s*'([^']+)',\s*\n\s*name:\s*'([^']+)'[\s\S]{0,300}?url:\s*'([^']+)'/g
    let m
    while ((m = re.exec(src))) map[m[1]] = { name: m[2], url: m[3] }
    return map
  } catch (e) { log('词库映射解析失败', e.message); return {} }
}
function resolveDict(dictId) {
  if (!dictId) return null
  if (dictId.startsWith('custom:')) {
    const b = listCustomBooks().find((x) => x.id === dictId)
    return b ? { name: b.name, url: b.url } : null
  }
  if (!dictInfoMap) dictInfoMap = buildDictInfoMap()
  return dictInfoMap[dictId] || null
}
function loadWordsByUrl(url) {
  try { return JSON.parse(fs.readFileSync(path.join(WEB_ROOT, url.replace(/^\//, '').replace(/\//g, path.sep)), 'utf8')) } catch { return null }
}
function applySyncBook(dictId, chapter) {
  const info = resolveDict(dictId)
  if (!info) return
  const all = loadWordsByUrl(info.url)
  if (!all || !all.length) return
  const start = (chapter || 0) * CHAPTER_LENGTH
  const words = all.slice(start, start + CHAPTER_LENGTH)
  if (!words.length) return
  syncedBook = { dictId, chapter: chapter || 0, name: info.name, words }
  log('同步词书:', dictId, '章节', chapter || 0, '共', words.length, '词')
  floatEvent('sync-book', {})
}
async function pollMainSelection(force = false) {
  if (!mainWin) return
  try {
    const raw = await mainWin.webContents.executeJavaScript(
      `JSON.stringify({ d: localStorage.getItem('currentDict'), c: localStorage.getItem('currentChapter') })`, true)
    const sel = JSON.parse(raw || '{}')
    const parseLS = (v) => { if (v == null) return null; try { return JSON.parse(v) } catch { return v } }
    // ql 只在手动切换过词库后才写 localStorage；未切换时回退到其默认词库 cet4
    const dictId = parseLS(sel.d) || 'cet4'
    const rawC = parseLS(sel.c)
    const chapter = rawC == null || isNaN(Number(rawC)) ? 0 : Number(rawC)
    if (!force && dictId === syncInfo.dictId && chapter === syncInfo.chapter) return
    syncInfo = { dictId, chapter }
    if (config.bookId != null) return // 固定词书模式下不同步
    applySyncBook(dictId, chapter)
  } catch {}
}

// 当前生效的词书：跟随模式用 syncedBook，固定模式用 config.bookId
// 熟记（state.mastered）是词级别的全局状态：标记过的词在所有词书中不再出现
function getActiveBook() {
  state.mastered = state.mastered || {}
  let entry = null
  if (config.bookId == null && syncedBook.words && syncedBook.words.length) {
    entry = { id: `sync:${syncedBook.dictId}#${syncedBook.chapter}`, name: syncedBook.name, words: syncedBook.words }
  } else {
    const bookId = fallbackBookId()
    const loaded = bookId ? readBookEntries(bookId) : null
    if (loaded) entry = { id: bookId, name: loaded.book.name, words: loaded.words }
  }
  if (!entry) return null
  const words = entry.words.filter((w) => !state.mastered[w.name])
  if (!words.length) return { id: entry.id, name: entry.name, words, allMastered: true }
  const st = (state.books[entry.id] = state.books[entry.id] || { idx: 0, known: {}, wrong: {} })
  st.wrong = st.wrong || {}
  const book = { id: entry.id, name: entry.name, words }
  ensureOrdered(book, st)
  return book
}

// ---------- 错词优先重现 ----------
// 词序只在内存中维护：换书/换章/词集变化（熟记增减）时重建，错过的词按错误次数排最前；
// 标记"不认识"时把该词插到当前位置后第 2 位，翻 1~2 个词就能再见到它（见 float:markWrong）
let orderCache = { key: null, sig: '', list: [] }
function orderSig(words) {
  const first = words.length ? words[0].name : ''
  const last = words.length ? words[words.length - 1].name : ''
  return `${words.length}#${first}#${last}`
}
function ensureOrdered(book, st) {
  const sig = orderSig(book.words)
  if (orderCache.key !== book.id || orderCache.sig !== sig) {
    const sameBook = orderCache.key === book.id
    // 同一本书词集变化（如熟记删词）触发重排时，记住"原定下一个词"，重排后仍从它继续展示
    const anchor = sameBook && orderCache.list.length
      ? orderCache.list[Math.min((st.idx || 0) + 1, orderCache.list.length - 1)]
      : null
    const wrong = st.wrong || {}
    orderCache = {
      key: book.id,
      sig,
      list: book.words
        .map((w, i) => ({ w, i, c: wrong[w.name] || 0 }))
        .sort((a, b) => (b.c - a.c) || (a.i - b.i))
        .map((x) => x.w),
    }
    if (anchor) {
      const p = orderCache.list.findIndex((w) => w.name === anchor.name)
      if (p >= 0) st.idx = p
    }
    const wrongCount = book.words.filter((w) => wrong[w.name]).length
    log('词序重排: 错词', wrongCount, '个优先 / 共', book.words.length, '词')
  }
  book.words = orderCache.list
  st.idx = Math.max(0, Math.min(st.idx || 0, book.words.length - 1))
}

// ---------- 悬浮窗数据 IPC ----------
ipcMain.handle('float:getData', () => {
  const active = getActiveBook()
  if (!active || !active.words.length) {
    const msg = active && active.allMastered ? '本章已全部熟记 ✓ 切换章节继续' : '暂无词书：请在托盘菜单「导入词书」'
    return { empty: true, message: msg }
  }
  const st = (state.books[active.id] = state.books[active.id] || { idx: 0, known: {}, wrong: {} })
  st.wrong = st.wrong || {}
  st.idx = Math.min(st.idx || 0, active.words.length - 1)
  const knownCount = Object.keys(st.known).length
  const wrongCount = Object.keys(st.wrong).length
  return {
    empty: false,
    bookId: active.id,
    bookName: active.name,
    total: active.words.length,
    idx: st.idx,
    knownCount,
    wrongCount,
    masteredCount: Object.keys(state.mastered).length,
    word: active.words[st.idx],
    autoAdvanceSeconds: config.autoAdvanceSeconds,
    hideOnMouseOut: config.hideOnMouseOut,
    idleOpacity: config.idleOpacity,
    hoverOpacity: config.opacity,
    textIdleOpacity: config.textIdleOpacity,
    textHoverOpacity: config.textHoverOpacity,
    textGlow: config.textGlow,
    wordColor: config.wordColor,
    subColor: config.subColor,
    transColor: config.transColor,
    transSize: config.transSize,
    transWeight: config.transWeight,
    transLines: config.transLines,
    hideHint: config.hideHint,
    hideKnowBtns: config.hideKnowBtns,
    wheelSwitch: config.wheelSwitch,
    bgColor: config.bgColor,
    wordFont: config.wordFont,
    wordFontWeight: config.wordFontWeight,
  }
})
ipcMain.handle('float:next', (e, { dir = 1 } = {}) => {
  const active = getActiveBook()
  if (!active || !active.words.length) return { ok: false }
  const { words } = active
  const st = (state.books[active.id] = state.books[active.id] || { idx: 0, known: {}, wrong: {} })
  st.wrong = st.wrong || {}
  let tries = 0
  do { st.idx = (st.idx + dir + words.length) % words.length; tries++ } while (st.known[words[st.idx].name] && tries < words.length)
  saveState()
  return { ok: true, idx: st.idx, total: words.length, knownCount: Object.keys(st.known).length, wrongCount: Object.keys(st.wrong).length, word: words[st.idx] }
})
ipcMain.handle('float:markKnown', () => {
  const active = getActiveBook()
  if (!active || !active.words.length) return { ok: false }
  const { words } = active
  const st = (state.books[active.id] = state.books[active.id] || { idx: 0, known: {}, wrong: {} })
  st.wrong = st.wrong || {}
  const name = words[st.idx].name
  st.known[name] = true
  delete st.wrong[name] // 修正：之前点过"不认识"的话改正过来
  saveState()
  return { ok: true, knownCount: Object.keys(st.known).length, wrongCount: Object.keys(st.wrong).length }
})
ipcMain.handle('float:markWrong', () => {
  const active = getActiveBook()
  if (!active || !active.words.length) return { ok: false }
  const { words } = active
  const st = (state.books[active.id] = state.books[active.id] || { idx: 0, known: {}, wrong: {} })
  st.wrong = st.wrong || {}
  const word = words[st.idx]
  const name = word.name
  st.wrong[name] = (st.wrong[name] || 0) + 1
  delete st.known[name] // 修正：之前点过"认识"的话改正过来
  // 错词优先重现：把该词挪到当前位置后第 2 位，翻 1~2 个词就会再次出现
  const p = words.findIndex((w) => w.name === name)
  if (p >= 0) {
    words.splice(p, 1)
    const q = Math.min(st.idx + 2, words.length)
    words.splice(q, 0, word)
    log('错词重现:', name, '→ 第', q + 1, '位（共', words.length, '词）')
  }
  saveState()
  return { ok: true, knownCount: Object.keys(st.known).length, wrongCount: Object.keys(st.wrong).length }
})
ipcMain.handle('float:markMaster', () => {
  const active = getActiveBook()
  if (!active || !active.words.length) return { ok: false }
  const { words } = active
  const st = (state.books[active.id] = state.books[active.id] || { idx: 0, known: {}, wrong: {} })
  st.wrong = st.wrong || {}
  const name = words[st.idx].name
  state.mastered = state.mastered || {}
  state.mastered[name] = true // 词级永久状态：所有词书中不再出现
  delete st.known[name]
  delete st.wrong[name]
  saveState()
  return { ok: true, knownCount: Object.keys(st.known).length, wrongCount: Object.keys(st.wrong).length, masteredCount: Object.keys(state.mastered).length }
})
ipcMain.handle('float:growBy', (e, { dx = 0, dy = 0 } = {}) => {
  if (!floatWin) return { ok: false }
  const b = floatWin.getBounds()
  const w = Math.max(280, Math.min(900, b.width + Math.round(dx)))
  const h = Math.max(90, Math.min(700, b.height + Math.round(dy)))
  if (w !== b.width || h !== b.height) {
    floatWin.setResizable(true)
    floatWin.setSize(w, h)
    floatWin.setResizable(false)
    rememberFloatBounds()
  }
  return { ok: true }
})
ipcMain.handle('float:moveBy', (e, { dx = 0, dy = 0 } = {}) => {
  if (floatWin) {
    const b = floatWin.getBounds()
    floatWin.setPosition(b.x + Math.round(dx), b.y + Math.round(dy))
  }
  return { ok: true }
})
ipcMain.handle('float:hover', (e, { inside } = {}) => {
  // 仅服务于"鼠标移出自动隐藏"；平时/悬停双态透明由渲染层 CSS 实现
  if (config.hideOnMouseOut && floatWin) {
    if (inside) { if (mouseOutTimer) { clearTimeout(mouseOutTimer); mouseOutTimer = null } }
    else if (!mouseOutTimer) {
      mouseOutTimer = setTimeout(() => { mouseOutTimer = null; if (floatWin) floatWin.hide(); broadcastFloatState() }, 2000)
    }
  }
  return { ok: true }
})
ipcMain.handle('float:patchConfig', (e, { key, value } = {}) => {
  const allowed = ['idleOpacity', 'opacity', 'textIdleOpacity', 'textHoverOpacity', 'textGlow', 'wordColor', 'subColor', 'transColor', 'transSize', 'transWeight', 'transLines', 'hideHint', 'hideKnowBtns', 'wheelSwitch', 'bgColor', 'wordFont', 'wordFontWeight']
  if (!allowed.includes(key)) return { ok: false }
  config[key] = value
  saveConfig()
  return { ok: true }
})
ipcMain.handle('float:expand', (e, { h } = {}) => {
  if (!floatWin) return { ok: false }
  const target = Math.max(56, Math.min(700, Number(h) || 150)) // 上限 700 与 grip 缩放一致，恢复用户拖大的高度不被钳掉
  const b = floatWin.getBounds()
  floatWin.setResizable(true)
  floatWin.setSize(b.width, target)
  floatWin.setResizable(false)
  return { ok: true }
})

// ---------- 主界面"词窗开关"按钮 ----------
// 在 qwerty-learner 页面注入一个固定位置的开关按钮，点击切换悬浮窗显隐
function broadcastFloatState() {
  if (mainWin) mainWin.webContents.send('host:float-visible', !!(floatWin && floatWin.isVisible()))
}
function injectFloatToggle() {
  if (!mainWin) return
  mainWin.webContents.executeJavaScript(`(function(){
    if (document.getElementById('moyu-float-toggle')) return
    const b = document.createElement('button')
    b.id = 'moyu-float-toggle'
    b.title = '开/关 摸鱼单词悬浮窗'
    const paint = (v) => { b.textContent = v ? '● 词窗 开' : '○ 词窗 关'; b.classList.toggle('off', !v) }
    b.addEventListener('click', () => window.moyuHost && window.moyuHost.toggleFloat())
    if (window.moyuHost && window.moyuHost.onFloatVisible) window.moyuHost.onFloatVisible(paint)
    document.body.appendChild(b)
    const st = document.createElement('style')
    st.textContent = '#moyu-float-toggle{position:fixed;bottom:12px;right:12px;z-index:2147483647;background:rgba(30,34,40,.88);color:#7ae6ac;border:1px solid rgba(122,230,172,.4);border-radius:14px;padding:3px 12px;font-size:12px;cursor:pointer;font-family:Microsoft YaHei,sans-serif}#moyu-float-toggle.off{color:#8a93a0;border-color:rgba(255,255,255,.15)}'
    document.head.appendChild(st)
    if (window.moyuHost) window.moyuHost.currentFloatVisible().then(paint).catch(function(){})
  })()`, true).catch((e) => log('注入词窗开关失败', e.message))
}
ipcMain.handle('host:toggleFloat', () => {
  if (floatWin) floatWin.isVisible() ? floatWin.hide() : floatWin.show()
  broadcastFloatState()
  return !!(floatWin && floatWin.isVisible())
})
ipcMain.handle('host:currentFloatVisible', () => !!(floatWin && floatWin.isVisible()))

// ---------- 静态服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg',
}
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
        rel = rel.replace(/\.\./g, '') // 防目录穿越
        const file = path.join(WEB_ROOT, rel.replace(/\//g, path.sep))
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return }
        const noCache = file.startsWith(CUSTOM_DIR)
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600' })
        fs.createReadStream(file).pipe(res)
      } catch (e) { res.writeHead(500); res.end('error') }
    })
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port
      log('静态服务已启动', serverPort)
      resolve()
    })
  })
}

// ---------- 窗口 ----------
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280, height: 820, show: false, autoHideMenuBar: true, title: '摸鱼背词 Lite',
    webPreferences: { preload: path.join(__dirname, 'host-preload.js'), contextIsolation: true },
  })
  mainWin.loadURL(`http://127.0.0.1:${serverPort}/`)
  mainWin.webContents.on('did-fail-load', (e, code, desc, url) => log('主窗口加载失败', code, desc, url))
  mainWin.webContents.on('did-finish-load', () => { log('主窗口加载完成'); injectFloatToggle() })
  mainWin.webContents.on('console-message', (e, lv, msg) => { if (lv >= 2) log('[main渲染]', msg) })
  const forceShowTimer = setTimeout(() => { if (mainWin && !mainWin.isVisible()) { log('主窗口5秒未就绪，强制显示'); mainWin.show() } }, 5000)
  mainWin.once('ready-to-show', () => { clearTimeout(forceShowTimer); log('主窗口 ready-to-show'); mainWin.show() })
  mainWin.on('closed', () => { mainWin = null })
}
function createFloatWindow() {
  const wa = screen.getPrimaryDisplay().workArea
  const fb = config.floatBounds || {}
  const dw = fb.w || 480, dh = fb.h || 170
  const pos = fb.x != null ? { x: fb.x, y: fb.y } : { x: wa.x + wa.width - dw - 48, y: wa.y + wa.height - dh - 60 }
  floatWin = new BrowserWindow({
    width: dw, height: dh, show: false, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: false,
    x: pos.x, y: pos.y,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  floatWin.setAlwaysOnTop(true, 'screen-saver')
  floatWin.loadFile(path.join(__dirname, 'float.html'))
  let boundsTimer = null
  floatWin.on('move', () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(rememberFloatBounds, 500)
  })
  floatWin.webContents.on('did-fail-load', (e, code, desc, url) => log('悬浮窗加载失败', code, desc, url))
  floatWin.webContents.on('console-message', (e, lv, msg) => log('[float渲染]', msg))
  floatWin.once('ready-to-show', () => { log('悬浮窗 ready-to-show'); floatWin.show() })
  floatWin.on('closed', () => { floatWin = null; broadcastFloatState() })
}

// ---------- 托盘 ----------
function trayIcon() {
  try { return nativeImage.createFromPath(path.join(__dirname, 'tray.png')) } catch { return nativeImage.createEmpty() }
}
function buildTrayMenu() {
  const books = listBooks()
  const followItem = {
    label: '跟随主窗口（词库/章节）', type: 'radio', checked: config.bookId == null,
    click: () => { config.bookId = null; saveConfig(); pollMainSelection(true); if (floatWin) floatWin.reload() },
  }
  const bookItems = [followItem, ...books.slice(0, 40).map((b) => ({
    label: b.name + (b.length ? ` (${b.length})` : ''), type: 'radio', checked: config.bookId === b.id,
    click: () => { config.bookId = b.id; saveConfig(); if (floatWin) floatWin.reload() },
  }))]
  const opacityItems = [100, 85, 70, 55, 40].map((v) => ({
    label: v + '%', type: 'radio', checked: Math.round(config.opacity * 100) === v,
    click: () => { config.opacity = v / 100; saveConfig(); floatEvent('hover-opacity', config.opacity); buildTrayMenu() },
  }))
  const advanceItems = [
    { label: '关闭自动切词', v: 0 }, { label: '30 秒', v: 30 }, { label: '60 秒', v: 60 }, { label: '120 秒', v: 120 },
  ].map((it) => ({
    label: it.label, type: 'radio', checked: config.autoAdvanceSeconds === it.v,
    click: () => { config.autoAdvanceSeconds = it.v; saveConfig(); if (floatWin) floatWin.reload(); buildTrayMenu() },
  }))
  const menu = Menu.buildFromTemplate([
    { label: '学习主窗口', click: showMain },
    { label: '显示 / 隐藏悬浮窗', click: () => { if (floatWin) floatWin.isVisible() ? floatWin.hide() : floatWin.show(); broadcastFloatState() } },
    { label: '下一个单词', click: () => floatEvent('do-next') },
    { type: 'separator' },
    { label: '悬浮窗词书', submenu: bookItems.length ? bookItems : [{ label: '（暂无，请先导入）', enabled: false }] },
    { label: '自动切词', submenu: advanceItems },
    { label: '悬停时透明度', submenu: opacityItems },
    { label: '迷你模式（只留单词）', type: 'checkbox', checked: floatMini, click: toggleMini },
    { label: '鼠标穿透（悬浮窗不挡点击）', type: 'checkbox', checked: floatClickThrough, click: toggleClickThrough },
    { label: '鼠标移出悬浮窗自动隐藏', type: 'checkbox', checked: config.hideOnMouseOut,
      click: (it) => { config.hideOnMouseOut = it.checked; saveConfig(); if (floatWin) floatWin.reload() } },
    { type: 'separator' },
    { label: '导入词书…（txt / csv / json）', click: importDict },
    { label: `老板键：${config.bossHide} 隐身 · ${config.bossQuit} 退出 · ${config.opacityUp}/${config.opacityDown} 透明度`, enabled: false },
    { label: `　　　　${config.miniToggle} 迷你 · ${config.clickThrough} 穿透`, enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
}
function showMain() {
  if (!mainWin) createMainWindow()
  else { mainWin.show(); mainWin.focus() }
}

// ---------- 导入 ----------
async function importDict() {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '导入词书', properties: ['openFile'],
    filters: [{ name: '词书文件 (txt/csv/json)', extensions: ['txt', 'csv', 'json'] }],
  })
  if (r.canceled || !r.filePaths[0]) return
  try {
    const entries = parseDictFile(r.filePaths[0])
    if (!entries.length) throw new Error('没有解析到任何单词，请检查文件格式')
    const stem = (path.basename(r.filePaths[0], path.extname(r.filePaths[0])).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)) || 'book'
    fs.mkdirSync(CUSTOM_DIR, { recursive: true })
    let id = stem, n = 1
    while (fs.existsSync(path.join(CUSTOM_DIR, id + '.json'))) id = `${stem}_${++n}`
    fs.writeFileSync(path.join(CUSTOM_DIR, id + '.json'), JSON.stringify(entries))
    rebuildCustomIndex()
    config.bookId = 'custom:' + id
    saveConfig()
    buildTrayMenu()
    if (mainWin) mainWin.webContents.reload()
    dialog.showMessageBox(mainWin, { type: 'info', title: '导入成功', message: `已导入《${stem}》：${entries.length} 个单词`, detail: '悬浮窗已切换到新书；主窗口词书列表也已刷新（在“词库”分类的“自定义”下）。' })
  } catch (e) {
    dialog.showErrorBox('导入失败', String(e.message || e))
  }
}

// ---------- 隐藏功能开关 ----------
// Alt+↑/↓ 调的是"悬停"档透明度，渲染层 CSS 应用
function adjustOpacity(delta) {
  config.opacity = Math.min(1, Math.max(0.2, Math.round((config.opacity + delta) * 100) / 100))
  saveConfig()
  floatEvent('hover-opacity', config.opacity)
  buildTrayMenu()
}
function toggleMini() {
  floatMini = !floatMini
  log('toggleMini ->', floatMini)
  if (floatWin) {
    const [w, h] = floatMini ? [300, 56] : [config.floatBounds?.w || 480, config.floatBounds?.h || 170]
    // Windows 下 resizable:false 会让 setSize 失效，需临时解除
    floatWin.setResizable(true)
    floatWin.setSize(w, h)
    floatWin.setResizable(false)
    const b = floatWin.getBounds()
    log('setSize done, bounds =', b.width, 'x', b.height)
    floatEvent('mini', floatMini)
  }
  buildTrayMenu()
}
function toggleClickThrough() {
  floatClickThrough = !floatClickThrough
  if (floatWin) floatWin.setIgnoreMouseEvents(floatClickThrough, { forward: true })
  floatEvent('clickthrough', floatClickThrough)
  buildTrayMenu()
}

// ---------- 老板键 ----------
// 一键隐身：隐藏全部窗口；恢复：只弹回单词悬浮窗，不唤出主界面
function toggleStealth() {
  const anyVisible = (floatWin && floatWin.isVisible()) || (mainWin && mainWin.isVisible())
  if (anyVisible) {
    if (floatWin) floatWin.hide()
    if (mainWin) mainWin.hide()
  } else {
    if (floatWin) floatWin.show()
  }
  broadcastFloatState()
}
function registerShortcuts() {
  const pairs = [
    [config.bossHide, toggleStealth],
    [config.bossQuit, () => app.quit()],
    [config.opacityUp, () => adjustOpacity(0.1)],
    [config.opacityDown, () => adjustOpacity(-0.1)],
    [config.miniToggle, toggleMini],
    [config.clickThrough, toggleClickThrough],
    [config.keyKnow, () => floatEvent('do-know')],
    [config.keyWrong, () => floatEvent('do-wrong')],
    [config.keyMaster, () => floatEvent('do-master')],
  ]
  for (const [accel, fn] of pairs) {
    try {
      const ok = globalShortcut.register(accel, fn)
      if (!ok) log('热键注册失败（可能被占用）：', accel)
    } catch (e) { log('热键注册异常', accel, e.message) }
  }
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', showMain)

app.whenReady().then(async () => {
  config = loadJson(CONFIG_FILE(), DEFAULT_CONFIG)
  state = loadJson(STATE_FILE(), { books: {} })
  await startServer()
  createMainWindow()
  createFloatWindow()
  tray = new Tray(trayIcon())
  tray.setToolTip('摸鱼背词 Lite')
  buildTrayMenu()
  registerShortcuts()
  pollMainSelection(true)
  setInterval(() => pollMainSelection(), 2000)
  log('启动完成')
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { /* 有托盘常驻，不随窗口退出 */ })
