/**
 * 奶龙桌宠 —— 浏览器端脚本（纯 DOM，无构建步骤）。
 * 由 index.js 通过 tapIndex 注入，并从 /<routePrefix>/pet.js 提供服务。
 * 轮询 /<routePrefix>/state 获取 Agent 工作状态，切换精灵动画；任务完成时播放语音。
 */
;(function () {
  'use strict'

  if (window.__nailongPetLoaded) return
  window.__nailongPetLoaded = true

  var PREFIX = '__ROUTE_PREFIX__'

  var W = 140
  var S = W / 192
  var H = Math.round((W * 208) / 192)

  var ANIMS = {
    idle: { row: 0, frames: 6, dur: 1100 },
    working: { row: 7, frames: 6, dur: 820 },
    review: { row: 8, frames: 6, dur: 1030 },
    success: { row: 4, frames: 5, dur: 840 },
    waving: { row: 3, frames: 4, dur: 700 },
    failed: { row: 5, frames: 8, dur: 1220 }
  }

  var css =
    '.nailong-pet-root{position:fixed;right:24px;bottom:24px;z-index:99999;pointer-events:auto;user-select:none;touch-action:none;font-family:system-ui,sans-serif}' +
    '.nailong-pet-root *{box-sizing:border-box}' +
    '.nailong-pet-sprite{width:' + W + 'px;height:' + H + 'px;background-image:url("' + PREFIX + '/sprite.webp");background-repeat:no-repeat;background-size:calc(1536px*var(--nlg-s)) auto;background-position-y:calc(-1*var(--nlg-row)*208px*var(--nlg-s));animation:nlg-play var(--nlg-dur) steps(var(--nlg-frames)) infinite;cursor:grab;filter:drop-shadow(0 4px 8px rgba(0,0,0,.22))}' +
    '.nailong-pet-sprite:active{cursor:grabbing}' +
    '@keyframes nlg-play{from{background-position-x:0px}to{background-position-x:calc(-1*var(--nlg-frames)*192px*var(--nlg-s))}}' +
    '.nailong-pet-bubble{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:8px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:6px 12px;font-size:13px;color:#1f2937;box-shadow:0 4px 12px rgba(0,0,0,.12);white-space:nowrap;animation:nlg-pop .25s ease-out}' +
    '.nailong-pet-bubble::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:6px solid transparent;border-top-color:#fff}' +
    '@keyframes nlg-pop{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}' +
    '.nailong-pet-tools{position:absolute;top:-26px;right:0;display:none;gap:4px}' +
    '.nailong-pet-root:hover .nailong-pet-tools{display:flex}' +
    '.nailong-pet-btn{width:22px;height:22px;border-radius:11px;border:1px solid #e5e7eb;background:rgba(255,255,255,.92);color:#6b7280;font-size:11px;line-height:1;cursor:pointer;padding:0;box-shadow:0 2px 6px rgba(0,0,0,.15)}' +
    '.nailong-pet-btn:hover{background:#fff;color:#111827}' +
    '.nailong-pet-pill{position:fixed;right:24px;bottom:24px;width:38px;height:38px;border-radius:50%;border:1px solid #fde68a;background:#fef3c7;cursor:pointer;font-size:19px;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:99999;pointer-events:auto}'

  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var current = 'idle'
  var muted = false
  var hidden = false
  var lastSeq = null
  var lastErr = null
  var tick = 0
  var pos = { rx: 24, ry: 24 }
  var bubbleTimer = null
  var drag = null
  var moved = false

  function setAnim(name) {
    if (current !== name) {
      current = name
      applySprite()
    }
  }

  function applySprite() {
    var a = ANIMS[current] || ANIMS.idle
    sprite.style.setProperty('--nlg-s', S)
    sprite.style.setProperty('--nlg-row', a.row)
    sprite.style.setProperty('--nlg-frames', a.frames)
    sprite.style.setProperty('--nlg-dur', a.dur + 'ms')
  }

  function showBubble(text, ms) {
    bubble.textContent = text
    bubble.style.display = ''
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(hideBubble, ms)
  }
  function hideBubble() { bubble.style.display = 'none' }

  function playVoice() {
    if (muted) return
    try { audio.currentTime = 0; var p = audio.play(); if (p && p.catch) p.catch(function () {}) } catch (e) {}
  }

  var root = document.createElement('div')
  root.className = 'nailong-pet-root'
  root.style.right = pos.rx + 'px'
  root.style.bottom = pos.ry + 'px'

  var bubble = document.createElement('div')
  bubble.className = 'nailong-pet-bubble'
  bubble.style.display = 'none'

  var tools = document.createElement('div')
  tools.className = 'nailong-pet-tools'

  var muteBtn = document.createElement('button')
  muteBtn.className = 'nailong-pet-btn'
  muteBtn.title = '静音'
  muteBtn.textContent = '\uD83D\uDD0A' // 🔊
  muteBtn.addEventListener('click', function () {
    muted = !muted
    muteBtn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A' // 🔇 / 🔊
    muteBtn.title = muted ? '打开声音' : '静音'
  })

  var hideBtn = document.createElement('button')
  hideBtn.className = 'nailong-pet-btn'
  hideBtn.title = '隐藏奶龙'
  hideBtn.textContent = '\u2715' // ✕
  hideBtn.addEventListener('click', function () {
    root.style.display = 'none'
    hidden = true
    pill.style.display = ''
  })

  tools.appendChild(muteBtn)
  tools.appendChild(hideBtn)

  var sprite = document.createElement('div')
  sprite.className = 'nailong-pet-sprite'
  sprite.setAttribute('role', 'img')
  sprite.setAttribute('aria-label', '奶龙桌宠')

  var audio = new Audio(PREFIX + '/voice.mp3')
  audio.preload = 'auto'

  var pill = document.createElement('button')
  pill.className = 'nailong-pet-pill'
  pill.title = '显示奶龙'
  pill.textContent = '\uD83D\uDC09' // 🐉
  pill.style.display = 'none'
  pill.addEventListener('click', function () {
    hidden = false
    pill.style.display = 'none'
    root.style.display = ''
  })

  function down(e) {
    if (typeof e.button === 'number' && e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
    drag = { x: e.clientX, y: e.clientY }
    moved = false
  }
  function move(e) {
    if (!drag) return
    var dx = e.clientX - drag.x
    var dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 5) moved = true
    drag = { x: e.clientX, y: e.clientY }
    pos.rx = Math.max(-(W - 56), pos.rx - dx)
    pos.ry = Math.max(-(H - 56), pos.ry - dy)
    root.style.right = pos.rx + 'px'
    root.style.bottom = pos.ry + 'px'
  }
  function up() {
    if (!drag) return
    drag = null
    if (moved) return
    setAnim('waving')
    setTimeout(function () { if (current === 'waving') setAnim('idle') }, 1600)
    playVoice()
    showBubble('我是奶龙～', 2200)
  }

  sprite.addEventListener('pointerdown', down)
  sprite.addEventListener('pointermove', move)
  sprite.addEventListener('pointerup', up)
  sprite.addEventListener('dragstart', function (e) { e.preventDefault() })

  root.appendChild(bubble)
  root.appendChild(tools)
  root.appendChild(sprite)
  document.body.appendChild(root)
  document.body.appendChild(pill)

  applySprite()

  var first = true
  setInterval(function () {
    fetch(PREFIX + '/state')
      .then(function (r) { return r.json() })
      .then(function (s) {
        if (!s || typeof s !== 'object') return
        if (first) {
          first = false
          lastSeq = typeof s.completionSeq === 'number' ? s.completionSeq : 0
          lastErr = typeof s.errorSeq === 'number' ? s.errorSeq : 0
          return
        }
        if (typeof s.errorSeq === 'number' && s.errorSeq > lastErr) {
          lastErr = s.errorSeq
          setAnim('failed')
          setTimeout(function () { if (current === 'failed') setAnim('idle') }, 3200)
          showBubble('哎呀…出错了', 3400)
        } else if (typeof s.completionSeq === 'number' && s.completionSeq > lastSeq) {
          lastSeq = s.completionSeq
          setAnim('success')
          setTimeout(function () { if (current === 'success') setAnim('idle') }, 3400)
          playVoice()
          showBubble('我是奶龙～', 3600)
        } else if (s.status === 'running') {
          tick += 1
          if (current !== 'success' && current !== 'failed' && current !== 'waving') {
            setAnim(tick % 10 < 5 ? 'working' : 'review')
          }
        } else if (current === 'working' || current === 'review') {
          setAnim('idle')
        }
      })
      .catch(function () {})
  }, 600)
})()
