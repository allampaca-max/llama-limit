/* 라마 리밋 — 화면과 네트워크.
 *
 * 구조 (포인트오목·울타리와 같은 틀)
 *  - 방을 만든 사람(방장)의 브라우저가 게임 상태 전체를 들고 판정한다(GameHost).
 *  - 모두 자기 몫의 화면 정보(LL.viewFor)만 받는다. 남의 뒷면 카드와 덱 순서는 오지 않는다.
 *  - 연결은 PeerJS(WebRTC)로 브라우저끼리 직접 잇는다. 방장 한 명에 참가자 최대 4명이 붙는다.
 *  - 봇 자리는 방장 브라우저 안에서 돈다(연습 모드, 또는 대기실에서 빈 자리에 넣은 봇).
 */
(function () {
  'use strict';
  const LL = window.LL;
  const Bot = window.LLBot;
  const tr = (k, p) => window.I18N.t(k, p);

  const PEER_PREFIX = 'llamalimit-v1-';
  const EMOTES = ['👍', '😏', '😱', '🤔', 'ㅋㅋ', '🦙'];
  const K = {
    name: 'llama.name', host: 'llama.host', client: 'llama.client',
    records: 'llama.records', settings: 'llama.settings', mute: 'llama.mute',
  };
  const PAL = {
    cream: { base: '#e6c48a', dark: '#8a672b', soft: '#fbf0dc' },
    pink: { base: '#f09ab0', dark: '#a8445f', soft: '#fde3ea' },
    mint: { base: '#78c9a4', dark: '#2c7656', soft: '#ddf3e8' },
    lavender: { base: '#b39be6', dark: '#5d489a', soft: '#ece4fb' },
    caramel: { base: '#d39a60', dark: '#7b4b20', soft: '#f6e2cd' },
  };
  const PHASE_FIXED = { lottery: 4800, roll: 3300, result: 12000 };
  const colorKey = (seat) => LL.COLORS[seat];
  const pal = (seat) => PAL[colorKey(seat)] || PAL.cream;
  const avaSrc = (seat) => `assets/ava${seat}.webp`;
  const seatVars = (seat) => { const p = pal(seat); return `--pc:${p.base};--pcd:${p.dark};--pcs:${p.soft}`; };

  // ───────── 작은 도구들 ─────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 */ } };
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function makeCode() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }
  const fmtTime = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const cardLabel = (v) => (v < 0 ? '−1' : String(v));

  // ───────── 소리 (WebAudio로 즉석 합성) ─────────
  const Sound = {
    ctx: null,
    muted: !!load(K.mute, false),
    ac() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    noise(dur, freq, q, vol, when) {
      if (this.muted) return;
      const ac = this.ac(); if (!ac) return;
      const t = ac.currentTime + (when || 0), len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(bp).connect(g).connect(ac.destination); src.start(t);
    },
    thud(f0, f1, vol, when) {
      if (this.muted) return;
      const ac = this.ac(); if (!ac) return;
      const t = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), og = ac.createGain();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.1);
      og.gain.setValueAtTime(vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(og).connect(ac.destination); o.start(t); o.stop(t + 0.16);
    },
    beep(freq, dur, vol, when, type) {
      if (this.muted) return;
      const ac = this.ac(); if (!ac) return;
      const t = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    card(when) { this.noise(0.055, 3000, 0.9, 0.32, when); this.thud(380, 190, 0.05, when); },
    deal(n) { for (let i = 0; i < n; i++) this.card(i * 0.07); },
    flip() { this.noise(0.045, 2300, 1.1, 0.35); this.noise(0.05, 3500, 1.1, 0.28, 0.05); },
    chip() { this.beep(2350, 0.07, 0.045, 0, 'triangle'); this.beep(3100, 0.09, 0.035, 0.035, 'triangle'); },
    chips() { for (let i = 0; i < 6; i++) this.beep(1900 + Math.random() * 1500, 0.06, 0.03, i * 0.055, 'triangle'); },
    dice() { for (let i = 0; i < 10; i++) this.noise(0.035, 1300 + Math.random() * 1300, 1.6, 0.45, i * (0.05 + i * 0.013)); this.thud(260, 110, 0.16, 1.15); },
    stay() { this.thud(230, 110, 0.18); this.beep(520, 0.12, 0.05, 0.02); },
    fold() { this.noise(0.28, 800, 0.5, 0.3); },
    pop() { this.beep(700, 0.08, 0.07); this.beep(1050, 0.12, 0.07, 0.07); this.beep(1400, 0.16, 0.06, 0.14); },
    tick() { this.beep(1320, 0.05, 0.05); },
    turn() { this.beep(660, 0.1, 0.08); this.beep(990, 0.14, 0.08, 0.1); },
    win() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.24, 0.09, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => this.beep(f, 0.28, 0.07, i * 0.16)); },
  };

  // ───────── 게임 진행자: 방장 브라우저에서만 돈다 ─────────
  // seats[i] = null(빈 자리) | { name, cid, bot }
  class GameHost {
    constructor(o) {
      this.code = o.code || '';
      this.settings = LL.cleanSettings(o.settings);
      this.n = this.settings.players;
      this.seats = new Array(this.n).fill(null);
      this.seats[0] = { name: o.myName || '', cid: 'host', bot: false };
      this.net = o.net || null;      // { send(seat, msg), connected(seat) }
      this.onLocal = o.onLocal;
      this.persistOn = !!o.persist;
      this.bots = {};
      this.state = null;
      this.games = 0;
      this.deadline = 0;
      this.pausedLeft = null;
      this.pauses = {};
      this.turnKey = '';
      this.rematch = [];
      this.lastTick = Date.now();
      this.iv = setInterval(() => this.tick(), 300);
    }
    static fromSave(data, o) {
      const h = new GameHost(Object.assign({}, o, { code: data.code, settings: data.settings, myName: data.seats[0] && data.seats[0].name }));
      h.seats = data.seats.map((s) => (s ? Object.assign({}, s) : null));
      h.seats.forEach((s, i) => { if (s && s.bot) h.bots[i] = new BotSeat(h, i); });
      h.state = data.state;
      h.games = data.games || 1;
      h.rematch = data.rematch || [];
      h.turnKey = data.turnKey || '';
      if (h.state && h.state.phase !== 'over') {
        h.pausedLeft = data.msLeft != null ? Math.max(data.msLeft, 5000) : h.phaseMs();
        h.updateDisconnectPause(true);
        if (!h.isPaused()) { h.deadline = Date.now() + h.pausedLeft; h.pausedLeft = null; }
      }
      return h;
    }
    destroy() { clearInterval(this.iv); this.bots = {}; }

    isConnected(seat) {
      const s = this.seats[seat];
      if (!s) return false;
      if (seat === 0 || s.bot) return true;
      return !!(this.net && this.net.connected(seat));
    }
    humanSeats() { return this.seats.map((s, i) => (s && !s.bot ? i : -1)).filter((i) => i >= 0); }
    names() { return this.seats.map((s) => (s ? s.name : '')); }
    allFilled() { return this.seats.every(Boolean); }

    onHello(cid, name) {
      const have = this.seats.findIndex((s) => s && !s.bot && s.cid === cid);
      if (have > 0) { if (name) this.seats[have].name = name; return have; }
      if (this.state) {
        const gone = this.seats.findIndex((s, i) => i > 0 && s && !s.bot && !this.isConnected(i));
        if (gone < 0) return -1;
        this.seats[gone].cid = cid;
        if (name) this.seats[gone].name = name;
        return gone;
      }
      const free = this.seats.findIndex((s) => !s);
      if (free < 0) return -1;
      this.seats[free] = { name: name || '', cid, bot: false };
      return free;
    }
    onJoin() {
      if (this.state) { this.state.names = this.names(); this.updateDisconnectPause(); }
      else this.push();
    }
    onDrop(seat) {
      if (!this.state) { this.seats[seat] = null; this.push(); return; }
      this.updateDisconnectPause();
    }
    updateDisconnectPause(silent) {
      const st = this.state;
      const missing = !!st && st.phase !== 'over' && this.humanSeats().some((i) => !st.out[i] && !this.isConnected(i));
      if (silent) { if (missing) this.pauses.disconnect = true; else delete this.pauses.disconnect; return; }
      this.setPause('disconnect', missing);
    }
    addBot() {
      if (this.state) return;
      const free = this.seats.findIndex((s) => !s);
      if (free < 0) return;
      this.seats[free] = { name: '', cid: 'bot' + free, bot: true };
      this.bots[free] = new BotSeat(this, free);
      this.push();
    }
    removeBot(seat) {
      if (this.state || !this.seats[seat] || !this.seats[seat].bot) return;
      this.seats[seat] = null;
      delete this.bots[seat];
      this.push();
    }

    startGame() {
      if (!this.allFilled()) return;
      const order = shuffle(Array.from({ length: this.n }, (_, i) => i));
      this.state = LL.newGame(this.settings, order);
      this.state.names = this.names();
      this.games++;
      this.rematch = [];
      this.turnKey = '';
      delete this.pauses.manual;
      this.afterAction();
    }

    phaseMs() {
      const st = this.state;
      if (!st || st.phase === 'over') return 0;
      if (PHASE_FIXED[st.phase]) return PHASE_FIXED[st.phase];
      return st.settings.turnSec * 1000;
    }
    keyOf(st) { return st ? [st.id, st.phase, st.round, st.r ? st.r.actor : -1, st.logNo].join(':') : ''; }
    isPaused() { return Object.keys(this.pauses).length > 0; }
    // 단계·차례가 바뀌었을 때만 시계를 새로 건다(공개 카드 고르기는 모두 같은 시계)
    afterAction() {
      const st = this.state;
      const key = this.keyOf(st);
      if (key !== this.turnKey) {
        this.turnKey = key;
        if (st && st.phase === 'over') delete this.pauses.manual;
        const ms = this.phaseMs();
        if (!ms) { this.deadline = 0; this.pausedLeft = null; }
        else if (this.isPaused()) { this.deadline = 0; this.pausedLeft = ms; }
        else { this.deadline = Date.now() + ms; this.pausedLeft = null; }
      }
      this.push();
    }
    setPause(reason, on, by) {
      const was = this.isPaused();
      if (on) this.pauses[reason] = by == null ? true : by;
      else delete this.pauses[reason];
      const now = this.isPaused();
      if (!was && now && this.deadline) { this.pausedLeft = Math.max(0, this.deadline - Date.now()); this.deadline = 0; }
      if (was && !now && this.pausedLeft != null) { this.deadline = Date.now() + Math.max(this.pausedLeft, 3000); this.pausedLeft = null; }
      this.push();
    }
    msLeft() {
      if (this.pausedLeft != null) return this.pausedLeft;
      return this.deadline ? Math.max(0, this.deadline - Date.now()) : 0;
    }
    tick() {
      const now = Date.now(), gap = now - this.lastTick;
      this.lastTick = now;
      if (!this.state || !this.deadline) return;
      if (gap > 3000) { this.deadline += gap; this.push(); return; } // 기기가 잠들었던 시간은 빼 준다
      if (now >= this.deadline) this.onTimeout();
    }
    onTimeout() {
      const st = this.state;
      this.deadline = 0;
      try {
        switch (st.phase) {
          case 'lottery': LL.beginRound(st); break;
          case 'roll': LL.endRoll(st); break;
          case 'reveal': LL.autoReveal(st); break;
          case 'bet': LL.autoBet(st); break;
          case 'hit': LL.applyStay(st, st.r.actor, true); break;
          case 'result': LL.nextRound(st); break;
        }
      } catch (e) { console.error(e); }
      this.turnKey = '';
      this.afterAction();
    }
    readyNeeded() {
      const st = this.state;
      return this.humanSeats().filter((i) => !st.out[i] && this.isConnected(i));
    }

    handle(seat, m) {
      if (!m || typeof m !== 'object') return;
      const st = this.state;
      try {
        switch (m.t) {
          case 'reveal':
            if (!st) return;
            LL.applyReveal(st, seat, m.idx);
            this.afterAction();
            break;
          case 'bet':
            if (!st) return;
            LL.applyBet(st, seat, m.a, m.amount);
            this.afterAction();
            break;
          case 'hit':
            if (!st) return;
            LL.applyHit(st, seat);
            this.afterAction();
            break;
          case 'stay':
            if (!st) return;
            LL.applyStay(st, seat);
            this.afterAction();
            break;
          case 'ready':
            if (!st || st.phase !== 'result' || !st.r) return;
            st.r.ready[seat] = true;
            if (this.readyNeeded().every((i) => st.r.ready[i])) LL.nextRound(st);
            this.afterAction();
            break;
          case 'pause':
            if (st && st.phase !== 'over') this.setPause('manual', !!m.on, seat);
            break;
          case 'resign':
            if (!st) return;
            LL.resign(st, seat);
            this.afterAction();
            break;
          case 'rematch':
            if (!st || st.phase !== 'over') return;
            this.rematch[seat] = true;
            if (this.humanSeats().every((i) => this.rematch[i])) this.startGame();
            else this.push();
            break;
          case 'emote':
            if (EMOTES.includes(m.e)) this.seats.forEach((s, i) => { if (s && i !== seat) this.sendTo(i, { t: 'emote', e: m.e, from: seat }); });
            break;
        }
      } catch (e) {
        if (e instanceof LL.RuleError) this.sendTo(seat, { t: 'err', code: e.code });
        else console.error(e);
      }
    }

    sendTo(seat, msg) {
      if (seat === 0) this.onLocal(msg);
      else if (this.bots[seat]) this.bots[seat].send(msg);
      else if (this.net) this.net.send(seat, msg);
    }
    message(seat) {
      const common = {
        code: this.code, me: seat, n: this.n,
        seats: this.seats.map((s, i) => (s ? { name: s.name, bot: !!s.bot, here: this.isConnected(i) } : null)),
      };
      if (!this.state) return Object.assign(common, { t: 'lobby', settings: this.settings });
      return Object.assign(common, {
        t: 'view',
        view: LL.viewFor(this.state, seat),
        msLeft: this.msLeft(),
        phaseMs: this.phaseMs(),
        paused: this.isPaused(),
        pauses: Object.assign({}, this.pauses),
        rematch: this.seats.map((_, i) => !!this.rematch[i]),
      });
    }
    push() {
      this.seats.forEach((s, i) => { if (s) this.sendTo(i, this.message(i)); });
      if (this.persistOn) this.persist();
    }
    persist() {
      save(K.host, {
        code: this.code, settings: this.settings, seats: this.seats, state: this.state, games: this.games,
        rematch: this.rematch, turnKey: this.turnKey, msLeft: this.msLeft(), savedAt: Date.now(),
      });
    }
  }

  // ───────── 봇 자리: 방장 브라우저 안에서 돈다 ─────────
  class BotSeat {
    constructor(host, seat) { this.host = host; this.seat = seat; this.done = new Set(); }
    send(m) {
      if (m.t !== 'view') return;
      const v = m.view, h = this.host, seat = this.seat;
      const once = (key, ms, fn) => {
        if (this.done.has(key)) return;
        this.done.add(key);
        setTimeout(() => {
          const st = h.state;
          if (h.bots[seat] !== this || !st || st.id !== v.id || st.logNo !== v.logNo || st.phase !== v.phase) return;
          if (h.isPaused()) { this.done.delete(key); return; } // 다시 시작하면 push가 와서 다시 시도
          fn(LL.viewFor(st, seat));
        }, ms);
      };
      const r = v.r;
      const key = `${v.id}:${v.logNo}:${v.phase}`;
      if (v.phase === 'reveal' && r.inHand[seat] && !r.folded[seat] && r.pick[seat] < 0) {
        once(key + ':rv', 900 + Math.random() * 1900, (fresh) => h.handle(seat, { t: 'reveal', idx: Bot.chooseReveal(fresh) }));
      } else if (v.phase === 'bet' && v.current === seat) {
        once(key + ':bet', 1100 + Math.random() * 1500, (fresh) => {
          const d = Bot.chooseBet(fresh);
          h.handle(seat, { t: 'bet', a: d.a, amount: d.amount });
        });
      } else if (v.phase === 'hit' && v.current === seat) {
        once(key + ':hit', 900 + Math.random() * 1200, (fresh) => h.handle(seat, { t: Bot.chooseHit(fresh) }));
      } else if (v.phase === 'over' && m.rematch.some(Boolean) && !m.rematch[seat]) {
        once(v.id + ':re', 700, () => h.handle(seat, { t: 'rematch' }));
      }
    }
  }

  // ───────── PeerJS 연결: 방장 쪽 (참가자 여럿) ─────────
  class HostNet {
    constructor(code, cb) {
      this.code = code; this.cb = cb;
      this.peer = null;
      this.bySeat = {};  // seat → { conn, lastSeen }
      this.hb = setInterval(() => this.heartbeat(), 2000);
    }
    start() {
      if (this.peer) { try { this.peer.destroy(); } catch (e) { /* 무시 */ } }
      const peer = new Peer(PEER_PREFIX + this.code, { debug: 1 });
      this.peer = peer;
      peer.on('open', () => this.cb.onOpen());
      peer.on('connection', (conn) => this.accept(conn));
      peer.on('disconnected', () => { setTimeout(() => { if (this.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); });
      peer.on('error', (err) => { if (this.peer === peer) this.cb.onError(err); });
    }
    accept(conn) {
      conn.on('data', (m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'hello') {
          const seat = this.cb.onHello(String(m.cid || ''), String(m.name || '').slice(0, 12));
          if (seat < 0) {
            try { conn.send({ t: 'full' }); } catch (e) { /* 무시 */ }
            setTimeout(() => { try { conn.close(); } catch (e) { /* 무시 */ } }, 600);
            return;
          }
          const old = this.bySeat[seat];
          if (old && old.conn !== conn) { try { old.conn.close(); } catch (e) { /* 무시 */ } }
          conn._seat = seat;
          this.bySeat[seat] = { conn, lastSeen: Date.now() };
          this.cb.onJoin(seat);
          return;
        }
        const seat = conn._seat, rec = seat != null ? this.bySeat[seat] : null;
        if (!rec || rec.conn !== conn) return;
        rec.lastSeen = Date.now();
        if (m.t === 'pong') return;
        this.cb.onMessage(seat, m);
      });
      const gone = () => { const seat = conn._seat; if (seat != null && this.bySeat[seat] && this.bySeat[seat].conn === conn) this.drop(seat); };
      conn.on('close', gone);
      conn.on('error', gone);
    }
    heartbeat() {
      const now = Date.now();
      for (const seat of Object.keys(this.bySeat)) {
        const rec = this.bySeat[seat];
        this.send(+seat, { t: 'ping' });
        if (now - rec.lastSeen > 9000) this.drop(+seat);
      }
    }
    drop(seat) {
      const rec = this.bySeat[seat];
      if (!rec) return;
      delete this.bySeat[seat];
      try { rec.conn.close(); } catch (e) { /* 무시 */ }
      this.cb.onDrop(seat);
    }
    connected(seat) { return !!this.bySeat[seat]; }
    send(seat, m) {
      const rec = this.bySeat[seat];
      if (rec && rec.conn.open) { try { rec.conn.send(m); } catch (e) { /* 끊김은 heartbeat가 처리 */ } }
    }
    destroy() {
      clearInterval(this.hb);
      for (const seat of Object.keys(this.bySeat)) { try { this.bySeat[seat].conn.close(); } catch (e) { /* 무시 */ } }
      this.bySeat = {};
      try { this.peer && this.peer.destroy(); } catch (e) { /* 무시 */ }
    }
  }

  // ───────── PeerJS 연결: 참가자 쪽 ─────────
  class GuestNet {
    constructor(code, cid, name, h) {
      this.code = code; this.cid = cid; this.name = name; this.h = h;
      this.peer = null; this.conn = null; this.connected = false; this.ever = false;
      this.attempts = 0; this.stopped = false; this.lastSeen = 0;
      this.hb = setInterval(() => { if (this.connected && Date.now() - this.lastSeen > 9000) this.lost(); }, 2000);
    }
    start() {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      peer.on('open', () => this.connect());
      peer.on('disconnected', () => { setTimeout(() => { if (!this.stopped && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); });
      peer.on('error', (err) => {
        if (this.stopped) return;
        if (err.type === 'peer-unavailable') this.lost();
        else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) this.h.onStatus('reconnecting');
        else console.warn('peer error', err.type, err);
      });
    }
    connect() {
      if (this.stopped) return;
      clearTimeout(this.retryT); clearTimeout(this.openT);
      if (this.conn) { const old = this.conn; this.conn = null; try { old.close(); } catch (e) { /* 무시 */ } }
      this.attempts++;
      const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => {
        if (conn !== this.conn) return;
        clearTimeout(this.openT);
        this.connected = true; this.ever = true; this.attempts = 0;
        this.lastSeen = Date.now();
        conn.send({ t: 'hello', cid: this.cid, name: this.name });
        this.h.onStatus('connected');
      });
      conn.on('data', (m) => {
        if (conn !== this.conn || !m || typeof m !== 'object') return;
        this.lastSeen = Date.now();
        if (m.t === 'ping') { try { conn.send({ t: 'pong' }); } catch (e) { /* 무시 */ } return; }
        if (m.t === 'full') { this.stop(); this.h.onStatus('full'); return; }
        this.h.onMessage(m);
      });
      conn.on('close', () => { if (conn === this.conn) this.lost(); });
      this.openT = setTimeout(() => { if (conn === this.conn && !conn.open) this.lost(); }, 9000);
    }
    lost() {
      if (this.stopped) return;
      this.connected = false;
      if (!this.ever && this.attempts >= 4) { this.stop(); this.h.onStatus('notfound'); return; }
      this.h.onStatus(this.ever ? 'reconnecting' : 'connecting');
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => {
        if (this.stopped) return;
        if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
        else this.connect();
      }, 2500);
    }
    send(m) { if (this.conn && this.conn.open) { try { this.conn.send(m); } catch (e) { /* 무시 */ } } }
    stop() {
      this.stopped = true;
      clearInterval(this.hb); clearTimeout(this.retryT); clearTimeout(this.openT);
      try { this.conn && this.conn.close(); } catch (e) { /* 무시 */ }
      try { this.peer && this.peer.destroy(); } catch (e) { /* 무시 */ }
    }
    destroy() { this.stop(); }
  }

  // ───────── 앱 상태 ─────────
  const app = {
    mode: 'lobby',       // lobby | host | guest | solo
    screen: 'lobby',
    host: null,
    net: null,
    netStatus: '',
    msg: null,
    view: null,
    deadlineAt: 0,
    ui: freshUi(''),
    sig: {},
    overlaySig: null,
    dismissed: {},
    saved: new Set(load(K.records, []).map((r) => r.id)),
    needed: false,
    lastTickSec: -1,
    formMode: 'create',
    fx: { round: '', born: {}, flip: {} },
    die: { round: '', until: 0, iv: 0 },
    lotto: { id: '', at: 0, t: 0 },
  };
  function freshUi(key) { return { key, pick: null, raise: 1 }; }
  function resetSigs() { app.sig = {}; app.overlaySig = null; }

  function act(m) {
    if (app.host) app.host.handle(0, m);
    else if (app.net) app.net.send(m);
  }

  function show(screen) {
    app.screen = screen;
    for (const id of ['lobby', 'room', 'game']) $('#' + id).hidden = id !== screen;
    window.scrollTo(0, 0);
  }

  const myName = () => ($('#name').value.trim() || '').slice(0, 12);
  const colorName = (seat) => tr('color.' + colorKey(seat));
  // 이름을 비워 둔 사람은 각자 화면의 언어로 인형 색 이름으로 보인다.
  function nameOf(seat, seats) {
    seats = seats || (app.msg && app.msg.seats) || [];
    const s = seats[seat];
    if (s && s.name) return s.name;
    if (app.view && app.view.names && app.view.names[seat]) return app.view.names[seat];
    return colorName(seat) + (s && s.bot ? ' ' + tr('role.bot') : '');
  }
  const recName = (rec, seat) => rec.names[seat] || (colorName(seat) + (rec.bots && rec.bots[seat] ? ' ' + tr('role.bot') : ''));
  const avaImg = (seat, cls) => `<img class="ava ${cls || ''}" src="${avaSrc(seat)}" alt="" draggable="false">`;

  // ───────── 메시지 받기 ─────────
  function onMessage(m) {
    switch (m.t) {
      case 'lobby':
        app.msg = m;
        app.view = null;
        if (app.screen !== 'room') show('room');
        renderRoom();
        break;
      case 'view':
        onView(m);
        break;
      case 'err':
        toast(tr('err.' + m.code), 'err');
        break;
      case 'emote':
        showBubble(m.from, m.e);
        break;
    }
  }

  function uiKey(v) { return [v.id, v.round, v.phase, v.r ? v.r.actor : -1, v.logNo].join(':'); }

  function onView(m) {
    const prev = app.view;
    app.msg = m;
    app.view = m.view;
    app.deadlineAt = performance.now() + (m.msLeft || 0);
    const v = m.view;
    if (app.screen !== 'game') { show('game'); resetSigs(); }
    const key = uiKey(v);
    if (app.ui.key !== key) {
      const keepPick = v.phase === 'reveal' && prev && prev.phase === 'reveal' && prev.round === v.round ? app.ui.pick : null;
      app.ui = freshUi(key);
      app.ui.pick = keepPick;
      if (v.phase === 'bet' && v.r && v.r.bet) {
        const info = LL.betInfo(v, v.me);
        app.ui.raise = Math.max(1, Math.min(info.maxRaise, Math.max(1, Math.round(info.pot / 3))));
      }
    }
    trackFx(prev, v);
    playSounds(prev, v);
    if (v.phase === 'over') saveRecord(v);
    const need = needsMe(v);
    if (need && !app.needed) {
      Sound.turn();
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(40);
      if (window.innerWidth <= 900 && v.phase !== 'reveal') setTimeout(() => { const p = $('#panel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 80);
    }
    app.needed = need;
    document.title = (need ? '● ' : '') + tr('doc.title');
    render();
  }

  // 새로 나온 카드(돌리기·히트)와 뒤집힌 카드(공개·쇼다운)를 기억해 짧게 움직인다
  function trackFx(prev, v) {
    const now = performance.now();
    const rk = v.id + ':' + v.round;
    const fx = app.fx;
    if (!v.r) return;
    if (fx.round !== rk) {
      fx.round = rk; fx.born = {}; fx.flip = {};
      // 처음 보는 라운드: 돌리는 중(roll)이면 차례로 날아오게
      if (v.phase === 'roll' && (!prev || prev.round !== v.round || prev.id !== v.id)) {
        let k = 0;
        for (let c = 0; c < LL.HAND; c++) for (const s of v.order) if (v.r.hands[s].length > c) fx.born[s + ':' + c] = now + 1550 + (k++) * 70;
      }
      return;
    }
    if (!prev || !prev.r || prev.round !== v.round) return;
    for (let s = 0; s < v.n; s++) {
      const a = prev.r.hands[s] || [], b = v.r.hands[s] || [];
      for (let i = 0; i < b.length; i++) {
        if (i >= a.length) fx.born[s + ':' + i] = now;
        else if ((a[i].v == null && b[i].v != null) || (!a[i].up && b[i].up)) fx.flip[s + ':' + i] = now;
      }
    }
  }
  function fxClass(s, i) {
    const now = performance.now(), fx = app.fx;
    const b = fx.born[s + ':' + i], f = fx.flip[s + ':' + i];
    if (b != null && now - b < 650) return { cls: ' born', style: `animation-delay:${Math.max(0, b - now).toFixed(0)}ms` };
    if (f != null && now - f < 650) return { cls: ' flip', style: '' };
    return { cls: '', style: '' };
  }

  function playSounds(prev, v) {
    if (!prev || prev.id !== v.id) {
      if (v.phase === 'lottery') startLotto(v);
      return;
    }
    if (v.phase === 'lottery' && prev.phase !== 'lottery') startLotto(v);
    if (v.phase === 'roll' && (prev.phase !== 'roll' || prev.round !== v.round)) {
      startDie(v);
      setTimeout(() => Sound.deal(Math.min(10, v.order.filter((s) => v.r.inHand[s]).length * 3)), 1500);
      Sound.chips();
    }
    if (v.logNo <= prev.logNo) return;
    const fresh = v.log.slice(-(v.logNo - prev.logNo));
    let flipped = false;
    for (const e of fresh) {
      if (e.k === 'reveal') { if (!flipped) Sound.flip(); flipped = true; }
      else if (e.k === 'bet') { if (e.a === 'fold') Sound.fold(); else if (e.pay) Sound.chip(); else Sound.stay(); }
      else if (e.k === 'hit') Sound.card();
      else if (e.k === 'stay') Sound.stay();
      else if (e.k === 'win') {
        setTimeout(() => {
          if (e.winners.includes(v.me)) Sound.chips(); else if (e.reason === 'showdown') Sound.flip();
        }, 200);
      }
    }
    if (v.phase === 'over' && prev.phase !== 'over') {
      const mine = v.result.ranking.find((r) => r.seat === v.me);
      setTimeout(() => { if (mine && mine.rank === 1) Sound.win(); else Sound.lose(); }, 600);
    }
  }

  function needsMe(v) {
    const r = v.r;
    if (!r || v.out[v.me]) return false;
    if (v.phase === 'reveal') return r.inHand[v.me] && !r.folded[v.me] && r.pick[v.me] < 0;
    return (v.phase === 'bet' || v.phase === 'hit') && v.current === v.me;
  }
  function myTurn() {
    const v = app.view;
    return !!v && app.screen === 'game' && needsMe(v) && !(app.msg && app.msg.paused);
  }

  function saveRecord(v) {
    if (app.saved.has(v.id)) return;
    const recs = load(K.records, []).filter((r) => r.id !== v.id);
    const m = app.msg;
    recs.unshift({
      id: v.id, at: Date.now(), settings: v.settings, names: v.names, order: v.order, me: v.me,
      rounds: v.rounds, result: v.result, mode: app.mode, bots: m.seats.map((s) => !!(s && s.bot)),
    });
    save(K.records, recs.slice(0, 30));
    app.saved.add(v.id);
  }

  // ───────── 주사위 · 추첨 ─────────
  function dieSvg(num, idAttr) {
    // 8면체를 꼭짓점 쪽에서 본 모습: 육각형 윤곽 + 앞면 삼각형
    return `<svg class="die-svg" viewBox="0 0 100 100" aria-hidden="true">
      <polygon class="d-side d1" points="50,5 92,28 92,72"/>
      <polygon class="d-side d2" points="92,72 50,95 8,72"/>
      <polygon class="d-side d3" points="8,72 8,28 50,5"/>
      <polygon class="d-front" points="50,5 92,72 8,72"/>
      <polygon class="d-stitch" points="50,15 83,67 17,67"/>
      <text class="d-num" ${idAttr ? `id="${idAttr}"` : ''} x="50" y="57">${num == null ? '?' : num}</text>
    </svg>`;
  }
  function startDie(v) {
    const d = app.die;
    d.round = v.id + ':' + v.round;
    d.until = performance.now() + 1500;
    d.final = v.r.limit;
    clearInterval(d.iv);
    Sound.dice();
    d.iv = setInterval(() => {
      const el = $('#die-num');
      if (performance.now() >= d.until) {
        clearInterval(d.iv);
        if (el) el.textContent = d.final;
        const w = $('#die-wrap'); if (w) { w.classList.remove('rolling'); w.classList.add('landed'); }
        return;
      }
      if (el) el.textContent = LL.DIE[Math.floor(Math.random() * LL.DIE.length)];
    }, 85);
  }
  const dieRolling = (v) => app.die.round === v.id + ':' + v.round && performance.now() < app.die.until;

  function startLotto(v) {
    const L = app.lotto;
    if (L.id === v.id) return;
    L.id = v.id; L.at = performance.now();
    clearTimeout(L.t);
    L.t = setTimeout(() => { Sound.pop(); app.sig.center = ''; if (app.view) renderTable(); }, 2600);
  }
  function lotteryHtml(v) {
    const done = app.lotto.id === v.id && performance.now() - app.lotto.at >= 2550;
    const balls = v.order.map((s, i) => {
      const picked = done && s === v.firstStart;
      return `<span class="ball ${picked ? 'picked' : ''}" style="${seatVars(s)};--i:${i};--dx:${(i - (v.n - 1) / 2) * 34}px">${avaImg(s)}</span>`;
    }).join('');
    return `<div class="lotto ${done ? 'done' : ''}">
      <div class="bowl">${balls}</div>
      <div class="lotto-cap">${done ? tr('lotto.picked', { name: esc(nameOf(v.firstStart)) }) : tr('lotto.mixing')}</div>
    </div>`;
  }

  // ───────── 카드 ─────────
  function cardHtml(c, s, i, opts) {
    opts = opts || {};
    const back = c.v == null;
    let cls = 'ncard ' + (opts.big ? 'big' : 'mini');
    if (back) cls += ' back';
    else cls += c.v < 0 ? ' neg' : ' v' + c.v;
    if (c.hit) cls += ' hit';
    if (opts.secret) cls += ' secret';
    if (opts.sel) cls += ' sel';
    if (opts.pickable) cls += ' pickable';
    if (opts.dim) cls += ' dim';
    const fx = fxClass(s, i);
    cls += fx.cls;
    const lab = back ? '' : cardLabel(c.v);
    const inner = back ? '' : opts.big
      ? `<span class="c-tl">${lab}</span><span class="n">${lab}</span><span class="c-br">${lab}</span>`
      : `<span class="n">${lab}</span>`;
    const tag = opts.secret ? `<i class="secret-tag">${tr('card.secret')}</i>` : opts.shown ? `<i class="shown-tag">${tr('card.shown')}</i>` : '';
    const attrs = opts.pickable ? ` role="button" tabindex="0" data-act="pick-card" data-i="${i}" aria-label="${esc(tr('card.pickAria', { v: lab }))}"` : '';
    return `<div class="${cls}" style="${fx.style}"${attrs}>${inner}${tag}</div>`;
  }

  // ───────── 좌석 ─────────
  function seatStatus(v, s) {
    const r = v.r, m = app.msg, info = m.seats[s] || {};
    if (v.out[s]) return { text: v.resigned[s] ? tr('st.resigned') : tr('st.out'), cls: 'bad' };
    if (!info.here) return { text: tr('st.offline'), cls: 'bad' };
    if (!r) return { text: '', cls: '' };
    const o = r.outcome;
    if (o && (v.phase === 'result' || v.phase === 'over')) {
      if (o.winners.includes(s)) return { text: tr('st.won', { n: o.gains[s] }), cls: 'win' };
      if (r.folded[s]) return { text: tr('st.folded'), cls: 'muted' };
      if (o.reason === 'showdown') {
        const row = o.rows.find((x) => x.seat === s);
        if (row && row.bust) return { text: tr('st.bust'), cls: 'bad' };
        return { text: tr('st.lost'), cls: 'muted' };
      }
      return { text: '', cls: '' };
    }
    if (r.folded[s]) return { text: tr('st.folded'), cls: 'muted' };
    if (v.phase === 'reveal') return r.picked[s] ? { text: tr('st.picked'), cls: 'ok' } : { text: tr('st.picking'), cls: 'think' };
    if (v.current === s) return { text: tr(v.phase === 'bet' ? 'st.betting' : 'st.thinking'), cls: 'think' };
    const a = r.acts[s];
    if (a) {
      if (a.a === 'raise') return { text: tr('act.raise', { n: a.by }), cls: 'hot' };
      if (a.a === 'call') return { text: tr('act.call', { n: a.pay }), cls: '' };
      if (a.a === 'check') return { text: tr('act.check'), cls: '' };
      if (a.a === 'hit') return { text: tr('act.hit'), cls: '' };
      if (a.a === 'stay') return { text: tr('act.stay'), cls: 'ok' };
    }
    if (v.phase === 'hit' && r.stayed[s]) return { text: tr('act.stay'), cls: 'ok' };
    if (v.phase === 'bet' && r.stayed[s]) return { text: tr('act.stay'), cls: 'muted' };
    return { text: '', cls: '' };
  }
  function shownAll(v, s) {
    const r = v.r;
    return !!(r && r.outcome && r.outcome.reason === 'showdown' && r.inHand[s] && !r.folded[s]);
  }
  function sumLabel(v, s) {
    const r = v.r;
    if (!r || !r.inHand[s]) return '';
    const hand = r.hands[s];
    if (s === v.me || shownAll(v, s)) {
      const t = LL.handSum(hand), over = t > r.limit;
      return `<span class="sum ${over ? 'over' : ''}">${tr('sum.total', { n: t })}</span>`;
    }
    const hidden = hand.filter((c) => c.v == null).length;
    if (!hand.some((c) => c.up)) return '';
    return `<span class="sum vis">${tr('sum.visible', { n: LL.upSum(hand) })}${hidden ? ` <small>+${'?'.repeat(Math.min(hidden, 3))}</small>` : ''}</span>`;
  }

  function oppHtml(v, s, idx, k) {
    const r = v.r, info = app.msg.seats[s] || {};
    const st = seatStatus(v, s);
    const cur = v.current === s;
    const hand = r && r.inHand[s] ? r.hands[s] : [];
    const o = r && r.outcome;
    const win = o && o.winners.includes(s) && (v.phase === 'result' || v.phase === 'over');
    const t = (idx + 0.5) / k - 0.5;
    const lift = Math.round(Math.pow(Math.abs(t) * 2, 2) * 46);
    const cards = hand.map((c, i) => cardHtml(c, s, i, { dim: r.folded[s] })).join('');
    const contrib = r && r.inHand[s] ? r.contrib[s] : 0;
    return `<div class="seat opp ${cur ? 'cur' : ''} ${r && r.folded[s] ? 'folded' : ''} ${v.out[s] ? 'out' : ''} ${win ? 'win' : ''}" data-seat="${s}" style="${seatVars(s)};--lift:${lift}px">
      <div class="ava-wrap">${avaImg(s)}${r && r.start === s && !v.out[s] ? `<span class="start-badge" title="${esc(tr('badge.startTitle'))}">${tr('badge.start')}</span>` : ''}</div>
      <div class="s-name"><span>${esc(nameOf(s))}</span>${info.bot && info.name ? `<small class="bot-tag">${tr('role.bot')}</small>` : ''}</div>
      <div class="s-chips"><i class="chip-ico"></i><b>${v.chips[s]}</b></div>
      <div class="s-status ${st.cls}">${st.text || '&nbsp;'}</div>
      <div class="mini-hand">${cards}</div>
      <div class="s-sum">${sumLabel(v, s)}</div>
      ${contrib ? `<div class="s-bet" title="${esc(tr('bet.contribTitle'))}"><i class="chip-ico sm"></i>${contrib}</div>` : '<div class="s-bet empty"></div>'}
    </div>`;
  }

  function meHtml(v) {
    const s = v.me, r = v.r;
    const st = seatStatus(v, s);
    const cur = needsMe(v);
    const o = r && r.outcome;
    const win = o && o.winners.includes(s) && (v.phase === 'result' || v.phase === 'over');
    const hand = r && r.inHand[s] ? r.hands[s] : [];
    const picking = v.phase === 'reveal' && r && r.inHand[s] && !r.folded[s] && r.pick[s] < 0 && !(app.msg && app.msg.paused);
    const selIdx = picking ? app.ui.pick : (v.phase === 'reveal' && r ? r.pick[s] : -1);
    const cards = hand.map((c, i) => cardHtml(c, s, i, {
      big: true, secret: !c.up && !shownAll(v, s), shown: c.up && !c.hit, sel: selIdx === i, pickable: picking, dim: r.folded[s],
    })).join('');
    const contrib = r && r.inHand[s] ? r.contrib[s] : 0;
    let gauge = '';
    if (r && hand.length) {
      const t = LL.handSum(hand), L = r.limit;
      const pct = Math.max(0, Math.min(100, (Math.max(0, t) / Math.max(L, 1)) * 100));
      gauge = `<div class="gauge ${t > L ? 'over' : t === L ? 'exact' : ''}" title="${esc(tr('sum.gaugeTitle'))}">
        <div class="g-bar"><i style="width:${pct}%"></i></div>
        <div class="g-text">${tr('sum.mine', { n: t, L })} <small>· ${tr('sum.cards', { n: hand.length })}</small></div></div>`;
    }
    const spectator = v.out[s];
    return `<div class="seat me ${cur ? 'cur' : ''} ${r && r.folded[s] ? 'folded' : ''} ${spectator ? 'out' : ''} ${win ? 'win' : ''}" data-seat="${s}" style="${seatVars(s)}">
      ${contrib ? `<div class="s-bet me-bet" title="${esc(tr('bet.contribTitle'))}"><i class="chip-ico sm"></i>${contrib}</div>` : ''}
      <div class="me-row">
        <div class="ava-wrap">${avaImg(s)}${r && r.start === s && !spectator ? `<span class="start-badge" title="${esc(tr('badge.startTitle'))}">${tr('badge.start')}</span>` : ''}</div>
        <div class="me-info">
          <div class="s-name"><span>${esc(nameOf(s))}</span><small class="you-tag">${tr('role.you')}</small></div>
          <div class="s-chips"><i class="chip-ico"></i><b>${v.chips[s]}</b> <small>${tr('unit.chips')}</small></div>
          <div class="s-status ${st.cls}">${st.text || '&nbsp;'}</div>
        </div>
      </div>
      <div class="me-main">${spectator ? `<p class="spectate">${tr('me.spectate')}</p>` : `<div class="my-hand ${picking ? 'picking' : ''}" style="--cnt:${hand.length}">${cards}</div>${gauge}`}</div>
    </div>`;
  }

  function centerHtml(v) {
    if (v.phase === 'lottery') return lotteryHtml(v);
    const r = v.r;
    if (!r) return '';
    const rolling = dieRolling(v);
    const die = `<div class="die-block"><div class="die-wrap ${rolling ? 'rolling' : ''}" id="die-wrap">${dieSvg(rolling ? LL.DIE[Math.floor(Math.random() * 8)] : r.limit, 'die-num')}</div><div class="die-cap">${tr('center.limit')}</div></div>`;
    const o = r.outcome;
    let mid;
    if (o && (v.phase === 'result' || v.phase === 'over')) {
      const head = o.allBust ? tr('win.allBust') : o.split ? tr('win.split') : tr('win.one', { name: esc(nameOf(o.winners[0])) });
      mid = `<div class="win-banner ${o.winners.includes(v.me) ? 'mine' : ''}">
        <div class="wb-avas">${o.winners.map((s) => `<span style="${seatVars(s)}">${avaImg(s)}</span>`).join('')}</div>
        <b>${head}</b>
        <span class="wb-gain"><i class="chip-ico"></i>${o.split ? o.winners.map((s) => '+' + o.gains[s]).join(' / ') : '+' + o.pot}</span>
      </div>`;
    } else {
      mid = `<div class="pot-block"><div class="pot-pile">${potPile(r.pot)}</div><b class="pot-num">${r.pot}</b><small>${tr('center.pot')}</small></div>`;
    }
    const deck = `<div class="deck-block"><div class="deck-stack ${r.deckLeft ? '' : 'empty'}"><i></i><i></i><i></i></div><b>${r.deckLeft}</b><small>${tr('center.deck')}</small></div>`;
    return `<div class="center-row">${die}${mid}${deck}</div>`;
  }
  function potPile(n) {
    const k = Math.min(9, Math.max(1, Math.ceil(n / 3)));
    let s = '';
    for (let i = 0; i < k; i++) s += `<i class="chip-ico" style="left:${8 + (i % 3) * 15 + (Math.floor(i / 3) % 2) * 6}px;bottom:${Math.floor(i / 3) * 8}px"></i>`;
    return s;
  }

  function renderTable() {
    const v = app.view;
    const m = app.msg;
    const others = [];
    const k0 = v.order.indexOf(v.me);
    for (let i = 1; i < v.n; i++) others.push(v.order[(k0 + i) % v.n]);
    const opps = others.map((s, i) => oppHtml(v, s, i, others.length)).join('');
    const center = centerHtml(v);
    const me = meHtml(v);
    const hud = v.round ? `<span>${tr('hud.round', { n: v.round })}</span><span>${tr('hud.ante', { n: v.ante })}</span>` : `<span>${tr('hud.start')}</span>`;
    const ph = phaseHint(v);
    const sigs = { opps: opps + window.I18N.lang, center: center + window.I18N.lang, me: me + window.I18N.lang, hud: hud + ph };
    if (sigs.opps !== app.sig.opps) { $('#opps').innerHTML = opps; $('#opps').style.setProperty('--k', String(others.length)); app.sig.opps = sigs.opps; }
    if (sigs.center !== app.sig.center || dieRolling(v)) {
      if (!(dieRolling(v) && $('#die-wrap') && app.sig.centerPhase === v.phase + v.round)) { $('#center').innerHTML = center; }
      app.sig.center = sigs.center;
      app.sig.centerPhase = v.phase + v.round;
    }
    if (sigs.me !== app.sig.me) { $('#me-seat').innerHTML = me; app.sig.me = sigs.me; }
    if (sigs.hud !== app.sig.hud) { $('#hud').innerHTML = hud + (ph ? `<span class="hud-ph">${ph}</span>` : ''); app.sig.hud = sigs.hud; }
    $('#table').classList.toggle('my-turn', myTurn());
    void m;
  }
  function phaseHint(v) {
    if (v.phase === 'bet' && v.r && v.r.bet) return tr('phase.betN', { n: v.r.bet.no });
    if (['lottery', 'roll', 'reveal', 'hit', 'result', 'over'].includes(v.phase)) return tr('phase.' + v.phase);
    return '';
  }

  function showBubble(seat, e) {
    const v = app.view;
    if (!v || app.screen !== 'game') return;
    const ava = $(`.seat[data-seat="${seat}"] .ava-wrap`);
    const table = $('#table');
    if (!ava || !table) return;
    const a = ava.getBoundingClientRect(), t = table.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = e === 'ㅋㅋ' ? tr('emote.lol') : e;
    el.style.left = (a.left - t.left + a.width / 2) + 'px';
    el.style.top = (a.top - t.top - 6) + 'px';
    $('#bubbles').appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  // ───────── 오른쪽: 단계 · 시계 · 내 할 일 ─────────
  function renderPhaseLabel() {
    const v = app.view;
    let html;
    if (v.phase === 'over') html = `${tr('phase.over')} <small>· ${tr('hud.rounds', { n: v.round })}</small>`;
    else if (v.phase === 'lottery') html = tr('phase.lottery');
    else {
      const who = v.current >= 0 ? ` <small>· ${esc(nameOf(v.current))}</small>` : '';
      html = `${tr('hud.round', { n: v.round })} · ${phaseHint(v)}${who}`;
    }
    $('#phase-label').innerHTML = html;
    $('#phase').style.setProperty('--pc', v.current >= 0 ? pal(v.current).base : 'var(--rose)');
  }
  function updateTimer() {
    const v = app.view, m = app.msg;
    if (!v || app.screen !== 'game') return;
    const el = $('#timer'), bar = $('#timebar');
    const total = m.phaseMs || 0;
    if (!total) { el.textContent = ''; el.className = 'timer'; bar.style.width = '0'; bar.className = ''; return; }
    if (m.paused) {
      el.textContent = tr('timer.paused');
      el.className = 'timer paused';
      bar.style.width = Math.min(100, (m.msLeft / total) * 100) + '%';
      return;
    }
    const left = Math.max(0, app.deadlineAt - performance.now());
    const sec = Math.ceil(left / 1000);
    el.textContent = fmtTime(sec);
    const low = sec <= 5 && ['reveal', 'bet', 'hit'].includes(v.phase);
    el.className = 'timer' + (low ? ' low' : '');
    bar.className = low ? 'low' : '';
    bar.style.width = Math.min(100, (left / total) * 100) + '%';
    if (needsMe(v) && sec <= 5 && sec > 0 && sec !== app.lastTickSec) { app.lastTickSec = sec; Sound.tick(); }
  }

  function renderPanel() {
    const v = app.view, m = app.msg, u = app.ui;
    const sig = JSON.stringify([uiKey(v), myTurn(), u.pick, u.raise, m.paused, m.rematch, v.r && v.r.ready, v.r && v.r.picked, window.I18N.lang, m.seats.map((s) => s && s.here)]);
    if (sig === app.sig.panel) return;
    app.sig.panel = sig;
    $('#panel').innerHTML = panelHtml(v);
  }

  function unseenHtml(v) {
    const cnt = LL.unseenCounts(v);
    const r = v.r;
    const hidden = r.hands.reduce((t, h, s) => t + (s === v.me ? 0 : h.filter((c) => c.v == null).length), 0);
    const cells = LL.VALUES.map((x) => `<span class="uc ${x < 0 ? 'neg' : ''} ${cnt[x] ? '' : 'zero'}"><b>${cardLabel(x)}</b><i>${cnt[x]}</i></span>`).join('');
    return `<div class="unseen"><div class="unseen-top">${tr('unseen.title')}<small>${tr('unseen.sub', { d: r.deckLeft, h: hidden })}</small></div><div class="unseen-row">${cells}</div></div>`;
  }

  function panelHtml(v) {
    const r = v.r, u = app.ui, m = app.msg, me = v.me;
    const turn = myTurn();
    if (v.phase === 'lottery') {
      return `<h3>${tr('pl.lottery.title')}</h3><p>${tr('pl.lottery.body')}</p><p class="hint">${tr('pl.lottery.hint')}</p>`;
    }
    if (v.phase === 'over') return overHtml(v);
    if (v.out[me] && v.phase !== 'result') {
      return `<h3>${tr('pl.spec.title')}</h3><p>${tr('pl.spec.body')}</p>`;
    }
    if (v.phase === 'roll') {
      return `<h3>${tr('pl.roll.title', { n: v.round })}</h3><p>${tr('pl.roll.body', { a: r.ante, name: esc(nameOf(r.start)) })}</p>${v.round > 1 && v.ante !== LL.anteFor(v.settings, v.round - 1) ? `<p class="hint up">${tr('pl.roll.anteUp', { n: v.ante })}</p>` : ''}${r.ante < v.ante ? `<p class="hint">${tr('pl.roll.anteCap', { n: r.ante })}</p>` : ''}`;
    }
    if (v.phase === 'reveal') {
      if (turn) {
        const sel = u.pick != null && r.hands[me][u.pick];
        return `<h3>${tr('pl.reveal.title')}</h3><p>${tr('pl.reveal.body', { L: r.limit })}</p>
          ${sel ? `<button class="btn primary wide" data-act="confirm-reveal">${tr('pl.reveal.confirm', { v: cardLabel(sel.v) })}</button>` : `<p class="hint">${tr('pl.reveal.tap')}</p>`}
          <p class="hint">${tr('pl.reveal.hint')}</p>`;
      }
      const need = v.order.filter((s) => r.inHand[s] && !r.folded[s]);
      const done = need.filter((s) => r.picked[s]).length;
      return `<h3>${tr('pl.revealWait.title')}</h3><p>${tr('pl.revealWait.body', { a: done, b: need.length })}</p><p class="hint">${tr('pl.reveal.hint')}</p>`;
    }
    if (v.phase === 'bet') {
      const info = LL.betInfo(v, me);
      const stats = `<div class="stats"><span>${tr('bet.pot')}<b>${info.pot}</b></span><span>${tr('bet.cur')}<b>${info.cur}</b></span><span>${tr('bet.cap')}<b>${info.cap}</b></span></div>`;
      if (turn) {
        const k = Math.max(1, Math.min(u.raise, info.maxRaise));
        const raiseBox = info.maxRaise > 0
          ? `<div class="raise-box">
              <div class="raise-top"><b>${tr('bet.raise')}</b><small>${tr('bet.raiseMax', { n: info.maxRaise })}</small></div>
              <div class="stepper">
                <button class="icon-btn" data-act="raise-dec" ${k <= 1 ? 'disabled' : ''} aria-label="${esc(tr('bet.less'))}">−</button>
                <output>+${k}</output>
                <button class="icon-btn" data-act="raise-inc" ${k >= info.maxRaise ? 'disabled' : ''} aria-label="${esc(tr('bet.more'))}">+</button>
              </div>
              <div class="quick">${[1, 2, 3, 5].filter((x) => x <= info.maxRaise).map((x) => `<button class="qbtn ${x === k ? 'on' : ''}" data-act="raise-set" data-n="${x}">+${x}</button>`).join('')}<button class="qbtn ${k === info.maxRaise ? 'on' : ''}" data-act="raise-set" data-n="${info.maxRaise}">${tr('bet.max')}</button></div>
              <button class="btn wide raise-go" data-act="raise">${tr('bet.raiseGo', { k, to: info.cur + k, pay: info.cur + k - info.mine })}</button>
            </div>`
          : `<p class="hint">${tr('bet.atCap')}</p>`;
        return `<h3>${tr('bet.titleMine', { n: info.no })}</h3>${stats}
          <div class="bet-btns">
            <button class="btn fold" data-act="fold">${tr('bet.fold')}</button>
            <button class="btn primary" data-act="call">${info.toCall ? tr('bet.call', { n: info.toCall }) : tr('bet.check')}</button>
          </div>
          ${raiseBox}
          <p class="hint">${tr('bet.hint')}</p>`;
      }
      const mine = r.folded[me] ? `<p class="hint">${tr('bet.youFolded')}</p>` : `<p class="hint">${tr('bet.youIn', { n: info.mine, c: info.toCall ? ' ' + tr('bet.youOwe', { n: info.toCall }) : '' })}</p>`;
      return `<h3>${tr('bet.titleWait', { n: info.no, name: esc(nameOf(v.current)) })}</h3>${stats}${mine}`;
    }
    if (v.phase === 'hit') {
      if (turn) {
        const t = LL.handSum(r.hands[me]);
        return `<h3>${tr('hit.titleMine')}</h3>
          <p class="sum-line ${t > r.limit ? 'over' : ''}">${tr('hit.sum', { n: t, L: r.limit })}${t > r.limit ? ` <b class="over-tag">${tr('hit.overTag')}</b>` : ''}</p>
          <div class="bet-btns big">
            <button class="btn primary big" data-act="hit"><b>${tr('hit.hit')}</b><small>${tr('hit.hitSub')}</small></button>
            <button class="btn big" data-act="stay"><b>${tr('hit.stay')}</b><small>${tr('hit.staySub')}</small></button>
          </div>
          ${unseenHtml(v)}
          <p class="hint">${tr('hit.hint')}</p>`;
      }
      let mine;
      if (r.folded[me]) mine = tr('hit.youFolded');
      else if (r.stayed[me]) mine = tr('hit.youStayed');
      else mine = tr('hit.youWait');
      return `<h3>${tr('hit.titleWait', { name: esc(nameOf(v.current)) })}</h3><p>${mine}</p>${!r.folded[me] ? unseenHtml(v) : ''}`;
    }
    if (v.phase === 'result') return resultHtml(v);
    return '';
  }

  function outcomeRows(v, o, hands) {
    // hands: seat → values[] (쇼다운) | null
    const r = v.r;
    const order = LL.fromStart(v, (s) => r && r.inHand[s], r.start);
    const rows = order.map((s) => {
      const win = o.winners.includes(s);
      let cards, sum = '', tag = '';
      if (hands && hands[s]) {
        cards = hands[s].map((x) => `<i class="tc ${x < 0 ? 'neg' : ''}">${cardLabel(x)}</i>`).join('');
        const t = hands[s].reduce((a, b) => a + b, 0);
        sum = String(t);
        tag = t > r.limit ? `<em class="bad">${tr('res.bust')}</em>` : '';
      } else {
        cards = `<small>${r.folded[s] ? tr('res.foldedHidden') : tr('res.hidden')}</small>`;
      }
      if (r.folded[s]) tag = `<em class="muted">${tr('res.folded')}</em>`;
      const gain = o.gains[s] ? `<b class="gain">+${o.gains[s]}</b>` : `<span class="loss">−${r.contrib[s]}</span>`;
      return `<li class="${win ? 'win' : ''}" style="${seatVars(s)}">${avaImg(s, 'xs')}<span class="who">${esc(nameOf(s))}</span><span class="tcards">${cards}</span><span class="tsum">${sum}${tag}</span>${gain}</li>`;
    }).join('');
    return `<ol class="out-list">${rows}</ol>`;
  }

  function resultHtml(v) {
    const r = v.r, o = r.outcome, me = v.me, m = app.msg;
    let head;
    if (o.reason === 'fold') head = tr('res.foldWin', { name: esc(nameOf(o.winners[0])), n: o.pot });
    else if (o.allBust) head = tr('res.allBust', { n: o.pot });
    else if (o.split) head = tr('res.split', { names: o.winners.map((s) => esc(nameOf(s))).join(', '), n: o.pot });
    else head = tr('res.win', { name: esc(nameOf(o.winners[0])), n: o.pot });
    const hands = o.reason === 'showdown' ? v.rounds[v.rounds.length - 1].hands : null;
    const elim = o.eliminated.length ? `<p class="elim">${tr('res.elim', { names: o.eliminated.map((s) => esc(nameOf(s))).join(', ') })}</p>` : '';
    const ready = r.ready[me];
    const humans = m.seats.map((s, i) => (s && !s.bot && !v.out[i] && s.here ? i : -1)).filter((i) => i >= 0);
    const waitN = humans.filter((i) => !r.ready[i]).length;
    return `<h3 class="res-head">${head}</h3>
      <p class="hint">${tr('res.limit', { L: r.limit })}</p>
      ${outcomeRows(v, o, hands)}
      ${elim}
      ${v.out[me] ? '' : `<button class="btn primary wide" data-act="ready" ${ready ? 'disabled' : ''}>${tr(ready ? 'res.readyWait' : 'res.ready')}</button>`}
      <p class="hint">${tr('res.next', { n: waitN })}</p>`;
  }

  function overHtml(v) {
    const m = app.msg, rk = v.result.ranking;
    const mine = rk.find((r) => r.seat === v.me);
    const head = mine.rank === 1 ? tr('over.win') : tr('over.rank', { n: mine.rank });
    const iWant = m.rematch[v.me];
    const humansLeft = m.seats.filter((s, i) => s && !s.bot && !m.rematch[i]).length;
    const rows = rk.map((r) => `<li style="${seatVars(r.seat)}" class="${r.rank === 1 ? 'first' : ''}"><span class="rk r${r.rank}">${r.rank}</span>${avaImg(r.seat, 'xs')}
        <span class="who">${esc(nameOf(r.seat))}</span>
        <span class="meta">${r.out ? (r.resigned ? tr('over.resignedAt', { n: r.outRound }) : tr('over.outAt', { n: r.outRound })) : ''}</span>
        <b class="tot">${r.out ? '' : r.chips + '<small>' + tr('unit.chips') + '</small>'}</b></li>`).join('');
    return `<div class="win-text">${head}</div>
      <p>${tr('over.body', { n: v.round })}</p>
      <ol class="rank-list">${rows}</ol>
      ${v.r && v.r.outcome ? `<details class="last-round"><summary>${tr('over.lastRound')}</summary>${outcomeRows(v, v.r.outcome, v.r.outcome.reason === 'showdown' ? v.rounds[v.rounds.length - 1].hands : null)}</details>` : ''}
      <button class="btn wide" data-act="snapshot">${tr('btn.record')}</button>
      <button class="btn primary wide" data-act="rematch" ${iWant ? 'disabled' : ''}>${tr(iWant ? 'btn.rematchWait' : 'btn.rematch')}</button>
      ${iWant && humansLeft ? `<p class="hint">${tr('rematch.wait', { n: humansLeft })}</p>` : ''}
      <button class="btn ghost wide" data-act="leave">${tr('btn.lobby')}</button>`;
  }

  // ───────── 기록 ─────────
  function historyLine(v, e, names) {
    const nm = (s) => `<b style="color:${pal(s).dark}">${esc(names(s))}</b>`;
    const cd = (x) => `<i class="tc ${x < 0 ? 'neg' : ''}">${cardLabel(x)}</i>`;
    const auto = e.auto ? ` <span class="auto-mark">${tr('auto')}</span>` : '';
    switch (e.k) {
      case 'round': return `<span class="log-round">${tr('log.round', { n: e.r, L: e.limit, a: e.ante, name: nm(e.start) })}</span>`;
      case 'reveal': return tr('log.reveal', { name: nm(e.seat), c: cd(e.v) }) + auto;
      case 'bet':
        if (e.a === 'raise') return tr('log.raise', { name: nm(e.seat), n: e.by, to: e.to });
        if (e.a === 'call') return tr('log.call', { name: nm(e.seat), n: e.pay });
        if (e.a === 'check') return tr('log.check', { name: nm(e.seat) }) + auto;
        return tr('log.fold', { name: nm(e.seat) }) + auto;
      case 'betSkip': return `<span class="log-sys">${tr('log.betSkip', { n: e.no })}</span>`;
      case 'hit': return tr('log.hit', { name: nm(e.seat), c: cd(e.v) });
      case 'stay': return tr('log.stay', { name: nm(e.seat) }) + auto;
      case 'hitEnd': return e.empty ? `<span class="log-sys">${tr('log.deckEmpty')}</span>` : '';
      case 'win': {
        const who = e.winners.map(nm).join(', ');
        let s;
        if (e.reason === 'fold') s = tr('log.winFold', { name: who, n: e.pot });
        else if (e.allBust) s = tr('log.allBust', { n: e.pot });
        else if (e.winners.length > 1) s = tr('log.split', { names: who, n: e.pot });
        else s = tr('log.win', { name: who, n: e.pot });
        if (e.eliminated && e.eliminated.length) s += ' · ' + tr('log.elim', { names: e.eliminated.map(nm).join(', ') });
        return `<span class="log-win">${s}</span>`;
      }
      case 'resign': return tr('log.resign', { name: nm(e.seat) });
      case 'over': return `<span class="log-sys">${tr('log.over')}</span>`;
    }
    return '';
  }
  function renderLog() {
    const v = app.view;
    const sig = JSON.stringify([v.id, v.logNo, window.I18N.lang]);
    if (sig === app.sig.log) return;
    app.sig.log = sig;
    const rows = v.log.slice().reverse().map((e) => historyLine(v, e, (s) => nameOf(s))).filter(Boolean);
    $('#log').innerHTML = rows.map((h) => `<li>${h}</li>`).join('') || `<li><small>${tr('log.empty')}</small></li>`;
  }

  function renderOverlay() {
    const v = app.view, m = app.msg, el = $('#overlay');
    let html = '';
    const missing = v.phase !== 'over' ? m.seats.map((s, i) => (s && !s.here && !v.out[i] ? i : -1)).filter((i) => i >= 0) : [];
    if (app.mode === 'guest' && app.netStatus !== 'connected') {
      html = `<div class="overlay-card"><h2>${tr('ov.lostTitle')}</h2><p>${tr('ov.lostBody')}</p>
        <button class="btn ghost" data-act="leave">${tr('btn.leave')}</button></div>`;
    } else if (missing.length) {
      const names = missing.map((i) => `<b style="color:${pal(i).dark}">${esc(nameOf(i))}</b>`).join(', ');
      html = `<div class="overlay-card"><h2>${tr('ov.oppTitle')}</h2><p>${tr(m.seats[0] && !m.seats[0].here ? 'ov.hostBody' : 'ov.oppBody', { names, code: esc(m.code) })}</p></div>`;
    } else if (v.phase === 'over' && !app.dismissed[v.id]) {
      const rk = v.result.ranking, first = rk[0];
      const mine = rk.find((r) => r.seat === v.me);
      const head = mine && mine.rank === 1 ? tr('over.win') : tr('over.wonBy', { name: esc(nameOf(first.seat)) });
      html = `<div class="overlay-card win" style="${seatVars(first.seat)}">
        <div class="crown-ava">${avaImg(first.seat)}<span class="crown" aria-hidden="true">♛</span></div>
        <h2>${head}</h2><p>${tr('over.ovBody', { n: v.round, c: first.chips })}</p>
        <div class="row center"><button class="btn primary" data-act="dismiss-overlay">${tr('btn.viewTable')}</button><button class="btn ghost" data-act="snapshot">${tr('btn.record')}</button></div></div>`;
    } else if (m.paused && m.pauses && m.pauses.manual != null) {
      const by = m.pauses.manual;
      html = `<div class="overlay-card"><h2>${tr('ov.pausedTitle')}</h2><p>${tr('ov.pausedBody', { name: esc(nameOf(by)) })}</p><button class="btn primary" data-act="pause">${tr('bar.resume')}</button></div>`;
    }
    if (html === app.overlaySig) return;
    app.overlaySig = html;
    el.innerHTML = html;
    el.hidden = !html;
  }

  function renderBar() {
    const v = app.view, m = app.msg;
    $('#code-chip').textContent = app.mode === 'solo' ? tr('bar.practice') : (m.code || '');
    const net = $('#net');
    if (app.mode === 'solo') { net.textContent = ''; net.className = 'net'; }
    else if (app.mode === 'guest') {
      const ok = app.netStatus === 'connected';
      net.textContent = tr(ok ? 'net.ok' : 'net.re');
      net.className = 'net ' + (ok ? 'ok' : 'bad');
    } else {
      const humans = m.seats.filter((s, i) => i > 0 && s && !s.bot);
      const here = humans.filter((s) => s.here).length;
      const ok = here === humans.length;
      net.textContent = humans.length ? tr('net.count', { a: here, b: humans.length }) : '';
      net.className = 'net ' + (humans.length ? (ok ? 'ok' : 'bad') : '');
    }
    const manual = !!(m.pauses && m.pauses.manual != null);
    const pb = $('#pause-btn');
    pb.classList.toggle('on', manual);
    pb.disabled = v.phase === 'over';
    pb.title = tr(manual ? 'bar.resume' : 'bar.pause');
    pb.setAttribute('aria-label', pb.title);
    $('#mute-btn').classList.toggle('on', !Sound.muted);
    $('#mute-btn').textContent = Sound.muted ? '♪̸' : '♪';
    $('#resign-btn').hidden = v.phase === 'over' || v.out[v.me];
  }

  function render() {
    if (!app.view || app.screen !== 'game') return;
    renderBar();
    renderPhaseLabel();
    renderTable();
    renderPanel();
    renderLog();
    renderOverlay();
    updateTimer();
  }

  // ───────── 대기실 ─────────
  function settingsSummary(s) { return tr('room.summary', { n: s.players, t: s.turnSec, a: s.anteEvery, c: s.chips }); }
  function shareUrl(code) { return location.origin + location.pathname + '?join=' + code; }
  function renderRoom() {
    const m = app.msg;
    const isHost = app.mode === 'host';
    const code = isHost ? app.host.code : (app.net && app.net.code) || '';
    $('#room-code').textContent = code || '····';
    $('#share-box').hidden = !isHost || !code;
    if (isHost && code) $('#share-link').value = shareUrl(code);
    const seats = m ? m.seats : null;
    const n = m ? m.n : 0;
    const filled = seats ? seats.filter(Boolean).length : 0;
    let status;
    if (isHost) {
      if (app.netStatus === 'opening') status = tr('room.opening');
      else if (app.netStatus === 'waitid') status = tr('room.waitid');
      else if (seats && filled === n) status = tr('room.full');
      else status = tr('room.waiting', { a: filled, b: n });
    } else {
      status = ['connecting', 'connected', 'reconnecting', 'notfound', 'full'].includes(app.netStatus)
        ? tr('room.g.' + app.netStatus) : tr('room.g.default');
    }
    $('#room-status').innerHTML = status;
    const me = m ? m.me : (isHost ? 0 : -1);
    $('#room-players').innerHTML = seats ? seats.map((s, i) => {
      const ava = `<span class="room-ava" style="${seatVars(i)}">${avaImg(i)}</span>`;
      if (!s) {
        return `<li class="empty">${ava}<span>${tr('room.empty')} <small>${colorName(i)}</small></span>${isHost ? `<button class="btn small" data-act="add-bot">${tr('room.addBot')}</button>` : ''}</li>`;
      }
      const role = i === 0 ? tr('role.host') : s.bot ? tr('role.bot') : tr('role.guest');
      return `<li>${ava}<span>${esc(s.name || colorName(i) + (s.bot ? ' ' + tr('role.bot') : ''))}${i === me ? ` <small>${tr('room.me')}</small>` : ''}</span>
        <small>${colorName(i)} · ${role}</small>${isHost && s.bot ? `<button class="icon-btn small" data-act="remove-bot" data-seat="${i}" aria-label="${tr('room.removeBot')}">✕</button>` : ''}</li>`;
    }).join('') : '';
    $('#room-settings').textContent = m && m.settings ? settingsSummary(m.settings) : '';
    const sb = $('#start-btn');
    sb.hidden = !isHost;
    sb.disabled = !(seats && filled === n);
  }

  // ───────── 시작 · 참가 · 연습 · 이어하기 ─────────
  const FORM_KEYS = ['players', 'turnSec', 'anteEvery'];
  function readSettingsForm() {
    const f = $('#settings-form');
    const val = (n) => (f.querySelector(`input[name="${n}"]:checked`) || {}).value;
    const o = {};
    for (const k of FORM_KEYS) o[k] = +val(k);
    return o;
  }
  function writeSettingsForm(saved) {
    if (!saved) return;
    const f = $('#settings-form');
    const set = (n, v) => { const el = f.querySelector(`input[name="${n}"][value="${v}"]`); if (el) el.checked = true; };
    for (const k of FORM_KEYS) if (saved[k]) set(k, saved[k]);
  }

  function hostCallbacks() {
    return {
      onOpen: () => { app.netStatus = 'open'; if (app.host) app.host.push(); if (app.screen === 'room') renderRoom(); },
      onHello: (cid, name) => (app.host ? app.host.onHello(cid, name) : -1),
      onJoin: (seat) => {
        const h = app.host; if (!h) return;
        h.onJoin(seat);
        toast(tr('toast.joined', { name: (h.seats[seat] && h.seats[seat].name) || colorName(seat) }));
      },
      onMessage: (seat, m) => { if (app.host) app.host.handle(seat, m); },
      onDrop: (seat) => {
        const h = app.host; if (!h) return;
        const nm = (h.seats[seat] && h.seats[seat].name) || colorName(seat);
        h.onDrop(seat);
        toast(tr('toast.left', { name: nm }), 'err');
      },
      onError: (err) => {
        if (err.type === 'unavailable-id') {
          if (app.host && app.host.state) {
            app.netStatus = 'waitid';
            if (app.screen === 'room') renderRoom();
            setTimeout(() => { if (app.net) app.net.start(); }, 3000);
          } else {
            const code = makeCode();
            app.host.code = code; app.net.code = code;
            app.net.start();
            renderRoom();
          }
        } else if (err.type === 'browser-incompatible') {
          toast(tr('toast.noRTC'), 'err');
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          toast(tr('toast.signal'), 'err');
          setTimeout(() => { if (app.net && app.net.peer && app.net.peer.destroyed) app.net.start(); }, 4000);
        } else {
          console.warn('peer error', err.type, err);
        }
      },
    };
  }

  function startHosting(settings) {
    if (!window.Peer) { toast(tr('toast.noPeer'), 'err'); return; }
    teardown();
    app.mode = 'host';
    const code = makeCode();
    const net = new HostNet(code, hostCallbacks());
    app.net = net;
    app.host = new GameHost({ code, settings, myName: myName(), net, onLocal: onMessage, persist: true });
    app.netStatus = 'opening';
    show('room');
    app.host.push();
    net.start();
  }

  function resumeHosting() {
    const data = load(K.host, null);
    if (!data || !data.state) return;
    if (!window.Peer) { toast(tr('toast.noPeer'), 'err'); return; }
    teardown();
    app.mode = 'host';
    const net = new HostNet(data.code, hostCallbacks());
    app.net = net;
    app.host = GameHost.fromSave(data, { net, onLocal: onMessage, persist: true });
    if (!app.host.seats[0].name && myName()) app.host.seats[0].name = myName();
    app.netStatus = 'opening';
    app.host.push();
    net.start();
  }

  function startSolo(settings) {
    teardown();
    app.mode = 'solo';
    app.host = new GameHost({ code: '', settings, myName: myName(), net: null, onLocal: onMessage, persist: false });
    for (let i = 1; i < app.host.n; i++) {
      app.host.seats[i] = { name: '', cid: 'bot' + i, bot: true };
      app.host.bots[i] = new BotSeat(app.host, i);
    }
    app.host.startGame();
  }

  function startJoining(code) {
    if (!window.Peer) { toast(tr('toast.noPeer'), 'err'); return; }
    teardown();
    app.mode = 'guest';
    const map = load(K.client, {});
    const cid = map[code] || rid();
    map[code] = cid;
    save(K.client, map);
    history.replaceState(null, '', location.pathname + '?join=' + code);
    app.netStatus = 'connecting';
    app.msg = null;
    const net = new GuestNet(code, cid, myName(), {
      onMessage,
      onStatus: (s) => {
        const was = app.netStatus;
        app.netStatus = s;
        if (s === 'connected' && was === 'reconnecting') toast(tr('toast.reconnected'));
        if (app.screen === 'room') renderRoom();
        else if (app.screen === 'game') { app.overlaySig = null; render(); }
      },
    });
    app.net = net;
    show('room');
    renderRoom();
    net.start();
  }

  function teardown() {
    if (app.host) { app.host.destroy(); app.host = null; }
    if (app.net) { app.net.destroy(); app.net = null; }
    app.msg = null; app.view = null; app.netStatus = '';
    resetSigs();
    app.needed = false;
    clearInterval(app.die.iv); app.die.until = 0;
    clearTimeout(app.lotto.t); app.lotto.id = '';
    document.title = tr('doc.title');
  }

  function leave() {
    const v = app.view;
    const inGame = v && v.phase !== 'over' && app.mode !== 'solo';
    if (inGame && !confirm(tr(app.mode === 'host' ? 'confirm.leaveHost' : 'confirm.leaveGuest'))) return;
    if (app.mode === 'host' && (!v || v.phase === 'over')) localStorage.removeItem(K.host);
    teardown();
    app.mode = 'lobby';
    history.replaceState(null, '', location.pathname);
    show('lobby');
    refreshResume();
    hideForms();
  }

  function refreshResume() {
    const data = load(K.host, null);
    const ok = data && data.state && data.state.phase !== 'over' && Date.now() - data.savedAt < 24 * 3600 * 1000;
    $('#resume-card').hidden = !ok;
    if (ok) {
      $('#resume-code').textContent = data.code;
      const names = data.seats.map((s, i) => (s && s.name) || colorName(i)).join(', ');
      const at = data.state.round ? tr('hud.round', { n: data.state.round }) : tr('phase.lottery');
      $('#resume-meta').textContent = tr('resume.meta', { names, at, t: fmtDate(data.savedAt) });
    }
  }

  function setSettingsLabels() {
    const solo = app.formMode === 'solo';
    $('#settings-title').textContent = tr(solo ? 'set.titleSolo' : 'set.titleRoom');
    $('#settings-submit').textContent = tr(solo ? 'set.submitSolo' : 'set.submitRoom');
    $('#settings-note').textContent = tr(solo ? 'set.noteSolo' : 'set.noteRoom');
  }

  function setLang(l) {
    window.I18N.set(l);
    closeModal();
    setSettingsLabels();
    refreshResume();
    resetSigs();
    if (app.screen === 'room') renderRoom();
    if (app.screen === 'game' && app.view) {
      render();
      document.title = (app.needed ? '● ' : '') + tr('doc.title');
    }
  }

  function hideForms() { $('#settings-form').hidden = true; $('#join-form').hidden = true; }
  function showSettings(mode) {
    app.formMode = mode;
    $('#join-form').hidden = true;
    $('#settings-form').hidden = false;
    setSettingsLabels();
    $('#settings-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ───────── 모달: 규칙 · 지난 게임 ─────────
  function openModal(html, wide) {
    $('#modal-body').innerHTML = html;
    $('#modal').hidden = false;
    $('#modal .modal-box').classList.toggle('wide', !!wide);
  }
  function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }

  function recWinner(r) { const f = r.result.ranking[0]; return recName(r, f.seat); }
  function openRecords() {
    const recs = load(K.records, []);
    const items = recs.map((r) => {
      const mine = r.result.ranking.find((x) => x.seat === r.me);
      const players = r.order.map((s) => `<i class="dot" style="${seatVars(s)}"></i>${esc(recName(r, s))}`).join(' ');
      return `<li><button data-act="open-record" data-id="${esc(r.id)}"><span>${players}${r.mode === 'solo' ? ` <small>${tr('rec.practice')}</small>` : ''}</span>
        <small>${fmtDate(r.at)} · ${tr('rec.won', { name: esc(recWinner(r)) })} · ${tr('hud.rounds', { n: r.result.rounds })}${mine ? ' · ' + tr('rec.mine', { n: mine.rank }) : ''}</small></button></li>`;
    }).join('');
    openModal(`<h2>${tr('rec.title')}</h2><p class="hint">${tr('rec.note')}</p>
      ${items ? `<ul class="rec-list">${items}</ul>` : `<p class="hint">${tr('rec.empty')}</p>`}`);
  }

  function chipChart(rec) {
    const n = rec.settings.players, R = rec.rounds.length;
    const start = rec.settings.chips || 30;
    const series = [];
    for (let s = 0; s < n; s++) {
      const pts = [start];
      for (const rd of rec.rounds) pts.push(rd.chips[s]);
      series.push(pts);
    }
    const maxY = Math.max(start, ...series.flat());
    const W = 640, H = 240, L = 34, B = 26, T = 10, Rr = 12;
    const x = (i) => L + (R ? (i / R) * (W - L - Rr) : 0);
    const y = (c) => T + (1 - c / maxY) * (H - T - B);
    let g = '';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const c = Math.round((maxY / ticks) * i);
      g += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(c)}" y2="${y(c)}"/><text class="ax" x="${L - 6}" y="${y(c) + 4}" text-anchor="end">${c}</text>`;
    }
    const step = Math.max(1, Math.ceil(R / 8));
    for (let i = 0; i <= R; i += step) g += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${i}</text>`;
    let lines = '';
    series.forEach((pts, s) => {
      let end = pts.length - 1;
      while (end > 0 && pts[end] === 0 && pts[end - 1] === 0) end--;
      const d = pts.slice(0, end + 1).map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join('');
      lines += `<path class="line" d="${d}" stroke="${pal(s).dark}"/><circle cx="${x(end)}" cy="${y(pts[end])}" r="4" fill="${pal(s).base}" stroke="${pal(s).dark}" stroke-width="1.5"/>`;
    });
    const legend = rec.order.map((s) => `<span><i class="dot" style="${seatVars(s)}"></i>${esc(recName(rec, s))}</span>`).join('');
    return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('rp.chartAria'))}">${g}${lines}</svg><figcaption class="legend">${legend}</figcaption></figure>`;
  }

  function openRecord(rec) {
    const rk = rec.result.ranking;
    const rows = rk.map((r) => `<li style="${seatVars(r.seat)}"><span class="rk r${r.rank}">${r.rank}</span>${avaImg(r.seat, 'xs')}<span class="who">${esc(recName(rec, r.seat))}</span>
      <span class="meta">${r.out ? (r.resigned ? tr('over.resignedAt', { n: r.outRound }) : tr('over.outAt', { n: r.outRound })) : ''}</span><b class="tot">${r.out ? '' : r.chips}</b></li>`).join('');
    const rounds = rec.rounds.slice().reverse().map((rd) => {
      const who = rd.winners.map((s) => `<b style="color:${pal(s).dark}">${esc(recName(rec, s))}</b>`).join(', ');
      const what = rd.reason === 'fold' ? tr('rp.byFold') : rd.allBust ? tr('rp.allBust') : rd.winners.length > 1 ? tr('rp.split') : '';
      const hands = rd.hands ? rd.hands.map((h, s) => (h ? `<span class="rp-hand" style="${seatVars(s)}"><i class="dot"></i>${h.map((x) => `<i class="tc ${x < 0 ? 'neg' : ''}">${cardLabel(x)}</i>`).join('')}<small>=${h.reduce((a, b) => a + b, 0)}</small></span>` : '')).join('') : '';
      return `<tr><td>${rd.no}</td><td><span class="lim">${rd.limit}</span></td><td>${rd.pot}</td><td>${who} ${what ? `<small>${what}</small>` : ''}<div class="rp-hands">${hands}</div></td></tr>`;
    }).join('');
    openModal(`<h2>${tr('rp.title', { d: fmtDate(rec.at) })}</h2>
      <ol class="rank-list">${rows}</ol>
      <h3>${tr('rp.chart')}</h3>
      ${chipChart(rec)}
      <h3>${tr('rp.rounds')}</h3>
      <div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>#</th><th>${tr('rp.limit')}</th><th>${tr('rp.pot')}</th><th>${tr('rp.winner')}</th></tr></thead><tbody>${rounds}</tbody></table></div>`, true);
  }

  // ───────── 이벤트 ─────────
  function setRaise(k) {
    const v = app.view; if (!v || v.phase !== 'bet') return;
    const info = LL.betInfo(v, v.me);
    app.ui.raise = Math.max(1, Math.min(info.maxRaise, k));
    renderPanel();
  }
  function pickCard(i) {
    const v = app.view;
    if (!v || v.phase !== 'reveal' || !myTurn()) return;
    if (app.ui.pick === i) { act({ t: 'reveal', idx: i }); return; }
    app.ui.pick = i;
    $$('#me-seat .my-hand .ncard').forEach((el, j) => el.classList.toggle('sel', j === i));
    app.sig.me = '';
    renderPanel();
  }

  const handlers = {
    'lang': (b) => setLang(b.dataset.lang),
    'lang-flip': () => { $('#menu').hidden = true; setLang(window.I18N.lang === 'ko' ? 'en' : 'ko'); },
    'show-create': () => showSettings('create'),
    'show-solo': () => showSettings('solo'),
    'show-join': () => { $('#settings-form').hidden = true; $('#join-form').hidden = false; $('#join-code').focus(); },
    'hide-forms': hideForms,
    'resume': () => { save(K.name, myName()); resumeHosting(); },
    'discard-resume': () => { if (confirm(tr('confirm.discard'))) { localStorage.removeItem(K.host); refreshResume(); } },
    'rules': () => { $('#menu').hidden = true; openModal(tr('rules')); },
    'records': openRecords,
    'open-record': (b) => { const rec = load(K.records, []).find((r) => r.id === b.dataset.id); if (rec) openRecord(rec); },
    'close-modal': closeModal,
    'copy-link': async (b) => {
      const url = $('#share-link').value;
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ title: tr('doc.title'), text: tr('share.text', { code: app.host.code }), url }); return; } catch (e) { /* 취소 */ }
      }
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
        const inp = $('#share-link'); inp.select();
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      }
      toast(tr(ok ? 'toast.copied' : 'toast.copyFail'));
      b.blur();
    },
    'add-bot': () => { if (app.host) app.host.addBot(); },
    'remove-bot': (b) => { if (app.host) app.host.removeBot(+b.dataset.seat); },
    'start': () => { if (app.host && app.host.allFilled()) app.host.startGame(); },
    'leave': () => { $('#menu').hidden = true; closeModal(); leave(); },
    'menu': () => { $('#menu').hidden = !$('#menu').hidden; },
    'pause': () => {
      const m = app.msg; if (!m || !app.view || app.view.phase === 'over') return;
      act({ t: 'pause', on: !(m.pauses && m.pauses.manual != null) });
    },
    'mute': () => { Sound.muted = !Sound.muted; save(K.mute, Sound.muted); if (!Sound.muted) Sound.chip(); if (app.view) renderBar(); },
    'resign': () => { $('#menu').hidden = true; if (app.view && app.view.phase !== 'over' && confirm(tr('confirm.resign'))) act({ t: 'resign' }); },
    'pick-card': (b) => pickCard(+b.dataset.i),
    'confirm-reveal': () => { if (app.ui.pick != null) act({ t: 'reveal', idx: app.ui.pick }); },
    'call': () => act({ t: 'bet', a: 'call' }),
    'fold': () => {
      const v = app.view; if (!v || v.phase !== 'bet') return;
      const info = LL.betInfo(v, v.me);
      if (!info.toCall && !confirm(tr('confirm.foldFree'))) return;
      act({ t: 'bet', a: 'fold' });
    },
    'raise': () => {
      const v = app.view; if (!v || v.phase !== 'bet') return;
      const info = LL.betInfo(v, v.me);
      act({ t: 'bet', a: 'raise', amount: Math.max(1, Math.min(app.ui.raise, info.maxRaise)) });
    },
    'raise-dec': () => setRaise(app.ui.raise - 1),
    'raise-inc': () => setRaise(app.ui.raise + 1),
    'raise-set': (b) => setRaise(+b.dataset.n),
    'hit': () => act({ t: 'hit' }),
    'stay': () => act({ t: 'stay' }),
    'ready': () => act({ t: 'ready' }),
    'emote': (b) => { const e = b.dataset.e; act({ t: 'emote', e }); if (app.view) showBubble(app.view.me, e); },
    'snapshot': () => {
      const v = app.view; if (!v) return;
      saveRecord(v);
      const rec = load(K.records, []).find((r) => r.id === v.id);
      if (rec) openRecord(rec);
    },
    'rematch': () => act({ t: 'rematch' }),
    'dismiss-overlay': () => { if (app.view) { app.dismissed[app.view.id] = true; renderOverlay(); } },
  };

  document.addEventListener('click', (e) => {
    const menuOpen = !$('#menu').hidden;
    if (menuOpen && !e.target.closest('.menu-wrap')) $('#menu').hidden = true;
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const fn = handlers[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b, e); }
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) closeModal();
      $('#menu').hidden = true;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ncard.pickable')) {
      e.preventDefault();
      pickCard(+e.target.dataset.i);
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'join-code') t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const settings = readSettingsForm();
    save(K.settings, settings);
    save(K.name, myName());
    if (app.formMode === 'solo') startSolo(settings);
    else startHosting(settings);
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { toast(tr('toast.code4'), 'err'); $('#join-code').focus(); return; }
    save(K.name, myName());
    startJoining(code);
  });
  $('#name').addEventListener('change', () => save(K.name, myName()));
  document.addEventListener('pointerdown', () => { if (!Sound.muted) Sound.ac(); }, { once: true });

  setInterval(updateTimer, 200);

  // ───────── 처음 열었을 때 ─────────
  window.I18N.applyStatic();
  setSettingsLabels();
  $('#name').value = load(K.name, '') || '';
  writeSettingsForm(load(K.settings, null));
  refreshResume();
  const joinParam = (new URLSearchParams(location.search).get('join') || '').toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(joinParam)) {
    $('#join-code').value = joinParam;
    $('#join-form').hidden = false;
    if (myName()) startJoining(joinParam);
    else { $('#name').focus(); toast(tr('toast.enterName')); }
  }

  // 테스트·디버깅용
  window.__ll = { app, GameHost, BotSeat };
})();
