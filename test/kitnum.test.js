// 실행: npm test   (node --test test/kitnum.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../public/kitnum');
const createKitStore = require('../kit-store');

// 활동 4명 · 휴면 2명. 명부의 기존 번호는 실제 모습을 그대로 흉내 냈다 —
// 활동 회원과 휴면 회원이 같은 번호를 쓰고 있는 자리(21번)가 명부에 있다.
const ROSTER = ['활동가', '활동나', '활동다', '번호없음', '휴면가', '휴면나'];
const BASE = { 활동가: '7', 활동나: '21', 활동다: '999', 번호없음: '-', 휴면가: '24', 휴면나: '21' };
const DORMANT = new Set(['휴면가', '휴면나']);
const ctx = (orders = {}) => ({
  roster: ROSTER, base: BASE, orders, isActive: n => !DORMANT.has(n),
});

test('번호 정리 — 앞의 0은 같은 번호로 보고, 숫자가 아니면 거부한다', () => {
  assert.equal(K.cleanNumber('7'), 7);
  assert.equal(K.cleanNumber('07'), 7);
  assert.equal(K.cleanNumber(0), 0);
  assert.equal(K.cleanNumber('999'), 999);
  assert.throws(() => K.cleanNumber('1000'), /0~999/);
  assert.throws(() => K.cleanNumber(''), /0~999/);
  assert.throws(() => K.cleanNumber('7번'), /0~999/);
  assert.throws(() => K.cleanNumber('-1'), /0~999/);
});

test('사이즈 — 화면 표기(2XL)로 보내와도 명부 표기(XXL)로 받는다', () => {
  assert.equal(K.cleanSize('xl'), 'XL');
  assert.equal(K.cleanSize('2XL'), 'XXL');
  assert.equal(K.cleanSize('3xl'), 'XXXL');
  assert.throws(() => K.cleanSize(''), /사이즈/);
  assert.throws(() => K.cleanSize('XXXXL'), /사이즈/);
});

test('남길 말씀 — 공백은 줄이고 길면 거부한다', () => {
  assert.equal(K.cleanNote('  하의는  L로 '), '하의는 L로');
  assert.equal(K.cleanNote(null), '');
  assert.throws(() => K.cleanNote('가'.repeat(41)), /40자/);
});

test('명부 번호 읽기 — 비었거나 「-」면 번호가 없다', () => {
  assert.equal(K.parseBase('7'), 7);
  assert.equal(K.parseBase('-'), null);
  assert.equal(K.parseBase(''), null);
  assert.equal(K.parseBase(undefined), null);
});

test('활동 회원의 기존 번호는 잠기고, 휴면 회원 번호는 고를 수 있다', () => {
  const c = K.claimsOf(ctx());
  assert.equal(K.stateOf(c, 7), 'taken');          // 활동가
  assert.equal(K.stateOf(c, 999), 'taken');        // 활동다 (세 자리도 그대로 잠긴다)
  assert.equal(K.stateOf(c, 24), 'dormant');       // 휴면가
  assert.equal(K.stateOf(c, 50), 'free');
  assert.equal(K.canTake(c, 7, '활동나'), false);
  assert.equal(K.canTake(c, 24, '활동나'), true);  // 휴면 번호는 가져갈 수 있다
  assert.equal(K.canTake(c, 50, '활동나'), true);
});

test('활동 회원과 휴면 회원이 같은 번호면 활동 회원 쪽이 이긴다', () => {
  const c = K.claimsOf(ctx());
  assert.equal(K.stateOf(c, 21), 'taken');         // 활동나(활동) + 휴면나(휴면)
  assert.equal(K.canTake(c, 21, '휴면가'), false);
});

test('내 번호는 내가 다시 고를 수 있다', () => {
  const c = K.claimsOf(ctx());
  assert.equal(K.stateOf(c, 7, '활동가'), 'mine');
  assert.equal(K.stateOf(c, 24, '휴면가'), 'mine');
  assert.equal(K.canTake(c, 7, '활동가'), true);
});

test('번호를 바꾸면 쓰던 번호가 그 자리에서 풀린다', () => {
  const c = K.claimsOf(ctx({ 활동가: { number: 50 } }));
  assert.equal(K.stateOf(c, 50), 'taken');
  assert.equal(K.stateOf(c, 7), 'free');           // 7번이 비었다
  assert.equal(K.canTake(c, 7, '활동나'), true);
});

test('휴면 회원이 신청하면 그 번호도 잠긴다 — 유니폼을 받으니까', () => {
  const c = K.claimsOf(ctx({ 휴면가: { number: 24 } }));
  assert.equal(K.stateOf(c, 24), 'taken');
  assert.equal(K.canTake(c, 24, '활동가'), false);
});

test('휴면 회원이 다른 번호로 옮기면 쓰던 번호는 비어 버린다', () => {
  const c = K.claimsOf(ctx({ 휴면가: { number: 60 } }));
  assert.equal(K.stateOf(c, 24), 'free');          // 휴면이라 소프트 표시도 남지 않는다
  assert.equal(K.stateOf(c, 60), 'taken');
});

test('번호가 없는 회원은 아무 자리도 차지하지 않는다', () => {
  const c = K.claimsOf(ctx());
  assert.equal([...c.values()].flatMap(x => [...x.hard, ...x.soft]).includes('번호없음'), false);
});

test('격자는 0~99 에 쓰이는 세 자리 번호를 더해 보여준다', () => {
  const c = K.claimsOf(ctx());
  const { grid, over } = K.numbersToShow(c.keys());
  assert.equal(grid.length, 100);
  assert.equal(grid[0], 0);
  assert.equal(grid[99], 99);
  assert.deepEqual(over, [999]);
  assert.deepEqual(K.numbersToShow(c.keys(), 100).over, [100, 999]);   // 내가 고른 번호도 보인다
  assert.deepEqual(K.numbersToShow(c.keys(), 7).over, [999]);          // 두 자리는 이미 격자에 있다
});

// ---------- 저장소: 같은 번호를 동시에 눌렀을 때 ----------
test('같은 번호를 두 분이 동시에 눌러도 한 분만 지나간다', async () => {
  const store = createKitStore(null);
  const claim = member => store.save(member, orders => {
    const c = K.claimsOf(ctx(orders));
    if (!K.canTake(c, 50, member)) throw new Error('이미 쓰는 번호입니다.');
    return { number: 50, size: 'L', note: '', at: new Date().toISOString() };
  });
  const r = await Promise.allSettled([claim('활동나'), claim('번호없음')]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(r.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await store.all()).length, 1);
});

test('막힌 신청은 아무것도 남기지 않는다', async () => {
  const store = createKitStore(null);
  await assert.rejects(store.save('활동나', () => { throw new Error('안 됩니다'); }), /안 됩니다/);
  assert.equal((await store.all()).length, 0);
});
