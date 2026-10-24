// 자체전 포메이션 보드 API.  /api/board/*
//
//   누가 무엇을 하나
//     누구나(링크를 아는 사람)   보기: GET /api/board
//     회원 본인                  자기 포지션 입력: POST /positions   (전화 뒷 4자리, 입력 기간 안에서만)
//     감독 두 명 (감독 모드)     지명·되돌리기·최종 확정·포메이션: POST /pick /undo /confirm /formation
//                                (본인 확인 필수 — 틀리면 막는다)
//     총무(열쇠, ?key=)          모든 것: 감독 지정, 시작·마감, 입력 기간, 어느 팀이든 대신 조작, 연령대 정보 보기
//
//   투표는 틀린 번호도 받아 주지만(총무 결정) 감독은 막는다 — 감독 행세는 팀 전체를 흔들기 때문이다.
//   연령대는 공개 응답에 싣지 않는다. 감독(자기 요청)과 총무에게만 내려간다.
const C = require('./public/core');
const D = require('./draft');

module.exports = function mountBoard(app, deps) {
  const {
    store, ROSTER, ROSTER_VIEW, LABELS, DORMANT, AGE, AUTH, NEED_CODE,
    codeOk, guard, tooMany, noteFail, fails, IS_PROD,
  } = deps;

  const labelOf = n => LABELS[n] || n;
  const CTX = {
    roster: ROSTER,
    isActive: (st, n) => (n in st.active ? st.active[n] : !DORMANT.has(n)),
    label: labelOf,
    band: n => AGE[n],
    ageOn: Object.keys(AGE).length > 0,
  };

  // 오류는 한 곳에서 모은다. 규칙 위반은 그대로 알려주고, 저장소 오류는 투표에 번지지 않게 가둔다.
  const wrap = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof D.RuleError) return res.status(e.status).json({ error: e.message });
      console.error('[보드]', e);
      res.status(503).json({ error: '보드를 불러오지 못했습니다. 잠시 뒤에 다시 해주세요.' });
    }
  };
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const kst = iso => new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  // 누구나 보는 응답. 연령대·번호 정보는 없다.
  function view(st, posRows) {
    const posMap = new Map(posRows.map(r => [r.member, r.payload]));
    const win = D.windowState(st, CTX);
    return {
      phase: st.phase,
      picks: st.picks.length,
      turn: st.turn,
      first: st.first,
      confirmed: st.confirmed,
      names: st.names,
      colors: st.colors,
      coaches: st.coaches.map(n => (n ? { v: n, label: labelOf(n) } : null)),
      teams: st.teams,
      formation: st.formation,
      pool: D.poolOf(st, CTX),
      members: ROSTER_VIEW.map(({ v, label }) => {
        const p = posMap.get(v);
        // 좌우를 묻던 시절 값이 남아 있을 수 있다. 통합된 자리로 바꿔 내려보낸다.
        const pos = p && Array.isArray(p.pos) && p.pos.length
          ? [...new Set(p.pos.map(x => C.LEGACY_POS[x] || x))] : null;
        return { v, label, active: CTX.isActive(st, v), pos, foot: (p && p.foot) || null };
      }),
      log: st.log.slice(-80).reverse(),
      needCode: NEED_CODE,
      ageOn: D.balanceOn(st, CTX),        // 연령대 비율 맞춤이 켜져 있는지(켜짐/꺼짐만)
      window: st.window,
      positionsOpen: win === 'open',
      positionsState: win,
    };
  }

  // 감독 확인. 총무 열쇠가 있으면 어느 팀이든 대신할 수 있다.
  async function coachAuth(req, res) {
    const body = req.body || {};
    if (req.query.key) {
      if (!guard(req, res)) return null;
      return { team: body.team === 1 ? 1 : 0, admin: true };
    }
    const name = String(body.name || '');
    const st = await store.state();
    const team = name ? st.coaches.indexOf(name) : -1;
    if (team < 0) { bad(res, '감독만 할 수 있습니다.', 403); return null; }
    if (NEED_CODE) {
      if (!Object.prototype.hasOwnProperty.call(AUTH, name)) {
        bad(res, '연락처가 등록되지 않아 본인 확인을 할 수 없습니다. 총무에게 대신 요청해 주세요.', 403);
        return null;
      }
      const bucket = 'coach|' + name + '|' + (req.ip || '');
      if (tooMany(bucket)) { bad(res, '여러 번 틀렸습니다. 10분 뒤에 다시 해주세요.', 429); return null; }
      const code = String(body.code || '').replace(/\D/g, '');
      if (code.length !== 4 || !codeOk(name, code)) {
        noteFail(bucket);
        bad(res, '전화번호 뒷 4자리가 맞지 않습니다.', 403);
        return null;
      }
      fails.delete(bucket);
    } else if (IS_PROD) {
      bad(res, '본인 확인 설정이 없어 지금은 총무만 할 수 있습니다.', 403);
      return null;
    }
    return { team, admin: false };
  }

  // 감독 모드 화면용: 내 차례인지, 되돌릴 수 있는지, 연령대 현황.
  // 연령대는 여기(인증된 감독·총무)로만 내려간다.
  function mine(st, team, admin) {
    const last = st.picks[st.picks.length - 1];
    const out = {
      ok: true, team, phase: st.phase, turn: st.turn,
      myTurn: st.phase === 'draft' && st.turn === team,
      confirmed: st.confirmed,
      canUndo: (st.phase === 'draft' || st.phase === 'review') && !!last && (admin || last.t === team),
      ageOn: D.balanceOn(st, CTX),
    };
    if (CTX.ageOn) {
      const info = D.balanceInfo(st, CTX);
      const pool = D.poolOf(st, CTX);
      out.bands = {};
      for (const n of [...st.teams[0], ...st.teams[1], ...pool]) out.bands[n] = D.bandOf(CTX, n);
      out.balance = info.rows;
      out.extra = { max: info.extraMax, used: info.used };
      out.blocked = {};
      for (const n of pool) { const w = D.whyNot(st, CTX, team, n, info); if (w) out.blocked[n] = w; }
    }
    return out;
  }

  // ---------- 보기 ----------
  app.get('/api/board', wrap(async (req, res) => {
    const [st, rows] = await Promise.all([store.state(), store.posAll()]);
    res.json(view(st, rows));
  }));

  // ---------- 회원: 포지션 입력 ----------
  app.post('/api/board/positions', wrap(async (req, res) => {
    const body = req.body || {};
    const isAdminReq = !!req.query.key;

    if (!isAdminReq) {                                 // 입력 기간 밖에는 받지 않는다 (총무는 언제든)
      const st = await store.state();
      const w = D.windowState(st, CTX);
      if (w === 'before') return bad(res, `포지션 입력은 ${kst(st.window.from)}부터 열립니다.`, 403);
      if (w === 'after') return bad(res, `포지션 입력이 마감되었습니다. (${kst(st.window.to)})`, 403);
    }

    const member = String(body.member || '');
    if (!ROSTER.includes(member)) return bad(res, '명부에 없는 이름입니다.');
    let pos, foot;
    try {
      pos = C.cleanPositions(body.positions);
      foot = C.cleanFoot(body.foot);          // 안 고를 수도 있다 (null)
    } catch (e) { return bad(res, e.message); }

    let codeState = null;
    if (isAdminReq) {
      if (!guard(req, res)) return;                    // 총무 대리 입력 — 번호 확인 없음
    } else if (NEED_CODE) {
      // 투표와 같은 방식: 번호가 달라도 막지 않고 한 번 되묻는다. 그래도 다르면 받고 표시만 남긴다.
      const code = String(body.code || '').replace(/\D/g, '');
      const known = Object.prototype.hasOwnProperty.call(AUTH, member);
      const ok = code.length === 4 && codeOk(member, code);
      const bucket = 'pos|' + member + '|' + (req.ip || '');
      if (!ok && body.confirm !== true && !tooMany(bucket)) {
        noteFail(bucket);
        return res.json({ saved: false, mismatch: true });
      }
      if (ok) fails.delete(bucket);
      codeState = known ? ok : null;
    }
    await store.posPut(member, { pos, foot, at: new Date().toISOString(), codeOk: codeState });
    res.json({ ok: true, saved: true, pos });
  }));

  // ---------- 감독 모드 ----------
  app.post('/api/board/mine', wrap(async (req, res) => {
    const a = await coachAuth(req, res);
    if (!a) return;
    res.json(mine(await store.state(), a.team, a.admin));
  }));

  app.post('/api/board/pick', wrap(async (req, res) => {
    const a = await coachAuth(req, res);
    if (!a) return;
    const player = String((req.body || {}).player || '');
    const st = await store.update(s => D.pick(s, a.team, player, CTX));
    res.json(mine(st, a.team, a.admin));
  }));

  app.post('/api/board/undo', wrap(async (req, res) => {
    const a = await coachAuth(req, res);
    if (!a) return;
    const st = await store.update(s => D.undo(s, a.admin ? null : a.team, CTX));
    res.json(mine(st, a.team, a.admin));
  }));

  app.post('/api/board/confirm', wrap(async (req, res) => {
    const a = await coachAuth(req, res);
    if (!a) return;
    const value = (req.body || {}).value !== false;
    const st = await store.update(s => D.confirm(s, a.team, value, CTX));
    res.json(mine(st, a.team, a.admin));
  }));

  app.post('/api/board/formation', wrap(async (req, res) => {
    const a = await coachAuth(req, res);
    if (!a) return;
    const st = await store.update(s => D.setFormation(s, a.team, req.body || {}, CTX));
    res.json({ ok: true, team: a.team, formation: st.formation[a.team] });
  }));

  // 팀 이름 — 감독은 자기 팀, 총무는 team 으로 고른 팀. 본문의 name 은 감독 이름이라 teamName 을 쓴다.
  app.post('/api/board/name', wrap(async (req, res) => {
    const a = await coachAuth(req, res);
    if (!a) return;
    const st = await store.update(s => D.rename(s, a.team, (req.body || {}).teamName, CTX));
    res.json({ ok: true, team: a.team, name: st.names[a.team] });
  }));

  // ---------- 총무 ----------
  const admin = (path, fn) => app.post(path, wrap(async (req, res) => {
    if (!guard(req, res)) return;
    await fn(req, res);
  }));
  const update = fn => store.update(fn);

  app.get('/api/board/admin/check', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json({ ok: true, ageOn: CTX.ageOn, ageCount: Object.keys(AGE).length, dormantCount: DORMANT.size });
  }));
  // 번호가 달라서 표시만 남은 포지션 입력. 공개 화면에는 싣지 않는다.
  app.get('/api/board/admin/flags', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const rows = await store.posAll();
    res.json({ flagged: rows.filter(r => r.payload && r.payload.codeOk === false).map(r => r.member) });
  }));
  admin('/api/board/admin/setup', async (req, res) => {
    await update(s => D.setup(s, req.body || {}, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/start', async (req, res) => {
    const f = (req.body || {}).first;
    const first = f === 0 || f === 1 ? f : undefined;           // 그 밖에는 추첨
    await update(s => D.start(s, CTX, first));
    res.json({ ok: true });
  });
  admin('/api/board/admin/finish', async (req, res) => {
    await update(s => D.finish(s, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/reopen', async (req, res) => {
    await update(s => D.reopen(s, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/release', async (req, res) => {
    await update(s => D.release(s, String((req.body || {}).player || ''), CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/reset', async (req, res) => {
    // 되돌릴 수 없다. 투표 reset과 같이 확인 값을 받는다.
    if (req.query.confirm !== 'yes') return bad(res, 'confirm=yes 가 필요합니다.');
    await update(s => D.reset(s, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/active', async (req, res) => {
    const b = req.body || {};
    const value = b.active === null || typeof b.active === 'boolean' ? b.active : undefined;
    if (value === undefined) return bad(res, '활동/휴면 값이 올바르지 않습니다.');
    await update(s => D.setActive(s, String(b.member || ''), value, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/window', async (req, res) => {
    await update(s => D.setWindow(s, req.body || {}, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/balance', async (req, res) => {
    await update(s => D.setBalance(s, (req.body || {}).on !== false, CTX));
    res.json({ ok: true });
  });
  admin('/api/board/admin/position-delete', async (req, res) => {
    const n = await store.posDel(String((req.body || {}).member || ''));
    res.json({ ok: true, deleted: n });
  });
};
