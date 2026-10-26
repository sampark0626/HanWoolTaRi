// 유니폼 번호 · 사이즈 — 회원 탭과 총무 탭.
//
// 번호는 서버가 SSE로 밀어주는 스냅샷을 그대로 그린다. 화면이 번호의 상태를 따로 계산해 저장하지 않는다 —
// 누가 번호를 바꾸면 다른 사람 화면의 칸이 곧바로 바뀌고(잠김→비움, 비움→잠김), 바뀐 칸은 잠깐 반짝인다.
//
//   UN.open({ root, voter, code, key, needCode, ver, onSnap })   회원 탭을 열고 실시간을 붙인다
//   UN.close()                                                   탭을 떠날 때 — 연결을 끊는다
//   UN.openAdmin({ root, key, onView }) / UN.closeAdmin()        총무 탭
//   UN.fetchPublic()                                             대시보드 카드용 (로그인 없이 되는 요약)
//
// 칸의 상태 (색):  free 비어 있음 · own 내 번호 · tie 기존 번호가 겹침(내가 당사자)
//                 taken 활동 회원이 쓰는 중(못 고름) · soft 휴면 회원 번호(가져갈 수 있음)
window.UN = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, path, body, key) {
    const url = path + (key ? (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : '');
    const r = await fetch(url, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || '요청에 실패했습니다.'); e.status = r.status; throw e; }
    return j;
  }

  // 실시간 연결. 브라우저가 알아서 다시 붙지만, 서버가 연결 자체를 거절하면(CLOSED) 우리가 다시 건다.
  // 끊긴 채로 오래 가면 15초마다 직접 불러와서 놓친 변화를 메운다.
  function connect(onSnap, onState) {
    let es = null, stopped = false, retry = null;
    const open = () => {
      if (stopped) return;
      es = new EventSource('/api/uniform/stream');
      es.addEventListener('snap', e => { try { onSnap(JSON.parse(e.data)); } catch (_) { /* 무시 */ } });
      es.onopen = () => onState(true);
      es.onerror = () => {
        onState(false);
        if (es.readyState === 2) { clearTimeout(retry); retry = setTimeout(open, 3000); }
      };
    };
    open();
    const poll = setInterval(async () => {
      if (es && es.readyState === 1) return;
      try { onSnap(await api('GET', '/api/uniform')); } catch (_) { /* 다음에 */ }
    }, 15000);
    return () => { stopped = true; clearTimeout(retry); clearInterval(poll); if (es) es.close(); };
  }

  const newer = (cur, s) => !(cur && cur.boot === s.boot && s.seq < cur.seq);   // 오래된 스냅샷은 버린다

  // 큰 그림으로 보기 (확정 유니폼)
  function lightbox(src, name) {
    const z = $('wzoom'); if (!z) return;
    $('wzimg').src = src; $('wzimg').alt = name; $('wzname').textContent = name;
    z.hidden = false; document.body.style.overflow = 'hidden';
  }
  document.addEventListener('click', e => {
    const z = $('wzoom');
    if (!z || z.hidden) return;
    if (e.target.id === 'wzoom' || e.target.closest('#wzclose')) { z.hidden = true; document.body.style.overflow = ''; }
  });

  // ================= 회원 탭 =================
  let M = null;      // { root, voter, code, key, needCode, ver, onSnap, stop, S, ME, sel, busy, live, prev, three }

  function open(o) {
    close();
    M = { ...o, S: null, ME: null, sel: null, busy: false, live: false, prev: null, meErr: '' };
    build();
    M.stop = connect(applySnap, on => { M.live = on; paintLive(); });
    loadAll();
  }

  function close() {
    if (M && M.stop) M.stop();
    M = null;
  }

  function build() {
    M.root.innerHTML = `
      <section id="unWin" class="un-win" hidden></section>
      <p class="eyebrow">한울타리 FC</p>
      <h2>번호 · 사이즈</h2>
      <p class="un-live" id="unLive"><i></i><span>불러오는 중…</span></p>
      <div class="un-prog" id="unProg"></div>
      <p class="note un-note" id="unNote" hidden></p>
      <section class="un-me" id="unMe"></section>

      <h3 class="sub">번호 고르기 <span class="sleg">0~99는 아래 표, 세 자리는 입력</span></h3>
      <div class="un-legend">
        <span><i class="un-k own"></i>내 번호</span>
        <span><i class="un-k free"></i>선택 가능</span>
        <span><i class="un-k taken"></i>사용 중</span>
        <span><i class="un-k soft"></i>휴면 회원 번호 · 가져올 수 있음</span>
      </div>
      <div class="un-grid" id="unGrid" role="group" aria-label="0부터 99까지 번호"></div>
      <div class="un-three">
        <label for="unThree">세 자리 번호</label>
        <input id="unThree" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="100~999">
      </div>
      <div class="un-used" id="unUsed"></div>

      <h3 class="sub">사이즈</h3>
      <div class="un-sizes" id="unSizes" role="group" aria-label="사이즈 고르기"></div>
      <p class="un-sizehint" id="unSizeHint" hidden></p>
      <p class="hintline muted">사이즈표는 업체 기준입니다. 헷갈리면 입던 옷의 사이즈를 따르세요.</p>

      <details class="un-all"><summary>회원별 번호 보기</summary><div id="unList"></div></details>
      <div class="un-toast" id="unToast" hidden></div>
      <div class="un-bar" id="unBar" hidden></div>`;

    $('unGrid').innerHTML = Array.from({ length: 100 }, (_, n) =>
      `<button type="button" class="un-n free" data-n="${n}">${n}</button>`).join('');
    $('unGrid').addEventListener('click', e => {
      const b = e.target.closest('.un-n'); if (b) pick(+b.dataset.n);
    });
    $('unUsed').addEventListener('click', e => {
      const b = e.target.closest('[data-n]'); if (b) pick(+b.dataset.n);
    });
    $('unThree').addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 3);
      e.target.value = v;
      if (v.length === 3 && +v >= 100) pick(+v, true);
      else if (!v.length) { M.sel = null; paintBar(); }
    });
    $('unThree').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    $('unSizes').addEventListener('click', e => {
      const b = e.target.closest('.un-size'); if (b) setSize(b.dataset.s);
    });
    $('unSizeHint').addEventListener('click', e => {
      const b = e.target.closest('[data-act="size-ok"]'); if (b && !b.disabled && M.ME) setSize(M.ME.size);
    });
    $('unMe').addEventListener('click', e => {
      if (e.target.closest('[data-act="release"]')) release();
    });
    $('unBar').addEventListener('click', e => {
      if (e.target.closest('[data-act="close"]')) { M.sel = null; $('unThree').value = ''; paintGrid(); paintBar(); }
      const go = e.target.closest('[data-act="claim"]');
      if (go && !go.disabled) claim(M.sel);
    });
  }

  async function loadAll() {
    const mine = M;
    try {
      const [s] = await Promise.all([api('GET', '/api/uniform'), loadMe()]);
      if (M !== mine) return;
      applySnap(s);
    } catch (e) {
      if (M === mine) { $('unLive').lastElementChild.textContent = '불러오지 못했습니다. 잠시 뒤에 다시 열어 주세요.'; }
    }
  }

  // 내 정보(사이즈 포함)는 본인 확인을 거쳐야 받는다.
  async function loadMe() {
    const mine = M;
    if (!mine.key && mine.needCode && !/^\d{4}$/.test(mine.code)) { mine.ME = null; return; }
    try {
      const j = await api('POST', '/api/uniform/mine', { member: mine.voter, code: mine.code }, mine.key);
      if (M === mine) { mine.ME = j.me; mine.meErr = ''; }
    } catch (e) {
      if (M === mine) { mine.ME = null; mine.meErr = e.message; }
    }
    // 내 정보는 스냅샷과 따로 도착한다. 실시간 첫 스냅샷이 먼저 와서 조회 결과가 「오래된 것」으로 버려져도
    // 내 정보 쪽은 늦게라도 반드시 다시 그린다.
    if (M === mine && mine.S) { paintNote(); paintMe(); paintSizes(); paintBar(); }
  }

  // ---------- 상태 → 그림 ----------
  function applySnap(s) {
    if (!M || !newer(M.S, s)) return;
    const before = M.S && mineOf(M.S);
    M.prev = M.S ? classes(M.S) : null;
    M.S = s;
    if (M.onSnap) M.onSnap(s);
    paintAll();
    // 내 번호가 내 손을 거치지 않고 바뀌었으면(휴면 번호를 빼앗김 등) 내 정보를 다시 받는다
    const now = mineOf(s);
    if (before && now && (before.n !== now.n || before.k !== now.k)) loadMe();
  }

  const mineOf = s => s.members.find(m => m.v === M.voter);

  // 번호 → 칸 상태. 활동 회원이 쓰는 번호는 taken, 내가 쥔 번호는 mine/tie, 휴면 회원만 쥔 번호는 soft.
  function classes(s) {
    const by = new Map();
    for (const m of s.members) if (m.n != null) { if (!by.has(m.n)) by.set(m.n, []); by.get(m.n).push(m); }
    const out = new Map();
    for (const [n, list] of by) {
      const me = list.find(m => m.v === M.voter);
      const act = list.filter(m => m.a);
      out.set(n, me ? { c: me.k === 'tie' ? 'tie' : 'own', list }
        : act.length ? { c: 'taken', list: act } : { c: 'soft', list });
    }
    return out;
  }
  const stateOf = n => (M.S && classes(M.S).get(n)) || { c: 'free', list: [] };

  // 쓰기를 막는 이유. 비어 있으면 쓸 수 있다.
  function blocked() {
    if (M.key) return '';
    if (M.S && M.S.locked) return '접수가 마감되어 바꿀 수 없습니다. 바꿀 일이 있으면 총무에게 문의해 주세요.';
    if (M.needCode && !/^\d{4}$/.test(M.code)) return '본인 확인이 안 되어 보기만 할 수 있습니다. 처음 화면에서 이름을 다시 골라 번호를 눌러 주세요.';
    if (!M.ME && M.meErr) return M.meErr;
    return '';
  }

  function paintAll() {
    paintLive(); paintWinner(); paintProg(); paintNote(); paintMe(); paintGrid(); paintUsed(); paintSizes(); paintList(); paintBar();
  }

  function paintLive() {
    const el = $('unLive'); if (!el) return;
    el.classList.toggle('on', !!M.live);
    el.lastElementChild.textContent = M.live ? '실시간으로 반영 중' : (M.S ? '연결이 끊겼습니다 · 다시 붙는 중' : '불러오는 중…');
  }

  function paintWinner() {
    const el = $('unWin'), w = M.S && M.S.winner;
    if (!w) { el.hidden = true; return; }
    const src = `/kits/lg/${w.id}.jpg?v=${M.ver || ''}`;
    el.hidden = false;
    el.innerHTML = `
      <button type="button" class="un-winpic" aria-label="${esc(w.name)} 크게 보기"><img src="${src}" alt="${esc(w.name)}"></button>
      <div class="un-wintxt">
        <small>${w.by === 'admin' ? '총무가 정한 유니폼' : '회원 투표 1위'}</small>
        <b>${esc(w.name)}</b>
        <span>이 유니폼으로 주문합니다. 번호와 사이즈를 정해 주세요.</span>
      </div>`;
    el.querySelector('.un-winpic').onclick = () => lightbox(src, w.name);
  }

  function paintProg() {
    const p = M.S.progress, pct = p.active ? Math.round(p.done / p.active * 100) : 0;
    $('unProg').innerHTML = `활동 회원 ${p.active}명 중 <b>${p.done}명</b>이 번호와 사이즈를 정했습니다
      <div class="adbar"><i style="width:${pct}%"></i></div>`;
  }

  function paintNote() {
    const n = $('unNote'), why = blocked();
    n.hidden = !why;
    n.textContent = why;
  }

  function paintMe() {
    const el = $('unMe'), ME = M.ME;
    if (!ME) {                     // 이유는 위쪽 안내(unNote) 한 곳에만 적는다
      el.innerHTML = `<p class="note">${blocked() ? '본인 확인이 되면 내 번호와 사이즈가 여기에 보입니다.' : '내 정보를 불러오는 중…'}</p>`;
      return;
    }
    const n = ME.number, ok = ME.status === 'held';
    let chip = '아직 없음', msg = '';
    if (ME.status === 'lost') { chip = '다시 골라야 함'; msg = `기존 ${ME.lostNumber}번을 다른 활동 회원이 쓰고 있어 새 번호를 골라야 합니다.`; }
    else if (ME.status === 'tie') { chip = '겹침'; msg = `기존 ${n}번이 다른 분과 겹칩니다. 먼저 확정하는 분이 가져갑니다. 아래에서 ${n}번을 눌러 확정하세요.`; }
    else if (n != null) chip = ME.src === 'seed' ? '기존 번호 · 유지 중' : '내가 정한 번호';
    if (ME.displaced) {
      const by = M.S.members.find(m => m.v === ME.displaced.by);
      msg = `${ME.displaced.n}번을 ${esc(by ? by.l : ME.displaced.by)} 님이 가져갔습니다.` +
        `${ME.active ? '' : ' 휴면 회원의 번호는 보호되지 않습니다.'} 새 번호를 골라 주세요.`;
    }
    const todo = [];
    if (!ok) todo.push('번호');
    if (!ME.size) todo.push('사이즈');
    else if (ME.sizeSrc === 'seed') todo.push('사이즈 확인');
    el.innerHTML = `
      <div class="un-mehead">
        <div class="un-big${n == null ? ' none' : ''}">${n == null ? '—' : n}</div>
        <div>
          <b>내 번호</b>
          <span class="un-chip ${ME.status === 'held' && n != null ? 'ok' : ME.status ? 'warn' : ''}">${chip}</span>
        </div>
        ${n != null && !blocked() ? '<button type="button" class="un-mini" data-act="release">번호 놓기</button>' : ''}
      </div>
      ${msg ? `<p class="un-msg">${esc(msg)}</p>` : ''}
      ${ME.active ? '' : '<p class="un-msg soft">휴면 회원으로 되어 있어 번호가 보장되지 않습니다. 활동 회원이 가져갈 수 있습니다.</p>'}
      <p class="un-todo${todo.length ? '' : ' done'}">${todo.length ? '남은 일 — ' + todo.join(' · ') : '번호와 사이즈를 모두 정하셨습니다 ✓'}</p>`;
  }

  function paintGrid() {
    const cls = classes(M.S), cells = $('unGrid').children, prevMap = M.prev;
    M.prev = null;                                         // 반짝임은 새 스냅샷 한 번에만 — 칸을 눌러 다시 그릴 때는 없다
    for (let n = 0; n < 100; n++) {
      const b = cells[n], c = (cls.get(n) || { c: 'free' }).c;
      const prev = prevMap ? (prevMap.get(n) || { c: 'free' }).c : c;
      b.className = `un-n ${c}${M.sel === n ? ' sel' : ''}`;
      b.setAttribute('aria-disabled', c === 'taken' ? 'true' : 'false');
      b.title = c === 'taken' ? `${cls.get(n).list[0].l} 님 사용 중` : '';
      if (prev !== c) {                                    // 방금 바뀐 칸은 잠깐 반짝인다
        b.classList.add('flash');
        setTimeout(() => b.classList.remove('flash'), 1600);
      }
    }
  }

  // 세 자리 번호는 표에 없으니, 이미 쓰는 번호를 칩으로 보여준다
  function paintUsed() {
    const cls = classes(M.S), big = [...cls.entries()].filter(([n]) => n >= 100).sort((a, b) => a[0] - b[0]);
    $('unUsed').innerHTML = big.length
      ? '쓰는 세 자리: ' + big.map(([n, v]) =>
        `<button type="button" class="un-chipn ${v.c}${M.sel === n ? ' sel' : ''}" data-n="${n}">${n}<small>${esc(v.list[0].l)}</small></button>`).join('')
      : '';
  }

  function paintSizes() {
    // 총무가 미리 넣어 둔 기존 사이즈는 점선으로 골라져 있다 — 본인이 맞다고 눌러야 확인된다
    const cur = M.ME && M.ME.size, seed = !!(cur && M.ME.sizeSrc === 'seed'), off = !!blocked();
    $('unSizes').innerHTML = M.S.sizes.map(s =>
      `<button type="button" class="un-size${cur === s ? ' on' : ''}${cur === s && seed ? ' seed' : ''}" data-s="${esc(s)}" aria-pressed="${cur === s}"${off ? ' disabled' : ''}>${esc(s)}</button>`).join('');
    const h = $('unSizeHint');
    h.hidden = !seed;
    h.innerHTML = seed
      ? `<span>이전 시트의 사이즈 <b>${esc(cur)}</b>로 미리 채워 두었습니다. 지금도 맞는지 확인해 주세요.</span>
         <button type="button" class="un-mini ok" data-act="size-ok"${off ? ' disabled' : ''}>맞아요</button>`
      : '';
  }

  function paintList() {
    const ms = M.S.members.slice();
    const has = ms.filter(m => m.n != null).sort((a, b) => a.n - b.n || a.l.localeCompare(b.l, 'ko'));
    const no = ms.filter(m => m.n == null).sort((a, b) => (b.a - a.a) || a.l.localeCompare(b.l, 'ko'));
    const row = m => `<li class="${m.a ? '' : 'off'}${m.v === M.voter ? ' me' : ''}">
      <b class="un-ln">${m.n == null ? '—' : m.n}</b><span>${esc(m.l)}</span>
      ${m.a ? '' : '<em>휴면</em>'}${m.k === 'tie' ? '<em class="w">겹침</em>' : ''}${m.a && m.d ? '<i class="un-ck">✓</i>' : ''}</li>`;
    $('unList').innerHTML = `<ul class="un-ul">${has.map(row).join('')}</ul>
      ${no.length ? `<p class="sub">번호가 없는 분 ${no.length}명</p><ul class="un-ul">${no.map(row).join('')}</ul>` : ''}`;
  }

  // ---------- 고르기 ----------
  function pick(n, fromInput) {
    M.sel = n;
    if (!fromInput) $('unThree').value = n >= 100 ? String(n) : '';
    paintGrid(); paintUsed(); paintBar();
  }

  // 아래 고정 막대: 누른 번호의 상태와, 할 수 있는 일
  function paintBar() {
    const bar = $('unBar'), n = M.sel;
    if (n == null) { bar.hidden = true; M.root.classList.remove('un-withbar'); return; }
    const st = stateOf(n), who = st.list[0] ? st.list[0].l : '', why = blocked();
    let text, btn = '', dis = !!why || M.busy;
    if (st.c === 'free') { text = '비어 있습니다'; btn = '이 번호로 정하기'; }
    else if (st.c === 'soft') {
      text = `휴면 회원 <b>${esc(who)}</b> 님의 번호입니다. 가져오면 ${esc(who)} 님에게서 빠집니다.`; btn = '가져오기';
    } else if (st.c === 'own') { text = '지금 내 번호입니다'; btn = ''; }
    else if (st.c === 'tie') { text = '기존 번호가 다른 분과 겹칩니다. 먼저 확정하는 분이 가져갑니다.'; btn = '내 번호로 확정'; }
    else { text = `<b>${esc(who)}</b> 님이 쓰는 번호라 고를 수 없습니다`; btn = ''; }
    bar.hidden = false;
    M.root.classList.add('un-withbar');
    bar.innerHTML = `<div class="un-barnum ${st.c}">${n}</div>
      <p>${text}${why && btn ? '<br><small>지금은 고를 수 없습니다 (위 안내 참고)</small>' : ''}</p>
      ${btn ? `<button type="button" class="primary" data-act="claim"${dis ? ' disabled' : ''}>${M.busy ? '처리 중…' : btn}</button>` : ''}
      <button type="button" class="un-x" data-act="close" aria-label="닫기">✕</button>`;
  }

  function toast(msg, bad) {
    const t = $('unToast'); if (!t) return;
    t.textContent = msg; t.className = 'un-toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // 번호·사이즈를 바꾸는 요청은 한 틀이다: 요청 → 내 정보 갱신 → 최신 스냅샷
  async function send(path, body, okMsg) {
    if (M.busy) return false;
    const mine = M;
    M.busy = true; paintBar();
    let ok = false;
    try {
      const j = await api('POST', path, { member: mine.voter, code: mine.code, ...body }, mine.key);
      if (M !== mine) return true;
      mine.ME = j.me; ok = true;
      if (okMsg) toast(okMsg);
    } catch (e) {
      if (M === mine) toast(e.message, true);
    }
    if (M !== mine) return ok;
    mine.busy = false;
    try { applySnap(await api('GET', '/api/uniform')); } catch (_) { /* 실시간이 곧 메운다 */ }
    if (M === mine) { paintMe(); paintSizes(); paintBar(); }
    return ok;
  }

  async function claim(n) {
    if (await send('/api/uniform/claim', { number: n }, `${n}번으로 정했습니다`)) {
      M.sel = null; $('unThree').value = ''; paintGrid(); paintUsed(); paintBar();
    }
  }

  async function release() {
    const n = M.ME && M.ME.number;
    if (n == null || !confirm(`${n}번을 놓을까요?\n놓으면 다른 분이 바로 가져갈 수 있습니다.`)) return;
    await send('/api/uniform/release', {}, `${n}번을 놓았습니다`);
  }

  async function setSize(s) {
    const cur = M.ME && M.ME.size, seed = !!(M.ME && M.ME.sizeSrc === 'seed');
    // 직접 고른 사이즈를 다시 누르면 지운다. 미리 채워 둔 사이즈를 누르면 「맞다」는 확인이다.
    const clear = cur === s && !seed;
    await send('/api/uniform/size', { size: clear ? null : s },
      clear ? '사이즈를 지웠습니다' : cur === s ? `사이즈 ${s}로 확인했습니다` : `사이즈 ${s}로 저장했습니다`);
  }

  // ================= 총무 탭 =================
  let A = null;      // { root, key, onView, T, stop, filter, timer }

  function openAdmin(o) {
    closeAdmin();
    A = { ...o, T: null, filter: 'all', timer: null };
    A.root.innerHTML = '<p class="note">불러오는 중…</p>';
    A.stop = connect(() => { clearTimeout(A && A.timer); if (A) A.timer = setTimeout(loadAdmin, 300); }, () => {});
    loadAdmin();
  }
  function closeAdmin() {
    if (A) { clearTimeout(A.timer); if (A.stop) A.stop(); }
    A = null;
  }

  async function loadAdmin() {
    const mine = A; if (!mine) return;
    try {
      const t = await api('GET', '/api/uniform/admin/table', undefined, mine.key);
      if (A !== mine) return;
      mine.T = t; paintAdmin();
    } catch (e) {
      if (A === mine) mine.root.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }

  const KIND = { pick: '직접 선택', seed: '기존 번호', tie: '겹침', lost: '다시 골라야 함', '': '' };

  // 실시간으로 표가 다시 그려져도 쓰던 것이 사라지면 안 된다 — 펼친 칸, 붙여넣던 글, 고르던 유니폼을 지킨다.
  // 글을 쓰는 중이면 그리지 않고 미뤘다가 입력칸에서 나올 때 그린다.
  function paintAdmin() {
    const root = A.root, ae = document.activeElement;
    if (ae && root.contains(ae) && /^(TEXTAREA|SELECT|INPUT)$/.test(ae.tagName)) { A.dirty = true; return; }
    A.dirty = false;
    const open = [...root.querySelectorAll('details')].map(d => d.open);
    const texts = ['unSeedTxt', 'unSizeTxt'].map(id => [id, $(id) ? $(id).value : '']);
    const sel = $('unWinSel'), win = sel ? sel.value : null;
    drawAdmin();
    [...root.querySelectorAll('details')].forEach((d, i) => { if (open[i]) d.open = true; });
    for (const [id, v] of texts) if (v && $(id)) $(id).value = v;
    if (win != null && $('unWinSel')) $('unWinSel').value = win;
    if (A.seedHtml && $('unSeedOut')) $('unSeedOut').innerHTML = A.seedHtml;
    if (A.sizeHtml && $('unSizeOut')) $('unSizeOut').innerHTML = A.sizeHtml;
  }

  function drawAdmin() {
    const T = A.T, rows = T.rows;
    const act = rows.filter(r => r.a), done = act.filter(r => r.d).length;
    const f = A.filter;
    const list = rows.filter(r => f === 'all' || (f === 'act' ? r.a : f === 'off' ? !r.a : (r.a && !r.d)))
      .sort((a, b) => (b.a - a.a) || ((a.n == null) - (b.n == null)) || (a.n - b.n) || a.l.localeCompare(b.l, 'ko'));
    const sizeChips = T.sizes.map(s => `<span class="un-sz"><b>${esc(s)}</b>${T.sizeActive[s]}${T.sizeAll[s] !== T.sizeActive[s] ? `<small>(+${T.sizeAll[s] - T.sizeActive[s]})</small>` : ''}</span>`).join('');
    const pct = act.length ? Math.round(done / act.length * 100) : 0;
    const winnerOpts = ['<option value="">자동 (투표 1위)</option>']
      .concat(T.kits.map(k => `<option value="${k.id}"${T.winnerSet === k.id ? ' selected' : ''}>${esc(k.name)}</option>`)).join('');
    A.root.innerHTML = `
      <div class="adprog">활동 ${act.length}명 중 <b>${done}명</b>이 번호와 사이즈를 정했습니다
        <div class="adbar"><i style="width:${pct}%"></i></div></div>
      <p class="sub">사이즈별 인원 <span class="sleg">활동 회원 · 확인 전인 기존 사이즈 포함 · 괄호는 휴면 포함 추가분</span></p>
      <div class="un-szrow">${sizeChips}</div>
      ${T.unverifiable.length ? `<p class="note">연락처가 없어 본인 확인이 안 되는 회원: ${T.unverifiable.map(esc).join(', ')} — 아무 4자리나 통과하므로 직접 확인해 주세요.</p>` : ''}

      <div class="un-adctl">
        <button type="button" class="ghost" data-a="lock">${T.locked ? '접수 다시 열기' : '접수 마감하기'}</button>
        <button type="button" class="ghost" data-a="csv">표 내려받기 (CSV)</button>
        <button type="button" class="ghost" data-a="copy">표 복사 (엑셀에 붙여넣기)</button>
      </div>
      <p class="note">${T.locked ? '지금 <b>마감</b> 상태입니다. 회원은 바꿀 수 없고 총무만 바꿀 수 있습니다.' : '접수 중입니다. 주문 전에 마감하면 그 뒤로는 총무만 바꿀 수 있습니다.'}</p>

      <details class="un-det"><summary>확정 유니폼 지정</summary>
        <p class="note">기본은 투표 1위가 자동으로 나옵니다${T.winnerAuto ? ` (지금 1위: ${esc(T.winnerAuto.name)})` : T.voteClosed ? ' (집계된 표가 없습니다)' : ' (투표가 아직 열려 있어 1위를 보여주지 않습니다)'}. 다르게 정했다면 여기서 고르세요.</p>
        <select id="unWinSel" class="adinput">${winnerOpts}</select>
        <button type="button" class="ghost" data-a="winner">저장</button>
      </details>

      <details class="un-det"><summary>기존 번호 가져오기</summary>
        <p class="note">한 줄에 한 명씩 <b>이름 번호</b>로 붙여넣으세요 (예: <code>홍길동 7</code>). 번호 자리에 <code>-</code>를 쓰면 기존 번호를 지웁니다.
          이름은 명부에 있는 이름이어야 합니다. 이미 번호를 직접 고른 회원은 그대로 둡니다. 명단은 저장소에 올라가지 않고 서버 DB에만 남습니다.</p>
        <textarea id="unSeedTxt" class="adinput un-ta" rows="7" placeholder="홍길동 7&#10;김철수 10"></textarea>
        <button type="button" class="ghost" data-a="seed">가져오기</button>
        <div id="unSeedOut"></div>
      </details>

      <details class="un-det"><summary>기존 사이즈 가져오기</summary>
        <p class="note">한 줄에 한 명씩 <b>이름 사이즈</b>로 붙여넣으세요 (예: <code>홍길동 XXL</code>). 시트 표기 <code>XXL</code>·<code>XXXL</code>은 <code>2XL</code>·<code>3XL</code>로 바꿔 받고, 사이즈 자리에 <code>-</code>를 쓰면 기존 사이즈를 지웁니다.
          넣은 사이즈는 회원 화면에 <b>미리 골라진 제안</b>으로 나오고, 본인이 「맞아요」를 누르거나 바꿔야 끝낸 것으로 셉니다. 이미 본인이 사이즈를 정한 회원은 그대로 둡니다.</p>
        <textarea id="unSizeTxt" class="adinput un-ta" rows="7" placeholder="홍길동 XXL&#10;김철수 L"></textarea>
        <button type="button" class="ghost" data-a="sizeseed">가져오기</button>
        <div id="unSizeOut"></div>
      </details>

      <div class="adseg adshow" id="unFilter">
        ${[['all', `전체 ${rows.length}`], ['act', `활동 ${act.length}`], ['off', `휴면 ${rows.length - act.length}`], ['todo', `미완료 ${act.length - done}`]]
        .map(([k, t]) => `<button type="button" data-f="${k}" class="${f === k ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <p class="note">회원을 누르면 그 회원의 번호·사이즈 화면이 열려 대신 고칠 수 있습니다.</p>
      <ul class="tmlist un-adlist">${list.map(r => `
        <li class="${r.a ? '' : 'off'}" data-v="${esc(r.v)}">
          <div><b>${esc(r.l)}${r.a ? '' : ' <em>휴면</em>'}</b>
            <span>${r.n == null ? (r.lost != null ? `기존 ${r.lost}번 · 다시 골라야 함` : '번호 없음') : KIND[r.k] || ''}${r.displaced ? ` · ${r.displaced.n}번을 잃음` : ''}</span></div>
          <div class="un-adval"><strong>${r.n == null ? '—' : r.n}</strong><i class="un-sz1${r.size ? '' : ' none'}${r.sk === 'seed' ? ' seed' : ''}"${r.sk === 'seed' ? ' title="미리 넣은 기존 사이즈 — 본인 확인 전"' : ''}>${r.size || '사이즈 ?'}${r.sk === 'seed' ? '<small>기존</small>' : ''}</i>${r.d ? '<i class="un-ck">✓</i>' : ''}</div>
        </li>`).join('') || '<li class="note">조건에 맞는 회원이 없습니다.</li>'}</ul>

      <details class="un-det"><summary>변경 기록</summary>
        <ul class="un-log">${T.log.map(l => `<li><time>${new Date(l.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time> ${esc(l.text)}</li>`).join('') || '<li>아직 없습니다.</li>'}</ul>
      </details>`;
  }

  function tableText(sep) {
    const T = A.T;
    // 상태 열: 주문서에 옮기기 전에 걸러 볼 수 있게 — 겹친 번호, 다시 골라야 하는 번호, 본인이 아직 확인하지 않은 기존 사이즈를 표시한다
    const head = ['이름', '구분', '번호', '사이즈', '상태'];
    const state = r => (r.k === 'tie' ? '번호 겹침' : r.lost != null ? '번호 다시 골라야 함'
      : r.sk === 'seed' ? '사이즈 확인 전' : r.d ? '완료' : '미완료');
    const rows = T.rows.slice().sort((a, b) => (b.a - a.a) || a.l.localeCompare(b.l, 'ko'))
      .map(r => [r.l, r.a ? '활동' : '휴면', r.n == null ? '' : r.n, r.size || '', state(r)]);
    const cell = v => (sep === ',' && /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [head, ...rows].map(r => r.map(cell).join(sep)).join('\n');
  }

  async function adminClick(e) {
    const mine = A; if (!mine) return;
    const li = e.target.closest('.un-adlist li[data-v]');
    if (li) return mine.onView(li.dataset.v);
    const fb = e.target.closest('#unFilter button[data-f]');
    if (fb) { mine.filter = fb.dataset.f; return paintAdmin(); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === 'lock') {
        await api('POST', '/api/uniform/admin/lock', { locked: !mine.T.locked }, mine.key);
        await loadAdmin();
      } else if (a === 'csv') {
        const url = URL.createObjectURL(new Blob(['﻿' + tableText(',')], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url; link.download = '유니폼_번호_사이즈.csv'; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } else if (a === 'copy') {
        await navigator.clipboard.writeText(tableText('\t'));
        b.textContent = '복사했습니다 ✓';
        setTimeout(() => { b.textContent = '표 복사 (엑셀에 붙여넣기)'; }, 1800);
      } else if (a === 'winner') {
        await api('POST', '/api/uniform/admin/winner', { winner: $('unWinSel').value || null }, mine.key);
        await loadAdmin();
      } else if (a === 'seed') {
        const text = $('unSeedTxt').value;
        if (!text.trim()) return;
        const j = await api('POST', '/api/uniform/admin/seed', { text }, mine.key);
        // 결과는 표가 다시 그려져도 남도록 기억해 둔다. 적용한 글은 비운다.
        mine.seedHtml = `<p class="note"><b>${j.applied}명</b>의 기존 번호를 넣었습니다.</p>` +
          (j.warnings.length ? `<p class="err">확인이 필요합니다</p><ul class="un-log">${j.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '') +
          (j.skipped.length ? `<p class="err">건너뛴 줄</p><ul class="un-log">${j.skipped.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '');
        $('unSeedTxt').value = '';
        $('unSeedTxt').blur();
        await loadAdmin();
      } else if (a === 'sizeseed') {
        const text = $('unSizeTxt').value;
        if (!text.trim()) return;
        const j = await api('POST', '/api/uniform/admin/sizeseed', { text }, mine.key);
        mine.sizeHtml = `<p class="note"><b>${j.applied}명</b>의 기존 사이즈를 넣었습니다.` +
          `${j.own ? ` 그중 ${j.own}명은 이미 본인이 사이즈를 정해서 그대로 둡니다.` : ''}</p>` +
          (j.skipped.length ? `<p class="err">건너뛴 줄</p><ul class="un-log">${j.skipped.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '');
        $('unSizeTxt').value = '';
        $('unSizeTxt').blur();
        await loadAdmin();
      }
    } catch (err) { alert(err.message); }
  }
  document.addEventListener('click', e => { if (A && A.root.contains(e.target)) adminClick(e); });
  document.addEventListener('focusout', () => {
    if (A && A.dirty) setTimeout(() => { if (A && A.dirty) paintAdmin(); }, 0);
  });

  // 대시보드 카드용 — 로그인 없이 받는 요약
  const fetchPublic = () => api('GET', '/api/uniform').catch(() => null);

  return { open, close, openAdmin, closeAdmin, fetchPublic };
})();
