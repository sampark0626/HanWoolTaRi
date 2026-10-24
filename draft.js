// 자체전 팀 구성 상태 기계.
//
// 입출력이 없고 상태 객체만 바꾼다 — 서버는 저장·권한만 맡고, 규칙은 여기 모은다.
//
// 방식 (총무 확정 2026-10-16): 일요일 경기에서 두 감독이 감독 모드로 들어와
//   · 한 명씩 **번갈아** 고른다. 선공은 추첨(또는 총무 지정).
//   · **연령대 비율을 맞춘다.** 활동 회원 전체의 연령대 비율을 두 팀이 똑같이 나눠 갖도록,
//     한 팀은 어떤 연령대든 정원(그 연령대 활동 회원의 절반, 홀수면 올림)을 넘겨 가져갈 수 없다.
//   · 고를 수 있는 선수가 없는 쪽은 차례를 건너뛴다.
//   · 다 고르면(review) 두 감독이 각각 **최종 확정**을 누른다. 둘 다 확정하면 잠긴다(done).
//
//   phase:  setup → draft → review → done
const crypto = require('crypto');
const { FORMATION_BY_ID, cleanPieces } = require('./public/core');

const LOG_MAX = 150;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const UNKNOWN_BAND = '미상';

class RuleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (m, s) => { throw new RuleError(m, s); };

const blankForm = () => ({ id: '4-2-3-1', pieces: {}, note: '', at: null });   // 기본은 4-2-3-1 (총무 확인 2026-10-24)

function initial() {
  return {
    v: 2,
    phase: 'setup',
    coaches: [null, null],
    names: ['A팀', 'B팀'],
    colors: ['#e4572e', '#2e86de'],
    teams: [[], []],                      // 팀원 (지명 순서). 감독이 맨 앞
    first: null,                          // 선공 팀
    turn: null,                           // 지금 고를 차례인 팀
    picks: [],                            // [{t, p, at}] — 되돌리기용
    confirmed: [false, false],            // 최종 확정
    balance: true,                        // 연령대 비율 맞춤 (연령대 정보가 있을 때만 작동)
    window: { from: null, to: null },     // 회원 포지션 입력 기간 (ISO). 둘 다 null이면 항상 열림
    formation: [blankForm(), blankForm()],
    active: {},                           // 총무가 바꾼 활동/휴면 {이름: true|false}
    log: [],
  };
}

function note(st, kind, text, ctx) {
  const t = (ctx && ctx.now ? ctx.now() : new Date()).toISOString();
  st.log.push({ t, n: st.picks.length, kind, text });
  if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
}
const lab = (ctx, n) => (ctx && ctx.label ? ctx.label(n) : n);
const nowMs = ctx => (ctx && ctx.now ? ctx.now() : new Date()).getTime();

// ---------- 포지션 입력 기간 ----------
function windowState(st, ctx) {
  const w = st.window || {};
  const t = nowMs(ctx);
  if (w.from && t < Date.parse(w.from)) return 'before';
  if (w.to && t >= Date.parse(w.to)) return 'after';
  return 'open';
}
function setWindow(st, body, ctx) {
  const norm = v => {
    if (v == null || v === '') return null;
    const ms = Date.parse(String(v));
    if (!Number.isFinite(ms)) fail('날짜 형식이 올바르지 않습니다.');
    return new Date(ms).toISOString();
  };
  const from = norm(body && body.from), to = norm(body && body.to);
  if (from && to && Date.parse(from) >= Date.parse(to)) fail('시작이 마감보다 늦습니다.');
  st.window = { from, to };
  note(st, 'window', from || to ? '포지션 입력 기간을 바꿨습니다.' : '포지션 입력 기간 제한을 풀었습니다 (항상 열림).', ctx);
  return st;
}

// ---------- 풀·연령대 ----------
// 아직 팀이 없는 활동 회원. 감독은 이미 자기 팀에 들어 있다.
function poolOf(st, ctx) {
  const taken = new Set([...st.teams[0], ...st.teams[1], ...st.coaches.filter(Boolean)]);
  return ctx.roster.filter(n => !taken.has(n) && ctx.isActive(st, n));
}

const bandOf = (ctx, n) => (ctx.band && ctx.band(n)) || UNKNOWN_BAND;
const balanceOn = (st, ctx) => !!(ctx.ageOn && st.balance);

// 연령대별 전체 인원(활동 회원 = 두 팀 + 풀), 정원(절반 올림), 각 팀 현재 인원.
//
// 인원 균형: 홀수 연령대는 한 팀이 한 명 더 가져간다(정원까지 채운 팀 = "한 명 더" 쪽).
// 한 팀이 "한 명 더"를 가져가는 연령대는 홀수 연령대 수의 절반(올림)까지만 허용한다.
// 그래야 연령대마다 차이가 1명 이하이면서 팀 인원도 1명 이하로 맞는다.
function balanceInfo(st, ctx) {
  const rows = new Map();
  const row = b => { if (!rows.has(b)) rows.set(b, { band: b, total: 0, counts: [0, 0] }); return rows.get(b); };
  for (const n of [...st.teams[0], ...st.teams[1], ...poolOf(st, ctx)]) row(bandOf(ctx, n)).total++;
  for (const t of [0, 1]) for (const n of st.teams[t]) row(bandOf(ctx, n)).counts[t]++;
  const list = [...rows.values()]
    .map(r => ({ ...r, cap: Math.ceil(r.total / 2), odd: r.total % 2 === 1 }))
    .sort((a, b) => a.band.localeCompare(b.band, 'ko'));
  const k = list.filter(r => r.odd).length;
  const used = [0, 1].map(t => list.filter(r => r.odd && r.counts[t] === r.cap).length);
  return { rows: list, extraMax: Math.ceil(k / 2), used };
}
const balanceTable = (st, ctx) => balanceInfo(st, ctx).rows;

// 이 팀이 이 선수를 데려갈 수 없는 이유. 가능하면 null.
//   'band'  이 연령대 정원이 찼다
//   'extra' 이 선수를 데려가면 팀 인원이 상대보다 한 명 넘게 많아질 수 있다
function whyNot(st, ctx, team, name, info) {
  if (!balanceOn(st, ctx)) return null;
  const inf = info || balanceInfo(st, ctx);
  const r = inf.rows.find(x => x.band === bandOf(ctx, name));
  if (!r) return null;
  if (r.counts[team] >= r.cap) return 'band';
  if (r.odd && r.counts[team] + 1 === r.cap && inf.used[team] >= inf.extraMax) return 'extra';
  return null;
}
const canTake = (st, ctx, team, name, info) => whyNot(st, ctx, team, name, info) === null;
function hasChoice(st, ctx, team) {
  const info = balanceInfo(st, ctx);
  return poolOf(st, ctx).some(n => canTake(st, ctx, team, n, info));
}

// ---------- 진행 ----------
function setup(st, body, ctx) {
  if (st.phase !== 'setup')
    fail('팀 구성이 시작된 뒤에는 감독을 바꿀 수 없습니다. 먼저 처음으로 되돌려 주세요.', 409);
  const c = body && body.coaches;
  if (!Array.isArray(c) || c.length !== 2) fail('감독 두 명을 골라주세요.');
  if (c.some(n => !ctx.roster.includes(n))) fail('명부에 없는 이름입니다.');
  if (c[0] === c[1]) fail('감독 두 명은 서로 다른 사람이어야 합니다.');
  st.coaches = c.slice();
  if (body.names != null) {
    const n = body.names;
    if (!Array.isArray(n) || n.length !== 2 ||
        n.some(s => typeof s !== 'string' || !s.trim() || s.trim().length > 12))
      fail('팀 이름은 1~12자로 두 개를 적어주세요.');
    if (n[0].trim() === n[1].trim()) fail('두 팀 이름이 같습니다.');
    st.names = n.map(s => s.trim());
  }
  if (body.colors != null) {
    const k = body.colors;
    if (!Array.isArray(k) || k.length !== 2 || k.some(s => !COLOR_RE.test(String(s))))
      fail('팀 색은 #RRGGBB 형식이어야 합니다.');
    st.colors = k.map(s => s.toLowerCase());
  }
  note(st, 'setup', `감독 지정: ${st.names[0]} ${lab(ctx, c[0])} · ${st.names[1]} ${lab(ctx, c[1])}`, ctx);
  return st;
}

function setBalance(st, on, ctx) {
  st.balance = !!on;
  note(st, 'balance', st.balance ? '연령대 비율 맞춤을 켰습니다.' : '연령대 비율 맞춤을 껐습니다.', ctx);
  return st;
}

// first: 0 | 1 | undefined(추첨)
function start(st, ctx, first) {
  if (st.phase !== 'setup') fail('이미 시작했습니다.', 409);
  if (!st.coaches[0] || !st.coaches[1]) fail('먼저 감독 두 명을 정해주세요.');
  if (first != null && first !== 0 && first !== 1) fail('선공 값이 올바르지 않습니다.');
  st.teams = [[st.coaches[0]], [st.coaches[1]]];
  st.picks = [];
  st.confirmed = [false, false];
  st.formation = [blankForm(), blankForm()];
  const drawn = first == null;
  st.first = drawn ? (ctx.rng ? ctx.rng() : crypto.randomInt(2)) : first;
  st.turn = st.first;
  st.phase = 'draft';
  note(st, 'start',
    `팀 구성을 시작합니다. 지명 가능한 선수 ${poolOf(st, ctx).length}명 · ` +
    `선공 ${st.names[st.first]} (${drawn ? '추첨' : '총무 지정'})`, ctx);
  if (!poolOf(st, ctx).length) toReview(st, ctx, '지명할 선수가 없어 바로 확정 단계로 넘어갑니다.');
  return st;
}

function toReview(st, ctx, why) {
  st.phase = 'review';
  st.turn = null;
  st.confirmed = [false, false];
  note(st, 'review', why || '모든 선수를 정했습니다. 두 감독이 최종 확정을 눌러 주세요.', ctx);
  return st;
}

// 마지막으로 고른 팀이 last. 차례를 다음 팀으로 넘긴다.
function advance(st, ctx, last) {
  if (!poolOf(st, ctx).length) return toReview(st, ctx);
  let next = 1 - last;
  if (!hasChoice(st, ctx, next)) {
    if (!hasChoice(st, ctx, last)) return toReview(st, ctx, '더 고를 수 있는 선수가 없어 확정 단계로 넘어갑니다.');
    note(st, 'skip', `${st.names[next]}: 연령대 정원 때문에 고를 수 있는 선수가 없어 차례를 건너뜁니다.`, ctx);
    next = last;
  }
  st.turn = next;
  return st;
}

function pick(st, team, player, ctx) {
  if (st.phase !== 'draft') fail('지금은 선수를 고를 수 없습니다.', 409);
  if (st.turn !== team) fail('상대 감독 차례입니다.', 409);
  if (!poolOf(st, ctx).includes(player))
    fail('고를 수 없는 선수입니다. (이미 팀이 정해졌거나 휴면 회원입니다)');
  const why = whyNot(st, ctx, team, player);
  if (why === 'band')
    fail(`${bandOf(ctx, player)}는 이미 정원만큼 데려가셨습니다. 연령대 비율을 맞추기 위해 이 선수는 상대 팀 몫입니다.`);
  if (why === 'extra')
    fail(`${bandOf(ctx, player)}를 더 데려가면 팀 인원이 상대보다 한 명 넘게 많아질 수 있어 고를 수 없습니다. 다른 연령대를 골라주세요.`);
  st.teams[team].push(player);
  st.picks.push({ t: team, p: player, at: (ctx.now ? ctx.now() : new Date()).toISOString() });
  note(st, 'pick', `${st.picks.length}번째 · ${st.names[team]}: ${lab(ctx, player)}`, ctx);
  return advance(st, ctx, team);
}

// 방금 한 지명을 되돌린다. team이 있으면 그 팀이 마지막으로 지명한 경우에만(상대가 고르기 전).
// team이 null이면 총무.
function undo(st, team, ctx) {
  if (st.phase !== 'draft' && st.phase !== 'review') fail('되돌릴 수 없는 단계입니다.', 409);
  const last = st.picks[st.picks.length - 1];
  if (!last) fail('되돌릴 지명이 없습니다.');
  if (team != null && last.t !== team)
    fail('방금 지명은 상대 감독이 한 것입니다. 본인이 마지막으로 고른 경우에만 되돌릴 수 있습니다.', 409);
  st.picks.pop();
  st.teams[last.t] = st.teams[last.t].filter(n => n !== last.p);
  delete st.formation[last.t].pieces[last.p];
  st.phase = 'draft';
  st.confirmed = [false, false];
  st.turn = last.t;
  note(st, 'undo', `${st.names[last.t]}: ${lab(ctx, last.p)} 지명을 되돌렸습니다.`, ctx);
  return st;
}

function confirm(st, team, value, ctx) {
  if (st.phase !== 'review') fail('모든 선수를 정한 뒤에 확정할 수 있습니다.', 409);
  st.confirmed[team] = !!value;
  note(st, 'confirm', `${st.names[team]}: 최종 확정${value ? '' : ' 취소'}`, ctx);
  if (st.confirmed[0] && st.confirmed[1]) {
    st.phase = 'done';
    note(st, 'done', '두 감독이 최종 확정했습니다. 팀이 확정되었습니다.', ctx);
  }
  return st;
}

// 총무: 남은 선수가 있어도 여기서 마감하고 확정 단계로 간다 (불참자가 있을 때).
function finish(st, ctx) {
  if (st.phase !== 'draft') fail('진행 중일 때만 마감할 수 있습니다.', 409);
  return toReview(st, ctx, '총무가 선택을 마감했습니다. 두 감독이 최종 확정을 눌러 주세요.');
}

// 총무: 한 단계 되돌린다. done → review → draft.
function reopen(st, ctx) {
  if (st.phase === 'done') {
    st.phase = 'review';
    st.confirmed = [false, false];
    note(st, 'reopen', '확정을 풀었습니다.', ctx);
    return st;
  }
  if (st.phase === 'review') {
    if (!poolOf(st, ctx).length) fail('남은 선수가 없어 선택 단계로 돌아갈 수 없습니다. 지명을 되돌리거나 팀원을 제외해 주세요.');
    st.phase = 'draft';
    st.confirmed = [false, false];
    const a = st.teams[0].length, b = st.teams[1].length;
    st.turn = a === b ? (st.picks.length ? 1 - st.picks[st.picks.length - 1].t : st.first || 0) : (a < b ? 0 : 1);
    note(st, 'reopen', `선택 단계로 돌아갑니다. ${st.names[st.turn]} 차례.`, ctx);
    return st;
  }
  return fail('되돌릴 단계가 없습니다.', 409);
}

// 총무: 팀원 한 명을 풀로 돌려보낸다 (잘못 지명했거나 불참 통보).
function release(st, player, ctx) {
  for (const t of [0, 1]) {
    const i = st.teams[t].indexOf(player);
    if (i < 0) continue;
    if (st.coaches[t] === player) fail('감독은 팀에서 뺄 수 없습니다.');
    st.teams[t].splice(i, 1);
    st.picks = st.picks.filter(p => p.p !== player);
    delete st.formation[t].pieces[player];
    note(st, 'release', `${st.names[t]}에서 ${lab(ctx, player)} 제외 (풀로 돌아감)`, ctx);
    if (st.phase === 'review' || st.phase === 'done') {
      st.phase = 'draft';
      st.confirmed = [false, false];
      st.turn = t;
    } else if (st.phase === 'draft' && !hasChoice(st, ctx, st.turn)) {
      st.turn = 1 - st.turn;
    }
    return st;
  }
  return fail('팀에 없는 선수입니다.');
}

function reset(st, ctx) {
  st.phase = 'setup';
  st.teams = [[], []];
  st.first = null;
  st.turn = null;
  st.picks = [];
  st.confirmed = [false, false];
  st.formation = [blankForm(), blankForm()];
  note(st, 'reset', '팀 구성을 처음으로 되돌렸습니다.', ctx);
  return st;
}

function setActive(st, member, value, ctx) {
  if (!ctx.roster.includes(member)) fail('명부에 없는 이름입니다.');
  if (value === null) delete st.active[member];
  else if (typeof value === 'boolean') st.active[member] = value;
  else fail('활동/휴면 값이 올바르지 않습니다.');
  return st;
}

// 팀 이름 바꾸기 — 각 감독이 자기 팀 이름을 정한다 (총무 확인 2026-10-24).
// 팀 구성이 시작된 뒤에도 된다(setup 은 시작 전에만 이름을 받는다). 상대 팀과 같으면 안 된다.
function rename(st, team, name, ctx) {
  if (team !== 0 && team !== 1) fail('팀을 알 수 없습니다.');
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s || s.length > 12) fail('팀 이름은 1~12자로 적어주세요.');
  if (s === st.names[1 - team]) fail('상대 팀과 이름이 같습니다.');
  if (s === st.names[team]) return st;                       // 바뀐 것이 없다
  const before = st.names[team];
  st.names[team] = s;
  note(st, 'rename', `팀 이름: ${before} → ${s}`, ctx);
  return st;
}

// 포메이션·말 위치·작전 메모 저장. 팀 구성 중에도 미리 짜 둘 수 있다.
function setFormation(st, team, body, ctx) {
  if (st.phase === 'setup') fail('팀이 정해진 뒤에 포메이션을 짤 수 있습니다.', 409);
  const cur = st.formation[team];
  const id = body.formation == null ? cur.id : String(body.formation);
  if (!FORMATION_BY_ID[id]) fail('없는 포메이션입니다.');
  let pieces;
  try {
    pieces = cleanPieces(body.pieces == null ? cur.pieces : body.pieces, st.teams[team]);
  } catch (e) { fail(e.message); }
  const memo = body.note == null ? cur.note : String(body.note).slice(0, 300);
  st.formation[team] = { id, pieces, note: memo, at: (ctx.now ? ctx.now() : new Date()).toISOString() };
  return st;
}

module.exports = {
  RuleError, UNKNOWN_BAND, initial, poolOf, balanceInfo, balanceTable, balanceOn, whyNot, canTake, bandOf,
  windowState, setWindow, setBalance, setup, start, pick, undo, confirm, finish, reopen,
  release, reset, setActive, setFormation, rename,
};
