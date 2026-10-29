// 등번호·사이즈 신청 규칙.
// 서버(CommonJS)와 브라우저가 같은 파일을 쓴다 — core.js 와 같은 이유로, 두 곳의 판단이 어긋나면
// 화면에서는 고를 수 있는 번호가 저장할 때 거부되는 일이 생긴다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitNum = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // 명부에 실제로 쓰인 사이즈는 M·L·XL·XXL·XXXL 뿐이지만 S도 받는다 (10대 회원이 있다).
  // 저장 값은 명부 표기를 그대로 쓴다 — 나중에 members.csv 로 옮겨 적을 때 손이 덜 간다.
  const SIZES = [
    { id: 'S', name: 'S', hint: '85~90' },
    { id: 'M', name: 'M', hint: '95' },
    { id: 'L', name: 'L', hint: '100' },
    { id: 'XL', name: 'XL', hint: '105' },
    { id: 'XXL', name: '2XL', hint: '110' },
    { id: 'XXXL', name: '3XL', hint: '115' },
  ];
  const SIZE_IDS = SIZES.map(s => s.id);

  const GRID_MAX = 99;        // 0~99 는 격자로 다 깔아 보여준다
  const NUM_MAX = 999;        // 세 자리도 쓴다 (명부에 100·777·999 가 있다)
  const NOTE_MAX = 40;

  // 번호 문자열 정리. 「07」처럼 앞에 0을 붙여 적어도 7번과 같은 번호로 본다 —
  // 둘을 다른 번호로 두면 같은 등번호가 둘이 되어 경기장에서 구분이 안 된다.
  function cleanNumber(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^[0-9]{1,3}$/.test(s)) throw new Error('등번호는 0~999 사이의 숫자로 적어주세요.');
    const n = parseInt(s, 10);
    if (!Number.isInteger(n) || n < 0 || n > NUM_MAX)
      throw new Error('등번호는 0~999 사이로 골라주세요.');
    return n;
  }

  function cleanSize(v) {
    const s = String(v == null ? '' : v).trim().toUpperCase();
    const hit = SIZE_IDS.find(id => id === s) ||
      ({ '2XL': 'XXL', '3XL': 'XXXL' })[s];     // 화면 표기로 보내와도 받아 준다
    if (!hit) throw new Error('사이즈를 골라주세요.');
    return hit;
  }

  function cleanNote(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (s.length > NOTE_MAX) throw new Error(`남길 말씀은 ${NOTE_MAX}자까지 적어주세요.`);
    return s;
  }

  // 명부의 기존 번호 문자열을 숫자로. 비었거나 「-」면 번호가 없는 것이다.
  function parseBase(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s === '-') return null;
    if (!/^[0-9]{1,3}$/.test(s)) return null;
    return parseInt(s, 10);
  }

  // 지금 누가 어느 번호를 쥐고 있는가.
  //
  //   hard = 비켜 줄 수 없는 번호. 활동 회원이 쓰던 번호이거나, 누가 이미 신청해 둔 번호다.
  //   soft = 휴면 회원이 쓰던 번호. 비워 둘 이유가 없으니 다른 회원이 가져갈 수 있다.
  //
  // **신청한 사람의 기존 번호는 더 이상 세지 않는다** — 37번을 쓰던 회원이 7번을 신청하면
  // 그 자리에서 37번이 풀려야 한다 (총무 요청 2026-10-28).
  function claimsOf(ctx) {
    const out = new Map();
    const add = (n, who, hard) => {
      if (n == null) return;
      if (!out.has(n)) out.set(n, { hard: [], soft: [] });
      out.get(n)[hard ? 'hard' : 'soft'].push(who);
    };
    for (const m of ctx.roster) {
      const o = ctx.orders[m];
      if (o && Number.isInteger(o.number)) add(o.number, m, true);
      else add(parseBase(ctx.base[m]), m, !!ctx.isActive(m));
    }
    return out;
  }

  // 한 번호의 상태. me 를 주면 내 번호를 따로 알려준다.
  //   mine   내가 쥐고 있는 번호 (기존 번호이거나 내가 신청한 번호)
  //   taken  활동 회원이 쓰는 번호 — 고를 수 없다
  //   dormant 휴면 회원이 쓰던 번호 — 고를 수 있다
  //   free   비어 있는 번호
  function stateOf(claims, n, me) {
    const c = claims.get(n);
    if (!c) return 'free';
    if (me && (c.hard.includes(me) || c.soft.includes(me))) return 'mine';
    if (c.hard.length) return 'taken';
    if (c.soft.length) return 'dormant';
    return 'free';
  }

  const holdersOf = (claims, n) => {
    const c = claims.get(n);
    return c ? [...c.hard, ...c.soft] : [];
  };

  // 내가 이 번호를 가져갈 수 있는가. 나 말고 누군가 hard 로 쥐고 있으면 안 된다.
  function canTake(claims, n, me) {
    const c = claims.get(n);
    return !c || c.hard.every(x => x === me);
  }

  // 격자에 깔 번호: 0~99 + 그 밖에서 실제로 쓰이는 번호(명부에 100·777·999 가 있다) + 내가 고른 번호.
  //   used: 지금 쓰이는 번호들 (숫자를 꺼낼 수 있는 아무 것)   extra: 내가 고른 번호
  function numbersToShow(used, extra) {
    const grid = [];
    for (let n = 0; n <= GRID_MAX; n += 1) grid.push(n);
    const over = new Set();
    for (const v of used || []) { const n = Number(v); if (n > GRID_MAX) over.add(n); }
    if (Number.isInteger(extra) && extra > GRID_MAX) over.add(extra);
    return { grid, over: [...over].sort((a, b) => a - b) };
  }

  return {
    SIZES, SIZE_IDS, GRID_MAX, NUM_MAX, NOTE_MAX,
    cleanNumber, cleanSize, cleanNote, parseBase,
    claimsOf, stateOf, holdersOf, canTake, numbersToShow,
  };
});
