// 등번호·사이즈 신청 API.  /api/kit/*
//
//   누가 무엇을 하나
//     누구나(링크를 아는 사람)   보기: GET /api/kit        — 어느 번호가 비었는지, 누가 쓰는지
//     회원 본인                  신청: POST /api/kit/save  — 전화 뒷 4자리 (투표와 같은 방식)
//     총무(열쇠, ?key=)          모두 보기·대리 입력·삭제·마감 시각
//
//   번호 상태는 **그때그때 계산한다**. 어딘가에 「점유 표」를 따로 두면 회원이 번호를 바꿨을 때
//   그 표를 같이 고쳐야 하고, 한 번 틀어지면 멀쩡한 번호가 영영 잠긴다.
//   기존 번호(NUMBERS)와 신청 내역만 두고 매번 겹쳐서 본다 (kitnum.js 의 claimsOf).
const K = require('./public/kitnum');

class KitError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

module.exports = function mountKit(app, deps) {
  const {
    store, settings, ROSTER, ROSTER_VIEW, LABELS, DORMANT, AUTH, NEED_CODE,
    BASE, BASE_SIZE, codeOk, guard, tooMany, noteFail, fails, winner,
  } = deps;

  const OPEN = process.env.KIT_OPEN !== 'false';
  const DEADLINE_DEFAULT = process.env.KIT_DEADLINE || '';

  const labelOf = n => LABELS[n] || n;
  const isActive = n => !DORMANT.has(n);
  const expired = d => { const t = Date.parse(d); return Number.isFinite(t) && Date.now() >= t; };

  async function deadline() {
    const saved = await settings.get('kit_deadline').catch(() => null);
    return saved || DEADLINE_DEFAULT;
  }
  async function isOpen() {
    const d = await deadline();
    return OPEN && !(d && expired(d));
  }

  const wrap = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) {
      if (e instanceof KitError) return res.status(e.status).json({ error: e.message });
      console.error('[등번호]', e);
      res.status(503).json({ error: '등번호 신청을 불러오지 못했습니다. 잠시 뒤에 다시 해주세요.' });
    }
  };
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

  const ctxOf = orders => ({ roster: ROSTER, base: BASE, orders, isActive });

  // 공개 응답. 번호와 그 번호를 쓰는 사람 이름까지다 — 사이즈는 본인과 총무만 본다.
  //
  // **taken·dormant 에서 나는 빼고 보낸다.** 내가 쥔 번호는 내가 다시 고를 수 있어서,
  // 화면이 「누를 수 없음」을 taken 에 있는지만 보고 판단할 수 있게 된다.
  // 내가 쥔 번호는 mineHolds 로 따로 알려준다 (원래 쓰던 번호를 찾아 돌아올 수 있게).
  function publicView(orders, claims, me) {
    const taken = {}, dormant = {};
    let mineHolds = null;
    for (const [n, c] of claims) {
      if (me && (c.hard.includes(me) || c.soft.includes(me))) mineHolds = n;
      const hard = me ? c.hard.filter(x => x !== me) : c.hard;
      const soft = me ? c.soft.filter(x => x !== me) : c.soft;
      if (hard.length) taken[n] = hard.map(labelOf);
      else if (soft.length) dormant[n] = soft.map(labelOf);
    }
    const mine = me && orders[me] ? orders[me] : null;
    return {
      open: null,                       // 아래에서 채운다 (await 가 필요해서)
      sizes: K.SIZES,
      gridMax: K.GRID_MAX, numMax: K.NUM_MAX, noteMax: K.NOTE_MAX,
      taken, dormant, mineHolds,
      count: { done: Object.keys(orders).length, total: ROSTER.filter(isActive).length },
      base: me ? { number: K.parseBase(BASE[me]), size: BASE_SIZE[me] || null } : null,
      mine: mine ? { number: mine.number, size: mine.size, note: mine.note || '', at: mine.at } : null,
      needCode: NEED_CODE,
    };
  }

  // ---------- 보기 ----------
  app.get('/api/kit', wrap(async (req, res) => {
    const me = String(req.query.member || '');
    const rows = await store.all();
    const orders = Object.fromEntries(rows.map(r => [r.member, r.payload]));
    const claims = K.claimsOf(ctxOf(orders));
    const out = publicView(orders, claims, ROSTER.includes(me) ? me : '');
    const d = await deadline();
    out.open = await isOpen();
    out.deadline = d || null;
    out.winner = await winner();
    res.json(out);
  }));

  // ---------- 회원: 신청 ----------
  app.post('/api/kit/save', wrap(async (req, res) => {
    const body = req.body || {};
    const isAdminReq = !!req.query.key;

    if (!isAdminReq && !(await isOpen()))
      return bad(res, '등번호 신청이 마감되었습니다. 총무에게 문의해 주세요.', 403);

    const member = String(body.member || '');
    if (!ROSTER.includes(member)) return bad(res, '명부에 없는 이름입니다.');

    let number, size, note;
    try {
      number = K.cleanNumber(body.number);
      size = K.cleanSize(body.size);
      note = K.cleanNote(body.note);
    } catch (e) { return bad(res, e.message); }

    let codeState = null;
    if (isAdminReq) {
      if (!guard(req, res)) return;                 // 총무 대리 입력 — 번호 확인 없음
    } else if (NEED_CODE) {
      // 투표·포지션과 같은 방식: 번호가 달라도 막지 않고 한 번 되묻는다.
      // 그래도 다르면 받고 표시만 남긴다 — 총무가 나중에 확인한다.
      const code = String(body.code || '').replace(/\D/g, '');
      const known = Object.prototype.hasOwnProperty.call(AUTH, member);
      const ok = code.length === 4 && codeOk(member, code);
      const bucket = 'kit|' + member + '|' + (req.ip || '');
      if (!ok && body.confirm !== true && !tooMany(bucket)) {
        noteFail(bucket);
        return res.json({ saved: false, mismatch: true });
      }
      if (ok) fails.delete(bucket);
      codeState = known ? ok : null;
    }

    // 읽기와 쓰기가 한 덩어리다. 두 분이 같은 번호를 동시에 눌러도 한 분만 지나간다.
    try {
      await store.save(member, orders => {
        const claims = K.claimsOf(ctxOf(orders));
        if (!K.canTake(claims, number, member)) {
          const who = (claims.get(number).hard || []).map(labelOf).join(', ');
          throw new KitError(`${number}번은 ${who} 님이 쓰고 있어 고를 수 없습니다. 다른 번호를 골라주세요.`, 409);
        }
        return { number, size, note, at: new Date().toISOString(), codeOk: codeState };
      });
    } catch (e) {
      if (e instanceof KitError) return res.status(e.status).json({ error: e.message, taken: true });
      throw e;
    }
    res.json({ ok: true, saved: true, number, size, note });
  }));

  // ---------- 총무 ----------
  app.get('/api/kit/admin/list', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const rows = await store.all();
    const orders = Object.fromEntries(rows.map(r => [r.member, r.payload]));
    const claims = K.claimsOf(ctxOf(orders));
    res.json({
      open: await isOpen(),
      deadline: (await deadline()) || null,
      winner: await winner(),
      members: ROSTER_VIEW.map(({ v, label }) => {
        const o = orders[v];
        return {
          v, label, active: isActive(v),
          base: K.parseBase(BASE[v]), baseSize: BASE_SIZE[v] || null,
          number: o ? o.number : null,
          size: o ? o.size : null,
          note: (o && o.note) || '',
          at: (o && o.at) || null,
          // 번호가 달라서 표시만 남은 신청. 공개 화면에는 싣지 않는다.
          flagged: !!(o && o.codeOk === false),
        };
      }),
      // 활동 회원끼리 번호가 겹치는 자리 — 명부를 손봐야 하는 곳이다
      clash: [...claims].filter(([, c]) => c.hard.length > 1)
        .map(([n, c]) => ({ number: n, who: c.hard.map(labelOf) })),
    });
  }));

  app.post('/api/kit/admin/delete', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const n = await store.del(String((req.body || {}).member || ''));
    res.json({ ok: true, deleted: n });
  }));

  app.post('/api/kit/admin/deadline', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const v = String((req.body || {}).deadline || '').trim();
    if (v && !Number.isFinite(Date.parse(v)))
      return bad(res, '날짜 형식이 올바르지 않습니다.');
    await settings.set('kit_deadline', v);        // 빈 값이면 마감 없이 계속 받는다
    res.json({ ok: true, deadline: v || null, open: await isOpen() });
  }));
};
