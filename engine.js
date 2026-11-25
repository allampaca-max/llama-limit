/* 라마 리밋 규칙 엔진.
 *
 * DOM에 의존하지 않는다. 브라우저에서는 window.LL, 테스트(jsc)에서는 globalThis.LL 로 쓴다.
 * 좌석(seat) 0 = 방장, 1~4 = 참가자(또는 봇). 좌석 번호가 곧 인형 색이다.
 * 자리 배치(order)는 게임마다 무작위로 정하고, 이 순서가 곧 시계 방향이다.
 *
 * 카드 35장: 7×1, 6×2, 5×3, 4×4, 3×5, 2×6, 1×7, -1×7. 라운드마다 전부 다시 섞는다.
 * 주사위: 5~12가 적힌 8면체. 나온 수가 그 라운드의 한계 숫자.
 *
 * 한 라운드
 *  1. 기본 베팅(앤티)을 낸다 → 주사위 → 3장씩 뒷면으로 받는다          phase 'roll'
 *  2. 각자 1장을 골라 동시에 공개한다                                   phase 'reveal'
 *  3. 1차 베팅: 선부터 콜/레이즈/포기                                    phase 'bet' (bet.no 1)
 *  4. 남은 사람이 선부터 돌아가며 히트(앞면 1장) 또는 스테이(그만)         phase 'hit'
 *  5. 2차 베팅                                                         phase 'bet' (bet.no 2)
 *  6. 모두 공개해 한계 이하에서 가장 큰 합이 판돈을 가져간다               phase 'result'
 * 칩이 0이 되면 탈락. 한 사람만 남으면 끝(phase 'over').
 *
 * 이 구현에서 정한 것
 *  - 베팅 상한: 한 라운드에 한 사람이 내는 칩(앤티 포함)은, 아직 포기하지 않은 사람 중
 *    라운드 시작 때 칩이 가장 적은 사람의 칩 수를 넘을 수 없다. 그래서 사이드 팟이 없다.
 *  - 앤티가 가장 적은 칩보다 크면 모두 그 칩 수만큼만 낸다.
 *  - 스테이를 고르면 그 라운드에는 더 받을 수 없다. 넘친 사람도 계속 히트할 수 있다(-1을 노릴 수 있으니).
 *  - 베팅을 더 올릴 수 없는 상태(이미 상한)면 그 베팅 차례는 건너뛴다.
 *  - 기권하면 남은 칩은 사라지고 그 자리에서 탈락한다.
 */
(function (root) {
  'use strict';

  const DECK_SPEC = Object.freeze([[7, 1], [6, 2], [5, 3], [4, 4], [3, 5], [2, 6], [1, 7], [-1, 7]]);
  const VALUES = DECK_SPEC.map((x) => x[0]);
  const DECK_SIZE = DECK_SPEC.reduce((t, x) => t + x[1], 0);
  const DIE = Object.freeze([5, 6, 7, 8, 9, 10, 11, 12]);
  const HAND = 3;
  const DEFAULTS = Object.freeze({ players: 2, turnSec: 40, anteEvery: 10, chips: 30 });
  const OPTIONS = Object.freeze({ players: [2, 3, 4, 5], turnSec: [20, 40, 60], anteEvery: [10, 5, 3], chips: [30] });
  const COLORS = ['cream', 'pink', 'mint', 'lavender', 'caramel'];

  class RuleError extends Error {
    constructor(code, params) { super(code); this.code = code; this.params = params || {}; }
  }

  const seq = (n) => Array.from({ length: n }, (_, i) => i);
  function cleanSettings(s) {
    const out = Object.assign({}, DEFAULTS);
    s = s || {};
    for (const k of Object.keys(OPTIONS)) {
      const v = Number(s[k]);
      if (OPTIONS[k].includes(v)) out[k] = v;
    }
    return out;
  }
  function makeDeck() {
    const d = [];
    for (const [v, c] of DECK_SPEC) for (let i = 0; i < c; i++) d.push(v);
    return d;
  }
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const handSum = (cards) => cards.reduce((t, c) => t + (c.v == null ? 0 : c.v), 0);
  const upSum = (cards) => cards.reduce((t, c) => t + (c.up && c.v != null ? c.v : 0), 0);
  const anteFor = (settings, round) => 1 + Math.floor((round - 1) / settings.anteEvery);

  // ───────── 새 게임 ─────────
  // order: 자리 배치(시계 방향). firstStart: 추첨 볼로 뽑힌 첫 선(없으면 무작위).
  function newGame(settings, order, rng, firstStart) {
    rng = rng || Math.random;
    const s = cleanSettings(settings), n = s.players;
    order = order && order.length === n ? order.slice() : seq(n);
    const fs = order.includes(firstStart) ? firstStart : order[Math.floor(rng() * n)];
    return {
      id: rid(), settings: s, n, names: new Array(n).fill(''), order,
      chips: new Array(n).fill(s.chips),
      out: new Array(n).fill(false), outSeq: new Array(n).fill(0), outRound: new Array(n).fill(0), resigned: new Array(n).fill(false), seq: 0,
      round: 0, ante: 1, firstStart: fs,
      phase: 'lottery',
      r: null, log: [], logNo: 0, rounds: [], result: null,
    };
  }

  // ───────── 자리 도우미 ─────────
  const alive = (st) => st.order.filter((s) => !st.out[s]);
  const inPlay = (st) => (st.r ? st.order.filter((s) => st.r.inHand[s] && !st.r.folded[s]) : []);
  // seat 다음(시계 방향)부터 pred를 만족하는 첫 자리. 한 바퀴 돌아 자기 자신도 본다.
  function nextInOrder(st, seat, pred) {
    const k = st.order.indexOf(seat);
    for (let i = 1; i <= st.n; i++) { const s = st.order[(k + i) % st.n]; if (pred(s)) return s; }
    return -1;
  }
  // 선부터 시계 방향으로 pred를 만족하는 자리들
  function fromStart(st, pred, start) {
    const k = st.order.indexOf(start == null ? st.r.start : start);
    const out = [];
    for (let i = 0; i < st.n; i++) { const s = st.order[(k + i) % st.n]; if (pred(s)) out.push(s); }
    return out;
  }
  function current(st) {
    return (st.phase === 'bet' || st.phase === 'hit') && st.r ? st.r.actor : -1;
  }
  function log(st, e) {
    e.r = st.round;
    st.log.push(e);
    st.logNo++;
    if (st.log.length > 500) st.log.splice(0, st.log.length - 500);
  }

  // ───────── 라운드 시작 ─────────
  function beginRound(st, rng) {
    rng = rng || Math.random;
    if (st.phase !== 'lottery' && st.phase !== 'result') throw new RuleError('phase');
    const live = alive(st);
    if (live.length <= 1) { finish(st, 'last'); return; }
    const prev = st.r ? st.r.start : -1;
    st.round++;
    st.ante = anteFor(st.settings, st.round);
    const start = prev < 0 || !st.order.includes(prev) ? (st.out[st.firstStart] ? live[0] : st.firstStart) : nextInOrder(st, prev, (s) => !st.out[s]);
    const minStack = Math.min.apply(null, live.map((s) => st.chips[s]));
    const pay = Math.min(st.ante, minStack);
    const n = st.n;
    const r = {
      no: st.round, start, ante: pay, limit: DIE[Math.floor(rng() * DIE.length)],
      deck: shuffle(makeDeck(), rng),
      hands: seq(n).map(() => []),
      pick: new Array(n).fill(-1),
      inHand: seq(n).map((s) => !st.out[s]),
      folded: new Array(n).fill(false),
      stayed: new Array(n).fill(false),
      stack0: st.chips.slice(),
      contrib: new Array(n).fill(0),
      pot: 0,
      bet: null, actor: -1, acts: new Array(n).fill(null),
      outcome: null, ready: new Array(n).fill(false), autoPick: [],
    };
    st.r = r;
    for (const s of live) pay1(st, s, pay);
    const seats = fromStart(st, (s) => r.inHand[s]);
    for (let k = 0; k < HAND; k++) for (const s of seats) r.hands[s].push({ v: r.deck.pop(), up: false });
    st.phase = 'roll';
    log(st, { k: 'round', start, ante: pay, limit: r.limit });
  }
  function pay1(st, seat, x) {
    st.chips[seat] -= x;
    st.r.contrib[seat] += x;
    st.r.pot += x;
  }
  function endRoll(st) {
    if (st.phase !== 'roll') throw new RuleError('phase');
    st.phase = 'reveal';
  }

  // ───────── 카드 1장 공개(동시에) ─────────
  function revealWaiting(st) {
    const r = st.r;
    return st.order.filter((s) => r.inHand[s] && !r.folded[s] && r.pick[s] < 0);
  }
  function applyReveal(st, seat, idx, auto) {
    const r = st.r;
    if (st.phase !== 'reveal') throw new RuleError('phase');
    if (!r.inHand[seat] || r.folded[seat]) throw new RuleError('notIn');
    if (r.pick[seat] >= 0) throw new RuleError('already');
    idx = Number(idx);
    if (!(Number.isInteger(idx) && idx >= 0 && idx < r.hands[seat].length)) throw new RuleError('badCard');
    r.pick[seat] = idx;
    if (auto) r.autoPick.push(seat);
    maybeFlip(st);
  }
  function maybeFlip(st) {
    const r = st.r;
    if (st.phase !== 'reveal' || revealWaiting(st).length) return;
    for (const s of fromStart(st, (x) => r.inHand[x] && !r.folded[x])) {
      const c = r.hands[s][r.pick[s]];
      c.up = true;
      log(st, { k: 'reveal', seat: s, v: c.v, auto: r.autoPick.includes(s) });
    }
    startBet(st, 1);
  }
  function autoReveal(st, rng) {
    rng = rng || Math.random;
    for (const s of revealWaiting(st)) {
      if (st.phase !== 'reveal') break;
      applyReveal(st, s, Math.floor(rng() * st.r.hands[s].length), true);
    }
  }

  // ───────── 베팅 ─────────
  function cap(st) {
    const ps = inPlay(st);
    return ps.length ? Math.min.apply(null, ps.map((s) => st.r.stack0[s])) : 0;
  }
  function startBet(st, no) {
    const r = st.r;
    st.phase = 'bet';
    const ps = inPlay(st);
    const cur = Math.max.apply(null, ps.map((s) => r.contrib[s]));
    r.bet = { no, cur, acted: new Array(st.n).fill(false), raises: 0 };
    r.acts = new Array(st.n).fill(null);
    r.actor = -1;
    if (cur >= cap(st)) { log(st, { k: 'betSkip', no }); afterBet(st); return; }
    r.actor = fromStart(st, (s) => r.inHand[s] && !r.folded[s])[0];
  }
  function betInfo(st, seat) {
    const r = st.r, b = r.bet;
    const c = cap(st);
    const cur = b ? b.cur : 0;
    return { no: b ? b.no : 0, cur, cap: c, toCall: Math.max(0, cur - r.contrib[seat]), maxRaise: Math.max(0, c - cur), pot: r.pot, mine: r.contrib[seat] };
  }
  function applyBet(st, seat, a, amount, auto) {
    const r = st.r;
    if (st.phase !== 'bet') throw new RuleError('phase');
    if (r.actor !== seat) throw new RuleError('notYou');
    const b = r.bet, info = betInfo(st, seat);
    if (a === 'call') {
      pay1(st, seat, info.toCall);
      b.acted[seat] = true;
      const what = info.toCall ? 'call' : 'check';
      r.acts[seat] = { a: what, pay: info.toCall };
      log(st, { k: 'bet', no: b.no, seat, a: what, pay: info.toCall, auto: !!auto });
    } else if (a === 'raise') {
      const k = Number(amount);
      if (!(Number.isInteger(k) && k >= 1)) throw new RuleError('badAmount');
      if (k > info.maxRaise) throw new RuleError('cap');
      const to = b.cur + k, p = to - r.contrib[seat];
      pay1(st, seat, p);
      b.cur = to;
      b.raises++;
      b.acted = new Array(st.n).fill(false);
      b.acted[seat] = true;
      r.acts[seat] = { a: 'raise', by: k, pay: p };
      log(st, { k: 'bet', no: b.no, seat, a: 'raise', by: k, to, pay: p });
    } else if (a === 'fold') {
      r.folded[seat] = true;
      b.acted[seat] = true;
      r.acts[seat] = { a: 'fold' };
      log(st, { k: 'bet', no: b.no, seat, a: 'fold', auto: !!auto });
      if (inPlay(st).length === 1) { settleFold(st); return; }
    } else {
      throw new RuleError('badAction');
    }
    advanceBet(st);
  }
  function betPending(st) {
    const r = st.r, b = r.bet;
    return inPlay(st).filter((s) => !b.acted[s] || r.contrib[s] < b.cur);
  }
  function advanceBet(st) {
    const r = st.r;
    const pending = betPending(st);
    if (!pending.length) { afterBet(st); return; }
    r.actor = nextInOrder(st, r.actor, (s) => pending.includes(s));
  }
  function afterBet(st) {
    const r = st.r;
    r.actor = -1;
    if (r.bet.no === 1) startHit(st);
    else showdown(st);
  }
  // 시간 초과: 낼 칩이 없으면 체크, 있으면 포기
  function autoBet(st) {
    const seat = st.r.actor;
    if (seat < 0) return;
    const info = betInfo(st, seat);
    applyBet(st, seat, info.toCall ? 'fold' : 'call', 0, true);
  }

  // ───────── 히트 / 스테이 ─────────
  function hitEligible(st) {
    const r = st.r;
    return inPlay(st).filter((s) => !r.stayed[s]);
  }
  function startHit(st) {
    const r = st.r;
    st.phase = 'hit';
    r.acts = new Array(st.n).fill(null);
    r.actor = -1;
    const el = hitEligible(st);
    if (!r.deck.length || !el.length) { endHit(st); return; }
    r.actor = fromStart(st, (s) => el.includes(s))[0];
  }
  function applyHit(st, seat) {
    const r = st.r;
    if (st.phase !== 'hit') throw new RuleError('phase');
    if (r.actor !== seat) throw new RuleError('notYou');
    if (!r.deck.length) throw new RuleError('empty');
    const v = r.deck.pop();
    r.hands[seat].push({ v, up: true, hit: true });
    r.acts[seat] = { a: 'hit', v };
    log(st, { k: 'hit', seat, v });
    advanceHit(st);
  }
  function applyStay(st, seat, auto) {
    const r = st.r;
    if (st.phase !== 'hit') throw new RuleError('phase');
    if (r.actor !== seat) throw new RuleError('notYou');
    r.stayed[seat] = true;
    r.acts[seat] = { a: 'stay' };
    log(st, { k: 'stay', seat, auto: !!auto });
    advanceHit(st);
  }
  function advanceHit(st) {
    const r = st.r;
    const el = hitEligible(st);
    if (!r.deck.length || !el.length) { endHit(st); return; }
    r.actor = nextInOrder(st, r.actor, (s) => el.includes(s));
  }
  function endHit(st) {
    const r = st.r;
    r.actor = -1;
    log(st, { k: 'hitEnd', empty: !r.deck.length });
    startBet(st, 2);
  }

  // ───────── 승부 ─────────
  function compareRow(a, b) { return b.sum - a.sum || b.count - a.count; }
  function evaluate(st) {
    const r = st.r, L = r.limit;
    const rows = inPlay(st).map((s) => {
      const sum = handSum(r.hands[s]);
      return { seat: s, sum, count: r.hands[s].length, bust: sum > L };
    });
    const ok = rows.filter((x) => !x.bust).sort(compareRow);
    const bust = rows.filter((x) => x.bust).sort((a, b) => a.sum - b.sum || b.count - a.count);
    let winners;
    if (!ok.length) winners = rows.map((x) => x.seat);
    else winners = ok.filter((x) => x.sum === ok[0].sum && x.count === ok[0].count).map((x) => x.seat);
    return { rows: ok.concat(bust), winners, allBust: !ok.length };
  }
  function showdown(st) {
    const ev = evaluate(st);
    settle(st, { reason: 'showdown', winners: ev.winners, rows: ev.rows, allBust: ev.allBust });
  }
  function settleFold(st) {
    settle(st, { reason: 'fold', winners: inPlay(st).slice(0, 1), rows: null, allBust: false });
  }
  function settle(st, o) {
    const r = st.r;
    r.actor = -1;
    r.bet = null;
    const ordered = fromStart(st, (s) => o.winners.includes(s));
    const k = ordered.length;
    const share = Math.floor(r.pot / k);
    let rem = r.pot - share * k;
    const gains = new Array(st.n).fill(0);
    for (const s of ordered) { gains[s] = share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; st.chips[s] += gains[s]; }
    o.winners = ordered;
    o.gains = gains;
    o.pot = r.pot;
    o.split = k > 1;
    r.pot = 0;
    const gone = st.order.filter((s) => !st.out[s] && st.chips[s] <= 0);
    if (gone.length) { st.seq++; for (const s of gone) { st.out[s] = true; st.outSeq[s] = st.seq; st.outRound[s] = st.round; } }
    o.eliminated = gone;
    r.outcome = o;
    const shown = o.reason === 'showdown' ? seqHands(st) : null;
    log(st, { k: 'win', reason: o.reason, winners: ordered, gains, pot: o.pot, allBust: o.allBust, rows: o.rows, hands: shown, eliminated: gone });
    st.rounds.push({
      no: st.round, limit: r.limit, ante: r.ante, start: r.start, pot: o.pot, reason: o.reason, winners: ordered, gains,
      allBust: o.allBust, hands: shown, folded: r.folded.slice(), chips: st.chips.slice(), eliminated: gone,
    });
    st.phase = 'result';
    if (alive(st).length <= 1) finish(st, 'last');
  }
  function seqHands(st) {
    const r = st.r;
    return seq(st.n).map((s) => (r.inHand[s] && !r.folded[s] ? r.hands[s].map((c) => c.v) : null));
  }
  function nextRound(st, rng) {
    if (st.phase !== 'result') throw new RuleError('phase');
    beginRound(st, rng);
  }

  // ───────── 기권 · 끝 ─────────
  function resign(st, seat) {
    if (st.phase === 'over') throw new RuleError('phase');
    if (st.out[seat]) throw new RuleError('out');
    st.seq++;
    st.out[seat] = true; st.outSeq[seat] = st.seq; st.outRound[seat] = st.round; st.resigned[seat] = true;
    st.chips[seat] = 0;
    log(st, { k: 'resign', seat });
    const r = st.r;
    const midRound = r && ['roll', 'reveal', 'bet', 'hit'].includes(st.phase);
    if (midRound && r.inHand[seat] && !r.folded[seat]) {
      r.folded[seat] = true;
      r.acts[seat] = { a: 'fold' };
      if (inPlay(st).length === 1) { settleFold(st); return; }
      if (st.phase === 'reveal') maybeFlip(st);
      else if (st.phase === 'bet') {
        r.bet.acted[seat] = true;
        if (r.actor === seat || !betPending(st).length) advanceBet(st);
      } else if (st.phase === 'hit' && r.actor === seat) advanceHit(st);
    }
    if (st.phase !== 'over' && alive(st).length <= 1) finish(st, 'resign');
  }
  function rankKey(st, s) { return st.out[s] ? [0, st.outSeq[s]] : [1, st.chips[s]]; }
  function ranking(st) {
    const rows = seq(st.n).map((s) => ({ seat: s, chips: st.chips[s], out: st.out[s], outRound: st.outRound[s], resigned: st.resigned[s], key: rankKey(st, s) }));
    rows.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1]);
    let rank = 0;
    rows.forEach((x, i) => {
      if (i === 0 || x.key[0] !== rows[i - 1].key[0] || x.key[1] !== rows[i - 1].key[1]) rank = i + 1;
      x.rank = rank;
    });
    rows.forEach((x) => { delete x.key; });
    return rows;
  }
  function finish(st, reason) {
    st.phase = 'over';
    if (st.r) { st.r.actor = -1; st.r.bet = null; }
    st.result = { reason, ranking: ranking(st), rounds: st.round };
    log(st, { k: 'over', reason });
  }

  // ───────── 보기 ─────────
  // 아직 보이지 않은 카드 수(이 사람 기준): 덱 + 남의 뒷면 카드
  function unseenCounts(view) {
    const cnt = {};
    for (const [v, c] of DECK_SPEC) cnt[v] = c;
    const r = view.r;
    if (!r) return cnt;
    for (const hand of r.hands) for (const c of hand) if (c.v != null) cnt[c.v]--;
    return cnt;
  }
  // 한 좌석에게 보여 줄 상태: 남의 뒷면 카드, 덱 순서, 남이 고른 공개 카드는 가린다.
  function viewFor(st, seat) {
    const v = JSON.parse(JSON.stringify(st));
    v.me = seat;
    v.current = current(st);
    v.log = v.log.slice(-160);
    const r = v.r;
    if (r) {
      r.deckLeft = r.deck.length;
      delete r.deck;
      const showAll = !!(r.outcome && r.outcome.reason === 'showdown');
      for (let s = 0; s < v.n; s++) {
        if (s === seat) continue;
        const shown = showAll && r.inHand[s] && !r.folded[s];
        if (!shown) r.hands[s] = r.hands[s].map((c) => (c.up ? c : { v: null, up: false }));
      }
      r.picked = r.pick.map((p) => p >= 0);
      r.pick = r.pick.map((p, s) => (s === seat ? p : -1));
    }
    return v;
  }

  root.LL = {
    DECK_SPEC, VALUES, DECK_SIZE, DIE, HAND, DEFAULTS, OPTIONS, COLORS, RuleError,
    cleanSettings, makeDeck, shuffle, handSum, upSum, anteFor,
    newGame, alive, inPlay, nextInOrder, fromStart, current,
    beginRound, endRoll, applyReveal, autoReveal, revealWaiting,
    cap, betInfo, applyBet, autoBet, betPending,
    hitEligible, applyHit, applyStay,
    evaluate, nextRound, resign, ranking, unseenCounts, viewFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
