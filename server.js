// 2027 한울타리 FC 유니폼 투표
//
// 방식: 17종 중 마음에 드는 것을 PICKS개 고른다. 고른 순서가 곧 순위다.
//       대진표(이상형 월드컵)는 걷어냈다 — 붙는 상대에 따라 결과가 흔들려
//       디자인끼리 공정하게 비교가 안 됐다 (총무 확인 2026-10-09).
//
// 2차 투표: SHORTLIST에 후보 id를 넣고 PICKS=1로 두면 같은 앱이 결선이 된다.
//
// 저장: Postgres (DATABASE_URL). 없으면 메모리에 담고 경고한다 — 로컬 확인용이다.
// 명부: ROSTER 환경변수. 코드에 회원 이름을 넣지 않는다.
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const { KITS, pointsFor } = require('./kits');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'),
  { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const VOTE_OPEN = process.env.VOTE_OPEN !== 'false';
const PICKS = Math.max(1, Math.min(8, parseInt(process.env.PICKS, 10) || 3));
const SHORTLIST = (process.env.SHORTLIST || '').split(',').map(s => s.trim()).filter(Boolean);
const ROUND_NAME = process.env.ROUND_NAME || (SHORTLIST.length ? '결선 투표' : '');

const BY_ID = Object.fromEntries(KITS.map(k => [k.id, k]));
const BALLOT = SHORTLIST.length ? SHORTLIST.filter(id => BY_ID[id]).map(id => BY_ID[id]) : KITS;
const BALLOT_IDS = new Set(BALLOT.map(k => k.id));
const POINTS = pointsFor(Math.min(PICKS, BALLOT.length));

const ROSTER = (process.env.ROSTER || '').split(',').map(s => s.trim()).filter(Boolean);
// 동명이인은 명부에 최지훈S / 최지훈B처럼 들어 있다. 그대로 보여주면 본인도 헷갈린다.
// ROSTER_LABELS로 화면에 쓸 이름을 따로 준다:  최지훈S=최지훈 (동생),최지훈B=최지훈 (형님)
const LABELS = Object.fromEntries(
  (process.env.ROSTER_LABELS || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; })
    .filter(([k, v]) => k && v));
const ROSTER_VIEW = ROSTER.map(n => ({ v: n, label: LABELS[n] || n }))
  .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

// 본인 확인 — 전화번호 뒷 4자리. 번호 원본은 서버에 없다.
// 소금과 함께 해시한 값만 들고 대조한다 (scripts/make_auth.py가 만든다).
const AUTH_SALT = process.env.AUTH_SALT || '';
const AUTH = Object.fromEntries(
  (process.env.AUTH || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const i = s.lastIndexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; }));
const NEED_CODE = Object.keys(AUTH).length > 0;

function codeOk(name, code) {
  const want = AUTH[name];
  if (!want) return true;          // 연락처가 없는 회원은 확인할 방법이 없다
  const got = crypto.createHash('sha256')
    .update(`${name}:${code}:${AUTH_SALT}`).digest('hex').slice(0, 20);
  return got.length === want.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// 4자리는 1만 가지뿐이다. 무작정 넣어보는 걸 막는다.
const fails = new Map();
const tooMany = k => {
  const f = fails.get(k);
  if (!f) return false;
  if (Date.now() - f.at > 10 * 60 * 1000) { fails.delete(k); return false; }
  return f.n >= 5;
};
const noteFail = k => {
  const f = fails.get(k);
  if (f && Date.now() - f.at <= 10 * 60 * 1000) { f.n += 1; f.at = Date.now(); }
  else fails.set(k, { n: 1, at: Date.now() });
};

// ---------- 저장소 ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  // Render는 내부 주소(dpg-xxxx-a)와 외부 주소(*.render.com)를 둘 다 준다.
  // 내부 연결은 SSL을 쓰지 않는다 — 켜면 "server does not support SSL"로 죽는다.
  const external = /\.render\.com|\.rds\.|sslmode=require/.test(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: external ? { rejectUnauthorized: false } : false,
  });
  pool.on('error', e => console.error('[DB] 연결 오류:', e.message));
  const ready = pool.query(`
    create table if not exists votes (
      voter      text primary key,
      payload    jsonb       not null,
      updated_at timestamptz not null default now()
    )`).then(
      () => console.log('[DB] 연결 완료 (%s)', external ? '외부 주소·SSL' : '내부 주소'),
      e => { console.error('[DB] 준비 실패:', e.message); throw e; });
  store = {
    kind: 'postgres',
    async put(voter, payload) {
      await ready;
      await pool.query(
        `insert into votes (voter, payload, updated_at) values ($1, $2, now())
         on conflict (voter) do update set payload = $2, updated_at = now()`,
        [voter, payload]);
    },
    async all() {
      await ready;
      const r = await pool.query('select voter, payload, updated_at from votes order by updated_at');
      return r.rows;
    },
    async clear() { await ready; await pool.query('delete from votes'); },
  };
} else {
  console.warn('[경고] DATABASE_URL이 없습니다. 투표가 메모리에만 남고 재시작하면 사라집니다.');
  const mem = new Map();
  store = {
    kind: 'memory',
    async put(voter, payload) { mem.set(voter, { voter, payload, updated_at: new Date() }); },
    async all() { return [...mem.values()]; },
    async clear() { mem.clear(); },
  };
}

// ---------- 집계 ----------
function tally(rows) {
  const score = {}, first = {}, picked = {};
  for (const k of BALLOT) { score[k.id] = 0; first[k.id] = 0; picked[k.id] = 0; }
  for (const r of rows) {
    const picks = (r.payload && r.payload.picks) || [];
    if (!Array.isArray(picks)) continue;
    picks.forEach((id, i) => {
      if (!(id in score)) return;         // 옛 방식(대진표)으로 남은 행은 무시한다
      score[id] += POINTS[i] || 0;
      picked[id] += 1;
      if (i === 0) first[id] += 1;
    });
  }
  return BALLOT.map(k => ({
    id: k.id, name: k.name, vendor: k.vendor, price: k.price, family: k.family,
    score: score[k.id], first: first[k.id], picked: picked[k.id],
  })).sort((a, b) => b.score - a.score || b.first - a.first || a.name.localeCompare(b.name));
}

// ---------- API ----------
app.get('/api/config', (req, res) => {
  res.json({
    open: VOTE_OPEN,
    picks: Math.min(PICKS, BALLOT.length),
    round: ROUND_NAME,
    kits: BALLOT.map(({ price, vendor, ...rest }) => rest),  // 가격·업체명은 선택에 영향을 준다
    roster: ROSTER_VIEW,
    needCode: NEED_CODE,
  });
});

app.get('/api/status', async (req, res) => {
  const rows = await store.all();
  const ready = !(process.env.RENDER && store.kind === 'memory');
  res.json({ voters: rows.length, open: VOTE_OPEN && ready, ready });
});

app.post('/api/vote', async (req, res) => {
  if (!VOTE_OPEN) return res.status(403).json({ error: '투표가 마감되었습니다.' });
  if (process.env.RENDER && store.kind === 'memory')
    return res.status(503).json({ error: '아직 준비 중입니다. 총무에게 알려주세요. (DB 미연결)' });

  const voter = String((req.body && req.body.voter) || '').trim().replace(/\s+/g, ' ');
  const picks = (req.body && req.body.picks) || [];
  const want = Math.min(PICKS, BALLOT.length);

  if (voter.length < 2 || voter.length > 20)
    return res.status(400).json({ error: '이름을 2~20자로 적어주세요.' });
  if (ROSTER.length && !ROSTER.includes(voter))
    return res.status(400).json({ error: '명부에 없는 이름입니다. 총무에게 문의해 주세요.' });

  if (NEED_CODE) {
    const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
    const bucket = voter + '|' + (req.ip || '');
    if (tooMany(bucket))
      return res.status(429).json({ error: '여러 번 틀렸습니다. 10분 뒤에 다시 해주세요.' });
    if (code.length !== 4 || !codeOk(voter, code)) {
      noteFail(bucket);
      return res.status(403).json({ error: '전화번호 뒷 4자리가 맞지 않습니다.' });
    }
    fails.delete(bucket);
  }

  if (!Array.isArray(picks) || picks.length !== want)
    return res.status(400).json({ error: `${want}개를 골라주세요.` });
  if (new Set(picks).size !== picks.length)
    return res.status(400).json({ error: '같은 디자인을 두 번 고르셨습니다.' });
  if (picks.some(id => !BALLOT_IDS.has(id)))
    return res.status(400).json({ error: '투표 내용이 올바르지 않습니다.' });

  await store.put(voter, { picks, at: new Date().toISOString() });
  const rows = await store.all();
  res.json({ ok: true, voters: rows.length });
});

// 결과는 총무만 본다. 중간 순위가 보이면 뒤에 투표하는 사람이 끌려간다.
app.get('/api/results', async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY)
    return res.status(403).json({ error: '권한이 없습니다.' });
  const rows = await store.all();
  res.json({
    picks: Math.min(PICKS, BALLOT.length),
    points: POINTS,
    round: ROUND_NAME,
    voters: rows.map(r => ({ voter: r.voter, at: r.updated_at })),
    ranking: tally(rows),
  });
});

// 라운드를 새로 시작할 때 비운다. 되돌릴 수 없어서 키와 확인을 둘 다 받는다.
app.post('/api/reset', async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY)
    return res.status(403).json({ error: '권한이 없습니다.' });
  if (req.query.confirm !== 'yes')
    return res.status(400).json({ error: 'confirm=yes 가 필요합니다.' });
  const before = (await store.all()).length;
  await store.clear();
  res.json({ ok: true, deleted: before });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(
  `유니폼 투표 서버 :${PORT}  (저장소: ${store.kind} · 후보 ${BALLOT.length} · ${PICKS}개 선택)`));
