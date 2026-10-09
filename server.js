// 2027 한울타리 FC 유니폼 투표 — 이상형 월드컵
//
// 저장: Postgres (DATABASE_URL). 없으면 메모리에 담고 경고한다 — 로컬 확인용이다.
// 명부: ROSTER 환경변수(쉼표 구분). 코드에 회원 이름을 넣지 않는다.
//       저장소가 공개되어도 명부가 따라 나가지 않게 하기 위해서다.
const express = require('express');
const path = require('path');
const { KITS, PLAYIN, ROUND16, POINTS, ROUND_LABEL } = require('./kits');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ROSTER = (process.env.ROSTER || '').split(',').map(s => s.trim()).filter(Boolean);
const VOTE_OPEN = process.env.VOTE_OPEN !== 'false';

// ---------- 저장소 ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const ready = pool.query(`
    create table if not exists votes (
      voter      text primary key,
      payload    jsonb       not null,
      updated_at timestamptz not null default now()
    )`);
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
  };
} else {
  console.warn('[경고] DATABASE_URL이 없습니다. 투표가 메모리에만 남고 재시작하면 사라집니다.');
  const mem = new Map();
  store = {
    kind: 'memory',
    async put(voter, payload) { mem.set(voter, { voter, payload, updated_at: new Date() }); },
    async all() { return [...mem.values()]; },
  };
}

// ---------- 집계 ----------
const BY_ID = Object.fromEntries(KITS.map(k => [k.id, k]));

function tally(rows) {
  const score = {}, wins = {}, champs = {}, reach = {};
  for (const k of KITS) { score[k.id] = 0; wins[k.id] = 0; champs[k.id] = 0; reach[k.id] = {}; }
  for (const r of rows) {
    const picks = (r.payload && r.payload.picks) || [];
    for (const p of picks) {
      if (!BY_ID[p.winner]) continue;
      const pt = POINTS[p.round] || 0;
      score[p.winner] += pt;
      wins[p.winner] += 1;
      reach[p.winner][p.round] = (reach[p.winner][p.round] || 0) + 1;
    }
    const c = r.payload && r.payload.champion;
    if (BY_ID[c]) champs[c] += 1;
  }
  return KITS.map(k => ({
    id: k.id, name: k.name, vendor: k.vendor, price: k.price,
    family: k.family,
    score: score[k.id], wins: wins[k.id], champion: champs[k.id], reach: reach[k.id],
  })).sort((a, b) => b.score - a.score || b.champion - a.champion || a.name.localeCompare(b.name));
}

// ---------- API ----------
app.get('/api/config', (req, res) => {
  res.json({
    open: VOTE_OPEN,
    kits: KITS,
    playin: PLAYIN, round16: ROUND16,
    points: POINTS, roundLabel: ROUND_LABEL,
    roster: ROSTER,
  });
});

app.get('/api/status', async (req, res) => {
  const rows = await store.all();
  res.json({ voters: rows.length, open: VOTE_OPEN });
});

app.post('/api/vote', async (req, res) => {
  if (!VOTE_OPEN) return res.status(403).json({ error: '투표가 마감되었습니다.' });
  const voter = String((req.body && req.body.voter) || '').trim().replace(/\s+/g, ' ');
  const picks = (req.body && req.body.picks) || [];
  const champion = String((req.body && req.body.champion) || '');

  if (voter.length < 2 || voter.length > 20)
    return res.status(400).json({ error: '이름을 2~20자로 적어주세요.' });
  if (ROSTER.length && !ROSTER.includes(voter))
    return res.status(400).json({ error: '명부에 없는 이름입니다. 총무에게 문의해 주세요.' });
  if (!Array.isArray(picks) || !picks.length)
    return res.status(400).json({ error: '투표 내용이 비어 있습니다.' });
  if (!BY_ID[champion])
    return res.status(400).json({ error: '우승 디자인이 올바르지 않습니다.' });
  for (const p of picks) {
    if (!BY_ID[p.winner] || !BY_ID[p.loser] || !(p.round in POINTS))
      return res.status(400).json({ error: '투표 내용이 올바르지 않습니다.' });
  }

  await store.put(voter, { picks, champion, at: new Date().toISOString() });
  const rows = await store.all();
  res.json({ ok: true, voters: rows.length });
});

// 결과는 총무만 본다. 중간 결과가 보이면 뒤에 투표하는 사람이 끌려간다.
app.get('/api/results', async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY)
    return res.status(403).json({ error: '권한이 없습니다.' });
  const rows = await store.all();
  res.json({
    voters: rows.map(r => ({ voter: r.voter, champion: r.payload.champion, at: r.updated_at })),
    ranking: tally(rows),
    points: POINTS,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`유니폼 투표 서버 :${PORT}  (저장소: ${store.kind})`));
