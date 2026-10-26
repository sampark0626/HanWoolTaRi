// 유니폼 번호 · 사이즈 조사 규칙.
//
// 입출력이 없고 상태 객체만 바꾼다 — draft.js 와 같은 방식. 서버(uniform-routes.js)는 저장·권한만 맡고,
// 규칙은 여기 모은다.
//
// 방식 (총무 확인 2026-10-26):
//   · 번호는 0~99, 세 자리(100~999)도 쓴다. 회원 한 명에 번호 하나.
//   · **활동 회원은 기존 번호를 그대로 지킨다.** 기존 번호(seed)는 총무가 넣고, 본인이 바꾸기 전까지 잠겨 있다.
//     다른 활동 회원은 그 번호를 고를 수 없다.
//   · **휴면 회원의 번호는 잠그지 않는다.** 색을 달리 보여주고, 활동 회원이 가져갈 수 있다.
//     가져가면 휴면 회원 쪽에서 빠진다(그 사실은 남는다).
//   · 활동 회원이 번호를 바꾸면 비는 번호는 곧바로 다시 고를 수 있다 — 번호의 상태는 저장하지 않고
//     회원들의 선택에서 매번 계산하기 때문에 따로 풀어줄 것이 없다.
//   · 기존 번호끼리 겹친 활동 회원은 둘 다 그 번호를 쥔 채로 두고, 먼저 확정하는 사람이 가져간다.
//
//   · 기존 사이즈(sizeSeed)는 번호와 달리 **제안**이다. 화면에 미리 골라져 있지만 본인이 맞다고 확인하거나
//     바꿔야 「끝낸 것」으로 센다 — 옛 시트의 사이즈가 이번 옷에도 맞는지는 본인만 안다.
//
//   state: { v, locked, winner, seed: {이름: 번호|null}, sizeSeed: {이름: 사이즈|null}, members: {이름: record}, log }
//   record: { number?: 번호|null, size?: 'M'|null, nat, at, displaced?: {n, by, at} }
//     number·size 키가 **있으면** 본인이 정한 것이다(null 은 일부러 비운 것). 없으면 기존 값(seed·sizeSeed)을 따른다.

const LOG_MAX = 150;
const MIN = 0, MAX = 999;
const SIZES_DEFAULT = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];

class RuleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (m, s) => { throw new RuleError(m, s); };

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const validNumber = n => Number.isInteger(n) && n >= MIN && n <= MAX;
const lab = (ctx, n) => (ctx.label ? ctx.label(n) : n);
const nowIso = ctx => (ctx && ctx.now ? ctx.now() : new Date()).toISOString();

function initial() {
  return { v: 1, locked: false, winner: null, seed: {}, sizeSeed: {}, members: {}, log: [] };
}

// 옛 저장 상태에 없는 필드를 채운다. 읽고 쓰기 전에 한 번 부른다.
function norm(st) {
  st.members = st.members || {};
  st.seed = st.seed || {};
  st.sizeSeed = st.sizeSeed || {};
  st.log = st.log || [];
  return st;
}

function note(st, text, ctx) {
  st.log.push({ t: nowIso(ctx), text });
  if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
}

// ---------- 번호의 주인 ----------
// 총무가 넣은 기존 번호(st.seed)가 환경변수(ctx.seed)보다 앞선다. null 은 「기존 번호 없음」.
function seedOf(st, ctx, name) {
  const v = has(st.seed, name) ? st.seed[name] : (ctx.seed || {})[name];
  return validNumber(v) ? v : null;
}

function claimOf(st, ctx, name) {
  const r = st.members[name];
  if (r && has(r, 'number')) return r.number == null ? { n: null, src: null } : { n: r.number, src: 'pick' };
  const s = seedOf(st, ctx, name);
  return s == null ? { n: null, src: null } : { n: s, src: 'seed' };
}

// 번호마다 누가 쥐고 있는지 계산한다.
//   numbers[n] = { holder, active, tie? }  — 활동 회원이 쥔 번호는 active, 기존 번호끼리 겹치면 tie(이름들)
//   mine[이름] = { n, src: 'pick'|'seed', status: 'held'|'tie'|'lost'|null }
//     lost = 번호를 적어 두었지만 다른 활동 회원이 쥐고 있어 지금은 내 것이 아니다
function resolve(st, ctx) {
  norm(st);
  const groups = new Map();
  const mine = {};
  for (const name of ctx.roster) {
    const c = claimOf(st, ctx, name);
    mine[name] = { n: c.n, src: c.src, status: c.n == null ? null : 'held' };
    if (c.n == null) continue;
    if (!groups.has(c.n)) groups.set(c.n, []);
    groups.get(c.n).push({ name, src: c.src, active: !!ctx.isActive(name) });
  }
  const nat = name => (st.members[name] && st.members[name].nat) || '';
  const byAt = (a, b) => nat(a.name).localeCompare(nat(b.name)) || a.name.localeCompare(b.name);

  const numbers = {};
  for (const [n, list] of groups) {
    const act = list.filter(h => h.active);
    if (!act.length) {                                   // 휴면 회원만 쥔 번호는 잠그지 않는다
      numbers[n] = { holder: list[0].name, active: false };
      continue;
    }
    // 직접 고른 활동 회원이 먼저, 없으면 기존 번호를 쥔 활동 회원 모두(겹치면 tie)
    const picks = act.filter(h => h.src === 'pick').sort(byAt);
    const win = picks.length ? [picks[0]] : act;
    numbers[n] = win.length === 1
      ? { holder: win[0].name, active: true }
      : { holder: win[0].name, active: true, tie: win.map(h => h.name) };
    const keep = new Set(win.map(h => h.name));
    for (const h of list) {
      if (!keep.has(h.name)) mine[h.name].status = 'lost';
      else if (numbers[n].tie) mine[h.name].status = 'tie';
    }
  }
  return { numbers, mine };
}

// 지금 이 회원의 사이즈. 본인이 정했으면 pick(비운 것도 본인이 정한 것), 아니면 총무가 미리 넣은 기존 사이즈(seed).
function sizeOf(st, ctx, name) {
  const r = st.members[name];
  if (r && has(r, 'size')) return r.size ? { size: r.size, src: 'pick' } : { size: null, src: null };
  const s = has(st.sizeSeed, name) ? st.sizeSeed[name] : null;
  return s && (ctx.sizes || SIZES_DEFAULT).includes(s) ? { size: s, src: 'seed' } : { size: null, src: null };
}

// 번호가 정해졌고 사이즈를 골랐으면 끝낸 것이다.
//   · 직접 골랐거나 일부러 비웠으면 끝. 다만 번호를 빼앗기고 아직 새로 안 골랐으면(displaced) 끝이 아니다.
//   · 직접 안 골랐어도 기존 번호를 그대로 쥐고 있으면(=유지) 끝.
//   · 사이즈는 **본인이 확인한 것**만 센다 — 총무가 미리 넣은 기존 사이즈는 제안일 뿐이다.
function isDone(st, ctx, name, m) {
  const rec = st.members[name];
  if (!rec || !rec.size) return false;
  if (has(rec, 'number')) return rec.number != null || !rec.displaced;
  return m.src === 'seed' && m.status === 'held';
}

// ---------- 고르기 ----------
function member(st, ctx, name) {
  norm(st);
  if (!ctx.roster.includes(name)) fail('명부에 없는 이름입니다.');
  return (st.members[name] = st.members[name] || {});
}

function claim(st, ctx, name, n) {
  const rec = member(st, ctx, name);
  if (!validNumber(n)) fail(`번호는 ${MIN}~${MAX} 사이의 정수로 골라주세요.`);
  const { numbers } = resolve(st, ctx);
  const cell = numbers[n];
  if (cell && cell.active) {
    // 활동 회원이 쥔 번호는 못 고른다. 단, 기존 번호가 겹친 당사자끼리는 먼저 정하는 사람이 가져간다.
    const mineAlready = cell.holder === name && !cell.tie;
    const tied = !!cell.tie && cell.tie.includes(name);
    if (!mineAlready && !tied)
      fail(`${n}번은 ${lab(ctx, cell.holder)} 님이 쓰고 있어 고를 수 없습니다.`, 409);
  }
  const at = nowIso(ctx);
  // 같은 번호를 쥔 나머지는 번호를 잃는다 — 휴면 회원, 또는 기존 번호가 겹쳤던 사람
  for (const o of ctx.roster) {
    if (o === name || claimOf(st, ctx, o).n !== n) continue;
    const r = (st.members[o] = st.members[o] || {});
    r.number = null; r.nat = at; r.at = at;
    r.displaced = { n, by: name, at };
    note(st, `${lab(ctx, o)} 님의 ${n}번을 ${lab(ctx, name)} 님이 가져갔습니다.`, ctx);
  }
  const was = claimOf(st, ctx, name).n;
  rec.number = n; rec.nat = at; rec.at = at;
  delete rec.displaced;
  if (was !== n) note(st, `${lab(ctx, name)} 님이 ${n}번을 골랐습니다${was != null ? ` (이전 ${was}번)` : ''}.`, ctx);
  return st;
}

// 번호를 쓰지 않겠다 / 지금 번호를 놓겠다.
function release(st, ctx, name) {
  const rec = member(st, ctx, name);
  const was = claimOf(st, ctx, name).n;
  const at = nowIso(ctx);
  rec.number = null; rec.nat = at; rec.at = at;
  delete rec.displaced;
  if (was != null) note(st, `${lab(ctx, name)} 님이 ${was}번을 놓았습니다.`, ctx);
  return st;
}

function setSize(st, ctx, name, size) {
  const rec = member(st, ctx, name);
  // 비울 때도 키는 남긴다(null) — 안 그러면 총무가 넣어 둔 기존 사이즈가 다시 살아난다
  if (size == null || size === '') rec.size = null;
  else if ((ctx.sizes || SIZES_DEFAULT).includes(size)) rec.size = size;
  else fail('사이즈 값이 올바르지 않습니다.');
  rec.at = nowIso(ctx);
  return st;
}

// 한 회원의 기록을 통째로 지운다(총무). 기존 번호(seed)로 돌아간다.
function clearMember(st, ctx, name) {
  member(st, ctx, name);
  delete st.members[name];
  note(st, `${lab(ctx, name)} 님의 기록을 지웠습니다.`, ctx);
  return st;
}

function setLocked(st, value) {
  norm(st).locked = !!value;
  return st;
}

function setWinner(st, id, valid) {
  norm(st);
  if (id == null || id === '') st.winner = null;
  else if (valid && valid.has(id)) st.winner = id;
  else fail('없는 유니폼입니다.');
  return st;
}

// ---------- 기존 번호·사이즈 가져오기 ----------
// 붙여넣은 이름을 명부의 이름으로 찾는다. 명부 표기(최지훈S)와 화면에 보이는 이름(최지훈 (동생)) 둘 다, 공백은 무시.
function rosterIndex(ctx) {
  const squash = s => String(s).replace(/\s+/g, '');
  const byKey = new Map();
  for (const n of ctx.roster) byKey.set(squash(n), n);
  for (const n of ctx.roster) { const k = squash(lab(ctx, n)); if (!byKey.has(k)) byKey.set(k, n); }
  return { squash, byKey };
}

// 한 줄에 한 명:  이름 번호   (공백·탭·쉼표·콜론 아무거나).  번호 자리에 - 를 쓰면 기존 번호를 지운다.
// 이름은 명부 표기(최지훈S)나 화면에 보이는 이름(최지훈 (동생))과 같아야 한다.
// 이미 본인이 직접 고른 회원은 그대로 둔다 — 기존 번호는 직접 고르기 전까지만 효력이 있다.
function importSeed(st, ctx, text) {
  norm(st);
  const { squash, byKey } = rosterIndex(ctx);

  const set = {}, skipped = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)[\s,:;=]+(\d{1,3}|-)$/.exec(line);
    if (!m) { skipped.push(`${line} — 「이름 번호」 모양이 아닙니다`); continue; }
    const who = byKey.get(squash(m[1]));
    if (!who) { skipped.push(`${line} — 명부에 없는 이름`); continue; }
    const n = m[2] === '-' ? null : parseInt(m[2], 10);
    if (n != null && !validNumber(n)) { skipped.push(`${line} — 번호 범위(${MIN}~${MAX})`); continue; }
    set[who] = n;
  }
  Object.assign(st.seed, set);
  const applied = Object.keys(set).length;
  if (applied) note(st, `기존 번호 ${applied}명을 가져왔습니다.`, ctx);

  // 가져온 뒤 겹치는 번호를 알려준다 — 총무가 미리 정리할 수 있게
  const { numbers, mine } = resolve(st, ctx);
  const warnings = [];
  for (const [n, c] of Object.entries(numbers)) {
    if (c.tie) warnings.push(`${n}번: ${c.tie.map(x => lab(ctx, x)).join(', ')} — 활동 회원의 기존 번호가 겹칩니다. 먼저 확정하는 분이 가져갑니다.`);
  }
  for (const name of ctx.roster) {
    if (mine[name].status === 'lost')
      warnings.push(`${lab(ctx, name)}: 기존 ${mine[name].n}번을 다른 활동 회원이 쥐고 있어 새로 골라야 합니다.`);
  }
  return { applied, skipped, warnings };
}

// 옛 시트의 표기(XXL, XXXL)를 앱 표기(2XL, 3XL)로 바꿔 받는다. 대소문자·공백은 가리지 않는다.
const SIZE_ALIAS = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL' };
function normSize(raw, sizes) {
  const t = String(raw).toUpperCase().replace(/\s+/g, '');
  const v = SIZE_ALIAS[t] || t;
  return sizes.includes(v) ? v : null;
}

// 한 줄에 한 명:  이름 사이즈   (구분자는 번호와 같다).  사이즈 자리에 - 를 쓰면 기존 사이즈를 지운다.
// 기존 사이즈는 본인이 아직 확인하지 않은 **제안**이다: 화면에 미리 골라져 있고, 맞다고 누르거나 바꿔야 끝낸 것으로 센다.
// 이미 본인이 사이즈를 정한 회원의 값은 그대로 둔다(own 으로 몇 명인지 알려준다).
function importSizes(st, ctx, text) {
  norm(st);
  const sizes = ctx.sizes || SIZES_DEFAULT;
  const { squash, byKey } = rosterIndex(ctx);

  const set = {}, skipped = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)[\s,:;=]+(\S+)$/.exec(line);
    if (!m) { skipped.push(`${line} — 「이름 사이즈」 모양이 아닙니다`); continue; }
    const who = byKey.get(squash(m[1]));
    if (!who) { skipped.push(`${line} — 명부에 없는 이름`); continue; }
    if (m[2] === '-') { set[who] = null; continue; }
    const s = normSize(m[2], sizes);
    if (!s) { skipped.push(`${line} — 사이즈 목록(${sizes.join(' ')})에 없는 값`); continue; }
    set[who] = s;
  }
  Object.assign(st.sizeSeed, set);
  const applied = Object.keys(set).length;
  const own = Object.keys(set).filter(n => has(st.members[n], 'size')).length;
  if (applied) note(st, `기존 사이즈 ${applied}명을 가져왔습니다.`, ctx);
  return { applied, skipped, own };
}

// ---------- 보여주기 ----------
function publicView(st, ctx) {
  const { mine } = resolve(st, ctx);
  const members = ctx.roster.map(v => {
    const m = mine[v], a = !!ctx.isActive(v);
    const held = m.status === 'held' || m.status === 'tie';
    return {
      v, l: lab(ctx, v), a,
      n: held ? m.n : null,
      k: m.status === 'lost' ? 'lost' : m.status === 'tie' ? 'tie' : (held ? m.src : ''),
      d: isDone(st, ctx, v, m),
    };
  });
  const act = members.filter(m => m.a);
  return {
    locked: !!st.locked,
    sizes: ctx.sizes || SIZES_DEFAULT,
    min: MIN, max: MAX,
    members,
    progress: { active: act.length, done: act.filter(m => m.d).length },
  };
}

// 본인에게만 보여주는 것 — 사이즈와, 번호를 빼앗겼다는 알림
function privateView(st, ctx, name) {
  const { mine } = resolve(st, ctx);
  const m = mine[name];
  if (!m) fail('명부에 없는 이름입니다.');
  const rec = st.members[name] || {};
  const held = m.status === 'held' || m.status === 'tie';
  const sz = sizeOf(st, ctx, name);
  return {
    member: name,
    active: !!ctx.isActive(name),
    number: held ? m.n : null,
    src: held ? m.src : null,
    status: m.status,
    lostNumber: m.status === 'lost' ? m.n : null,
    seed: seedOf(st, ctx, name),
    size: sz.size,
    sizeSrc: sz.src,                         // 'pick' 본인이 정함 · 'seed' 총무가 미리 넣음(확인 전)
    displaced: rec.displaced || null,
    done: isDone(st, ctx, name, m),
  };
}

// 총무용 표 — 주문서로 옮길 때 쓴다.
function adminView(st, ctx) {
  const { mine } = resolve(st, ctx);
  const rows = ctx.roster.map(v => {
    const m = mine[v], rec = st.members[v] || {};
    const held = m.status === 'held' || m.status === 'tie';
    const sz = sizeOf(st, ctx, v);
    return {
      v, l: lab(ctx, v), a: !!ctx.isActive(v),
      n: held ? m.n : null,
      k: m.status === 'lost' ? 'lost' : m.status === 'tie' ? 'tie' : (held ? m.src : ''),
      lost: m.status === 'lost' ? m.n : null,
      size: sz.size,
      sk: sz.src,                            // 'seed' 이면 본인이 아직 확인하지 않은 기존 사이즈
      d: isDone(st, ctx, v, m),
      displaced: rec.displaced || null,
      at: rec.at || null,
    };
  });
  const count = (list) => {
    const out = {};
    for (const s of ctx.sizes || SIZES_DEFAULT) out[s] = list.filter(r => r.size === s).length;
    return out;
  };
  return {
    locked: !!st.locked,
    sizes: ctx.sizes || SIZES_DEFAULT,
    rows,
    sizeActive: count(rows.filter(r => r.a)),
    sizeAll: count(rows),
    log: st.log.slice(-60).reverse(),
  };
}

module.exports = {
  RuleError, MIN, MAX, SIZES_DEFAULT, initial, norm, resolve, claimOf, seedOf, sizeOf, isDone,
  claim, release, setSize, clearMember, setLocked, setWinner, importSeed, importSizes,
  publicView, privateView, adminView,
};
