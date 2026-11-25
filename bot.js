/* 라마 리밋 봇. 자기 화면 정보(viewFor)만 보고 정한다.
 * 몬테카를로: 안 보이는 카드를 무작위로 나눠 주고, 모두가 단순한 규칙(한계까지 3 이상 남으면 히트)으로
 * 끝까지 진행해 봤을 때 내가 판돈을 가져가는 비율(지분)을 어림한다.
 */
(function (root) {
  'use strict';
  const LL = root.LL;

  function pool(v) {
    const cnt = LL.unseenCounts(v), out = [];
    for (const k of Object.keys(cnt)) for (let i = 0; i < cnt[k]; i++) out.push(+k);
    return out;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const hitsAhead = (v) => v.phase === 'roll' || v.phase === 'reveal' || v.phase === 'hit' || (v.phase === 'bet' && v.r.bet && v.r.bet.no === 1);

  // first: 'hit' | 'stay' | null — 지금 내 차례(히트 단계)에 할 행동을 고정하고 굴려 본다
  function equity(v, first, N) {
    const r = v.r, L = r.limit, me = v.me;
    const players = v.order.filter((s) => r.inHand[s] && !r.folded[s]);
    if (!players.includes(me)) return 0;
    const base = pool(v);
    const ahead = hitsAhead(v);
    const k = v.order.indexOf(first ? me : r.start);
    const rot = [];
    for (let i = 0; i < v.n; i++) { const s = v.order[(k + i + (first ? 1 : 0)) % v.n]; if (players.includes(s)) rot.push(s); }
    if (first) { const i = rot.indexOf(me); if (i >= 0) { rot.splice(i, 1); rot.push(me); } }
    let total = 0;
    N = N || 260;
    for (let t = 0; t < N; t++) {
      const p = shuffle(base.slice());
      const sum = {}, cnt = {}, stayed = {};
      for (const s of players) {
        let a = 0;
        for (const c of r.hands[s]) a += c.v != null ? c.v : p.pop();
        sum[s] = a; cnt[s] = r.hands[s].length; stayed[s] = !!r.stayed[s];
      }
      if (ahead) {
        if (first === 'hit' && p.length) { sum[me] += p.pop(); cnt[me]++; }
        else if (first === 'stay') stayed[me] = true;
        for (let guard = 0; guard < 40 && p.length; guard++) {
          let any = false;
          for (const s of rot) {
            if (stayed[s] || !p.length) continue;
            const gap = L - sum[s];
            if (gap < 0 || gap >= 3) { sum[s] += p.pop(); cnt[s]++; any = true; } else stayed[s] = true;
          }
          if (!any) break;
        }
      }
      const ok = players.filter((s) => sum[s] <= L);
      let win;
      if (!ok.length) win = players;
      else {
        let best = ok[0];
        for (const s of ok) if (sum[s] > sum[best] || (sum[s] === sum[best] && cnt[s] > cnt[best])) best = s;
        win = ok.filter((s) => sum[s] === sum[best] && cnt[s] === cnt[best]);
      }
      if (win.includes(me)) total += 1 / win.length;
    }
    return total / N;
  }

  // 공개할 카드: 대개 가운데 값(정보를 덜 주는 쪽), 가끔 아무거나
  function chooseReveal(v) {
    const hand = v.r.hands[v.me];
    if (Math.random() < 0.35) return Math.floor(Math.random() * hand.length);
    const idx = hand.map((c, i) => i).sort((a, b) => hand[a].v - hand[b].v);
    return idx[1];
  }

  // 칩을 다 잃으면 순위가 끝나는 게임이라, 남은 칩에서 큰 몫을 걸 때는 더 확실해야 한다.
  function chooseBet(v) {
    const me = v.me, r = v.r, info = LL.betInfo(v, me);
    const players = v.order.filter((s) => r.inHand[s] && !r.folded[s]).length;
    // 남이 레이즈했다면 그 사람 손이 좋을 가능성이 크다: 무작위 손을 가정한 지분을 깎는다
    const theirRaises = v.log.filter((e) => e.r === v.round && e.k === 'bet' && e.a === 'raise' && e.seat !== me && !r.folded[e.seat]);
    const raisedChips = theirRaises.reduce((t, e) => t + e.by, 0);
    const eq = equity(v, null, 320) * Math.pow(0.86, theirRaises.length) * Math.max(0.6, 1 - raisedChips / 60);
    const fair = 1 / players;
    const chips = Math.max(1, v.chips[me]);
    const raises = r.bet ? r.bet.raises : 0;
    const mine = v.log.filter((e) => e.r === v.round && e.k === 'bet' && e.no === info.no && e.a === 'raise' && e.seat === me).length;
    const rnd = Math.random();
    const strong = eq > Math.max(0.5, fair * 1.8) + raises * 0.1;
    if (info.maxRaise > 0 && strong && mine < (eq > 0.82 ? 2 : 1) && rnd < 0.8) {
      const frac = 0.06 + 0.4 * Math.max(0, eq - fair) * (eq > 0.85 ? 1.5 : 1);
      let k = Math.round(chips * frac * (0.6 + Math.random() * 0.8));
      k = Math.max(1, Math.min(info.maxRaise, k));
      return { a: 'raise', amount: k };
    }
    if (info.toCall === 0) {
      if (info.maxRaise > 0 && rnd < 0.06) return { a: 'raise', amount: Math.min(info.maxRaise, 1 + Math.floor(Math.random() * 2)) };
      return { a: 'call' };
    }
    const risk = info.toCall / chips;
    const potOdds = info.toCall / (info.pot + info.toCall);
    const need = Math.min(0.9, potOdds + 0.3 * risk * risk + (risk > 0.6 ? 0.1 : 0));
    if (eq >= need || (rnd < 0.05 && risk < 0.15)) return { a: 'call' };
    return { a: 'fold' };
  }

  function chooseHit(v) {
    const r = v.r, L = r.limit;
    const s = LL.handSum(r.hands[v.me]);
    if (!r.deckLeft) return 'stay';
    if (s > L) {
      // 넘쳤으면 −1로만 돌아올 수 있다. 1~2 넘쳤고 −1이 아직 남아 있을 때만 노린다.
      const over = s - L, negs = LL.unseenCounts(v)[-1] || 0;
      return over <= 2 && negs >= over ? 'hit' : 'stay';
    }
    if (s === L) return 'stay';
    const stay = equity(v, 'stay', 240), hit = equity(v, 'hit', 240);
    return hit > stay + 0.015 ? 'hit' : 'stay';
  }

  root.LLBot = { equity, chooseReveal, chooseBet, chooseHit };
})(typeof window !== 'undefined' ? window : globalThis);
