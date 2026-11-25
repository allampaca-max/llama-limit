/* 규칙 엔진 테스트. macOS 내장 JavaScriptCore로 실행:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc engine.js bot.js tests/engine.test.js
 * (브라우저에서는 tests/index.html 을 열면 같은 테스트가 돈다.)
 */
(function (G) {
  const LL = G.LL, Bot = G.LLBot;
  const out = typeof print === 'function' ? print : (s) => console.log(s);
  let pass = 0, fail = 0;
  function test(name, fn) {
    try { fn(); pass++; } catch (e) { fail++; out('FAIL ' + name + ': ' + (e && e.message) + (e && e.stack ? '\n' + e.stack.split('\n').slice(0, 4).join('\n') : '')); }
  }
  function eq(a, b, msg) {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) throw new Error((msg || '') + ' expected ' + B + ' got ' + A);
  }
  function ok(v, msg) { if (!v) throw new Error(msg || 'not ok'); }
  function throws(fn, code) {
    try { fn(); } catch (e) {
      if (e instanceof LL.RuleError) { if (code && e.code !== code) throw new Error('expected ' + code + ' got ' + e.code); return; }
      throw e;
    }
    throw new Error('expected RuleError ' + (code || ''));
  }
  const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const total = (st) => st.chips.reduce((a, b) => a + b, 0) + (st.r ? st.r.pot : 0);

  // n명, 자리 순서 0..n-1, 첫 선 = first. 라운드를 시작하고 손패를 원하는 값으로 바꾼다.
  function setup(n, first, hands, opts) {
    opts = opts || {};
    const st = LL.newGame(Object.assign({ players: n }, opts.settings || {}), Array.from({ length: n }, (_, i) => i), seeded(7), first);
    if (opts.chips) st.chips = opts.chips.slice();
    LL.beginRound(st, seeded(11));
    if (hands) {
      hands.forEach((h, s) => { if (h) st.r.hands[s] = h.map((v) => ({ v, up: false })); });
      if (opts.deck) st.r.deck = opts.deck.slice();
    }
    if (opts.limit) st.r.limit = opts.limit;
    LL.endRoll(st);
    return st;
  }
  function revealAll(st, idx) { for (const s of st.order) if (st.r.inHand[s] && !st.r.folded[s] && st.r.pick[s] < 0) LL.applyReveal(st, s, idx == null ? 0 : idx); }
  function checkAround(st) { let g = 0; while (st.phase === 'bet' && g++ < 20) LL.applyBet(st, st.r.actor, 'call'); }
  function stayAll(st) { let g = 0; while (st.phase === 'hit' && g++ < 20) LL.applyStay(st, st.r.actor); }

  test('덱 구성', () => {
    const d = LL.makeDeck();
    eq(d.length, 35);
    eq(LL.DECK_SIZE, 35);
    const c = {};
    d.forEach((v) => { c[v] = (c[v] || 0) + 1; });
    eq([c[7], c[6], c[5], c[4], c[3], c[2], c[1], c[-1]], [1, 2, 3, 4, 5, 6, 7, 7]);
  });

  test('설정 정리', () => {
    eq(LL.cleanSettings({ players: 9, turnSec: 5 }), { players: 2, turnSec: 40, anteEvery: 10, chips: 30 });
    eq(LL.cleanSettings({ players: '5', turnSec: 20, anteEvery: 5 }).players, 5);
  });

  test('라운드 시작: 앤티, 3장, 주사위', () => {
    const st = LL.newGame({ players: 4 }, [2, 0, 3, 1], seeded(3), 3);
    eq(st.phase, 'lottery');
    eq(st.firstStart, 3);
    LL.beginRound(st, seeded(5));
    eq(st.phase, 'roll');
    eq(st.round, 1);
    eq(st.r.start, 3);
    eq(st.r.ante, 1);
    eq(st.chips, [29, 29, 29, 29]);
    eq(st.r.pot, 4);
    ok(LL.DIE.includes(st.r.limit));
    for (let s = 0; s < 4; s++) eq(st.r.hands[s].length, 3);
    eq(st.r.deck.length, 35 - 12);
    eq(total(st), 120);
  });

  test('공개는 모두 고른 뒤 한꺼번에, 그다음 선부터 1차 베팅', () => {
    const st = setup(3, 1, [[1, 2, 3], [4, 5, 6], [-1, 1, 7]]);
    LL.applyReveal(st, 0, 2);
    throws(() => LL.applyReveal(st, 0, 1), 'already');
    eq(st.r.hands[0][2].up, false, '아직 뒤집지 않음');
    const v1 = LL.viewFor(st, 1);
    eq(v1.r.picked, [true, false, false]);
    eq(v1.r.pick, [-1, -1, -1], '남이 고른 카드는 안 보임');
    LL.applyReveal(st, 1, 0);
    throws(() => LL.applyReveal(st, 2, 3), 'badCard');
    LL.applyReveal(st, 2, 1);
    eq(st.phase, 'bet');
    eq(st.r.bet.no, 1);
    eq(st.r.actor, 1, '선(1)부터');
    eq(st.r.hands[0].map((c) => c.up), [false, false, true]);
    eq(st.log.filter((e) => e.k === 'reveal').map((e) => e.seat), [1, 2, 0]);
  });

  test('체크만 돌면 히트 단계, 히트는 선부터', () => {
    const st = setup(3, 2, [[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    revealAll(st);
    eq(st.r.actor, 2);
    LL.applyBet(st, 2, 'call');
    LL.applyBet(st, 0, 'call');
    throws(() => LL.applyBet(st, 0, 'call'), 'notYou');
    LL.applyBet(st, 1, 'call');
    eq(st.phase, 'hit');
    eq(st.r.actor, 2);
  });

  test('레이즈하면 나머지가 다시 응답해야 한다', () => {
    const st = setup(3, 0, [[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    revealAll(st);
    LL.applyBet(st, 0, 'call');           // 체크
    LL.applyBet(st, 1, 'raise', 3);       // 1 → 4
    eq(st.r.bet.cur, 4);
    eq(st.r.actor, 2);
    LL.applyBet(st, 2, 'call');
    eq(st.r.actor, 0, '처음 체크한 사람도 다시');
    eq(st.phase, 'bet');
    LL.applyBet(st, 0, 'call');
    eq(st.phase, 'hit');
    eq(st.r.contrib, [4, 4, 4]);
    eq(st.r.pot, 12);
    eq(st.chips, [26, 26, 26]);
  });

  test('베팅 상한: 가장 적은 칩(라운드 시작 때)까지', () => {
    const st = setup(3, 0, [[1, 1, 1], [2, 2, 2], [3, 3, 3]], { chips: [30, 6, 20] });
    revealAll(st);
    const info = LL.betInfo(st, 0);
    eq(info.cap, 6);
    eq(info.maxRaise, 5);
    throws(() => LL.applyBet(st, 0, 'raise', 6), 'cap');
    LL.applyBet(st, 0, 'raise', 5);
    eq(LL.betInfo(st, 1).maxRaise, 0);
    // 가난한 사람이 포기하면 상한이 올라간다
    LL.applyBet(st, 1, 'fold');
    eq(LL.cap(st), 20);
    eq(LL.betInfo(st, 2).maxRaise, 14);
  });

  test('앤티가 가장 적은 칩보다 크면 그만큼만, 상한에 닿으면 베팅 건너뜀', () => {
    const st = LL.newGame({ players: 2 }, [0, 1], seeded(1), 0);
    st.chips = [1, 40];
    st.round = 10; // 다음은 11라운드 → 기본 베팅 2
    LL.beginRound(st, seeded(2));
    eq(st.ante, 2);
    eq(st.r.ante, 1);
    eq(st.chips, [0, 39]);
    LL.endRoll(st);
    revealAll(st);
    eq(st.phase, 'hit', '1차 베팅 생략');
    ok(st.log.some((e) => e.k === 'betSkip' && e.no === 1));
  });

  test('앤티는 10라운드마다(옵션 5) 1씩', () => {
    const s10 = LL.cleanSettings({}), s5 = LL.cleanSettings({ anteEvery: 5 });
    eq([1, 10, 11, 20, 21].map((r) => LL.anteFor(s10, r)), [1, 1, 2, 2, 3]);
    eq([1, 5, 6, 11].map((r) => LL.anteFor(s5, r)), [1, 1, 2, 3]);
  });

  test('모두 포기하고 한 명 남으면 바로 판돈', () => {
    const st = setup(3, 0, [[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    revealAll(st);
    LL.applyBet(st, 0, 'raise', 2);
    LL.applyBet(st, 1, 'fold');
    LL.applyBet(st, 2, 'fold');
    eq(st.phase, 'result');
    eq(st.r.outcome.reason, 'fold');
    eq(st.r.outcome.winners, [0]);
    eq(st.r.outcome.pot, 5);
    eq(st.chips, [32, 29, 29]);
    // 포기로 끝나면 손패는 비공개
    const v = LL.viewFor(st, 1);
    eq(v.r.hands[0].filter((c) => c.v == null).length, 2);
  });

  test('스테이는 끝, 히트는 공개 카드', () => {
    const st = setup(2, 0, [[1, 1, 1], [2, 2, 2]], { deck: [5, -1, 3, 4] });
    revealAll(st);
    checkAround(st);
    eq(st.phase, 'hit');
    LL.applyHit(st, 0);                    // 4
    eq(st.r.hands[0][3], { v: 4, up: true, hit: true });
    LL.applyStay(st, 1);
    eq(st.r.actor, 0, '스테이한 사람은 건너뜀');
    LL.applyHit(st, 0);                    // 3
    LL.applyHit(st, 0);                    // -1
    LL.applyStay(st, 0);
    eq(st.phase, 'bet');
    eq(st.r.bet.no, 2);
    eq(st.r.hands[0].map((c) => c.v), [1, 1, 1, 4, 3, -1]);
  });

  test('카드가 떨어지면 히트 끝', () => {
    const st = setup(2, 1, [[1, 1, 1], [2, 2, 2]], { deck: [3, 4] });
    revealAll(st);
    checkAround(st);
    LL.applyHit(st, 1);
    LL.applyHit(st, 0);
    eq(st.phase, 'bet', '덱 소진');
    ok(st.log.some((e) => e.k === 'hitEnd' && e.empty));
  });

  test('승부: 한계 이하 최대 합, 같으면 카드 많은 쪽', () => {
    const st = setup(3, 0, [[3, 3, 3], [4, 4, 1], [2, 2, 1]], { limit: 9, deck: [1, 1, 1] });
    revealAll(st);
    checkAround(st);
    // 2번이 히트해 합 6, 0번 9(3장), 1번 9(3장) → 비김? 2번이 2장 더 받아 9(5장)면 2번 승리
    LL.applyStay(st, 0);
    LL.applyStay(st, 1);
    LL.applyHit(st, 2); LL.applyHit(st, 2); LL.applyHit(st, 2);
    eq(st.phase, 'bet');
    eq(LL.handSum(st.r.hands[2]), 8);
    checkAround(st);
    eq(st.phase, 'result');
    // 0과 1이 9/3장으로 같다 → 둘이 나눔
    eq(st.r.outcome.winners, [0, 1]);
    eq(st.r.outcome.split, true);
  });

  test('비기면 똑같이 나누고 남는 칩은 선에 가까운 사람부터', () => {
    const st = setup(4, 2, [[5, 4, 1], [2, 2, 2], [5, 5, 1], [3, 3, 4]], { limit: 10 });
    revealAll(st);
    // 선 2부터: 2 레이즈 2 → 판돈 4+2=6, 나머지 콜
    LL.applyBet(st, 2, 'raise', 2);
    LL.applyBet(st, 3, 'call');
    LL.applyBet(st, 0, 'call');
    LL.applyBet(st, 1, 'fold');
    eq(st.r.pot, 1 + 3 + 3 + 3);
    stayAll(st);
    checkAround(st);
    // 0: 10(3장), 2: 11 넘침, 3: 10(3장) → 0과 3이 나눔. 판돈 10 → 5/5
    eq(st.r.outcome.winners, [3, 0], '선(2) 다음부터 시계 방향');
    eq(st.r.outcome.gains, [5, 0, 0, 5]);
  });

  test('남는 칩 분배 순서', () => {
    const st = setup(3, 1, [[4, 4, 1], [4, 4, 1], [3, 3, 3]], { limit: 9 });
    revealAll(st);
    // 판돈 3, 셋 다 9(3장) → 1씩. 레이즈 없이 7로 만들기: 1이 레이즈 1 → 판돈 3+...
    LL.applyBet(st, 1, 'raise', 1);
    LL.applyBet(st, 2, 'call');
    LL.applyBet(st, 0, 'call');
    eq(st.r.pot, 6);
    stayAll(st);
    LL.applyBet(st, 1, 'raise', 1);
    LL.applyBet(st, 2, 'call');
    LL.applyBet(st, 0, 'fold');
    eq(st.r.outcome.pot, 8);
    // 1과 2가 9/3장으로 비김 → 4/4
    eq(st.r.outcome.gains, [0, 4, 4]);
    const st2 = setup(3, 2, [[4, 4, 1], [4, 4, 1], [4, 4, 1]], { limit: 9 });
    revealAll(st2);
    checkAround(st2); stayAll(st2);
    LL.applyBet(st2, 2, 'raise', 1);
    LL.applyBet(st2, 0, 'call');
    LL.applyBet(st2, 1, 'call');
    eq(st2.r.outcome.pot, 6);
    eq(st2.r.outcome.gains, [2, 2, 2]);
    const st3 = setup(2, 1, [[4, 4, 1], [4, 4, 1]], { limit: 9, chips: [10, 10] });
    st3.r.pot = 5; // 일부러 홀수
    revealAll(st3); checkAround(st3); stayAll(st3); checkAround(st3);
    eq(st3.r.outcome.gains, [2, 3], '선(1)이 남는 1칩');
  });

  test('모두 넘치면 참가자끼리 나눔', () => {
    const st = setup(3, 0, [[7, 6, 5], [5, 5, 4], [1, 1, 1]], { limit: 5 });
    revealAll(st);
    LL.applyBet(st, 0, 'call');
    LL.applyBet(st, 1, 'call');
    LL.applyBet(st, 2, 'fold');
    stayAll(st);
    checkAround(st);
    eq(st.r.outcome.allBust, true);
    eq(st.r.outcome.winners, [0, 1]);
    eq(st.r.outcome.gains, [2, 1, 0]);
  });

  test('쇼다운 뒤에는 포기 안 한 사람 손패가 모두 보인다', () => {
    const st = setup(3, 0, [[1, 2, 3], [2, 2, 2], [3, 3, 3]]);
    revealAll(st);
    LL.applyBet(st, 0, 'call'); LL.applyBet(st, 1, 'fold'); LL.applyBet(st, 2, 'call');
    stayAll(st); checkAround(st);
    const v = LL.viewFor(st, 0);
    eq(v.r.hands[2].map((c) => c.v), [3, 3, 3]);
    eq(v.r.hands[1].map((c) => c.v), [2, null, null], '포기한 사람은 그대로 비공개');
    ok(v.r.deck === undefined && typeof v.r.deckLeft === 'number');
  });

  test('보기: 남의 뒷면은 가리고 내 것은 보인다', () => {
    const st = setup(2, 0, [[1, 2, 3], [4, 5, 6]]);
    const v = LL.viewFor(st, 1);
    eq(v.r.hands[1].map((c) => c.v), [4, 5, 6]);
    eq(v.r.hands[0].map((c) => c.v), [null, null, null]);
    revealAll(st, 1);
    const v2 = LL.viewFor(st, 1);
    eq(v2.r.hands[0].map((c) => c.v), [null, 2, null]);
    const cnt = LL.unseenCounts(v2);
    eq(cnt[2], 6 - 1, '공개된 2 하나 빠짐');
    eq(cnt[4], 3, '내 4 빠짐');
  });

  test('선은 시계 방향으로 넘어가고 탈락자는 건너뜀', () => {
    const st = LL.newGame({ players: 4 }, [3, 1, 0, 2], seeded(9), 1);
    LL.beginRound(st, seeded(1));
    eq(st.r.start, 1);
    st.phase = 'result';
    LL.nextRound(st, seeded(2));
    eq(st.r.start, 0);
    st.phase = 'result';
    st.out[2] = true; st.chips[2] = 0;
    LL.nextRound(st, seeded(3));
    eq(st.r.start, 3, '2는 탈락 → 3');
    eq(st.r.inHand[2], false);
    eq(st.r.hands[2].length, 0);
  });

  test('칩을 다 잃으면 탈락, 한 명 남으면 끝, 순위', () => {
    const st = setup(3, 0, [[5, 4, 1], [1, 1, 1], [1, 1, 2]], { limit: 10, chips: [10, 4, 2] });
    revealAll(st);
    LL.applyBet(st, 0, 'raise', 1);    // 상한 2
    LL.applyBet(st, 1, 'call');
    LL.applyBet(st, 2, 'call');
    stayAll(st);
    eq(st.phase, 'result', '상한이라 2차 베팅 생략');
    eq(st.r.outcome.winners, [0]);
    eq(st.chips, [14, 2, 0]);
    eq(st.out, [false, false, true]);
    eq(st.r.outcome.eliminated, [2]);
    st.r.outcome = null;
    LL.nextRound(st, seeded(4));
    eq(st.r.start, 1);
    LL.endRoll(st);
    st.r.hands[0] = [7, 1, 1].map((v) => ({ v, up: false }));
    st.r.hands[1] = [1, 1, 1].map((v) => ({ v, up: false }));
    st.r.limit = 12;
    revealAll(st);
    LL.applyBet(st, 1, 'call');
    LL.applyBet(st, 0, 'raise', 1);
    LL.applyBet(st, 1, 'call');
    eq(st.phase, 'hit');
    stayAll(st);
    eq(st.phase, 'over');
    const rk = st.result.ranking;
    eq(rk.map((x) => [x.seat, x.rank]), [[0, 1], [1, 2], [2, 3]]);
    eq(total(st), 16);
  });

  test('같은 라운드에 함께 탈락하면 같은 순위', () => {
    const st = setup(3, 0, [[5, 5, 1], [1, 1, 1], [1, 1, 2]], { limit: 11, chips: [10, 2, 2] });
    revealAll(st);
    LL.applyBet(st, 0, 'raise', 1);
    LL.applyBet(st, 1, 'call');
    LL.applyBet(st, 2, 'call');
    stayAll(st);
    eq(st.phase, 'over');
    eq(st.result.ranking.map((x) => x.rank), [1, 2, 2]);
  });

  test('기권: 내 차례면 넘어가고, 한 명만 남으면 판돈', () => {
    const st = setup(3, 0, [[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    revealAll(st);
    LL.applyBet(st, 0, 'raise', 2);
    LL.resign(st, 1);
    eq(st.r.actor, 2);
    eq(st.chips[1], 0);
    eq(st.out[1], true);
    LL.resign(st, 2);
    eq(st.phase, 'over');
    eq(st.result.ranking[0].seat, 0);
    eq(st.result.ranking.map((x) => x.seat), [0, 2, 1], '늦게 기권한 쪽이 위');
  });

  test('기권: 공개 고르는 중이면 남은 사람 기준으로 진행', () => {
    const st = setup(3, 0, [[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    LL.applyReveal(st, 0, 0);
    LL.applyReveal(st, 1, 0);
    LL.resign(st, 2);
    eq(st.phase, 'bet');
    eq(st.r.actor, 0);
  });

  test('시간 초과 처리', () => {
    const st = setup(3, 0, [[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    LL.applyReveal(st, 1, 2);
    LL.autoReveal(st, seeded(5));
    eq(st.phase, 'bet');
    ok(st.log.some((e) => e.k === 'reveal' && e.seat === 0 && e.auto));
    LL.autoBet(st);                          // 0: 체크
    eq(st.r.acts[0].a, 'check');
    LL.applyBet(st, 1, 'raise', 1);
    LL.autoBet(st);                          // 2: 포기
    eq(st.r.folded[2], true);
  });

  test('봇끼리 끝까지: 예외 없음, 칩 보존', () => {
    let rounds = 0, games = 0, maxR = 0;
    for (let g = 0; g < 40; g++) {
      const n = 2 + (g % 4);
      const st = LL.newGame({ players: n, anteEvery: g % 2 ? 5 : 10 }, null, Math.random);
      LL.beginRound(st);
      let guard = 0;
      while (st.phase !== 'over' && guard++ < 20000) {
        const before = total(st);
        if (st.phase === 'roll') LL.endRoll(st);
        else if (st.phase === 'reveal') {
          for (const s of LL.revealWaiting(st)) { if (st.phase !== 'reveal') break; LL.applyReveal(st, s, Bot.chooseReveal(LL.viewFor(st, s))); }
        } else if (st.phase === 'bet') {
          const s = st.r.actor, d = Bot.chooseBet(LL.viewFor(st, s));
          LL.applyBet(st, s, d.a, d.amount);
        } else if (st.phase === 'hit') {
          const s = st.r.actor;
          if (Bot.chooseHit(LL.viewFor(st, s)) === 'hit') LL.applyHit(st, s); else LL.applyStay(st, s);
        } else if (st.phase === 'result') {
          LL.nextRound(st);
        }
        eq(total(st), before, '칩 보존');
        ok(st.chips.every((c) => c >= 0), '음수 칩 없음');
      }
      ok(st.phase === 'over', '끝나야 함 (n=' + n + ')');
      eq(total(st), 30 * n);
      eq(st.result.ranking[0].rank, 1);
      rounds += st.round; games++; maxR = Math.max(maxR, st.round);
    }
    out('  봇 게임 평균 ' + (rounds / games).toFixed(1) + '라운드, 최장 ' + maxR);
  });

  out((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
})(typeof window !== 'undefined' ? window : globalThis);
