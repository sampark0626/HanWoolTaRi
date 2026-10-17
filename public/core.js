// 포지션·포메이션 정의와 자동 배치.
// 서버(CommonJS)와 브라우저가 같은 파일을 쓴다 — 두 곳의 규칙이 어긋나지 않게.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // 회원이 고르는 포지션. 1~3개, 고른 순서가 곧 우선순위(주 포지션 → 부 포지션).
  //
  // **좌우는 묻지 않는다** (총무 확인 2026-10-17). 조기축구에서 왼쪽/오른쪽 구분은
  // 큰 의미가 없고, 물어봐야 고를 것만 늘어 입력이 길어진다. 포메이션의 왼쪽·오른쪽
  // 자리는 **주발**로 가늠한다 — 왼발잡이를 왼쪽에 세우는 식이다 (fitCost 참고).
  const POSITIONS = [
    { id: 'GK', name: '골키퍼',         hint: '골문을 지킵니다',        group: '골키퍼' },
    { id: 'CB', name: '중앙 수비',      hint: '센터백',                group: '수비' },
    { id: 'SB', name: '측면 수비',      hint: '풀백 · 좌우 상관없이',   group: '수비' },
    { id: 'DM', name: '수비형 미드필더', hint: '수비 앞에서 끊어줍니다', group: '미드필드' },
    { id: 'CM', name: '중앙 미드필더',   hint: '중원에서 연결합니다',    group: '미드필드' },
    { id: 'AM', name: '공격형 미드필더', hint: '공격수 뒤에서',         group: '미드필드' },
    { id: 'WG', name: '윙',            hint: '측면 · 좌우 상관없이',   group: '공격' },
    { id: 'ST', name: '스트라이커',     hint: '최전방',                group: '공격' },
  ];
  const POS_IDS = POSITIONS.map(p => p.id);
  const MAX_POS = 3;

  // 주발. 고르지 않아도 된다 (null).
  const FEET = [
    { id: 'R', name: '오른발' },
    { id: 'L', name: '왼발' },
    { id: 'B', name: '양발' },
  ];
  const FOOT_IDS = FEET.map(f => f.id);

  // 포메이션 슬롯은 좌우가 있는 실제 자리다. 회원이 고른 포지션과 이렇게 짝지어진다.
  const SLOT_TO_POS = {
    GK: 'GK', CB: 'CB', LB: 'SB', RB: 'SB',
    DM: 'DM', CM: 'CM', AM: 'AM', LW: 'WG', RW: 'WG', ST: 'ST',
  };
  const SLOT_SIDE = { LB: 'L', LW: 'L', RB: 'R', RW: 'R' };   // 나머지는 좌우가 없다

  // 좌우를 묻던 시절에 들어온 값. 통합된 자리로 옮겨 받는다.
  const LEGACY_POS = { LB: 'SB', RB: 'SB', LW: 'WG', RW: 'WG' };
  const FIELD_MAX = 11;                      // 필드에 올릴 수 있는 인원

  // 포메이션 슬롯: [포지션, x, y]. x 0=왼쪽 1=오른쪽, y 0=상대 골대 1=우리 골대.
  // 말은 이 자리에서 시작해 어디로든 끌 수 있다 — 슬롯은 출발점일 뿐이다.
  const mk = (id, slots) => ({ id, slots: slots.map(([role, x, y]) => ({ role, x, y })) });
  const BACK4 = [['LB', .14, .74], ['CB', .38, .77], ['CB', .62, .77], ['RB', .86, .74]];
  const FORMATIONS = [
    mk('4-4-2', [['GK', .5, .92], ...BACK4,
      ['LW', .12, .50], ['CM', .38, .54], ['CM', .62, .54], ['RW', .88, .50],
      ['ST', .37, .22], ['ST', .63, .22]]),
    mk('4-3-3', [['GK', .5, .92], ...BACK4,
      ['CM', .28, .50], ['DM', .50, .60], ['CM', .72, .50],
      ['LW', .15, .24], ['ST', .50, .17], ['RW', .85, .24]]),
    mk('4-2-3-1', [['GK', .5, .92], ...BACK4,
      ['DM', .36, .60], ['DM', .64, .60],
      ['LW', .14, .38], ['AM', .50, .40], ['RW', .86, .38],
      ['ST', .50, .16]]),
    mk('4-1-4-1', [['GK', .5, .92], ...BACK4,
      ['DM', .50, .62],
      ['LW', .12, .42], ['CM', .38, .45], ['CM', .62, .45], ['RW', .88, .42],
      ['ST', .50, .17]]),
    mk('4-3-2-1', [['GK', .5, .92], ...BACK4,
      ['CM', .28, .58], ['DM', .50, .62], ['CM', .72, .58],
      ['AM', .30, .36], ['AM', .70, .36],
      ['ST', .50, .16]]),
    mk('3-5-2', [['GK', .5, .92],
      ['CB', .24, .77], ['CB', .50, .79], ['CB', .76, .77],
      ['LW', .09, .50], ['CM', .31, .54], ['DM', .50, .61], ['CM', .69, .54], ['RW', .91, .50],
      ['ST', .37, .22], ['ST', .63, .22]]),
    mk('3-4-3', [['GK', .5, .92],
      ['CB', .24, .77], ['CB', .50, .79], ['CB', .76, .77],
      ['LW', .12, .52], ['CM', .38, .55], ['CM', .62, .55], ['RW', .88, .52],
      ['LW', .17, .24], ['ST', .50, .17], ['RW', .83, .24]]),
    mk('5-3-2', [['GK', .5, .92],
      ['LB', .09, .66], ['CB', .29, .77], ['CB', .50, .79], ['CB', .71, .77], ['RB', .91, .66],
      ['CM', .30, .52], ['DM', .50, .57], ['CM', .70, .52],
      ['ST', .37, .22], ['ST', .63, .22]]),
  ];
  const FORMATION_BY_ID = Object.fromEntries(FORMATIONS.map(f => [f.id, f]));

  // 포지션 사이의 거리 — 적어 낸 자리가 아니어도 "가까운 자리"는 있다.
  const NEAR = [['CB', 'SB'], ['CB', 'DM'], ['SB', 'DM'], ['SB', 'WG'],
    ['DM', 'CM'], ['CM', 'AM'], ['AM', 'ST'],
    ['WG', 'AM'], ['WG', 'CM'], ['WG', 'ST']];
  const DIST = (() => {
    const adj = Object.fromEntries(POS_IDS.map(p => [p, []]));
    for (const [a, b] of NEAR) { adj[a].push(b); adj[b].push(a); }
    const out = {};
    for (const s of POS_IDS) {
      out[s] = { [s]: 0 };
      const q = [s];
      while (q.length) {
        const c = q.shift();
        for (const n of adj[c]) if (!(n in out[s])) { out[s][n] = out[s][c] + 1; q.push(n); }
      }
    }
    return out;
  })();

  // 선수 한 명을 슬롯 하나(role)에 세울 때의 어색함. 낮을수록 잘 맞는다.
  //   적어 낸 포지션: 순위(0,1,2) / 안 적었지만 가까운 자리: 3~ / 골키퍼가 아닌데 GK 자리: 50
  //
  // **적어 낸 자리가 아니어도 배치된다** — 값이 커질 뿐 막지 않는다 (총무 확인 2026-10-17).
  // 인원을 맞추려면 누군가는 낯선 자리에 서야 하고, 조기축구에선 그게 정상이다.
  // 아무도 안 적어 낸 자리도 비워두지 않고 가장 덜 어색한 사람을 세운다.
  //
  // 좌우(LB/RB, LW/RW)는 주발로 가늠한다. 차이를 아주 작게 둔 것은 일부러다 —
  // 발 때문에 포지션이 맞는 사람을 제치고 엉뚱한 사람이 서면 안 된다.
  function fitCost(positions, role, foot) {
    const want = SLOT_TO_POS[role] || role;
    let base;
    if (!positions || !positions.length) base = role === 'GK' ? 60 : 20;
    else {
      const at = positions.indexOf(want);
      if (at >= 0) base = at;
      else {
        let best = Infinity;
        for (const p of positions) {
          const d = DIST[p] && DIST[p][want];
          if (d != null && d + 2 < best) best = d + 2;
        }
        base = best === Infinity ? 50 : best;
      }
    }
    const side = SLOT_SIDE[role];
    if (side && base < 50 && (foot === 'L' || foot === 'R'))
      base += (foot === side ? -0.2 : 0.4);     // 양발(B)과 모름은 그대로 둔다
    return base;
  }

  // 말을 포메이션 슬롯에 자동으로 앉힌다. 가장 잘 맞는 짝부터 확정하는 방식이라
  // 최선은 아니어도 감독이 조금만 고치면 되는 수준으로 나온다.
  //   members: 후보 이름 배열 (앞쪽일수록 먼저 고려)   posOf(name): 포지션 id 배열
  //   footOf(name): 주발 L/R/B/null — 안 주면 좌우를 따지지 않는다
  // 반환: { 이름: {x, y}, ... } — 최대 11명
  function autoLayout(formationId, members, posOf, footOf) {
    const f = FORMATION_BY_ID[formationId];
    if (!f) return {};
    const pairs = [];
    members.forEach((m, mi) => {
      const pos = posOf(m) || [];
      const foot = footOf ? footOf(m) : null;
      f.slots.forEach((s, si) => pairs.push({ m, si, mi, c: fitCost(pos, s.role, foot) }));
    });
    pairs.sort((a, b) => a.c - b.c || a.mi - b.mi || a.si - b.si);
    const usedM = new Set(), usedS = new Set(), out = {};
    for (const p of pairs) {
      if (usedM.has(p.m) || usedS.has(p.si)) continue;
      usedM.add(p.m); usedS.add(p.si);
      out[p.m] = { x: f.slots[p.si].x, y: f.slots[p.si].y };
    }
    return out;
  }

  const clamp01 = n => Math.min(1, Math.max(0, n));
  const round3 = n => Math.round(n * 1000) / 1000;

  // 서버가 받은 말 위치를 검증한다. 팀원이 아닌 이름·범위 밖 좌표는 거부한다.
  function cleanPieces(pieces, members) {
    if (!pieces || typeof pieces !== 'object' || Array.isArray(pieces))
      throw new Error('말 위치 형식이 올바르지 않습니다.');
    const set = new Set(members), out = {};
    const keys = Object.keys(pieces);
    if (keys.length > FIELD_MAX) throw new Error(`필드에는 ${FIELD_MAX}명까지 올릴 수 있습니다.`);
    for (const k of keys) {
      if (!set.has(k)) throw new Error('팀원이 아닌 선수는 올릴 수 없습니다.');
      const p = pieces[k];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' ||
          !Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw new Error('말 위치 형식이 올바르지 않습니다.');
      out[k] = { x: round3(clamp01(p.x)), y: round3(clamp01(p.y)) };
    }
    return out;
  }

  // 회원이 낸 포지션 목록 검증: 1~3개, 중복 없음, 정해진 id만.
  // 좌우를 묻던 시절의 LB/RB/LW/RW는 통합된 자리로 옮겨 받는다. 그러다 둘이 한 자리로
  // 겹치면(LB+RB) 하나로 줄인다 — 거부할 일이 아니다.
  function cleanPositions(list) {
    if (!Array.isArray(list)) throw new Error('포지션을 골라주세요.');
    if (list.length < 1 || list.length > MAX_POS)
      throw new Error(`포지션은 1~${MAX_POS}개를 골라주세요.`);
    if (new Set(list).size !== list.length) throw new Error('같은 포지션을 두 번 고르셨습니다.');
    const out = [];
    for (const p of list) {
      const v = LEGACY_POS[p] || p;
      if (!POS_IDS.includes(v)) throw new Error('포지션 값이 올바르지 않습니다.');
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  // 주발 검증. 고르지 않아도 된다 — 좌우를 안 따질 뿐이다.
  function cleanFoot(v) {
    if (v == null || v === '') return null;
    const s = String(v).toUpperCase();
    if (!FOOT_IDS.includes(s)) throw new Error('주발 값이 올바르지 않습니다.');
    return s;
  }

  return {
    POSITIONS, POS_IDS, MAX_POS, FIELD_MAX, FORMATIONS, FORMATION_BY_ID,
    FEET, FOOT_IDS, SLOT_TO_POS, SLOT_SIDE, LEGACY_POS,
    fitCost, autoLayout, cleanPieces, cleanPositions, cleanFoot,
  };
});
