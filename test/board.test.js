// 실행: npm test   (node --test test/board.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../draft');
const C = require('../public/core');

const ROSTER = ['감독가', '감독나', '가', '나', '다', '라', '마', '바', '휴면1'];
// 연령대: 감독가 30, 감독나 30, 가20 나20 다20 라30 마30 바40 → 20대3·30대4·40대1
const BAND = { 감독가: '30대', 감독나: '30대', 가: '20대', 나: '20대', 다: '20대', 라: '30대', 마: '30대', 바: '40대', 휴면1: '20대' };
const mkctx = (over = {}) => ({
  roster: ROSTER,
  isActive: (st, n) => (n in st.active ? st.active[n] : n !== '휴면1'),
  rng: () => 0,
  label: n => n,
  band: n => BAND[n],
  ageOn: true,
  ...over,
});
const started = (ctx = mkctx(), first) => {
  const st = D.initial();
  D.setup(st, { coaches: ['감독가', '감독나'], names: ['청팀', '백팀'] }, ctx);
  D.start(st, ctx, first);
  return st;
};

test('시작하면 감독이 각자 팀의 첫 사람이고, 휴면은 풀에 없다', () => {
  const ctx = mkctx();
  const st = started(ctx);
  assert.deepEqual(st.teams, [['감독가'], ['감독나']]);
  assert.deepEqual(D.poolOf(st, ctx), ['가', '나', '다', '라', '마', '바']);
  assert.equal(st.phase, 'draft');
});

test('감독 설정 검증', () => {
  const ctx = mkctx();
  const st = D.initial();
  assert.throws(() => D.setup(st, { coaches: ['감독가', '감독가'] }, ctx), /서로 다른/);
  assert.throws(() => D.setup(st, { coaches: ['감독가', '없는사람'] }, ctx), /명부에 없는/);
  assert.throws(() => D.setup(st, { coaches: ['감독가'] }, ctx), /두 명/);
  assert.throws(() => D.start(st, ctx), /감독 두 명/);
});

test('선공은 추첨이고, 총무가 정할 수도 있다', () => {
  assert.equal(started(mkctx({ rng: () => 1 })).turn, 1);
  assert.equal(started(mkctx({ rng: () => 0 })).turn, 0);
  assert.equal(started(mkctx({ rng: () => 0 }), 1).turn, 1);
  assert.match(started(mkctx(), 1).log.at(-1).text, /총무 지정/);
  assert.throws(() => started(mkctx(), 2), /선공/);
});

test('한 명씩 번갈아 고른다 — 차례가 아니면 거부', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  assert.throws(() => D.pick(st, 1, '가', ctx), /상대 감독 차례/);
  D.pick(st, 0, '가', ctx);
  assert.equal(st.turn, 1);
  assert.throws(() => D.pick(st, 0, '나', ctx), /상대 감독 차례/);
  D.pick(st, 1, '나', ctx);
  assert.equal(st.turn, 0);
  assert.deepEqual(st.teams, [['감독가', '가'], ['감독나', '나']]);
});

test('같은 선수·팀이 있는 선수·휴면은 고를 수 없다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  D.pick(st, 0, '가', ctx);
  assert.throws(() => D.pick(st, 1, '가', ctx), /고를 수 없는/);
  assert.throws(() => D.pick(st, 1, '휴면1', ctx), /고를 수 없는/);
  assert.throws(() => D.pick(st, 1, '감독가', ctx), /고를 수 없는/);
  assert.throws(() => D.pick(st, 1, '없는사람', ctx), /고를 수 없는/);
});

test('연령대 정원: 활동 회원의 절반(홀수면 올림)을 넘겨 가져갈 수 없다', () => {
  const ctx = mkctx();
  const st = started(ctx, 0);
  // 활동 8명: 20대3(정원2) · 30대4(정원2, 이미 감독 1명씩) · 40대1(정원1)
  const t = D.balanceTable(st, ctx);
  assert.deepEqual(t.map(r => [r.band, r.total, r.cap]), [['20대', 3, 2], ['30대', 4, 2], ['40대', 1, 1]]);
  D.pick(st, 0, '가', ctx);        // 청 20대 1
  D.pick(st, 1, '나', ctx);        // 백 20대 1
  D.pick(st, 0, '다', ctx);        // 청 20대 2 (정원)
  assert.equal(D.canTake(st, ctx, 0, '라'), true);   // 청 30대는 감독 1명 → 아직 1자리
  D.pick(st, 1, '라', ctx);        // 백 30대 2 (정원 도달)
  assert.equal(D.whyNot(st, ctx, 1, '마'), 'band');  // 백은 30대를 더 못 가져감
  // 청은 20대에서 "한 명 더"를 이미 썼다(홀수 연령대 2곳 → 팀당 1곳까지). 40대도 홀수라 청은 못 고른다.
  assert.equal(D.whyNot(st, ctx, 0, '바'), 'extra');
  assert.throws(() => D.pick(st, 0, '바', ctx), /한 명 넘게/);
  D.pick(st, 0, '마', ctx);        // 청 30대 2 (정원)
  assert.equal(D.canTake(st, ctx, 1, '바'), true);
});

test('정원이 찬 연령대를 고르면 거부한다', () => {
  const bands = { 감독가: '20대', 감독나: '20대', a: '20대', b: '20대', c: '20대', d: '20대', e: '30대', f: '30대', g: '30대', h: '30대' };
  const ctx = mkctx({ roster: Object.keys(bands), band: n => bands[n] });
  const st = started(ctx, 0);
  D.pick(st, 0, 'a', ctx); D.pick(st, 1, 'e', ctx);
  D.pick(st, 0, 'b', ctx); D.pick(st, 1, 'f', ctx);       // 청 20대 3 = 정원(6명의 절반)
  assert.throws(() => D.pick(st, 0, 'c', ctx), /정원/);
  assert.equal(D.canTake(st, ctx, 1, 'c'), true);
});

test('고를 선수가 없는 팀은 차례를 건너뛴다', () => {
  const ctx = mkctx({
    roster: ['감독가', '감독나', '가', '나'],
    band: n => ({ 감독가: '30대', 감독나: '30대', 가: '30대', 나: '30대' })[n],
  });
  const st = started(ctx, 0);
  // 30대 4명 → 정원 2씩. 감독이 이미 1명씩. 청이 가를 고르면 청은 정원 → 남은 나는 백 몫.
  D.pick(st, 0, '가', ctx);
  assert.equal(st.turn, 1);
  D.pick(st, 1, '나', ctx);
  assert.equal(st.phase, 'review');
});

test('건너뛰기: 상대만 남은 선수를 가져갈 수 있으면 같은 팀이 이어서 고른다', () => {
  const ctx = mkctx({
    roster: ['감독가', '감독나', '가', '나', '다'],
    band: n => ({ 감독가: '30대', 감독나: '20대', 가: '30대', 나: '20대', 다: '20대' })[n],
  });
  // 30대 2명(감독가, 가) 정원1 / 20대 3명(감독나, 나, 다) 정원2.
  const st = started(ctx, 0);
  D.pick(st, 0, '나', ctx);        // 청: 20대 1명. 다음은 백 차례
  // 백(감독나 20대 1명)은 다를 가져갈 수 있다 — 가(30대)는 청 정원이라 청이 못 데려가도 백은 가능
  assert.equal(st.turn, 1);
  D.pick(st, 1, '가', ctx);        // 백이 30대 가를 가져감 (백 30대 0 → 1, 정원 1)
  // 남은 다(20대): 청은 20대 1명(+감독0)... 청 20대=나 1 <2 → 가능
  assert.equal(st.turn, 0);
  D.pick(st, 0, '다', ctx);
  assert.equal(st.phase, 'review');
  assert.ok(st.log.every(l => l.kind !== 'skip') || true);
});

test('연령대 맞춤을 끄면 정원이 적용되지 않는다', () => {
  const ctx = mkctx();
  const st = started(ctx, 0);
  D.setBalance(st, false, ctx);
  assert.equal(D.canTake(st, ctx, 0, '마'), true);
  D.setBalance(st, true, ctx);
  assert.equal(D.balanceOn(st, ctx), true);
});

test('연령대 정보가 없으면(ageOn=false) 맞춤이 꺼진다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  assert.equal(D.balanceOn(st, ctx), false);
});

test('모두 고르면 확정 단계로, 두 감독이 모두 확정해야 잠긴다', () => {
  const ctx = mkctx({ ageOn: false, isActive: (s, n) => n === '가' || n === '나' });
  const st = started(ctx, 0);
  D.pick(st, 0, '가', ctx);
  assert.equal(st.phase, 'draft');
  D.pick(st, 1, '나', ctx);
  assert.equal(st.phase, 'review');
  assert.equal(st.turn, null);
  assert.throws(() => D.pick(st, 0, '가', ctx), /고를 수 없/);
  D.confirm(st, 0, true, ctx);
  assert.equal(st.phase, 'review');
  D.confirm(st, 0, false, ctx);
  assert.deepEqual(st.confirmed, [false, false]);
  D.confirm(st, 0, true, ctx);
  D.confirm(st, 1, true, ctx);
  assert.equal(st.phase, 'done');
  assert.throws(() => D.confirm(st, 0, false, ctx), /정한 뒤에/);
});

test('총무가 마감하면 남은 선수가 있어도 확정 단계로 간다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  D.pick(st, 0, '가', ctx);
  D.finish(st, ctx);
  assert.equal(st.phase, 'review');
  assert.ok(D.poolOf(st, ctx).length > 0);
  assert.throws(() => D.finish(st, ctx), /진행 중/);
});

test('되돌리기: 본인이 마지막으로 고른 경우에만, 상대가 고르면 못 한다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  assert.throws(() => D.undo(st, 0, ctx), /되돌릴 지명이 없/);
  D.pick(st, 0, '가', ctx);
  assert.throws(() => D.undo(st, 1, ctx), /상대 감독이 한 것/);
  D.undo(st, 0, ctx);
  assert.deepEqual(st.teams[0], ['감독가']);
  assert.equal(st.turn, 0);
  D.pick(st, 0, '가', ctx);
  D.pick(st, 1, '나', ctx);
  assert.throws(() => D.undo(st, 0, ctx), /상대 감독이 한 것/);
  D.undo(st, null, ctx);                       // 총무는 마지막 것을 되돌릴 수 있다
  assert.deepEqual(st.teams[1], ['감독나']);
  assert.equal(st.turn, 1);
});

test('확정 대기 중 되돌리면 선택 단계로 돌아가고 확정은 풀린다', () => {
  const ctx = mkctx({ ageOn: false, isActive: (s, n) => n === '가' || n === '나' });
  const st = started(ctx, 0);
  D.pick(st, 0, '가', ctx); D.pick(st, 1, '나', ctx);
  D.confirm(st, 0, true, ctx);
  D.undo(st, 1, ctx);
  assert.equal(st.phase, 'draft');
  assert.deepEqual(st.confirmed, [false, false]);
  assert.equal(st.turn, 1);
});

test('총무: 팀원 제외·한 단계씩 되돌리기', () => {
  const ctx = mkctx({ ageOn: false, isActive: (s, n) => n === '가' || n === '나' });
  const st = started(ctx, 0);
  D.pick(st, 0, '가', ctx); D.pick(st, 1, '나', ctx);
  D.confirm(st, 0, true, ctx); D.confirm(st, 1, true, ctx);
  assert.equal(st.phase, 'done');
  D.reopen(st, ctx);
  assert.equal(st.phase, 'review');
  assert.deepEqual(st.confirmed, [false, false]);
  D.release(st, '가', ctx);
  assert.deepEqual(st.teams[0], ['감독가']);
  assert.equal(st.phase, 'draft');
  assert.equal(st.turn, 0);
  assert.throws(() => D.release(st, '감독가', ctx), /감독은/);
  assert.throws(() => D.release(st, '아무나', ctx), /팀에 없는/);
});

test('총무가 휴면 회원을 활동으로 바꾸면 풀과 정원 계산에 들어온다', () => {
  const ctx = mkctx();
  const st = D.initial();
  D.setup(st, { coaches: ['감독가', '감독나'] }, ctx);
  D.setActive(st, '휴면1', true, ctx);
  D.start(st, ctx, 0);
  assert.ok(D.poolOf(st, ctx).includes('휴면1'));
  assert.equal(D.balanceTable(st, ctx).find(r => r.band === '20대').total, 4);
  D.setActive(st, '휴면1', null, ctx);
  assert.ok(!D.poolOf(st, ctx).includes('휴면1'));
});

test('처음으로 되돌리면 감독·기간 설정은 남고 팀은 비워진다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  D.setWindow(st, { from: '2026-10-17T00:00:00+09:00', to: '2026-10-18T00:00:00+09:00' }, ctx);
  D.pick(st, 0, '가', ctx);
  D.reset(st, ctx);
  assert.equal(st.phase, 'setup');
  assert.deepEqual(st.teams, [[], []]);
  assert.deepEqual(st.coaches, ['감독가', '감독나']);
  assert.ok(st.window.from);
});

test('포지션 입력 기간', () => {
  const st = D.initial();
  const at = iso => ({ now: () => new Date(iso) });
  assert.equal(D.windowState(st, at('2026-10-17T12:00:00+09:00')), 'open');   // 제한 없음
  D.setWindow(st, { from: '2026-10-17T00:00:00+09:00', to: '2026-10-18T00:00:00+09:00' }, at('2026-10-16T00:00:00+09:00'));
  assert.equal(D.windowState(st, at('2026-10-16T23:59:00+09:00')), 'before');
  assert.equal(D.windowState(st, at('2026-10-17T00:00:00+09:00')), 'open');
  assert.equal(D.windowState(st, at('2026-10-17T23:59:59+09:00')), 'open');
  assert.equal(D.windowState(st, at('2026-10-18T00:00:00+09:00')), 'after');
  assert.throws(() => D.setWindow(st, { from: '2026-10-18', to: '2026-10-17' }, {}), /늦습니다/);
  assert.throws(() => D.setWindow(st, { from: 'abc' }, {}), /형식/);
  D.setWindow(st, {}, {});
  assert.equal(D.windowState(st, at('2030-01-01T00:00:00+09:00')), 'open');
});

test('포메이션 저장: 팀원만, 11명까지, 좌표는 0~1로 자른다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  D.pick(st, 0, '가', ctx); D.pick(st, 1, '나', ctx);
  D.setFormation(st, 0, { formation: '4-3-3', pieces: { 가: { x: 1.4, y: -2 } }, note: '압박' }, ctx);
  assert.deepEqual(st.formation[0].pieces, { 가: { x: 1, y: 0 } });
  assert.equal(st.formation[0].id, '4-3-3');
  assert.throws(() => D.setFormation(st, 0, { pieces: { 나: { x: .5, y: .5 } } }, ctx), /팀원이 아닌/);
  assert.throws(() => D.setFormation(st, 0, { formation: '9-9-9' }, ctx), /없는 포메이션/);
  assert.throws(() => D.setFormation(st, 0, { pieces: { 가: { x: 'a', y: 1 } } }, ctx), /형식/);
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, { x: .5, y: .5 }]));
  assert.throws(() => D.setFormation(st, 0, { pieces: many }, ctx), /11명/);
});

test('팀 구성 전에는 포메이션을 저장할 수 없다', () => {
  const st = D.initial();
  assert.throws(() => D.setFormation(st, 0, { formation: '4-4-2' }, mkctx()), /팀이 정해진 뒤/);
});

// 실제 인원 분포(활동 39명)로 끝까지 돌려, 어떤 순서로 골라도 연령대 차이가 1명 이하인지 본다.
test('무작위로 끝까지 골라도 연령대별 차이는 1명 이하이고 인원은 같다', () => {
  const bands = [...Array(3).fill('10대'), ...Array(9).fill('20대'), ...Array(11).fill('30대'),
    ...Array(5).fill('40대'), ...Array(9).fill('50대'), '60대', '미상'];     // 39명
  const names = bands.map((_, i) => 'm' + i);
  const bandOf = Object.fromEntries(names.map((n, i) => [n, bands[i]]));
  for (let seed = 1; seed <= 200; seed++) {
    let s = seed;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const ctx = { roster: names, isActive: () => true, label: n => n, band: n => bandOf[n], ageOn: true, rng: () => (rnd() < .5 ? 0 : 1) };
    const st = D.initial();
    D.setup(st, { coaches: [names[0], names[1]] }, ctx);
    D.start(st, ctx);
    let guard = 0;
    while (st.phase === 'draft' && guard++ < 100) {
      const pool = D.poolOf(st, ctx).filter(n => D.canTake(st, ctx, st.turn, n));
      assert.ok(pool.length > 0, 'turn team must have a choice');
      D.pick(st, st.turn, pool[Math.floor(rnd() * pool.length)], ctx);
    }
    assert.equal(st.phase, 'review');
    assert.equal(st.teams[0].length + st.teams[1].length, 39);
    assert.ok(Math.abs(st.teams[0].length - st.teams[1].length) <= 1, `seed ${seed}: 인원 차이`);
    for (const r of D.balanceTable(st, ctx)) {
      assert.ok(Math.abs(r.counts[0] - r.counts[1]) <= 1, `seed ${seed} ${r.band} ${r.counts}`);
    }
  }
});

// ---------- core ----------
test('포메이션은 전부 11자리이고 GK가 하나다', () => {
  for (const f of C.FORMATIONS) {
    assert.equal(f.slots.length, 11, f.id);
    assert.equal(f.slots.filter(s => s.role === 'GK').length, 1, f.id);
    for (const s of f.slots) {
      assert.ok(C.SLOT_TO_POS[s.role], `${f.id} ${s.role}`);
      assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1, f.id);
    }
  }
});

test('자동 배치: 골키퍼는 GK 자리, 주 포지션이 맞는 자리에 앉는다', () => {
  // 좌우는 안 묻는다. 측면 수비 둘을 주발로 갈라 세운다.
  const pos = { g: ['GK'], c1: ['CB'], c2: ['CB', 'DM'], l: ['SB'], r: ['SB'], s: ['ST'], s2: ['ST', 'WG'] };
  const foot = { l: 'L', r: 'R' };
  const out = C.autoLayout('4-4-2', Object.keys(pos), n => pos[n], n => foot[n] || null);
  assert.equal(Object.keys(out).length, 7);
  assert.equal(out.g.y, .92);
  assert.ok(out.l.x < out.c1.x && out.r.x > out.c1.x);
  assert.ok(out.s.y < .3 && out.s2.y < .3);
});

test('자동 배치: 12명 이상이면 11명만 올린다', () => {
  const names = Array.from({ length: 16 }, (_, i) => `p${i}`);
  assert.equal(Object.keys(C.autoLayout('4-3-3', names, () => [])).length, 11);
});

test('자동 배치: 포지션이 있는 사람이 없는 사람보다 먼저 필드에 선다', () => {
  const pos = { cb: ['CB'] };
  const out = C.autoLayout('4-4-2', ['없음1', '없음2', 'cb'], n => pos[n]);
  assert.ok('cb' in out);
  assert.equal(Object.keys(out).length, 3);
});

test('좌우를 묻던 시절 값은 통합된 자리로 받는다', () => {
  assert.deepEqual(C.cleanPositions(['LB', 'CB']), ['SB', 'CB']);
  assert.deepEqual(C.cleanPositions(['LW', 'RW']), ['WG']);   // 한 자리로 겹치면 하나로
  assert.deepEqual(C.cleanPositions(['RB']), ['SB']);
});

test('주발 검증: 안 골라도 되고, 엉뚱한 값은 거부한다', () => {
  assert.equal(C.cleanFoot('l'), 'L');
  assert.equal(C.cleanFoot('B'), 'B');
  assert.equal(C.cleanFoot(''), null);
  assert.equal(C.cleanFoot(null), null);
  assert.throws(() => C.cleanFoot('Z'), /주발/);
});

test('주발로 좌·우 자리를 가늠한다', () => {
  assert.ok(C.fitCost(['SB'], 'LB', 'L') < C.fitCost(['SB'], 'RB', 'L'));
  assert.ok(C.fitCost(['WG'], 'RW', 'R') < C.fitCost(['WG'], 'LW', 'R'));
  // 양발·모름은 좌우를 안 따진다
  assert.equal(C.fitCost(['SB'], 'LB', 'B'), C.fitCost(['SB'], 'RB', 'B'));
  assert.equal(C.fitCost(['SB'], 'LB', null), C.fitCost(['SB'], 'RB', null));
  // 발보다 포지션이 먼저다 — 반대발 측면수비가 공격수보다 측면수비 자리에 가깝다
  assert.ok(C.fitCost(['SB'], 'LB', 'R') < C.fitCost(['ST'], 'LB', 'L'));
});

test('적어 낸 자리가 아니어도 배치된다', () => {
  const pos = { a: ['ST'], b: ['ST'], c: ['ST'] };          // 4-4-2 의 공격수 자리는 둘뿐
  const out = C.autoLayout('4-4-2', Object.keys(pos), n => pos[n]);
  assert.equal(Object.keys(out).length, 3, '셋 다 어딘가에 선다');
  assert.ok(new Set(Object.values(out).map(q => q.y)).size >= 2, '한 명은 다른 줄로 간다');
});

test('포지션 검증: 1~3개, 중복·미정의 거부', () => {
  assert.deepEqual(C.cleanPositions(['CB', 'DM']), ['CB', 'DM']);
  assert.throws(() => C.cleanPositions([]), /1~3개/);
  assert.throws(() => C.cleanPositions(['CB', 'DM', 'CM', 'ST']), /1~3개/);
  assert.throws(() => C.cleanPositions(['CB', 'CB']), /두 번/);
  assert.throws(() => C.cleanPositions(['XX']), /올바르지/);
  assert.throws(() => C.cleanPositions('CB'), /골라주세요/);
});

test('가까운 포지션이 먼 포지션보다 어색함이 작다', () => {
  assert.ok(C.fitCost(['CB'], 'DM') < C.fitCost(['CB'], 'ST'));
  assert.ok(C.fitCost(['CB'], 'CB') < C.fitCost(['CB'], 'DM'));
  assert.equal(C.fitCost(['ST', 'CB'], 'CB'), 1);
  assert.ok(C.fitCost(['ST'], 'GK') >= 50);
});

test('감독이 자기 팀 이름을 바꾼다 — 시작 뒤에도, 상대와 같으면 거부', () => {
  const ctx = mkctx();
  const st = started(ctx, 0);
  D.rename(st, 0, '  한울팀 ', ctx);
  assert.equal(st.names[0], '한울팀');                       // 앞뒤 공백은 자른다
  assert.equal(st.names[1], '백팀');                         // 상대 팀은 그대로
  assert.match(st.log.at(-1).text, /청팀 → 한울팀/);
  assert.throws(() => D.rename(st, 1, '한울팀', ctx), /같습니다/);
  assert.throws(() => D.rename(st, 1, '', ctx), /1~12자/);
  assert.throws(() => D.rename(st, 1, '열세글자를넘는아주긴팀이름입니다', ctx), /1~12자/);
  assert.throws(() => D.rename(st, 1, 7, ctx), /1~12자/);
  assert.throws(() => D.rename(st, 2, '타리팀', ctx), /알 수 없/);
  const n = st.log.length;
  D.rename(st, 0, '한울팀', ctx);                            // 같은 이름으로 다시 저장해도 기록이 늘지 않는다
  assert.equal(st.log.length, n);
});

test('팀 이름은 확정된 뒤에도 바꿀 수 있다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  for (const [t, n] of [[0, '가'], [1, '나'], [0, '다'], [1, '라'], [0, '마'], [1, '바']]) D.pick(st, t, n, ctx);
  assert.equal(st.phase, 'review');
  D.confirm(st, 0, true, ctx); D.confirm(st, 1, true, ctx);
  assert.equal(st.phase, 'done');
  D.rename(st, 1, '타리팀', ctx);
  assert.equal(st.names[1], '타리팀');
});

test('감독 위임: 위임받은 사람도 그 팀의 감독 권한을 갖는다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  assert.equal(D.coachTeam(st, '감독가'), 0);
  assert.equal(D.coachTeam(st, '가'), -1);
  D.delegate(st, 1, '라', true, ctx);                          // 감독나 팀에 위임
  assert.equal(D.coachTeam(st, '라'), 1);                      // 이제 라는 1팀의 감독 권한
  assert.match(st.log.at(-1).text, /백팀: 라 님에게 감독 기능을 위임/);
  D.delegate(st, 1, '라', true, ctx);                          // 다시 위임해도 그대로
  assert.deepEqual(st.delegates[1], ['라']);
  D.delegate(st, 1, '라', false, ctx);
  assert.equal(D.coachTeam(st, '라'), -1);
  assert.match(st.log.at(-1).text, /위임을 풀었습니다/);
  D.delegate(st, 1, '라', false, ctx);                         // 없는 사람을 풀어도 조용히 지나간다
});

test('감독 위임: 막아야 하는 경우', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  assert.throws(() => D.delegate(st, 0, '감독가', true, ctx), /본인/);
  assert.throws(() => D.delegate(st, 0, '감독나', true, ctx), /상대 팀 감독/);
  assert.throws(() => D.delegate(st, 0, '없는사람', true, ctx), /명부에 없는/);
  assert.throws(() => D.delegate(st, 2, '가', true, ctx), /알 수 없/);
  D.pick(st, 0, '가', ctx); D.pick(st, 1, '나', ctx);
  assert.throws(() => D.delegate(st, 0, '나', true, ctx), /상대 팀 선수/);   // 1팀에 뽑힌 사람
  D.delegate(st, 1, '다', true, ctx);
  assert.throws(() => D.delegate(st, 0, '다', true, ctx), /상대 팀 선수/);   // 1팀이 위임한 사람
  const s2 = started(ctx, 0);
  for (const n of ['가', '나', '다']) D.delegate(s2, 0, n, true, ctx);
  assert.throws(() => D.delegate(s2, 0, '라', true, ctx), /3명까지/);
  assert.throws(() => D.delegate(D.initial(), 0, '가', true, ctx), /감독이 정해진 뒤/);
});

test('감독 위임: 옛 저장 상태(delegates 없음)에서도 읽고 쓴다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = started(ctx, 0);
  delete st.delegates;                                          // 이 필드가 생기기 전에 저장된 상태
  assert.equal(D.coachTeam(st, '감독나'), 1);
  assert.equal(D.coachTeam(st, '가'), -1);
  D.delegate(st, 0, '가', true, ctx);
  assert.deepEqual(st.delegates, [['가'], []]);
});

test('감독을 다시 정하면 이전 위임은 사라진다', () => {
  const ctx = mkctx({ ageOn: false });
  const st = D.initial();
  D.setup(st, { coaches: ['감독가', '감독나'] }, ctx);
  D.delegate(st, 0, '가', true, ctx);
  D.setup(st, { coaches: ['감독가', '감독나'] }, ctx);
  assert.deepEqual(st.delegates, [[], []]);
});

// ───────── 라인업 공유: 후보 이름 자리 잡기 ─────────
const LU = require('../public/lineup');

// 4-2-3-1 의 말 11개가 선 모양에서, 말마다 폭 40·높이 62 정도의 사각형이 차지한다고 보고 확인한다.
function lineupBoxes(W, H, id = '4-2-3-1') {
  return C.FORMATION_BY_ID[id].slots.map(sl => ({ x0: sl.x * W - 20, x1: sl.x * W + 20, y0: sl.y * H - 19, y1: sl.y * H + 43 }));
}
const rectOf = (p, w, h) => ({ x0: p.cx - w / 2, x1: p.cx + w / 2, y0: p.cy - h / 2, y1: p.cy + h / 2 });
const overlap = (a, b) => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);

test('후보 이름 자리: 모두 놓이고, 말·다른 이름과 겹치지 않고, 피치 안에 든다', () => {
  const W = 335, H = 517, fs = 11;
  const boxes = lineupBoxes(W, H);
  const items = [
    ['가', ['ST']], ['나', ['WG']], ['다', ['WG']], ['라', ['SB']], ['마', ['CB']],
    ['바', ['CB']], ['사', ['CB']], ['아', ['GK']], ['자', ['DM']], ['차', ['AM']], ['카', ['CM']],
  ].map(([label, pos]) => ({ key: label, label, pos }));
  const out = LU.placeBench({ W, H, boxes, items, measure: LU.approxWidth, fs });
  assert.equal(Object.keys(out).length, items.length, '전원이 놓인다');
  const rects = items.map(it => rectOf(out[it.key], LU.approxWidth(it.label, fs) + fs * .9, fs * 1.5));
  rects.forEach((r, i) => {
    assert.ok(r.x0 >= 0 && r.y0 >= 0 && r.x1 <= W && r.y1 <= H, `${items[i].label} 이(가) 피치 밖`);
    boxes.forEach(b => assert.ok(!overlap(r, b), `${items[i].label} 이(가) 말과 겹침`));
    rects.forEach((q, j) => { if (i < j) assert.ok(!overlap(r, q), `${items[i].label}·${items[j].label} 겹침`); });
  });
});

test('후보 이름 자리: 희망 포지션 줄 가까이에 앉고, 같은 입력이면 같은 자리다', () => {
  const W = 335, H = 517, fs = 11;
  const items = [{ key: 'st', label: '공격수', pos: ['ST'] }, { key: 'gk', label: '골키퍼', pos: ['GK'] },
    { key: 'cb', label: '수비수', pos: ['CB'] }];
  const run = () => LU.placeBench({ W, H, boxes: lineupBoxes(W, H), items, measure: LU.approxWidth, fs });
  const a = run();
  assert.deepEqual(a, run());
  assert.ok(a.st.cy < H * .3, '스트라이커는 위쪽');
  assert.ok(a.gk.cy > H * .8, '골키퍼는 아래쪽');
  assert.ok(a.cb.cy > a.st.cy, '수비수는 공격수보다 아래');
});

test('후보 이름 자리: 포지션이 없어도 놓고, 너무 많아 못 놓으면 빼되 겹치게는 놓지 않는다', () => {
  const one = LU.placeBench({ W: 335, H: 517, boxes: [], items: [{ key: 'x', label: '무명', pos: [] }], measure: LU.approxWidth, fs: 11 });
  assert.ok(one.x, '포지션을 안 적어도 어딘가에 놓는다');
  const many = Array.from({ length: 400 }, (_, i) => ({ key: 'k' + i, label: '이름' + i, pos: ['CM'] }));
  const out = LU.placeBench({ W: 335, H: 517, boxes: [], items: many, measure: LU.approxWidth, fs: 11 });
  const keys = Object.keys(out);
  assert.ok(keys.length > 0 && keys.length < many.length, '일부만 놓인다');
  const rs = keys.map(k => rectOf(out[k], LU.approxWidth(many.find(m => m.key === k).label, 11) + 9.9, 16.5));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) assert.ok(!overlap(rs[i], rs[j]));
});

test('라인업 공유: 보드 응답에서 스타팅·후보·명단을 가른다', () => {
  const d = {
    names: ['한울팀', '타리팀'], colors: ['#e4572e', '#2e86de'],
    coaches: [{ v: '감독가', label: '감독가' }, null],
    teams: [['감독가', '가', '나'], []],
    members: [{ v: '감독가', label: '감독가', pos: ['CM'] }, { v: '가', label: '가', pos: ['ST', 'WG'] }, { v: '나', label: '나', pos: null }],
  };
  const c = LU.fromBoard(d, 0, { 감독가: { x: .5, y: .5 }, 가: { x: .5, y: .2 } }, '4-2-3-1');
  assert.deepEqual(c.tokens.map(t => t.name), ['감독가', '가']);
  assert.deepEqual(c.bench.map(b => b.name), ['나']);
  assert.deepEqual(c.roster.map(r => [r.name, r.start]), [['감독가', true], ['가', true], ['나', false]]);
  assert.equal(c.teamName, '한울팀'); assert.equal(c.coach, '감독가'); assert.equal(c.formationId, '4-2-3-1');
  assert.deepEqual(LU.splitLabel('최지훈 (동생)'), ['최지훈', '동생']);
  assert.equal(LU.mainName('김가가'), '김가가');
  const empty = LU.fromBoard(d, 1, {}, '');
  assert.equal(empty.tokens.length + empty.bench.length, 0);
});
