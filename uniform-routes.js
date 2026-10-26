// 유니폼 번호 · 사이즈 조사 API.  /api/uniform/*
//
//   누가 무엇을 하나
//     누구나(링크를 아는 사람)   보기: GET /api/uniform, 실시간 GET /api/uniform/stream
//                               — 번호가 누구 것인지는 보이고, **사이즈는 보이지 않는다**
//     회원 본인                  내 정보·번호 고르기·놓기·사이즈: POST /mine /claim /release /size
//                               (전화 뒷 4자리 필수 — 번호는 남의 자리를 바꾸므로 틀리면 막는다)
//     총무(열쇠, ?key=)          같은 요청을 대신하고(번호 확인 없음), 표·마감·유니폼 지정·기존 번호 가져오기
//
//   실시간: 번호가 바뀔 때마다 접속 중인 모두에게 SSE로 스냅샷을 보낸다. 번호의 상태(잠김/휴면/빔)는
//   저장하지 않고 스냅샷을 만들 때마다 회원들의 선택에서 계산한다(numbers.js).
const N = require('./numbers');

module.exports = function mountUniform(app, deps) {
  const {
    store, boardStore, ROSTER, LABELS, DORMANT, AUTH, NEED_CODE, SEED, SIZES, KITS,
    codeOk, guard, tooMany, noteFail, fails, voteInfo,
  } = deps;

  const label = n => LABELS[n] || n;
  const KIT_BY_ID = Object.fromEntries(KITS.map(k => [k.id, k]));
  const KIT_IDS = new Set(KITS.map(k => k.id));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const wrap = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof N.RuleError) return res.status(e.status).json({ error: e.message });
      console.error('[번호]', e);
      res.status(503).json({ error: '불러오지 못했습니다. 잠시 뒤에 다시 해주세요.' });
    }
  };

  // 활동/휴면은 보드가 정한 그대로 따른다(총무가 바꾼 것 > 환경변수 DORMANT).
  async function ctxNow() {
    let act = {};
    try { act = ((await boardStore.state()) || {}).active || {}; } catch (e) { /* 보드가 죽어도 번호는 돈다 */ }
    return {
      roster: ROSTER,
      isActive: n => (has(act, n) ? act[n] : !DORMANT.has(n)),
      label, seed: SEED, sizes: SIZES,
    };
  }

  // 유니폼: 총무가 지정했으면 그것, 아니면 투표가 끝난 뒤의 1위. 가격·업체명은 싣지 않는다.
  const pickWinner = (st, vote) => {
    if (st.winner && KIT_BY_ID[st.winner])
      return { id: st.winner, name: KIT_BY_ID[st.winner].name, by: 'admin' };
    return vote.closed && vote.winner ? { ...vote.winner, by: 'vote' } : null;
  };

  // ---------- 스냅샷과 실시간 ----------
  // seq: 먼저 시작한 쪽이 낮은 번호 — 화면이 오래된 스냅샷을 걸러낸다.
  // boot: 서버가 다시 떠서 seq 가 1부터 다시 세어져도 화면이 새 스냅샷을 버리지 않게 한다.
  const BOOT = Date.now().toString(36);
  let seq = 0;
  async function snapshot() {
    const mine = ++seq;
    const [st, ctx, vote] = await Promise.all([store.state(), ctxNow(), voteInfo()]);
    return {
      boot: BOOT, seq: mine,
      ...N.publicView(st, ctx),
      voteClosed: vote.closed,
      winner: pickWinner(st, vote),
    };
  }

  const clients = new Set();
  const CLIENT_MAX = 400;
  let pending = false;
  function notify() {
    if (!clients.size || pending) return;
    pending = true;
    setTimeout(async () => {
      pending = false;                   // 보내는 동안 또 바뀌면 다음 차례가 다시 잡힌다
      try {
        const msg = `event: snap\ndata: ${JSON.stringify(await snapshot())}\n\n`;
        for (const c of clients) c.write(msg);
      } catch (e) { console.error('[번호] 실시간 전송 실패:', e.message); }
    }, 30);
  }
  // 프록시가 놀고 있는 연결을 끊지 않게 20초마다 숨을 쉰다
  setInterval(() => { for (const c of clients) c.write(': ka\n\n'); }, 20000).unref();

  app.get('/api/uniform', wrap(async (req, res) => { res.json(await snapshot()); }));

  app.get('/api/uniform/stream', (req, res) => {
    if (clients.size >= CLIENT_MAX) return res.status(503).end();
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    snapshot().then(s => res.write(`event: snap\ndata: ${JSON.stringify(s)}\n\n`)).catch(() => {});
  });

  // ---------- 회원 ----------
  // 본인 확인. 총무 열쇠가 있으면 번호 없이 대신 할 수 있다. 틀린 횟수는 코치 모드와 같은 방식으로 센다.
  function memberAuth(req, res, member) {
    if (!ROSTER.includes(member)) { bad(res, '명부에 없는 이름입니다.'); return false; }
    if (req.query.key) return guard(req, res);
    if (!NEED_CODE) return true;
    const bucket = 'num|' + member + '|' + (req.ip || '');
    if (tooMany(bucket)) { bad(res, '여러 번 틀렸습니다. 10분 뒤에 다시 해주세요.', 429); return false; }
    const code = String((req.body || {}).code || '').replace(/\D/g, '');
    if (code.length !== 4 || !codeOk(member, code)) {
      noteFail(bucket);
      bad(res, '전화번호 뒷 4자리가 맞지 않습니다.', 403);
      return false;
    }
    fails.delete(bucket);
    return true;
  }

  app.post('/api/uniform/mine', wrap(async (req, res) => {
    const member = String((req.body || {}).member || '');
    if (!memberAuth(req, res, member)) return;
    const [st, ctx] = await Promise.all([store.state(), ctxNow()]);
    res.json({ ok: true, me: N.privateView(st, ctx, member) });
  }));

  // 번호·사이즈를 바꾸는 요청은 모두 같은 틀이다: 본인 확인 → (마감이면 거부) → 규칙 적용 → 모두에게 알림.
  const change = (path, apply) => app.post(path, wrap(async (req, res) => {
    const body = req.body || {};
    const member = String(body.member || '');
    if (!memberAuth(req, res, member)) return;
    const byAdmin = !!req.query.key;
    const ctx = await ctxNow();
    const st = await store.update(s => {
      // 마감 확인도 저장소 안에서 한다 — 마감 직전에 들어온 요청이 새어 들어가지 않게
      if (N.norm(s).locked && !byAdmin)
        throw new N.RuleError('접수가 마감되었습니다. 바꿀 일이 있으면 총무에게 문의해 주세요.', 403);
      return apply(s, ctx, member, body);
    });
    notify();
    res.json({ ok: true, me: N.privateView(st, ctx, member) });
  }));

  change('/api/uniform/claim', (s, ctx, member, b) => {
    const n = typeof b.number === 'string' && /^\d{1,3}$/.test(b.number) ? parseInt(b.number, 10) : b.number;
    return N.claim(s, ctx, member, n);
  });
  change('/api/uniform/release', (s, ctx, member) => N.release(s, ctx, member));
  change('/api/uniform/size', (s, ctx, member, b) => N.setSize(s, ctx, member, b.size));

  // ---------- 총무 ----------
  const admin = (method, path, fn) => app[method](path, wrap(async (req, res) => {
    if (!guard(req, res)) return;
    await fn(req, res);
  }));
  const touch = async fn => { const out = await store.update(fn); notify(); return out; };

  admin('get', '/api/uniform/admin/table', async (req, res) => {
    const [st, ctx, vote] = await Promise.all([store.state(), ctxNow(), voteInfo()]);
    res.json({
      ok: true,
      ...N.adminView(st, ctx),
      // 연락처가 없어 본인 확인을 못 하는 회원 — 이 분들은 아무 4자리나 통과하므로 총무가 확인한다
      unverifiable: NEED_CODE ? ROSTER.filter(n => !has(AUTH, n)) : [],
      kits: KITS.map(k => ({ id: k.id, name: k.name })),
      winnerSet: st.winner || null,
      winnerAuto: vote.winner || null,
      voteClosed: vote.closed,
    });
  });

  admin('post', '/api/uniform/admin/lock', async (req, res) => {
    const locked = (req.body || {}).locked !== false;
    await touch(s => N.setLocked(s, locked));
    res.json({ ok: true, locked });
  });

  admin('post', '/api/uniform/admin/winner', async (req, res) => {
    const id = (req.body || {}).winner;
    await touch(s => N.setWinner(s, id, KIT_IDS));
    res.json({ ok: true });
  });

  admin('post', '/api/uniform/admin/seed', async (req, res) => {
    const ctx = await ctxNow();
    let out;
    await touch(s => { out = N.importSeed(s, ctx, (req.body || {}).text); return s; });
    res.json({ ok: true, ...out });
  });

  admin('post', '/api/uniform/admin/clear', async (req, res) => {
    const ctx = await ctxNow();
    const member = String((req.body || {}).member || '');
    await touch(s => N.clearMember(s, ctx, member));
    res.json({ ok: true });
  });

  return { notify };
};
