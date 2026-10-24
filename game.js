(function () {
  'use strict';
  const { Audio, store, $, loadBoard, bindSubmit, bindMute, LB, renderBoard } = window.Laurier;
  const GAME = 'match';
  const cfg = window.LAURIER_CONFIG || {};
  const COLS = 7, ROWS = 8, TYPES = 6, TIME = 60;

  const HEART = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 56S6 40 6 22C6 13 13 7 21 7c5 0 9 3 11 7 2-4 6-7 11-7 8 0 15 6 15 15 0 18-26 34-26 34z" fill="#ff7eb6" stroke="#fff" stroke-width="4"/><ellipse cx="20" cy="20" rx="6" ry="4" fill="#fff" opacity=".7" transform="rotate(-30 20 20)"/></svg>';
  const ICON = ['new1', 'new2', 'old1', 'old2', 'leaf'].map((n) => '<img src="assets/' + n + '.png" alt="" draggable="false">').concat([HEART]);

  const boardEl = $('#board');
  let size = 52;
  let grid = [];
  let busy = false, playing = false, endPending = false;
  let score = 0, timeLeft = TIME, timer = null, hintTimer = null, lastTick = 0;
  let best = store.get('laurier_match_best', 0);
  let stats = { moves: 0, maxCombo: 0, newCleared: 0 };

  if (cfg.otherGameUrl) $('#otherGame').href = cfg.otherGameUrl; else $('#otherGame').parentElement.hidden = true;

  const bubbles = $('.bubbles');
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span'), sz = 14 + Math.random() * 40;
    s.style.cssText = 'left:' + (Math.random() * 100) + '%;width:' + sz + 'px;height:' + sz + 'px;animation-duration:' + (9 + Math.random() * 10) + 's;animation-delay:-' + (Math.random() * 15) + 's';
    bubbles.appendChild(s);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (n) => Math.floor(Math.random() * n);
  const key = (r, c) => r * COLS + c;

  /* ---------- layout ---------- */
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    size = Math.floor(Math.min((vw - 24) / COLS, (vh - 160) / ROWS, 66));
    boardEl.style.width = size * COLS + 'px';
    boardEl.style.height = size * ROWS + 'px';
    boardEl.querySelectorAll('.cell-bg').forEach((e) => e.remove());
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const b = document.createElement('div'); b.className = 'cell-bg';
      b.style.cssText = 'left:' + (c * size + 2) + 'px;top:' + (r * size + 2) + 'px;width:' + (size - 4) + 'px;height:' + (size - 4) + 'px';
      boardEl.prepend(b);
    }
    grid.forEach((row) => row.forEach((t) => { if (t) { t.el.style.width = t.el.style.height = size + 'px'; place(t, t.r, t.c, true); } }));
  }
  window.addEventListener('resize', layout);

  /* ---------- tiles ---------- */
  function paint(t) { t.el.className = 'tile t' + t.type + (t.type < 2 ? ' new-pack' : '') + (t.special ? ' s-' + t.special : ''); t.el.firstChild.innerHTML = ICON[t.type]; }
  function makeTile(type) {
    const el = document.createElement('div');
    el.innerHTML = '<div class="face"></div>';
    el.style.width = el.style.height = size + 'px';
    boardEl.appendChild(el);
    const t = { type, special: null, el, r: 0, c: 0 };
    paint(t);
    return t;
  }
  function place(t, r, c, instant) {
    t.r = r; t.c = c;
    if (instant) t.el.style.transition = 'none';
    t.el.style.transform = 'translate(' + (c * size) + 'px,' + (r * size) + 'px)';
    if (instant) { void t.el.offsetWidth; t.el.style.transition = ''; }
  }

  function freshBoard() {
    boardEl.querySelectorAll('.tile,.fx').forEach((e) => e.remove());
    do {
      grid = [];
      for (let r = 0; r < ROWS; r++) {
        grid.push([]);
        for (let c = 0; c < COLS; c++) {
          let type;
          do { type = rnd(TYPES); } while (
            (c >= 2 && grid[r][c - 1].type === type && grid[r][c - 2].type === type) ||
            (r >= 2 && grid[r - 1][c].type === type && grid[r - 2][c].type === type));
          grid[r].push({ type });
        }
      }
    } while (!hasMoves());
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = makeTile(grid[r][c].type);
      grid[r][c] = t;
      place(t, r - ROWS - 1, c, true);
    }
    void boardEl.offsetWidth;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      t.el.style.transitionDelay = ((ROWS - r) * 25 + c * 12) + 'ms';
      place(t, r, c);
    }
    setTimeout(() => grid.forEach((row) => row.forEach((t) => { t.el.style.transitionDelay = ''; })), 700);
  }

  /* ---------- matching ---------- */
  function findRuns() {
    const runs = [];
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const ty = grid[r][c] ? grid[r][c].type : -1; let e = c + 1;
        while (e < COLS && grid[r][e] && grid[r][e].type === ty) e++;
        if (ty >= 0 && e - c >= 3) { const cells = []; for (let i = c; i < e; i++) cells.push([r, i]); runs.push({ dir: 'h', cells }); }
        c = e;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const ty = grid[r][c] ? grid[r][c].type : -1; let e = r + 1;
        while (e < ROWS && grid[e][c] && grid[e][c].type === ty) e++;
        if (ty >= 0 && e - r >= 3) { const cells = []; for (let i = r; i < e; i++) cells.push([i, c]); runs.push({ dir: 'v', cells }); }
        r = e;
      }
    }
    return runs;
  }

  function swapGrid(a, b) { const t = grid[a[0]][a[1]]; grid[a[0]][a[1]] = grid[b[0]][b[1]]; grid[b[0]][b[1]] = t; }

  function findMove() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c].special === 'bomb') return [[r, c], c + 1 < COLS ? [r, c + 1] : [r, c - 1]];
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        swapGrid([r, c], [r2, c2]);
        const ok = findRuns().length > 0;
        swapGrid([r, c], [r2, c2]);
        if (ok) return [[r, c], [r2, c2]];
      }
    }
    return null;
  }
  const hasMoves = () => !!findMove();

  /* ---------- effects ---------- */
  function fx(cls, css, ms) {
    const e = document.createElement('div'); e.className = 'fx ' + cls; e.style.cssText = css;
    boardEl.appendChild(e); setTimeout(() => e.remove(), ms || 700);
    return e;
  }
  function shout(text) {
    const s = $('#shout'); s.textContent = text; s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
  }
  function sparks(r, c) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, d = size * (.5 + Math.random() * .6);
      const e = fx('spark', 'left:' + ((c + .5) * size - 4) + 'px;top:' + ((r + .5) * size - 4) + 'px;--dx:' + Math.cos(a) * d + 'px;--dy:' + Math.sin(a) * d + 'px', 550);
      e.style.background = ['#ffd84d', '#2fb83a', '#ff7eb6', '#4cc1d1'][rnd(4)];
    }
  }

  /* ---------- resolving ---------- */
  // Clears `clear` (Set of keys), turning `keep` cells into new specials, chaining special tiles.
  async function clearCells(clear, creates, combo) {
    const keep = new Set(creates.map((x) => key(x.r, x.c)));
    const queue = [...clear], fired = new Set();
    while (queue.length) {
      const k = queue.shift(), r = Math.floor(k / COLS), c = k % COLS, t = grid[r][c];
      if (!t || !t.special || fired.has(k) || keep.has(k)) continue;
      fired.add(k);
      const add = [];
      if (t.special === 'row') { for (let i = 0; i < COLS; i++) add.push(key(r, i)); fx('beam', 'left:0;top:' + (r * size + size * .3) + 'px;width:100%;height:' + size * .4 + 'px', 400); }
      if (t.special === 'col') { for (let i = 0; i < ROWS; i++) add.push(key(i, c)); fx('beam v', 'top:0;left:' + (c * size + size * .3) + 'px;height:100%;width:' + size * .4 + 'px', 400); }
      if (t.special === 'bomb') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) add.push(key(rr, cc)); }
        fx('boom', 'left:' + ((c - 1.5) * size) + 'px;top:' + ((r - 1.5) * size) + 'px;width:' + size * 4 + 'px;height:' + size * 4 + 'px', 450);
      }
      Audio.sfx('special');
      add.forEach((x) => { if (!keep.has(x) && !clear.has(x)) { clear.add(x); queue.push(x); } });
    }
    keep.forEach((k) => clear.delete(k));

    // score
    let pts = 0, newCount = 0, sr = 0, sc = 0;
    clear.forEach((k) => {
      const r = Math.floor(k / COLS), c = k % COLS, t = grid[r][c];
      if (!t) return;
      const base = t.type < 2 ? 20 : 10;
      if (t.type < 2) newCount++;
      pts += base * combo; sr += r; sc += c;
    });
    pts += fired.size * 30 * combo;
    score += pts; stats.newCleared += newCount;
    $('#score').textContent = score;
    if (clear.size) {
      const e = fx('pts' + (newCount ? ' x2' : ''), 'left:' + ((sc / clear.size + .5) * size) + 'px;top:' + ((sr / clear.size + .5) * size) + 'px', 850);
      e.textContent = '+' + pts + (newCount ? ' NEW×2' : '');
    }
    Audio.sfx('match', combo);

    clear.forEach((k) => { const r = Math.floor(k / COLS), c = k % COLS; const t = grid[r][c]; if (t) { t.el.classList.add('clear'); sparks(r, c); } });
    creates.forEach((x) => { const t = grid[x.r][x.c]; t.special = x.special; paint(t); t.el.firstChild.classList.add('pop'); });
    await sleep(230);
    clear.forEach((k) => { const r = Math.floor(k / COLS), c = k % COLS; const t = grid[r][c]; if (t) { t.el.remove(); grid[r][c] = null; } });

    // gravity + refill
    const spawned = [];
    for (let c = 0; c < COLS; c++) {
      let w = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const t = grid[r][c];
        if (t) { if (r !== w) { grid[w][c] = t; grid[r][c] = null; place(t, w, c); } w--; }
      }
      const missing = w + 1;
      for (let r = w; r >= 0; r--) {
        const t = makeTile(rnd(TYPES));
        grid[r][c] = t; place(t, r - missing, c, true); spawned.push([t, r, c]);
      }
    }
    void boardEl.offsetWidth;
    spawned.forEach(([t, r, c]) => place(t, r, c));
    await sleep(260);
  }

  async function resolve(swapped) {
    let combo = 0;
    for (;;) {
      const runs = findRuns();
      if (!runs.length) break;
      combo++;
      const clear = new Set(), creates = [], used = new Set();
      runs.forEach((run) => run.cells.forEach(([r, c]) => clear.add(key(r, c))));
      const pickCell = (cells) => {
        if (swapped) for (const s of swapped) if (cells.some(([r, c]) => r === s[0] && c === s[1]) && !grid[s[0]][s[1]].special && !used.has(key(s[0], s[1]))) return s;
        const mid = cells[Math.floor(cells.length / 2)];
        const order = [mid].concat(cells);
        return order.find(([r, c]) => !grid[r][c].special && !used.has(key(r, c)));
      };
      const done = new Set();
      // L / T shapes → bomb at the crossing cell
      runs.forEach((h, i) => {
        if (h.dir !== 'h') return;
        runs.forEach((v, j) => {
          if (v.dir !== 'v' || done.has(i) || done.has(j)) return;
          const x = h.cells.find(([r, c]) => v.cells.some(([r2, c2]) => r === r2 && c === c2));
          if (x && !grid[x[0]][x[1]].special) { creates.push({ r: x[0], c: x[1], special: 'bomb' }); used.add(key(x[0], x[1])); done.add(i); done.add(j); }
        });
      });
      runs.forEach((run, i) => {
        if (done.has(i) || run.cells.length < 4) return;
        const cell = pickCell(run.cells);
        if (!cell) return;
        creates.push({ r: cell[0], c: cell[1], special: run.cells.length >= 5 ? 'bomb' : (run.dir === 'h' ? 'row' : 'col') });
        used.add(key(cell[0], cell[1]));
      });
      await clearCells(clear, creates, combo);
      swapped = null;
    }
    stats.maxCombo = Math.max(stats.maxCombo, combo);
    if (combo >= 2) shout(['', '', '好嘢！', 'Great!', 'Amazing!'][combo] || '零感特薄！✨');
    return combo;
  }

  async function shuffle() {
    shout('洗牌！🔀');
    await sleep(500);
    const tiles = grid.flat();
    let tries = 0;
    do {
      tiles.forEach((t) => { if (!t.special) t.type = rnd(TYPES); });
      tries++;
    } while ((findRuns().length || !hasMoves()) && tries < 200);
    tiles.forEach((t) => { paint(t); t.el.firstChild.classList.remove('pop'); void t.el.offsetWidth; t.el.firstChild.classList.add('pop'); });
    await sleep(350);
    if (findRuns().length) await resolve(null);
  }

  async function trySwap(a, b) {
    if (busy || !playing) return;
    busy = true; clearHint(); deselect();
    const ta = grid[a[0]][a[1]], tb = grid[b[0]][b[1]];
    swapGrid(a, b); place(ta, b[0], b[1]); place(tb, a[0], a[1]);
    Audio.sfx('swap');
    await sleep(200);
    const bombSwap = ta.special === 'bomb' || tb.special === 'bomb';
    if (!findRuns().length && !bombSwap) {
      swapGrid(a, b); place(ta, a[0], a[1]); place(tb, b[0], b[1]);
      Audio.sfx('bad');
      await sleep(200);
      busy = false; scheduleHint();
      return;
    }
    stats.moves++;
    if (bombSwap && !findRuns().length) {
      const set = new Set();
      if (ta.special === 'bomb') set.add(key(b[0], b[1]));
      if (tb.special === 'bomb') set.add(key(a[0], a[1]));
      await clearCells(set, [], 1);
      await resolve(null);
    } else {
      await resolve([b, a]);
    }
    if (!hasMoves()) await shuffle();
    busy = false;
    if (endPending) finish(); else scheduleHint();
  }

  /* ---------- input ---------- */
  let sel = null, start = null, swiped = false;
  function cellAt(e) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / size), r = Math.floor((e.clientY - rect.top) / size);
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? [r, c] : null;
  }
  function deselect() { if (sel) { const t = grid[sel[0]][sel[1]]; if (t) t.el.classList.remove('sel'); sel = null; } }
  boardEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const cell = cellAt(e); if (!cell || busy || !playing) return;
    start = { x: e.clientX, y: e.clientY, cell }; swiped = false;
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!start || swiped) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < size * 0.35) return;
    swiped = true;
    const [r, c] = start.cell;
    const tgt = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
    if (tgt[0] >= 0 && tgt[0] < ROWS && tgt[1] >= 0 && tgt[1] < COLS) trySwap(start.cell, tgt);
  });
  boardEl.addEventListener('pointerup', () => {
    if (!start) return;
    const cell = start.cell; start = null;
    if (swiped || busy || !playing) return;
    if (sel) {
      const adj = Math.abs(sel[0] - cell[0]) + Math.abs(sel[1] - cell[1]) === 1;
      if (adj) { const a = sel; deselect(); trySwap(a, cell); return; }
      const same = sel[0] === cell[0] && sel[1] === cell[1];
      deselect();
      if (same) return;
    }
    sel = cell; grid[cell[0]][cell[1]].el.classList.add('sel');
  });
  boardEl.addEventListener('pointercancel', () => { start = null; });

  /* ---------- hints ---------- */
  function clearHint() { clearTimeout(hintTimer); boardEl.querySelectorAll('.tile.hint').forEach((e) => e.classList.remove('hint')); }
  function scheduleHint() {
    clearHint();
    hintTimer = setTimeout(() => {
      if (busy || !playing) return;
      const m = findMove();
      if (m) m.forEach(([r, c]) => grid[r][c].el.classList.add('hint'));
    }, 5000);
  }

  /* ---------- flow ---------- */
  function show(id) { ['home', 'play-screen', 'over'].forEach((s) => { $('#' + s).hidden = s !== id; }); }

  function startGame() {
    Audio.unlock(); Audio.start();
    score = 0; timeLeft = TIME; endPending = false; busy = false; sel = null;
    stats = { moves: 0, maxCombo: 0, newCleared: 0 };
    $('#score').textContent = '0'; $('#best').textContent = best;
    show('play-screen');
    layout(); freshBoard();
    updateTime();
    playing = true;
    shout('開始！');
    clearInterval(timer);
    let prev = performance.now();
    timer = setInterval(() => {
      const now = performance.now(); timeLeft -= (now - prev) / 1000; prev = now;
      if (timeLeft <= 10 && Math.ceil(timeLeft) !== lastTick && timeLeft > 0) { lastTick = Math.ceil(timeLeft); Audio.sfx('tick'); }
      if (timeLeft <= 0) {
        timeLeft = 0; clearInterval(timer); playing = false; clearHint(); deselect();
        shout('時間到！');
        if (busy) endPending = true; else setTimeout(finish, 900);
      }
      updateTime();
    }, 100);
    scheduleHint();
  }
  function updateTime() {
    $('#timeFill').style.width = (timeLeft / TIME * 100) + '%';
    $('#timeText').textContent = Math.ceil(timeLeft);
    $('.timebar').classList.toggle('low', timeLeft <= 10);
  }

  function finish() {
    endPending = false;
    Audio.sfx('end');
    const isBest = score > best;
    if (isBest) { best = score; store.set('laurier_match_best', best); }
    $('#finalScore').textContent = score;
    $('#bestLine').textContent = isBest && score > 0 ? '🎉 新個人紀錄！' : '個人最佳：' + best;
    $('#overTitle').textContent = score >= 3000 ? '消除達人！' : score >= 1500 ? '好犀利！' : '時間到！';
    $('#stats').innerHTML = '<span>💚 新包裝 ×' + stats.newCleared + '</span><span>🔗 最高連鎖 ' + stats.maxCombo + '</span><span>👆 ' + stats.moves + ' 步</span>';
    resetForm();
    show('over');
  }

  const resetForm = bindSubmit($('#submitForm'), GAME, () => score, (res, name) => openLb(res.top, name, res.best));

  function openLb(rows, name, sc) {
    $('#lbModal').hidden = false;
    $('#lbNote').textContent = LB.online ? '排行榜每位玩家只計最高分；手機號碼唔會公開。' : '（示範模式：排行榜暫時只儲存喺呢部裝置）';
    if (rows) renderBoard($('#lbList'), rows, name, sc);
    else loadBoard($('#lbList'), GAME);
  }

  $('#play').addEventListener('click', startGame);
  $('#again').addEventListener('click', startGame);
  $('#toHome').addEventListener('click', () => show('home'));
  $('#openLb').addEventListener('click', () => openLb());
  $('#overLb').addEventListener('click', () => openLb());
  $('#openHow').addEventListener('click', () => { $('#howModal').hidden = false; });
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m || e.target.hasAttribute('data-close')) m.hidden = true;
  }));
  bindMute($('#mute'));

  let musicOn = false;
  document.addEventListener('pointerdown', () => { if (!musicOn) { musicOn = true; Audio.unlock(); Audio.start(); } }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) Audio.stopMusic(); else if (musicOn) Audio.start(); });
})();
