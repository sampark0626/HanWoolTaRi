// 실행: npm test   (node --test test/numbers.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../numbers');

// 활동: 가 나 다 라 / 휴면: 휴1 휴2
const ROSTER = ['가', '나', '다', '라', '휴1', '휴2'];
const mkctx = (over = {}) => ({
  roster: ROSTER,
  isActive: n => !n.startsWith('휴'),
  label: n => n,
  seed: {},
  sizes: N.SIZES_DEFAULT,
  now: () => new Date('2026-10-26T00:00:00Z'),
  ...over,
});
const mine = (st, ctx, n) => N.resolve(st, ctx).mine[n];

test('기존 번호는 활동 회원이 그대로 쥔다 — 다른 활동 회원은 못 고른다', () => {
  const ctx = mkctx({ seed: { 가: 7 } });
  const st = N.initial();
  assert.deepEqual(mine(st, ctx, '가'), { n: 7, src: 'seed', status: 'held' });
  assert.throws(() => N.claim(st, ctx, '나', 7), /가 님이 쓰고 있어/);
  assert.equal(N.claimOf(st, ctx, '나').n, null);          // 시도가 실패하면 아무것도 안 바뀐다
});

test('번호는 0~999 정수만', () => {
  const ctx = mkctx(), st = N.initial();
  N.claim(st, ctx, '가', 0);
  N.claim(st, ctx, '나', 99);
  N.claim(st, ctx, '다', 100);
  N.claim(st, ctx, '라', 999);
  for (const bad of [-1, 1000, 1.5, NaN, '7', null, undefined])
    assert.throws(() => N.claim(st, ctx, '가', bad), /0~999/);
  assert.throws(() => N.claim(st, ctx, '없음', 5), /명부에 없는/);
});

test('번호를 바꾸면 비는 번호는 곧바로 다른 활동 회원이 고를 수 있다', () => {
  const ctx = mkctx({ seed: { 가: 7 } });
  const st = N.initial();
  assert.throws(() => N.claim(st, ctx, '나', 7));
  N.claim(st, ctx, '가', 10);                              // 가가 7 → 10
  assert.equal(mine(st, ctx, '가').n, 10);
  N.claim(st, ctx, '나', 7);                               // 7이 풀렸다
  assert.equal(mine(st, ctx, '나').n, 7);
  assert.throws(() => N.claim(st, ctx, '다', 10), /가 님이 쓰고/);
});

test('번호를 놓아도 풀린다. 놓은 뒤에는 기존 번호로 돌아가지 않는다', () => {
  const ctx = mkctx({ seed: { 가: 7 } });
  const st = N.initial();
  N.release(st, ctx, '가');
  assert.equal(mine(st, ctx, '가').n, null);
  N.claim(st, ctx, '나', 7);
  assert.equal(mine(st, ctx, '나').n, 7);
});

test('휴면 회원의 번호는 잠기지 않는다 — 활동 회원이 가져가면 휴면 쪽에서 빠진다', () => {
  const ctx = mkctx({ seed: { 휴1: 9 } });
  const st = N.initial();
  const r = N.resolve(st, ctx);
  assert.equal(r.numbers[9].active, false);                // 휴면이 쥔 번호
  assert.equal(r.mine['휴1'].status, 'held');
  N.claim(st, ctx, '가', 9);
  assert.equal(mine(st, ctx, '가').n, 9);
  assert.equal(mine(st, ctx, '휴1').n, null);
  const v = N.privateView(st, ctx, '휴1');
  assert.deepEqual(v.displaced, { n: 9, by: '가', at: '2026-10-26T00:00:00.000Z' });
  assert.match(st.log.at(-2).text, /휴1 님의 9번을 가 님이 가져갔습니다/);
});

test('휴면 회원끼리는 서로 가져갈 수 있다. 활동 회원이 쥔 번호는 휴면 회원도 못 고른다', () => {
  const ctx = mkctx({ seed: { 휴1: 9, 가: 3 } });
  const st = N.initial();
  assert.throws(() => N.claim(st, ctx, '휴2', 3), /가 님이 쓰고/);
  N.claim(st, ctx, '휴2', 9);
  assert.equal(mine(st, ctx, '휴2').n, 9);
  assert.equal(mine(st, ctx, '휴1').n, null);
});

test('기존 번호가 활동·휴면에서 겹치면 활동 회원이 이긴다', () => {
  const ctx = mkctx({ seed: { 가: 4, 휴1: 4 } });
  const st = N.initial();
  const r = N.resolve(st, ctx);
  assert.equal(r.numbers[4].holder, '가');
  assert.equal(r.mine['가'].status, 'held');
  assert.equal(r.mine['휴1'].status, 'lost');
  assert.equal(N.privateView(st, ctx, '휴1').lostNumber, 4);
});

test('휴면 회원이 활동으로 바뀌면 잠긴다', () => {
  let activeSet = new Set(['가', '나', '다', '라']);
  const ctx = mkctx({ seed: { 휴1: 9 }, isActive: n => activeSet.has(n) });
  const st = N.initial();
  assert.equal(N.resolve(st, ctx).numbers[9].active, false);
  activeSet.add('휴1');
  assert.equal(N.resolve(st, ctx).numbers[9].active, true);
  assert.throws(() => N.claim(st, ctx, '가', 9), /휴1 님이 쓰고/);
});

test('활동 회원의 기존 번호끼리 겹치면 둘 다 쥔 채로 두고, 먼저 확정한 사람이 가져간다', () => {
  const ctx = mkctx({ seed: { 가: 5, 나: 5 } });
  const st = N.initial();
  const r = N.resolve(st, ctx);
  assert.deepEqual(r.numbers[5].tie, ['가', '나']);
  assert.equal(r.mine['가'].status, 'tie');
  assert.throws(() => N.claim(st, ctx, '다', 5), /쓰고 있어/);   // 제3자는 못 고른다
  N.claim(st, ctx, '나', 5);                                    // 나가 먼저 확정
  assert.equal(mine(st, ctx, '나').status, 'held');
  assert.equal(mine(st, ctx, '가').n, null);
  assert.ok(N.privateView(st, ctx, '가').displaced);
  assert.equal(N.isDone(st, ctx, '가', mine(st, ctx, '가')), false);
});

test('번호를 빼앗기고 새로 안 골랐으면 끝낸 것이 아니다', () => {
  const ctx = mkctx({ seed: { 가: 5, 나: 5 } });
  const st = N.initial();
  N.setSize(st, ctx, '가', 'L');
  assert.equal(N.privateView(st, ctx, '가').done, false);   // 겹침(tie)이라 아직 확정이 아니다
  N.claim(st, ctx, '나', 5);
  assert.equal(N.privateView(st, ctx, '가').done, false);   // 빼앗겼다
  N.claim(st, ctx, '가', 8);
  assert.equal(N.privateView(st, ctx, '가').done, true);
});

test('사이즈는 정해진 값만, 다시 보내면 해제', () => {
  const ctx = mkctx(), st = N.initial();
  N.setSize(st, ctx, '가', 'XL');
  assert.equal(N.privateView(st, ctx, '가').size, 'XL');
  assert.throws(() => N.setSize(st, ctx, '가', '95'), /사이즈/);
  N.setSize(st, ctx, '가', null);
  assert.equal(N.privateView(st, ctx, '가').size, null);
});

test('기존 번호를 유지하는 활동 회원은 사이즈만 고르면 끝난다', () => {
  const ctx = mkctx({ seed: { 가: 7 } });
  const st = N.initial();
  assert.equal(N.privateView(st, ctx, '가').done, false);
  N.setSize(st, ctx, '가', 'M');
  assert.equal(N.privateView(st, ctx, '가').done, true);
  assert.equal(N.privateView(st, ctx, '나').done, false);   // 번호가 없는 사람은 사이즈만으로는 안 끝난다
  N.setSize(st, ctx, '나', 'M');
  assert.equal(N.privateView(st, ctx, '나').done, false);
  N.claim(st, ctx, '나', 12);
  assert.equal(N.privateView(st, ctx, '나').done, true);
});

test('공개 응답에는 사이즈가 없다', () => {
  const ctx = mkctx({ seed: { 가: 7 } });
  const st = N.initial();
  N.setSize(st, ctx, '가', 'XL');
  const m = N.publicView(st, ctx).members.find(x => x.v === '가');
  assert.deepEqual(Object.keys(m).sort(), ['a', 'd', 'k', 'l', 'n', 'v']);
  assert.equal(N.publicView(st, ctx).progress.active, 4);
  assert.equal(N.publicView(st, ctx).progress.done, 1);
});

test('총무 표에는 사이즈 집계가 있다', () => {
  const ctx = mkctx(), st = N.initial();
  N.setSize(st, ctx, '가', 'M'); N.setSize(st, ctx, '나', 'M'); N.setSize(st, ctx, '휴1', 'L');
  const a = N.adminView(st, ctx);
  assert.equal(a.sizeActive.M, 2);
  assert.equal(a.sizeActive.L, 0);
  assert.equal(a.sizeAll.L, 1);
});

test('기존 번호 가져오기 — 이름·화면 이름·구분자·건너뛰기', () => {
  const ctx = mkctx({
    roster: ['가', '나S', '나B', '휴1'],
    label: n => ({ 나S: '나 (동생)', 나B: '나 (형)' }[n] || n),
    isActive: n => n !== '휴1',
  });
  const st = N.initial();
  const r = N.importSeed(st, ctx, '가 7\n나 (동생), 10\n나B:11\n휴1\t9\n없는사람 3\n가 -\n엉터리\n나S 1000\n');
  assert.equal(r.applied, 4);                               // 가(두 줄) · 나S · 나B · 휴1
  assert.equal(r.skipped.length, 3);
  assert.match(r.skipped[0], /명부에 없는/);
  assert.equal(N.seedOf(st, ctx, '가'), null);              // 마지막 줄 - 가 지웠다
  assert.equal(N.seedOf(st, ctx, '나S'), 10);
  assert.equal(N.seedOf(st, ctx, '나B'), 11);
  assert.equal(N.seedOf(st, ctx, '휴1'), 9);
});

test('가져오기는 이미 직접 고른 회원을 건드리지 않고, 겹침을 알려준다', () => {
  const ctx = mkctx();
  const st = N.initial();
  N.claim(st, ctx, '가', 20);
  const r = N.importSeed(st, ctx, '가 7\n나 8\n다 8\n라 20');
  assert.equal(mine(st, ctx, '가').n, 20);                  // 직접 고른 것이 이긴다
  assert.equal(mine(st, ctx, '라').status, 'lost');         // 20은 가가 쥐고 있다
  assert.ok(r.warnings.some(w => /8번: 나, 다/.test(w)));
  assert.ok(r.warnings.some(w => /라: 기존 20번/.test(w)));
});

test('환경변수 기존 번호는 쓰되, 총무가 넣은 값이 앞선다', () => {
  const ctx = mkctx({ seed: { 가: 7, 나: 8 } });
  const st = N.initial();
  N.importSeed(st, ctx, '가 70\n나 -');
  assert.equal(N.seedOf(st, ctx, '가'), 70);
  assert.equal(N.seedOf(st, ctx, '나'), null);
});

test('마감·유니폼 지정·기록 지우기', () => {
  const ctx = mkctx({ seed: { 가: 7 } }), st = N.initial();
  N.setLocked(st, true);
  assert.equal(N.publicView(st, ctx).locked, true);
  N.setWinner(st, 'nebula', new Set(['nebula', 'solar']));
  assert.equal(st.winner, 'nebula');
  assert.throws(() => N.setWinner(st, 'zzz', new Set(['nebula'])), /없는 유니폼/);
  N.setWinner(st, null);
  assert.equal(st.winner, null);
  N.claim(st, ctx, '가', 50);
  N.clearMember(st, ctx, '가');
  assert.equal(mine(st, ctx, '가').n, 7);                   // 기존 번호로 돌아간다
});

test('옛 저장 상태(필드가 없는 상태)에서도 읽고 쓴다', () => {
  const ctx = mkctx(), st = { v: 1 };
  assert.doesNotThrow(() => N.publicView(st, ctx));
  N.claim(st, ctx, '가', 3);
  assert.equal(mine(st, ctx, '가').n, 3);
});

test('로그는 150건까지만 남긴다', () => {
  const ctx = mkctx(), st = N.initial();
  for (let i = 0; i < 400; i++) N.claim(st, ctx, '가', i % 2 ? 1 : 2);
  assert.ok(st.log.length <= 150);
});

// ---------- 기존 사이즈 ----------
const sz = (st, ctx, n) => N.privateView(st, ctx, n);

test('기존 사이즈 가져오기 — 시트 표기(XXL·XXXL)를 2XL·3XL로, 대소문자·공백 무시', () => {
  const ctx = mkctx();
  const st = N.initial();
  const r = N.importSizes(st, ctx, '가 XXL\n나\txxxl\n다, xl\n라: 2xl\n휴1 M\n휴2 XXXXL');
  assert.equal(r.applied, 6);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(['가', '나', '다', '라', '휴1', '휴2'].map(n => sz(st, ctx, n).size),
    ['2XL', '3XL', 'XL', '2XL', 'M', '4XL']);
});

test('기존 사이즈는 제안이다 — 미리 골라져 있지만 본인이 확인해야 끝낸 것', () => {
  const ctx = mkctx({ seed: { 가: 7 } });
  const st = N.initial();
  N.importSizes(st, ctx, '가 XL');
  let v = sz(st, ctx, '가');
  assert.equal(v.size, 'XL');
  assert.equal(v.sizeSrc, 'seed');
  assert.equal(v.done, false);                                // 기존 번호를 쥐고 있어도 사이즈를 아직 확인 안 했다
  assert.equal(N.publicView(st, ctx).progress.done, 0);
  N.setSize(st, ctx, '가', 'XL');                             // 같은 값을 보내면 확인
  v = sz(st, ctx, '가');
  assert.equal(v.sizeSrc, 'pick');
  assert.equal(v.done, true);
  assert.equal(N.publicView(st, ctx).progress.done, 1);
});

test('본인이 바꾸면 기존 사이즈는 물러나고, 지워도 되살아나지 않는다', () => {
  const ctx = mkctx();
  const st = N.initial();
  N.importSizes(st, ctx, '가 XL');
  N.setSize(st, ctx, '가', 'M');
  assert.equal(sz(st, ctx, '가').size, 'M');
  N.setSize(st, ctx, '가', null);                             // 일부러 비웠다
  assert.deepEqual([sz(st, ctx, '가').size, sz(st, ctx, '가').sizeSrc], [null, null]);
  N.clearMember(st, ctx, '가');                               // 총무가 기록을 지우면 기존 사이즈로 돌아간다
  assert.equal(sz(st, ctx, '가').size, 'XL');
});

test('다시 가져와도 본인이 정한 사이즈는 건드리지 않고, 몇 명인지 알려준다', () => {
  const ctx = mkctx();
  const st = N.initial();
  N.setSize(st, ctx, '가', 'S');
  const r = N.importSizes(st, ctx, '가 XXL\n나 L');
  assert.equal(r.applied, 2);
  assert.equal(r.own, 1);
  assert.equal(sz(st, ctx, '가').size, 'S');
  assert.equal(sz(st, ctx, '나').size, 'L');
});

test('사이즈 가져오기: 못 알아본 줄은 건너뛰고 이유를 알려준다. - 는 지운다', () => {
  const ctx = mkctx({ roster: ['가', '나S', '나B'], label: n => ({ 나S: '나 (동생)', 나B: '나 (형)' }[n] || n), isActive: () => true });
  const st = N.initial();
  N.importSizes(st, ctx, '가 L');
  const r = N.importSizes(st, ctx, '가 -\n나 (동생) XXL\n없는사람 M\n나B 95\n가\n나S');
  assert.equal(sz(st, ctx, '가').size, null);                 // - 가 기존 사이즈를 지웠다
  assert.equal(sz(st, ctx, '나S').size, '2XL');
  assert.equal(r.applied, 2);
  assert.equal(r.skipped.length, 4);
  assert.match(r.skipped.join('\n'), /없는사람 M — 명부에 없는 이름/);
  assert.match(r.skipped.join('\n'), /나B 95 — 사이즈 목록/);
});

test('총무 표: 기존 사이즈도 집계하되 확인 전(sk=seed)으로 표시한다. 공개 응답에는 없다', () => {
  const ctx = mkctx();
  const st = N.initial();
  N.importSizes(st, ctx, '가 XL\n나 XL');
  N.setSize(st, ctx, '나', 'XL');
  const a = N.adminView(st, ctx);
  assert.equal(a.sizeActive.XL, 2);
  assert.equal(a.rows.find(r => r.v === '가').sk, 'seed');
  assert.equal(a.rows.find(r => r.v === '나').sk, 'pick');
  assert.deepEqual(Object.keys(N.publicView(st, ctx).members[0]).sort(), ['a', 'd', 'k', 'l', 'n', 'v']);
});

test('사이즈 목록을 바꿔도 목록에 없는 기존 사이즈는 쓰지 않는다', () => {
  const st = N.initial();
  N.importSizes(st, mkctx(), '가 XL');
  const small = mkctx({ sizes: ['S', 'M', 'L'] });
  assert.equal(sz(st, small, '가').size, null);
});
