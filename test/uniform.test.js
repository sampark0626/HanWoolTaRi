// 실행: npm test   (node --test test/uniform.test.js)
// 번호·사이즈 API를 진짜 HTTP로 돌려 본다 — 본인 확인, 사이즈 비공개, 마감, 동시에 같은 번호 누르기, 실시간(SSE).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const mount = require('../uniform-routes');
const createStore = require('../uniform-store');
const { SIZES_DEFAULT } = require('../numbers');

const SALT = 's';
const hash = (name, code) => crypto.createHash('sha256').update(`${name}:${code}:${SALT}`).digest('hex').slice(0, 20);
const ROSTER = ['가', '나', '다', '휴1'];
const CODE = { 가: '1111', 나: '2222', 다: '3333', 휴1: '4444' };
const AUTH = Object.fromEntries(Object.entries(CODE).map(([n, c]) => [n, hash(n, c)]));
const KEY = 'adminkey';

async function boot(over = {}) {
  const app = express();
  app.use(express.json());
  const board = { active: {} };
  const fails = new Map();
  const deps = {
    store: createStore(null),
    boardStore: { async state() { return { active: board.active }; } },
    ROSTER, LABELS: {}, DORMANT: new Set(['휴1']), AUTH, NEED_CODE: true,
    SEED: { 가: 7, 휴1: 9 }, SIZES: SIZES_DEFAULT,
    KITS: [{ id: 'nebula', name: 'Nebula FC' }, { id: 'solar', name: 'Solar Infinity' }],
    codeOk: (n, c) => AUTH[n] === hash(n, c),
    guard: (req, res) => {
      if (req.query.key === KEY) return true;
      res.status(403).json({ error: '비밀번호가 맞지 않습니다.' });
      return false;
    },
    tooMany: k => (fails.get(k) || 0) >= 5,
    noteFail: k => fails.set(k, (fails.get(k) || 0) + 1),
    fails,
    voteInfo: async () => over.vote || { closed: true, winner: { id: 'solar', name: 'Solar Infinity' } },
    ...over.deps,
  };
  const hooks = mount(app, deps);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  return { base, call, board, hooks, close: () => { server.closeAllConnections(); server.close(); } };
}
const as = (n, extra = {}) => ({ member: n, code: CODE[n], ...extra });

// SSE 읽기 도우미: 완성된 snap 이벤트를 하나씩 꺼낸다
async function openStream(base) {
  const ac = new AbortController();
  const r = await fetch(base + '/api/uniform/stream', { signal: ac.signal });
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  return {
    async next(ms = 3000) {
      const until = Date.now() + ms;
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const d = /^data: (.*)$/m.exec(chunk);
          if (/^event: snap/m.test(chunk) && d) return JSON.parse(d[1]);
          continue;
        }
        if (Date.now() > until) throw new Error('실시간 이벤트가 오지 않았습니다');
        const t = await Promise.race([reader.read(), new Promise(res => setTimeout(() => res(null), 200))]);
        if (t && !t.done) buf += dec.decode(t.value, { stream: true });
      }
    },
    close: () => ac.abort(),
  };
}

test('스냅샷: 번호 주인은 보이고 사이즈는 안 보인다. 1위 유니폼이 따라온다', async () => {
  const s = await boot();
  try {
    await s.call('POST', '/api/uniform/size', as('가', { size: 'XL' }));
    const { status, body } = await s.call('GET', '/api/uniform');
    assert.equal(status, 200);
    const m = Object.fromEntries(body.members.map(x => [x.v, x]));
    assert.equal(m['가'].n, 7);
    assert.equal(m['휴1'].n, 9);
    assert.equal(m['휴1'].a, false);
    assert.deepEqual(body.winner, { id: 'solar', name: 'Solar Infinity', by: 'vote' });
    assert.ok(!JSON.stringify(body.members).includes('XL'));
    assert.deepEqual(body.progress, { active: 3, done: 1 });
  } finally { s.close(); }
});

test('본인 확인: 번호가 틀리면 막고, 5번 틀리면 잠근다', async () => {
  const s = await boot();
  try {
    let r = await s.call('POST', '/api/uniform/claim', { member: '나', code: '0000', number: 5 });
    assert.equal(r.status, 403);
    r = await s.call('POST', '/api/uniform/claim', { member: '없음', code: '0000', number: 5 });
    assert.equal(r.status, 400);
    for (let i = 0; i < 4; i++) await s.call('POST', '/api/uniform/claim', { member: '나', code: '0000', number: 5 });
    r = await s.call('POST', '/api/uniform/claim', as('나', { number: 5 }));
    assert.equal(r.status, 429);                              // 맞는 번호여도 잠겼다
    assert.equal((await s.call('GET', '/api/uniform')).body.members.find(x => x.v === '나').n, null);
  } finally { s.close(); }
});

test('활동 회원이 쥔 번호는 409, 휴면 회원 번호는 가져올 수 있다', async () => {
  const s = await boot();
  try {
    let r = await s.call('POST', '/api/uniform/claim', as('나', { number: 7 }));
    assert.equal(r.status, 409);
    assert.match(r.body.error, /가 님이 쓰고 있어/);
    r = await s.call('POST', '/api/uniform/claim', as('나', { number: '9' }));      // 문자열 숫자도 받는다
    assert.equal(r.status, 200);
    assert.equal(r.body.me.number, 9);
    const dormant = await s.call('POST', '/api/uniform/mine', as('휴1'));
    assert.equal(dormant.body.me.number, null);
    assert.equal(dormant.body.me.displaced.by, '나');
    r = await s.call('POST', '/api/uniform/claim', as('다', { number: 100 }));       // 세 자리
    assert.equal(r.status, 200);
    r = await s.call('POST', '/api/uniform/claim', as('다', { number: 1000 }));
    assert.equal(r.status, 400);
  } finally { s.close(); }
});

test('같은 번호를 동시에 눌러도 한 사람만 가져간다', async () => {
  const s = await boot();
  try {
    const rs = await Promise.all(['나', '다'].map(n => s.call('POST', '/api/uniform/claim', as(n, { number: 55 }))));
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
    const m = (await s.call('GET', '/api/uniform')).body.members.filter(x => x.n === 55);
    assert.equal(m.length, 1);
  } finally { s.close(); }
});

test('사이즈는 본인에게만 돌려주고, 정해진 값만 받는다', async () => {
  const s = await boot();
  try {
    let r = await s.call('POST', '/api/uniform/size', as('나', { size: 'L' }));
    assert.equal(r.body.me.size, 'L');
    r = await s.call('POST', '/api/uniform/size', as('나', { size: '95' }));
    assert.equal(r.status, 400);
    r = await s.call('POST', '/api/uniform/size', as('나', { size: null }));
    assert.equal(r.body.me.size, null);
  } finally { s.close(); }
});

test('마감하면 회원은 못 바꾸고, 총무는 바꿀 수 있다', async () => {
  const s = await boot();
  try {
    assert.equal((await s.call('POST', '/api/uniform/admin/lock', { locked: true })).status, 403);   // 열쇠 없음
    assert.equal((await s.call('POST', `/api/uniform/admin/lock?key=${KEY}`, { locked: true })).status, 200);
    let r = await s.call('POST', '/api/uniform/claim', as('나', { number: 5 }));
    assert.equal(r.status, 403);
    assert.match(r.body.error, /마감/);
    r = await s.call('POST', `/api/uniform/claim?key=${KEY}`, { member: '나', number: 5 });   // 번호 확인 없이 대신
    assert.equal(r.status, 200);
    assert.equal((await s.call('GET', '/api/uniform')).body.locked, true);
    await s.call('POST', `/api/uniform/admin/lock?key=${KEY}`, { locked: false });
    assert.equal((await s.call('POST', '/api/uniform/claim', as('나', { number: 6 }))).status, 200);
  } finally { s.close(); }
});

test('총무: 표·유니폼 지정·기존 번호 가져오기·기록 지우기', async () => {
  const s = await boot({ vote: { closed: false, winner: null } });
  try {
    assert.equal((await s.call('GET', '/api/uniform')).body.winner, null);        // 투표 중에는 1위를 보여주지 않는다
    assert.equal((await s.call('GET', '/api/uniform/admin/table')).status, 403);

    let r = await s.call('POST', `/api/uniform/admin/winner?key=${KEY}`, { winner: 'nebula' });
    assert.equal(r.status, 200);
    assert.equal((await s.call('GET', '/api/uniform')).body.winner.name, 'Nebula FC');
    assert.equal((await s.call('POST', `/api/uniform/admin/winner?key=${KEY}`, { winner: 'nope' })).status, 400);

    r = await s.call('POST', `/api/uniform/admin/seed?key=${KEY}`, { text: '나 20\n다 20\n모르는사람 3' });
    assert.equal(r.body.applied, 2);
    assert.equal(r.body.skipped.length, 1);
    assert.ok(r.body.warnings.some(w => /20번/.test(w)));

    await s.call('POST', '/api/uniform/size', as('나', { size: 'M' }));
    const t = (await s.call('GET', `/api/uniform/admin/table?key=${KEY}`)).body;
    assert.equal(t.rows.find(x => x.v === '나').size, 'M');
    assert.equal(t.sizeActive.M, 1);
    assert.deepEqual(t.kits.map(k => k.id), ['nebula', 'solar']);

    await s.call('POST', `/api/uniform/admin/clear?key=${KEY}`, { member: '나' });
    const t2 = (await s.call('GET', `/api/uniform/admin/table?key=${KEY}`)).body;
    assert.equal(t2.rows.find(x => x.v === '나').size, null);
  } finally { s.close(); }
});

test('기존 사이즈: 총무만 넣고, 본인에게는 미리 골라진 제안으로 보이며, 확인해야 끝난다', async () => {
  const s = await boot();
  try {
    let r = await s.call('POST', '/api/uniform/admin/sizeseed', { text: '나 XXL' });
    assert.equal(r.status, 403);                                                   // 열쇠 없음

    r = await s.call('POST', `/api/uniform/admin/sizeseed?key=${KEY}`, { text: '나 XXL\n다 XXXL\n모르는사람 M\n가 95' });
    assert.equal(r.status, 200);
    assert.equal(r.body.applied, 2);
    assert.equal(r.body.skipped.length, 2);

    // 공개 응답에는 사이즈가 없고, 끝낸 사람도 아직 0명
    const pub = (await s.call('GET', '/api/uniform')).body;
    assert.ok(!JSON.stringify(pub.members).includes('2XL'));
    assert.equal(pub.progress.done, 0);

    // 본인에게는 미리 골라진 제안
    r = await s.call('POST', '/api/uniform/mine', as('나'));
    assert.equal(r.body.me.size, '2XL');
    assert.equal(r.body.me.sizeSrc, 'seed');
    assert.equal(r.body.me.done, false);

    // 같은 값을 보내면 확인 → 끝 (번호는 따로 정해야 한다)
    r = await s.call('POST', '/api/uniform/size', as('나', { size: '2XL' }));
    assert.equal(r.body.me.sizeSrc, 'pick');
    r = await s.call('POST', '/api/uniform/claim', as('나', { number: 31 }));
    assert.equal(r.body.me.done, true);
    assert.equal((await s.call('GET', '/api/uniform')).body.progress.done, 1);

    // 총무 표에는 확인 전(seed)과 확인(pick)이 구분되어 나온다
    const t = (await s.call('GET', `/api/uniform/admin/table?key=${KEY}`)).body;
    assert.equal(t.rows.find(x => x.v === '나').sk, 'pick');
    assert.equal(t.rows.find(x => x.v === '다').sk, 'seed');
    assert.equal(t.sizeActive['2XL'], 1);
    assert.equal(t.sizeActive['3XL'], 1);
  } finally { s.close(); }
});

test('연락처가 없는 회원은 본인 확인을 못 하므로 총무 표에 따로 나온다', async () => {
  const s = await boot({ deps: { AUTH: { 가: 'x' }, codeOk: () => true } });
  try {
    const t = (await s.call('GET', `/api/uniform/admin/table?key=${KEY}`)).body;
    assert.deepEqual(t.unverifiable, ['나', '다', '휴1']);
  } finally { s.close(); }
});

test('실시간: 번호를 고르면 접속 중인 사람에게 바로 스냅샷이 간다', async () => {
  const s = await boot();
  const st = await openStream(s.base);
  try {
    const first = await st.next();
    assert.equal(first.members.find(x => x.v === '가').n, 7);

    await s.call('POST', '/api/uniform/claim', as('가', { number: 12 }));          // 가가 7 → 12
    const second = await st.next();
    assert.ok(second.seq > first.seq);
    assert.equal(second.members.find(x => x.v === '가').n, 12);
    assert.equal(second.members.some(x => x.n === 7), false);                       // 7이 풀렸다
  } finally { st.close(); s.close(); }
});

test('실시간: 휴면↔활동이 바뀌어도 알린다', async () => {
  const s = await boot();
  const st = await openStream(s.base);
  try {
    const first = await st.next();
    assert.equal(first.members.find(x => x.v === '휴1').a, false);
    s.board.active['휴1'] = true;                                                    // 총무가 활동으로 바꿨다
    s.hooks.notify();
    const second = await st.next();
    assert.equal(second.members.find(x => x.v === '휴1').a, true);
    // 이제 휴면이 아니므로 9번은 잠긴다
    const r = await s.call('POST', '/api/uniform/claim', as('나', { number: 9 }));
    assert.equal(r.status, 409);
  } finally { st.close(); s.close(); }
});
