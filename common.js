/* Shared: background music, sound effects, leaderboard, small UI helpers. */
(function () {
  'use strict';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  /* ---------------- Audio ---------------- */
  const Audio = (function () {
    let ctx = null, master = null, musicGain = null, sfxGain = null;
    let muted = store.get('laurier_muted', false);
    let playing = false, nextTime = 0, step = 0, timer = null;

    const BPM = 132, STEP = 60 / BPM / 2; // eighth notes
    const N = (s) => s === '-' ? null : 440 * Math.pow(2, (({ C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 })[s[0]] + (s[1] === '#' ? 1 : 0) + (parseInt(s.slice(-1), 10) - 4) * 12) / 12);
    // cheerful 4-bar loop in C major (I–V–vi–IV)
    const melody = ('E5 - G5 E5 C5 - D5 E5  D5 - B4 - G4 - B4 D5  ' +
                    'C5 - E5 C5 A4 - C5 E5  F5 - E5 D5 C5 - D5 -  ' +
                    'E5 - G5 E5 C5 - D5 E5  D5 - B4 - G4 A4 B4 D5  ' +
                    'C5 E5 A5 G5 E5 - C5 -  F5 E5 D5 B4 C5 - - -').split(/\s+/).filter(Boolean);
    const bass = ['C3', 'G2', 'A2', 'F2', 'C3', 'G2', 'A2', 'F2'];
    const chords = [['C4', 'E4', 'G4'], ['B3', 'D4', 'G4'], ['A3', 'C4', 'E4'], ['A3', 'C4', 'F4']];

    function ensure() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.35; sfxGain.connect(master);
      return ctx;
    }

    function tone(freq, t, dur, type, vol, dest, slideTo) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || sfxGain);
      o.start(t); o.stop(t + dur + 0.02);
    }

    function hat(t) {
      const len = Math.floor(ctx.sampleRate * 0.03), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'highpass'; f.frequency.value = 7000; g.gain.value = 0.25;
      s.buffer = buf; s.connect(f); f.connect(g); g.connect(musicGain); s.start(t);
    }

    function schedule() {
      while (nextTime < ctx.currentTime + 0.15) {
        const i = step % melody.length, bar = Math.floor(i / 8);
        const m = N(melody[i]);
        if (m) tone(m, nextTime, STEP * 1.6, 'triangle', 0.5, musicGain);
        if (i % 4 === 0) tone(N(bass[bar % 8]), nextTime, STEP * 1.8, 'sine', 0.9, musicGain);
        if (i % 8 === 2 || i % 8 === 6) chords[bar % 4].forEach((c) => tone(N(c), nextTime, STEP * 0.9, 'square', 0.06, musicGain));
        if (i % 2 === 1) hat(nextTime);
        nextTime += STEP; step++;
      }
    }

    return {
      start() {
        if (!ensure()) return;
        if (ctx.state === 'suspended') ctx.resume();
        if (playing) return;
        playing = true; nextTime = ctx.currentTime + 0.05;
        timer = setInterval(schedule, 40);
      },
      stopMusic() { playing = false; clearInterval(timer); },
      unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
      get muted() { return muted; },
      toggle() {
        muted = !muted; store.set('laurier_muted', muted);
        if (master) master.gain.value = muted ? 0 : 1;
        return muted;
      },
      sfx(name, n) {
        if (!ctx || muted) return;
        const t = ctx.currentTime;
        if (name === 'flap') tone(520, t, 0.12, 'sine', 0.5, null, 880);
        else if (name === 'point') { tone(988, t, 0.08, 'square', 0.18); tone(1319, t + 0.07, 0.14, 'square', 0.18); }
        else if (name === 'hit') { tone(220, t, 0.35, 'sawtooth', 0.35, null, 60); }
        else if (name === 'swap') tone(660, t, 0.08, 'sine', 0.35, null, 990);
        else if (name === 'bad') tone(300, t, 0.18, 'triangle', 0.4, null, 180);
        else if (name === 'match') { const b = 660 * Math.pow(2, Math.min(n || 0, 8) / 12 * 2); tone(b, t, 0.12, 'triangle', 0.45); tone(b * 1.5, t + 0.05, 0.14, 'triangle', 0.3); }
        else if (name === 'special') { [0, 4, 7, 12].forEach((s, k) => tone(784 * Math.pow(2, s / 12), t + k * 0.05, 0.16, 'square', 0.18)); }
        else if (name === 'end') { [12, 7, 4, 0].forEach((s, k) => tone(523 * Math.pow(2, s / 12), t + k * 0.12, 0.22, 'triangle', 0.4)); }
        else if (name === 'tick') tone(1200, t, 0.04, 'square', 0.12);
      },
    };
  })();

  /* ---------------- Leaderboard ----------------
     Online board: a Google Apps Script web app (see apps-script.gs in the repo).
     Phone numbers are stored only in the owner's Google Sheet; the board returns names + scores. */
  const LB = (function () {
    const url = (window.LAURIER_CONFIG && window.LAURIER_CONFIG.scriptUrl) || '';
    const online = /^https:\/\/script\.google(usercontent)?\.com\//.test(url);
    const localKey = (g) => 'laurier_local_board_' + g;

    function localBoard(game) { return store.get(localKey(game), []); }
    function localSubmit(game, name, phone, score) {
      const list = localBoard(game).filter((r) => r.phone !== phone);
      const prev = localBoard(game).find((r) => r.phone === phone);
      list.push(prev && prev.score >= score ? prev : { name, phone, score, t: Date.now() });
      list.sort((a, b) => b.score - a.score || a.t - b.t);
      store.set(localKey(game), list.slice(0, 50));
      const rank = list.findIndex((r) => r.phone === phone) + 1;
      return { ok: true, top: list.slice(0, 10).map((r) => ({ name: r.name, score: r.score })), rank, best: list[rank - 1].score };
    }

    async function withTimeout(p, ms) {
      return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    }

    return {
      online,
      async top(game) {
        if (!online) return { ok: true, top: localBoard(game).slice(0, 10).map((r) => ({ name: r.name, score: r.score })) };
        const r = await withTimeout(fetch(url + '?game=' + encodeURIComponent(game) + '&_=' + Date.now()), 12000);
        return r.json();
      },
      async submit(game, name, phone, score) {
        if (!online) return localSubmit(game, name, phone, score);
        // text/plain body avoids a CORS preflight, which Apps Script cannot answer
        const r = await withTimeout(fetch(url, { method: 'POST', body: JSON.stringify({ game, name, phone, score }) }), 15000);
        return r.json();
      },
    };
  })();

  /* ---------------- UI helpers ---------------- */
  const $ = (s, el) => (el || document).querySelector(s);

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  function renderBoard(el, rows, highlightName, highlightScore) {
    if (!rows || !rows.length) { el.innerHTML = '<li class="lb-empty">未有紀錄，快啲做第一名！</li>'; return; }
    const medal = ['🥇', '🥈', '🥉'];
    let marked = false;
    el.innerHTML = rows.map((r, i) => {
      const me = !marked && highlightName != null && r.name === highlightName && r.score === highlightScore;
      if (me) marked = true;
      return '<li class="' + (me ? 'me' : '') + '"><span class="rk">' + (medal[i] || (i + 1)) + '</span><span class="nm">' + esc(r.name) + '</span><span class="sc">' + r.score + '</span></li>';
    }).join('');
  }

  async function loadBoard(el, game, hl) {
    el.innerHTML = '<li class="lb-empty">載入中…</li>';
    try {
      const res = await LB.top(game);
      renderBoard(el, res.top, hl && hl.name, hl && hl.score);
    } catch (e) {
      el.innerHTML = '<li class="lb-empty">暫時連唔到排行榜，請稍後再試</li>';
    }
  }

  /* Score submission form inside the game-over card. */
  function bindSubmit(form, game, getScore, onDone) {
    const nameIn = $('[name=nick]', form), phoneIn = $('[name=phone]', form), agree = $('[name=agree]', form);
    const msg = $('.form-msg', form), btn = $('button[type=submit]', form);
    nameIn.value = store.get('laurier_nick', '');
    phoneIn.value = store.get('laurier_phone', '');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim().replace(/\s+/g, ' ');
      const phone = phoneIn.value.replace(/\D/g, '');
      if (!name || name.length > 12) { msg.textContent = '請輸入 1–12 個字嘅暱稱'; return; }
      if (!/^[4-9]\d{7}$/.test(phone)) { msg.textContent = '請輸入 8 位數香港手機號碼'; return; }
      if (!agree.checked) { msg.textContent = '請先同意收集資料聲明'; return; }
      store.set('laurier_nick', name); store.set('laurier_phone', phone);
      btn.disabled = true; msg.textContent = '提交中…';
      try {
        const score = getScore();
        const res = await LB.submit(game, name, phone, score);
        if (!res || !res.ok) throw new Error((res && res.error) || 'fail');
        msg.textContent = res.rank && res.rank <= 10 ? '恭喜！你而家排第 ' + res.rank + ' 名 🎉' :
          (res.rank ? '已記錄！你排第 ' + res.rank + ' 名，再努力衝入十大！' : '已記錄！');
        form.classList.add('done');
        onDone(res, name);
      } catch (err) {
        msg.textContent = '提交失敗，請檢查網絡再試';
        btn.disabled = false;
      }
    });
    return () => { btn.disabled = false; msg.textContent = ''; form.classList.remove('done'); };
  }

  function bindMute(btn) {
    const paint = () => { btn.textContent = Audio.muted ? '🔇' : '🎵'; btn.setAttribute('aria-label', Audio.muted ? '開聲' : '靜音'); };
    paint();
    btn.addEventListener('click', (e) => { e.stopPropagation(); Audio.unlock(); Audio.toggle(); Audio.start(); paint(); });
  }

  window.Laurier = { Audio, LB, store, $, esc, renderBoard, loadBoard, bindSubmit, bindMute };
})();
