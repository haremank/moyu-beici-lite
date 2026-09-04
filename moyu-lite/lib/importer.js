'use strict'
// 词书导入解析：txt / csv / json → qwerty-learner 词书格式 [{ name, trans: [] }]
const fs = require('fs')
const path = require('path')

function splitMeanings(raw) {
  return String(raw)
    .split(/[；;|]|、/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeEntry(word, meaning) {
  const name = String(word || '').trim()
  if (!name) return null
  let trans = []
  if (Array.isArray(meaning)) trans = meaning.map((s) => String(s).trim()).filter(Boolean)
  else if (meaning != null) trans = splitMeanings(meaning)
  if (!trans.length) trans = ['（待补充释义）']
  return { name, trans }
}

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parseTxt(text) {
  const entries = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    let word = null
    let meaning = ''
    if (line.includes('\t')) {
      const [w, ...rest] = line.split('\t')
      word = w
      meaning = rest.join(' ').trim()
    } else if (/ {2,}/.test(line)) {
      const m = line.match(/^(\S+)\s{2,}(.+)$/)
      if (m) { word = m[1]; meaning = m[2] }
    } else {
      const m = line.match(/^([^\s,，：:|]+)\s*[,，：:|]\s*(.+)$/)
      if (m) { word = m[1]; meaning = m[2] }
      else {
        // 纯空格分隔：第一个空格前是单词
        const m2 = line.match(/^(\S+)\s+(.+)$/)
        if (m2) { word = m2[1]; meaning = m2[2] }
      }
    }
    if (word == null) {
      // 整行只有单词
      word = line
      meaning = ''
    }
    const e = normalizeEntry(word, meaning)
    if (e) entries.push(e)
  }
  return entries
}

function parseCsv(text) {
  const entries = []
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const cols = parseCsvLine(rawLine)
    if (!cols.length || !cols[0]) continue
    // 跳过疑似表头
    if (/^(word|单词|name)$/i.test(cols[0]) && cols.length > 1) continue
    const e = normalizeEntry(cols[0], cols.slice(1).filter(Boolean).join('；'))
    if (e) entries.push(e)
  }
  return entries
}

function parseJsonData(data) {
  if (!Array.isArray(data)) throw new Error('JSON 词书应为数组')
  const entries = []
  for (const it of data) {
    if (!it || typeof it !== 'object') continue
    const word = it.name ?? it.word ?? it.spell
    let meaning = it.trans ?? it.translation ?? it.definition ?? it.meaning
    if (meaning == null && it.sense) meaning = it.sense
    const e = normalizeEntry(word, meaning)
    if (e) entries.push(e)
  }
  return entries
}

function parseDictFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  // 记事本等工具常产出带 BOM 的文件：不剥掉会让 JSON.parse 直接失败、txt/csv 首词混入不可见字符
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
  let entries
  if (ext === '.json') {
    let data
    try { data = JSON.parse(text) } catch (e) { throw new Error('JSON 解析失败：' + e.message) }
    entries = parseJsonData(data)
  } else if (ext === '.csv') {
    entries = parseCsv(text)
  } else {
    entries = parseTxt(text)
  }
  // 去重（按单词）
  const seen = new Set()
  const uniq = []
  for (const e of entries) {
    const k = e.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(e)
  }
  return uniq
}

module.exports = { parseDictFile, splitMeanings, normalizeEntry }
