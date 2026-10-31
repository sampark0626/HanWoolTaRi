// 17종을 한 화면에 늘어놓고, 마음에 드는 것을 골라 담는다.
// 고른 순서가 곧 순위다 — 1순위 3점, 2순위 2점, 3순위 1점.
// 대진표는 걷어냈다. 붙는 상대에 따라 결과가 흔들려 공정한 비교가 안 됐다.
(() => {
  const V = '14';          // 이미지를 교체하면 올린다 — 안 올리면 옛 그림이 남는다
  const $ = id => document.getElementById(id);
  const show = id => document.querySelectorAll('.screen')
    .forEach(s => s.classList.toggle('on', s.id === id));

  const C = window.BoardCore;
  const KN = window.KitNum;
  const POSBY = Object.fromEntries(C.POSITIONS.map(p => [p.id, p]));
  // 위(상대 골대)에서 아래(우리 골대)로. 좌우를 안 묻기 때문에 한 줄에 한 자리씩 놓인다.
  const PITCH_ROWS = ['ST', 'WG', 'AM', 'CM', 'DM', 'SB', 'CB', 'GK'];
  const WIDE = { WG: 1, SB: 1 };          // 좌·우를 함께 덮는 자리 — 넓게 그린다

  let CFG = null, BY = {};
  let voter = '', picks = [], zi = 0;
  let me = { pos: [], foot: '' };         // 내 선수 정보
  let MYVOTE = null, BOARD = null;        // 대시보드가 보여줄 현재 상태
  let KIT = null, kitPoll = 0, kitSig = '';   // 등번호 현황 · 실시간 갱신 타이머 · 직전 상태
  let pick = { number: null, size: '', note: null };   // 지금 고르고 있는 등번호·사이즈
  let AKEY = '', ADMIN_EDIT = false;      // 관리자 키(이 탭에서만), 관리자가 남의 자리를 고치는 중인지
  let adTab = 'kit', adTeam = 0, adShow = 'all';
  let ADKIT = null;                       // 총무 화면이 받아 둔 등번호 신청 현황
  let VIEW_AS = false;                    // 총무가 회원 페이지를 대신 열어 보는 중인지
  let homeTab = 'me';                     // 회원 페이지의 탭: me | coach
  let voteClosed = false;                 // 유니폼 투표가 끝났는지 (끝나면 첫 화면의 시계를 치운다)
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sget = k => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const sset = (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } };

  const need = () => (CFG && CFG.picks) || 3;

  // 마감까지 남은 시간. 지나면 투표를 막는다.
  function tick() {
    if (!CFG || !CFG.deadline) return;
    const end = Date.parse(CFG.deadline);
    if (!Number.isFinite(end)) return;
    const el = $('timer'), v = $('tval');
    // 투표가 끝난 뒤에도 「마감되었습니다」를 첫 화면 맨 위에 띄우면, 지금 받고 있는
    // 등번호 신청까지 닫힌 줄 안다. 끝난 투표의 시계는 치운다 (총무 요청 2026-10-28).
    if (voteClosed) { el.hidden = true; return; }
    el.hidden = false;
    // 「오전 12:00」은 자정인지 정오인지 헷갈린다. 24시간제로 적는다.
    const t = new Date(end), p0 = n => String(n).padStart(2, '0');
    $('tdate').textContent =
      `${t.getMonth() + 1}월 ${t.getDate()}일 (${'일월화수목금토'[t.getDay()]}) ` +
      `${p0(t.getHours())}:${p0(t.getMinutes())} 마감`;

    let left = end - Date.now();
    if (left <= 0) {
      el.classList.add('over');
      v.textContent = '마감되었습니다';
      return;                       // 투표가 끝나도 들어오는 것은 막지 않는다
    }
    el.classList.remove('over');
    const d = Math.floor(left / 86400000);
    const h = Math.floor(left / 3600000) % 24;
    const m = Math.floor(left / 60000) % 60;
    const sec = Math.floor(left / 1000) % 60;
    const p2 = n => String(n).padStart(2, '0');
    v.textContent = d > 0
      ? `${d}일 ${p2(h)}:${p2(m)}:${p2(sec)}`
      : `${p2(h)}:${p2(m)}:${p2(sec)}`;
  }

  async function boot() {
    CFG = await (await fetch('/api/config')).json();
    BY = Object.fromEntries(CFG.kits.map(k => [k.id, k]));

    if (CFG.round) $('roundTag').textContent = CFG.round;
    $('pickLabel').textContent = `${need()}개를 골라주세요`;
    tick();
    setInterval(tick, 1000);
    buildNames();
    buildGrid();

    try {
      const s = await (await fetch('/api/status')).json();
      if (s.voters > 0) {
        $('statusNote').textContent =
          `지금까지 ${s.voters}명이 투표했습니다.`;
      }
      if (s.deadline) { CFG.deadline = s.deadline; tick(); }
      if (!s.open) {
        // 투표만 닫힌 것이다. 등번호 신청과 자리 입력은 그대로 되니 그쪽을 가리킨다.
        voteClosed = s.ready !== false;
        tick();
        $('statusNote').textContent = s.ready === false
          ? '아직 준비 중입니다. 조금 뒤에 다시 들어와 주세요.'
          : '유니폼 투표는 끝났습니다. 이름을 누르시면 등번호와 사이즈를 고르실 수 있습니다.';
      }
    } catch (e) { /* 상태 조회 실패가 투표를 막지는 않는다 */ }
    await resume();
  }

  // ---------- 이름 고르기 ----------
  // 쳐서 넣게 하면 동명이인(최지훈S/최지훈B)이 자기 이름을 그대로 쳤다가 거부당한다.
  function buildNames() {
    const box = $('names');
    if (!CFG.roster || !CFG.roster.length) { box.innerHTML = ''; return; }
    const q = $('q').value.trim();
    const list = q ? CFG.roster.filter(m => m.label.includes(q) || m.v.includes(q)) : CFG.roster;
    if (!list.length) {
      box.innerHTML = '<p class="none">그런 이름이 없습니다. 총무에게 문의해 주세요.</p>';
      return;
    }
    let html = '', head = '';
    for (const m of list) {
      if (m.label[0] !== head) { head = m.label[0]; html += `<i class="grp">${head}</i>`; }
      html += `<button type="button" class="nm${voter === m.v ? ' on' : ''}"` +
              ` role="option" aria-selected="${voter === m.v}" data-v="${m.v}">${m.label}</button>`;
    }
    box.innerHTML = html;
  }

  function pickName(v) {
    voter = v;
    buildNames();
    showPin();
  }

  // ---------- 로그인 ----------
  // 이름을 고르면 번호 화면으로 넘어간다. 폰에서 한 손으로 누르도록 키패드를 쓴다.
  // 번호는 숨은 input(#code)에 담는다 — 다른 화면들이 그 값을 그대로 쓴다.
  function showPin() {
    const m = CFG.roster.find(x => x.v === voter);
    $('pinWho').textContent = `${m ? m.label : voter} 님`;
    $('code').value = '';
    $('pinErr').hidden = true;
    $('pinSkip').hidden = true;
    paintDots();
    show('pin');
    window.scrollTo(0, 0);
    if (!CFG.needCode) login();          // 본인 확인을 안 쓰는 설정이면 바로 통과
  }

  function paintDots() {
    const len = $('code').value.length;
    [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i < len));
  }

  function tapKey(k) {
    const cur = $('code').value;
    if (k === 'del') $('code').value = cur.slice(0, -1);
    else if (cur.length < 4) $('code').value = cur + k;
    $('pinErr').hidden = true;
    $('pinSkip').hidden = true;
    paintDots();
    if ($('code').value.length === 4) login();     // 네 자리가 차면 바로 확인한다
  }

  async function login() {
    if (CFG.needCode && !/^\d{4}$/.test($('code').value)) return;
    const pad = $('keypad');
    pad.classList.add('busy');
    try {
      const [v, b, k] = await Promise.all([fetchMine(), fetchBoard(), fetchKit()]);
      BOARD = b;
      readMe();
      readKit(k);
      if (v === 'badcode') {
        $('pinErr').textContent = '번호가 맞지 않습니다. 다시 눌러보세요.';
        $('pinErr').hidden = false;
        $('pinSkip').hidden = false;       // 틀려도 막지는 않는다 (기존 방침)
        $('code').value = '';
        paintDots();
        return;
      }
      MYVOTE = v;
      afterLogin();
    } catch (e) {
      MYVOTE = null; BOARD = null; me = { pos: [], foot: '' };
      afterLogin();                        // 조회가 안 되는 것이 입력을 막지는 않는다
    } finally {
      pad.classList.remove('busy');
    }
  }

  // 들어오면 **등번호·사이즈부터** 받고, 그다음 자리를 받는다 (총무 요청 2026-10-28).
  // 유니폼 투표는 끝났으니 더 묻지 않는다 — 1위 시안은 등번호 화면 위에 보여준다.
  // 둘 다 끝낸 사람은 대시보드로 바로 간다.
  function afterLogin() {
    sset('kitKey', ''); AKEY = '';          // 일반 로그인에서는 총무 열쇠를 남기지 않는다
    // 이 탭에서는 로그인을 기억한다 — 보드에 갔다가 「마이페이지」로 돌아오거나 새로고침해도 다시 묻지 않는다.
    // 탭을 닫으면 사라진다. 번호가 틀려 들어온 경우(그냥 들어가기)는 기억하지 않는다.
    const savedCode = $('code').value.trim();
    if (!CFG.needCode || /^\d{4}$/.test(savedCode)) sset('hanMe', JSON.stringify({ v: voter, c: savedCode }));
    const co = coachTeamOf(voter) >= 0;
    // 팀을 뽑는 중이거나 확정된 뒤(포메이션을 짜는 때)면 감독은 감독 탭부터 본다
    const live = !!(BOARD && ['draft', 'review', 'done'].includes(BOARD.phase));
    homeTab = co && live ? 'coach' : 'me';
    // 감독이 팀을 뽑는 중이면 등번호·포지션 입력보다 감독 화면이 먼저다
    if (co && live) { showHome(); return; }
    const needNum = KIT && KIT.open !== false && !(KIT.mine && KIT.mine.number != null);
    if (needNum) { showNumbers(); return; }
    if (!me.pos.length && BOARD && BOARD.positionsOpen) { showPlayer(); return; }
    showHome();
  }

  // 이 탭에 기억해 둔 로그인으로 다시 들어간다. 번호가 이제 안 맞으면 지우고 이름 화면에 머문다.
  async function resume() {
    let s = null;
    try { s = JSON.parse(sget('hanMe') || 'null'); } catch (e) { s = null; }
    if (!s || !s.v || !CFG.roster.some(m => m.v === s.v)) return;
    voter = s.v; $('code').value = s.c || '';
    try {
      const [v, b, k] = await Promise.all([fetchMine(), fetchBoard(), fetchKit()]);
      if (v === 'badcode') { sset('hanMe', ''); voter = ''; $('code').value = ''; return; }
      BOARD = b; MYVOTE = v; readMe(); readKit(k); afterLogin();
    } catch (e) { /* 불러오지 못하면 이름 화면에 머문다 */ }
  }

  // ---------- 등번호·사이즈 신청 ----------
  // 투표가 끝나 이 화면이 **로그인 직후 첫 화면**이다 (총무 요청 2026-10-28).
  //
  // 번호 상태는 서버가 매번 다시 계산해 내려준다. 여기서는 그대로 그릴 뿐이다 —
  // 두 곳에서 따로 판단하면 화면에서 눌리는 번호가 저장할 때 거부되는 일이 생긴다.
  //   taken   다른 활동 회원이 쓰는 번호 (내 번호는 들어 있지 않다) — 누를 수 없다
  //   dormant 휴면 회원이 쓰던 번호 — 색만 다르고 고를 수 있다
  //   그 밖    비어 있다
  // 다른 분이 번호를 바꾸면 몇 초 안에 반영되어야 하니, 이 화면에 있는 동안만 받아 온다.
  function showNumbers() {
    const m = CFG.roster.find(x => x.v === voter);
    $('nbWho').textContent = `${m ? m.label : voter} 님`;
    $('nbErr').hidden = true;
    renderKit();
    startKitPoll();
    show('numbers');
    window.scrollTo(0, 0);
  }

  const fetchKit = () => fetch('/api/kit?member=' + encodeURIComponent(voter))
    .then(r => (r.ok ? r.json() : null)).catch(() => null);

  const sizeName = id => (KN.SIZES.find(s => s.id === id) || { name: id || '—' }).name;

  // 아직 아무것도 안 고른 분에게는 **기존 번호·사이즈를 그대로** 채워 둔다.
  // 활동 회원은 번호를 유지하는 것이 기본이고, 그러면 누를 것이 하나도 없는 분이 생기지 않는다.
  function readKit(k) {
    KIT = k;
    if (!k) return;
    if (pick.number == null)
      pick.number = k.mine ? k.mine.number : (k.base ? k.base.number : null);
    if (!pick.size)
      pick.size = (k.mine && k.mine.size) || (k.base && k.base.size) || '';
    if (pick.note == null) {
      pick.note = (k.mine && k.mine.note) || '';
      $('nbNote').value = pick.note;
    }
  }

  function renderKit() {
    const k = KIT;
    if (!k) {
      $('nbGrid').innerHTML = '<p class="note">번호 현황을 불러오지 못했습니다. 잠시 뒤에 다시 열어 주세요.</p>';
      $('nbSave').disabled = true;
      return;
    }
    const w = k.winner;
    $('nbWinner').hidden = !w;
    if (w) {
      // 카드 전체가 버튼이다 — 작은 돋보기 아이콘보다 누르기 쉽다 (총무 요청 2026-10-31).
      $('nbWinner').innerHTML =
        `<img src="/kits/${w.id}.jpg?v=${V}" alt="">
         <div><span class="wtag">회원 투표 ${w.tie ? '공동 1위' : '1위'}</span>
         <strong>${esc(w.name)}</strong>
         <p class="note">${w.voters}명이 투표했습니다</p>
         <span class="wmore">눌러서 크게 보기</span></div>`;
      $('nbWinner').setAttribute('aria-label', `${w.name} — 눌러서 크게 보기`);
    }
    $('nbTitle').textContent = k.mine ? '신청하신 등번호입니다' : '등번호와 사이즈를 골라주세요';
    $('nbLead').textContent = w
      ? '투표로 정해진 위 유니폼으로 맞춥니다. 등번호와 사이즈만 골라주세요.'
      : '2027 시즌 유니폼을 맞춥니다. 등번호와 사이즈만 골라주세요.';
    buildSizes();
    buildNumGrid();

    const picked = pick.number != null;
    $('nbPicked').hidden = !picked;
    $('nbPicked').textContent = picked ? ` · ${pick.number}번` : '';
    const closed = k.open === false && !ADMIN_EDIT;
    $('nbCount').textContent = closed
      ? '신청 기간이 끝났습니다. 바꾸실 것이 있으면 총무에게 말씀해 주세요.'
      : `${k.count.total}명 중 ${k.count.done}명이 신청하셨습니다.`;
    $('nbSave').disabled = closed || !picked || !pick.size;
    $('nbSave').textContent = k.mine ? '이 번호로 고치기' : '이 번호로 신청하기';
  }

  function buildSizes() {
    const k = KIT;
    $('nbSizes').innerHTML = (k.sizes || KN.SIZES).map(s =>
      `<button type="button" data-s="${s.id}" class="${pick.size === s.id ? 'on' : ''}"
        aria-pressed="${pick.size === s.id}"><b>${esc(s.name)}</b><small>${esc(s.hint)}</small></button>`).join('');
    const base = k.base && k.base.size;
    $('nbSizeHint').textContent = k.mine && k.mine.size
      ? `신청하신 사이즈는 ${sizeName(k.mine.size)} 입니다.`
      : base ? `명부에는 ${sizeName(base)} 로 적혀 있습니다. 바뀌었으면 고쳐주세요.`
        : '상의 기준입니다. 하의가 다르면 아래에 적어주세요.';
  }

  function buildNumGrid() {
    const k = KIT;
    const { grid, over } = KN.numbersToShow(
      [...Object.keys(k.taken), ...Object.keys(k.dormant), k.mineHolds], pick.number);
    const cell = n => {
      const t = k.taken[n], d = k.dormant[n];
      let cls = 'num', who = '';
      if (n === pick.number) { cls += ' on'; who = '내 번호'; }
      else if (t) { cls += ' taken'; who = t.join(' '); }
      else if (d) { cls += ' dormant'; who = d.join(' '); }
      if (n === k.mineHolds && n !== pick.number) cls += ' was';
      const lock = !!t && n !== pick.number;
      return `<button type="button" class="${cls}" data-n="${n}" data-lock="${lock ? 1 : 0}"
        aria-pressed="${n === pick.number}"
        aria-label="${n}번 ${lock ? who + ' 님이 쓰는 번호' : d ? '휴면 회원 번호 · 고를 수 있습니다' : '고를 수 있습니다'}"
        ><b>${n}</b><i>${esc(who)}</i></button>`;
    };
    $('nbGrid').innerHTML = grid.concat(over).map(cell).join('');
    $('nbTap').textContent = k.mineHolds != null && k.mineHolds !== pick.number
      ? `원래 쓰시던 ${k.mineHolds}번에는 초록 점을 찍어 두었습니다. 그대로 쓰시려면 다시 눌러주세요.`
      : '회색 칸은 다른 분이 쓰는 번호라 누를 수 없습니다.';
  }

  function tapNumber(n, locked, who) {
    if (locked) {
      $('nbErr').textContent = `${n}번은 ${who} 님이 쓰고 있어 고를 수 없습니다.`;
      $('nbErr').hidden = false;
      return;
    }
    $('nbErr').hidden = true;
    pick.number = pick.number === n ? null : n;
    renderKit();
  }

  async function saveKit() {
    if (pick.number == null || !pick.size) return;
    const btn = $('nbSave'), was = btn.textContent;
    btn.disabled = true;
    btn.textContent = '저장 중…';
    $('nbErr').hidden = true;
    try {
      // 번호는 들어올 때 이미 확인했다. 여기서 또 되묻지 않는다 (포지션 저장과 같다).
      const r = await fetch('/api/kit/save' + (ADMIN_EDIT ? '?key=' + encodeURIComponent(AKEY) : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          member: voter, number: pick.number, size: pick.size, note: $('nbNote').value,
          code: $('code').value.trim(), confirm: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '저장하지 못했습니다.');
      pick.note = $('nbNote').value;
      readKit(await fetchKit());
      if (ADMIN_EDIT) { backToAdmin(); return; }
      stopKitPoll();
      // 자리를 아직 안 적은 분은 그리로, 다 하신 분은 대시보드로
      if (!me.pos.length && BOARD && BOARD.positionsOpen) showPlayer(); else showHome();
    } catch (e) {
      $('nbErr').textContent = e.message;
      $('nbErr').hidden = false;
      // 다른 분이 방금 가져간 번호일 수 있다. 새 상태로 다시 그린다.
      const k = await fetchKit();
      if (k) { KIT = k; if (k.taken[pick.number]) pick.number = null; renderKit(); }
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  }

  // 확정 유니폼 크게 보기. 큰 그림(/kits/lg)을 쓴다 — 목록용 그림은 확대하면 뭉갠다.
  function openKitZoom() {
    const w = KIT && KIT.winner;
    if (!w) return;
    $('kzImg').src = `/kits/lg/${w.id}.jpg?v=${V}`;
    $('kzImg').alt = w.name;
    $('kzName').textContent = w.name;
    $('kzoom').hidden = false;
    document.body.style.overflow = 'hidden';
    $('kzClose').focus();
  }
  const closeKitZoom = () => { $('kzoom').hidden = true; document.body.style.overflow = ''; };

  // 이 화면에 있는 동안만 돈다. 다른 분이 번호를 놓거나 가져가면 몇 초 안에 색이 바뀐다.
  function startKitPoll() {
    stopKitPoll();
    kitSig = KIT
      ? JSON.stringify([KIT.taken, KIT.dormant, KIT.mineHolds, KIT.count.done, KIT.open]) : '';
    kitPoll = setInterval(async () => {
      if (!$('numbers').classList.contains('on')) return stopKitPoll();
      const k = await fetchKit();
      if (!k) return;
      // 바뀐 게 없으면 다시 그리지 않는다. 5초마다 격자를 새로 그리면
      // 누르려던 칸이 손가락 밑에서 바뀌고, 화면도 깜박인다.
      const sig = JSON.stringify([k.taken, k.dormant, k.mineHolds, k.count.done, k.open]);
      if (sig === kitSig) return;
      kitSig = sig;
      KIT = k;
      // 고르던 번호를 그사이 다른 분이 가져갔으면 바로 알린다
      if (pick.number != null && k.taken[pick.number]) {
        $('nbErr').textContent =
          `방금 ${pick.number}번을 ${k.taken[pick.number].join(' ')} 님이 가져갔습니다. 다른 번호를 골라주세요.`;
        $('nbErr').hidden = false;
        pick.number = null;
      }
      renderKit();
    }, 5000);
  }
  const stopKitPoll = () => { if (kitPoll) { clearInterval(kitPoll); kitPoll = 0; } };

  async function fetchMine() {
    const r = await fetch('/api/mine' + (VIEW_AS ? '?key=' + encodeURIComponent(AKEY) : ''), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voter, code: $('code').value.trim() }),
    });
    if (r.status === 403) return 'badcode';
    if (!r.ok) return null;
    return r.json();
  }
  const fetchBoard = () => fetch('/api/board').then(r => (r.ok ? r.json() : null)).catch(() => null);

  function readMe() {
    const mine = BOARD && (BOARD.members || []).find(m => m.v === voter);
    me = { pos: (mine && mine.pos) || [], foot: (mine && mine.foot) || '' };
  }

  // ---------- 선수 정보 ----------
  function showPlayer() {
    const m = CFG.roster.find(x => x.v === voter);
    $('plEyebrow').textContent = `${m ? m.label : voter} 님`;
    $('plWho').textContent = ADMIN_EDIT ? '포지션을 고쳐 주세요'
      : (me.pos.length ? '자리를 고치시겠어요?' : '어디서 뛰시나요?');
    $('plSkip').textContent = ADMIN_EDIT ? '취소' : '나중에 하기';
    $('plErr').hidden = true;
    buildPitch();
    buildFeet();
    show('player');
    window.scrollTo(0, 0);
  }

  function buildPitch() {
    $('pitch').innerHTML = PITCH_ROWS.map(id => {
      const p = POSBY[id];
      if (!p) return '';
      const at = me.pos.indexOf(id);
      return `<button type="button" class="zone${WIDE[id] ? ' wide' : ''}${at >= 0 ? ' on' : ''}"
        data-p="${id}" aria-pressed="${at >= 0}">
        <span class="rk">${at + 1}</span><b>${p.name}</b><small>${p.hint}</small></button>`;
    }).join('');
    $('plSave').disabled = !me.pos.length;
  }

  function buildFeet() {
    $('feet').innerHTML = C.FEET.map(f =>
      `<button type="button" class="foot${me.foot === f.id ? ' on' : ''}" data-f="${f.id}"
        aria-pressed="${me.foot === f.id}">${f.name}</button>`).join('');
  }

  async function savePlayer() {
    if (!me.pos.length) return;
    const btn = $('plSave'), was = btn.textContent;
    btn.disabled = true;
    btn.textContent = '저장 중…';
    try {
      // 번호는 들어올 때 이미 확인했다. 여기서 또 되묻지 않는다.
      const r = await fetch('/api/board/positions' + (ADMIN_EDIT ? '?key=' + encodeURIComponent(AKEY) : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          member: voter, positions: me.pos, foot: me.foot || null,
          code: $('code').value.trim(), confirm: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '저장하지 못했습니다.');
      BOARD = await fetchBoard();
      if (ADMIN_EDIT) { backToAdmin(); return; }
      readMe();
      showHome();
    } catch (e) {
      $('plErr').textContent = e.message;
      $('plErr').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  }

  // ---------- 대시보드 ----------
  // 총무가 따로 올리는 글은 없다. **지금 열려 있는 일**만 서버 상태를 보고 카드로 세운다.
  function card(kind, title, state, body, action, isNew) {
    return `<section class="hcard ${kind}">
      <header><div><h3>${title}</h3><p class="state">${state}</p></div>
      ${isNew ? '<span class="new">NEW</span>' : ''}</header>
      ${body || ''}${action ? `<div class="act">${action}</div>` : ''}</section>`;
  }

  function showHome() {
    const m = CFG.roster.find(x => x.v === voter);
    $('hmWho').textContent = `${m ? m.label : voter} 님`;
    const out = [];

    // 등번호·사이즈 — 지금 받고 있는 일이라 맨 위에 둔다
    if (KIT) {
      const mine = KIT.mine;
      const base = KIT.base || {};
      const kclosed = KIT.open === false;
      if (mine && mine.number != null) {
        out.push(card('num', '등번호·사이즈', '신청하셨습니다',
          // .pill 의 동그라미(i)는 포지션 순위용이라 「번호」 같은 글자는 들어가지 않는다
          `<p class="pills"><span class="pill lab">등번호 <b>${mine.number}</b></span>
            <span class="pill lab">사이즈 <b>${esc(sizeName(mine.size))}</b></span></p>
           ${mine.note ? `<p class="note">${esc(mine.note)}</p>` : ''}`,
          kclosed && !VIEW_AS ? '<p class="note">신청 기간이 끝났습니다.</p>'
            : '<button type="button" class="ghost" data-go="kit">고치기</button>'));
      } else if (!kclosed || VIEW_AS) {
        out.push(card('num', '등번호·사이즈', '아직 안 하셨습니다',
          `<p class="lead">2027 시즌 유니폼을 맞춥니다. ${base.number != null
            ? `지금 쓰시는 <b>${base.number}번</b>을 그대로 쓰실 수 있습니다.`
            : '쓰실 번호와 사이즈를 골라주세요.'} 1분이면 됩니다.</p>`,
          '<button type="button" class="primary" data-go="kit">번호 고르러 가기</button>', true));
      }
    }

    // 유니폼 투표 — 끝났다. 들어가는 길은 닫고 1위 시안만 보여준다 (총무 요청 2026-10-28).
    const win = KIT && KIT.winner;
    if (win) {
      const first = MYVOTE && MYVOTE.voted && MYVOTE.picks.length ? MYVOTE.picks[0] : null;
      out.push(card('kit', '유니폼 투표', `끝났습니다 · ${win.voters}명 참여`,
        `<div class="mylist"><div class="mine"><b>${win.tie ? '공동 1위' : '1위'}</b>
          <img src="/kits/${win.id}.jpg?v=${V}" alt=""><span>${esc(win.name)}</span></div></div>
         <p class="note">${first
          ? `1순위로 ${esc(BY[first] ? BY[first].name : first)}를 고르셨습니다.`
          : '투표에는 참여하지 않으셨습니다.'}</p>`));
    } else if (MYVOTE && MYVOTE.voted) {
      out.push(card('kit', '유니폼 투표', '하셨습니다',
        `<div class="mylist">${MYVOTE.picks.map((id, i) => `
          <div class="mine"><b>${i + 1}순위</b><img src="/kits/${id}.jpg?v=${V}" alt="">
          <span>${BY[id] ? BY[id].name : id}</span></div>`).join('')}</div>`,
        VIEW_AS ? ''
          : MYVOTE.canEdit
            ? '<button type="button" class="ghost" data-go="vote">다시 고르기</button>'
            : '<p class="note">투표가 마감되어 수정은 안 됩니다.</p>'));
    } else if (VIEW_AS) {
      out.push(card('kit', '유니폼 투표', '아직 안 했습니다', '', ''));
    } else if (CFG.open !== false) {
      out.push(card('kit', '유니폼 투표', '아직 안 하셨습니다',
        '<p class="lead">2027 시즌 유니폼을 회원 투표로 정합니다. 17종 중 3개, 2~3분이면 됩니다.</p>',
        '<button type="button" class="primary" data-go="vote">투표하러 가기</button>', true));
    }

    // 내 선수 정보
    const closed = BOARD && BOARD.positionsState === 'after';
    if (me.pos.length) {
      const foot = (C.FEET.find(f => f.id === me.foot) || {}).name;
      out.push(card('pos', '내 선수 정보', '적어두셨습니다',
        `<p class="pills">${me.pos.map((id, i) =>
          `<span class="pill"><i>${i + 1}</i>${POSBY[id] ? POSBY[id].name : id}</span>`).join('')}</p>
         <p class="note">주발 · ${foot || '안 고르셨습니다'}</p>`,
        closed && !VIEW_AS ? '<p class="note">입력 기간이 끝났습니다.</p>'
          : '<button type="button" class="ghost" data-go="player">고치기</button>'));
    } else if (!closed || VIEW_AS) {
      out.push(card('pos', '내 선수 정보', '아직 안 적으셨습니다',
        '<p class="lead">자체전에서 팀을 짤 때 씁니다. 자리 1~3개와 주발, 1분이면 됩니다.</p>',
        '<button type="button" class="primary" data-go="player">적으러 가기</button>', true));
    }

    // 내 팀 — 감독이 뽑고 배치한 결과
    const mt = myTeam();
    if (mt >= 0) {
      const nm = (BOARD.names || [])[mt] || `${mt ? 'B' : 'A'}팀`;
      const placed = Object.keys((BOARD.formation || [])[mt] || {}).length
        && (BOARD.formation[mt].pieces || {})[voter];
      out.push(card('team', '내 팀', `${nm} · ${(BOARD.teams[mt] || []).length}명`,
        `<p class="note">${placed ? '감독이 자리까지 정했습니다.' : '감독이 아직 자리를 배치하지 않았습니다.'}</p>`,
        '<button type="button" class="primary" data-go="team">팀과 포메이션 보기</button>', true));
    } else if (BOARD && BOARD.phase !== 'setup') {
      // 팀을 짜는 중인데 아직 안 불린 분. 빈 화면보다 한 줄이라도 알려주는 편이 낫다.
      const draft = BOARD.phase === 'draft';
      out.push(card('team', '내 팀', '자체전 미편성',
        `<p class="note">${draft
          ? '감독들이 한 명씩 번갈아 뽑는 중입니다. 조금 뒤에 다시 보세요.'
          : '이번 자체전에는 편성되지 않았습니다. 궁금한 점은 총무에게 문의해 주세요.'}</p>`));
    }

    // 자체전 보드
    if (BOARD) {
      const ph = BOARD.phase;
      const state = ph === 'draft' ? '지금 감독들이 뽑고 있습니다'
        : ph === 'review' ? '감독들이 확정하는 중입니다'
          : ph === 'done' ? '팀이 정해졌습니다' : '아직 팀을 짜기 전입니다';
      const act = (BOARD.members || []).filter(x => x.active);
      out.push(card('board', '자체전 보드', state,
        `<p class="note">활동 ${act.length}명 중 ${act.filter(x => x.pos).length}명이 자리를 적었습니다.</p>`,
        '<a class="ghost linkbtn" href="/board.html">보드 열기</a>'));
    }

    $('cards').innerHTML = out.length ? out.join('')
      : '<p class="lead">지금은 하실 일이 없습니다. 고맙습니다.</p>';

    // 총무가 대신 열어 본 페이지면 맨 위에 알린다
    $('asBanner').hidden = !VIEW_AS;
    $('asText').textContent = `관리자 보기 · ${m ? m.label : voter} 님의 페이지`;
    $('hmLead').textContent = VIEW_AS ? '이 회원이 보는 화면 그대로입니다.' : '지금 하실 수 있는 일입니다.';
    // 자체전 감독이면 「감독」 탭이 생긴다
    const co = coachTeamOf(voter) >= 0;
    $('mTabs').hidden = !co;
    show('home');
    setHomeTab(co ? homeTab : 'me', true);
    window.scrollTo(0, 0);
  }

  // ---------- 내 팀 ----------
  // 감독이 뽑고 배치한 결과를 회원이 읽기만 한다. 고칠 수 있는 것은 없다.
  const myTeam = () => (BOARD && BOARD.teams ? BOARD.teams.findIndex(t => (t || []).includes(voter)) : -1);
  const labOf = v => {
    const m = (BOARD.members || []).find(x => x.v === v);
    return (m && m.label) || v;
  };
  const posOfV = v => {
    const m = (BOARD.members || []).find(x => x.v === v);
    return (m && m.pos) || [];
  };

  // 한 팀의 말·팀원 목록을 그리는 조각. 회원의 「내 팀」과 관리자 화면이 같이 쓴다.
  function teamParts(t, meV) {
    const color = (BOARD.colors || [])[t] || '#2e86de';
    const f = (BOARD.formation || [])[t] || {};
    const pieces = f.pieces || {};
    const names = Object.keys(pieces);
    const field = names.map(v => {
      const q = pieces[v];
      const first = (posOfV(v)[0]) || '?';
      return `<span class="fp${v === meV ? ' me' : ''}" style="left:${q.x * 100}%;top:${q.y * 100}%">
        <i style="--fc:${color}">${first}</i><b>${esc(labOf(v))}</b></span>`;
    }).join('');
    const list = (BOARD.teams || [])[t] || [];
    // 스타팅은 이름 왼쪽에 초록불 — 포메이션을 짠 팀에서만. 나머지는 빈 동그라미이고 말로 가르지 않는다.
    const listHtml = list.map(v => {
      const ps = posOfV(v).join(' · ');
      const dot = names.length ? `<i class="sdot${names.includes(v) ? ' on' : ''}"></i>` : '';
      return `<li${v === meV ? ' class="me"' : ''}><b>${dot}${esc(labOf(v))}</b>
        <span>${ps || '희망 포지션 미입력'}</span></li>`;
    }).join('');
    return { color, f, hasField: names.length > 0, field, list, listHtml };
  }
  const coachName = t => {
    const co = (BOARD.coaches || [])[t];
    return co && (typeof co === 'string' ? co : (co.label || co.v));
  };

  function showTeam() {
    const t = myTeam();
    const nm = t >= 0 ? ((BOARD.names || [])[t] || `${t ? 'B' : 'A'}팀`) : '';
    const color = t >= 0 ? ((BOARD.colors || [])[t] || '#2e86de') : '#888';
    // 감독은 {v, label} 로 내려온다. 이름만 꺼내 쓴다.
    const co = t >= 0 ? (BOARD.coaches || [])[t] : null;
    const coach = co && (typeof co === 'string' ? co : (co.label || co.v));

    $('tmTag').textContent = BOARD && BOARD.phase === 'done' ? '확정된 팀' : '아직 바뀔 수 있습니다';
    $('tmName').textContent = nm;
    $('tmName').style.color = color;
    $('tmLead').textContent = coach ? `${coach} 감독` : '감독 미정';

    const tp = teamParts(t, voter);
    const f = tp.f;
    if (tp.hasField) {
      $('tmField').innerHTML = tp.field;
      $('tmField').hidden = false;
      $('tmNote').textContent = f.note ? `감독 메모 — ${f.note}` : `포메이션 ${f.id || ''}`;
      $('tmNote').hidden = false;
    } else {
      $('tmField').hidden = true;
      $('tmNote').textContent = '감독이 아직 말을 배치하지 않았습니다. 팀원만 먼저 보여드립니다.';
      $('tmNote').hidden = false;
    }

    $('tmListTitle').hidden = !tp.list.length;
    $('tmListTitle').innerHTML = tp.hasField ? '팀원 <span class="sleg"><i class="sdot on"></i>스타팅</span>' : '팀원';
    $('tmList').innerHTML = tp.listHtml;
    $('tmShare').hidden = !tp.list.length;

    show('team');
    window.scrollTo(0, 0);
    // 스타팅이 아닌 팀원은 희망 포지션 자리에 작게 이름을 보여준다 (피치가 보인 뒤에 자리를 잡는다)
    if (tp.hasField && window.LU) requestAnimationFrame(() => LU.decoratePitch($('tmField'), BOARD, t, f.pieces, 'member'));
  }

  // 라인업을 이미지로 저장·공유 — 한 팀의 스타팅·후보·포메이션을 한 장에 담는다.
  function shareTeam(t) {
    if (!window.LU || !BOARD || t < 0) return;
    const f = (BOARD.formation || [])[t] || {};
    LU.openShare(LU.fromBoard(BOARD, t, f.pieces || {}, f.id || ''));
  }

  // ---------- 관리자 ----------
  // 두 팀의 선수 구성·포메이션을 보고, 전 회원의 자리·주발을 고친다.
  // 팀을 뽑고 말을 옮기는 일은 보드(/board.html)의 총무 모드에서 한다 — 여기는 보고 고치는 곳이다.
  // 키는 투표 집계 화면·보드와 같은 sessionStorage('kitKey')를 쓴다. 한 번 넣으면 셋 다 열린다.
  async function adminCheck(k) {
    const r = await fetch('/api/board/admin/check?key=' + encodeURIComponent(k));
    if (!r.ok) throw new Error(r.status === 429
      ? '여러 번 틀렸습니다. 15분 뒤에 다시 해주세요.' : '비밀번호가 맞지 않습니다.');
  }

  async function adminOpen() {
    ADMIN_EDIT = false;
    show('admin');
    window.scrollTo(0, 0);
    $('adErr').hidden = true;
    const k = sget('kitKey');
    if (k) {
      try { await adminCheck(k); AKEY = k; return adminMain(); } catch (e) { sset('kitKey', ''); }
    }
    AKEY = '';
    $('adLogin').hidden = false;
    $('adMain').hidden = true;
    $('adKey').value = '';
  }

  async function adminEnter() {
    const k = $('adKey').value.trim();
    if (!k) return;
    const btn = $('adEnter'); btn.disabled = true;
    try {
      await adminCheck(k);
      AKEY = k; sset('kitKey', k);
      $('adErr').hidden = true;
      await adminMain();
    } catch (e) {
      $('adErr').textContent = e.message;
      $('adErr').hidden = false;
    } finally { btn.disabled = false; }
  }

  async function adminMain() {
    $('adLogin').hidden = true;
    $('adMain').hidden = false;
    BOARD = await fetchBoard();
    renderAdmin();
  }

  function backToAdmin() {
    if (VIEW_AS) {                         // 회원 페이지를 대신 보다가 고친 것이면 그 페이지로 돌아간다
      ADMIN_EDIT = false;
      readMe();
      showHome();
      return;
    }
    ADMIN_EDIT = false;
    adTab = 'pos';
    show('admin');
    renderAdmin();
    window.scrollTo(0, 0);
  }

  function renderAdmin() {
    document.querySelectorAll('#adTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === adTab));
    $('adKit').hidden = adTab !== 'kit';
    $('adTeams').hidden = adTab !== 'teams';
    $('adPos').hidden = adTab !== 'pos';
    $('adMembers').hidden = adTab !== 'members';
    $('adBoard').hidden = adTab !== 'board';
    if (adTab === 'board') { ensureAdFrame(); return; }
    if (adTab === 'kit') { renderAdKit(); return; }        // 보드 정보가 없어도 열린다
    if (!BOARD) {
      $('adTeams').innerHTML = $('adPos').innerHTML = $('adMembers').innerHTML =
        '<p class="note">보드 정보를 불러오지 못했습니다. 잠시 뒤에 다시 열어 주세요.</p>';
      return;
    }
    if (adTab === 'teams') renderAdTeams();
    else if (adTab === 'pos') renderAdPos();
    else renderAdMembers();
  }

  // 등번호·사이즈 신청 현황. 명부에 옮겨 적을 표까지 여기서 뜬다 —
  // 이 서버는 명부를 모르니, 반영은 총무가 members.csv 에 붙여 넣는 것으로 끝낸다.
  async function renderAdKit() {
    const box = $('adKit');
    if (!box.dataset.ready) box.innerHTML = '<p class="note">불러오는 중…</p>';
    let j = null;
    try {
      const r = await fetch('/api/kit/admin/list?key=' + encodeURIComponent(AKEY));
      j = r.ok ? await r.json() : null;
    } catch (e) { j = null; }
    if (!j) { box.innerHTML = '<p class="note">등번호 신청 현황을 불러오지 못했습니다.</p>'; return; }
    ADKIT = j;
    const act = j.members.filter(m => m.active);
    const done = act.filter(m => m.number != null);
    const left = act.filter(m => m.number == null);
    const kst = iso => new Date(iso).toLocaleString('ko-KR', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

    let html = `<p class="lead">활동 ${act.length}명 중 <b>${done.length}명</b>이 신청했습니다. ${
      j.deadline ? `마감 ${kst(j.deadline)}.` : '마감 시각은 없습니다.'}${
      j.open ? '' : ' <b>지금은 닫혀 있습니다.</b>'}</p>`;
    if (j.winner) html += `<p class="note">투표 1위 · ${esc(j.winner.name)} (${j.winner.voters}명 참여)</p>`;
    if (j.clash && j.clash.length)
      html += `<p class="kitwarn">같은 번호를 둘이 쓰고 있습니다 — ${j.clash
        .map(c => `${c.number}번 (${c.who.map(esc).join(', ')})`).join(' · ')}.<br>명부를 확인해 주세요.</p>`;
    html += '<div class="kitlist">' + j.members.map(m => {
      const n = m.number != null ? m.number : m.base;
      const how = m.number != null ? `신청 · ${m.at ? kst(m.at) : ''}`
        : m.base != null ? '기존 번호 (신청 전)' : '번호 없음';
      return `<div class="kitrow${m.active ? '' : ' off'}">
        <span class="kn${n == null ? ' none' : ''}">${n == null ? '—' : n}</span>
        <span class="who">${esc(m.label)}<small>${m.active ? '활동' : '휴면'} · ${esc(how)}${
        m.note ? ` · ${esc(m.note)}` : ''}</small></span>
        <span class="ks">${m.size ? esc(sizeName(m.size))
          : m.baseSize ? `${esc(sizeName(m.baseSize))}<small>명부</small>` : '—'}</span>
        ${m.flagged ? '<span class="flag">번호 확인</span>' : ''}</div>`;
    }).join('') + '</div>';
    html += `<p class="note">아직 안 한 활동 회원 ${left.length}명${
      left.length ? ' · ' + left.map(m => esc(m.label)).join(', ') : ''}</p>`;
    html += '<button type="button" class="ghost" id="adKitCopy">명부 보정에 붙여 넣을 줄 복사하기</button>';
    box.innerHTML = html;
    box.dataset.ready = '1';
  }

  // members/adjustments.csv 에 그대로 붙여 넣을 줄로 내보낸다.
  // members.csv 는 build_master.py 가 다시 만드는 파일이라 직접 고치면 다음 실행에 사라진다 —
  // 보정 파일에 남겨야 「왜 그 번호인지」도 같이 남는다.
  // 이미 명부와 같은 값이면 빼둔다. 바뀐 것만 붙여 넣으면 된다.
  async function copyAdKit() {
    if (!ADKIT) return;
    const today = new Date().toISOString().slice(0, 10);
    const esc2 = s => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows = [];
    for (const m of ADKIT.members) {
      if (m.number == null) continue;
      const why = `2027 유니폼 신청 (${today})${m.note ? ' — ' + m.note : ''}`;
      if (m.number !== m.base) rows.push(['number', m.v, m.number, esc2(why)].join(','));
      if (m.size && m.size !== m.baseSize) rows.push(['size', m.v, m.size, esc2(why)].join(','));
    }
    const text = rows.join('\n');
    const btn = $('adKitCopy');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = rows.length
        ? `복사했습니다 (${rows.length}줄 — adjustments.csv 에 붙여 넣으세요)`
        : '명부와 달라진 것이 없습니다';
    } catch (e) {
      // 클립보드가 막힌 브라우저 — 눌러서 복사할 수 있게 그냥 펼쳐 둔다
      const pre = document.createElement('textarea');
      pre.className = 'adinput';
      pre.rows = 8;
      pre.value = text;
      btn.replaceWith(pre);
      pre.select();
    }
  }

  function renderAdTeams() {
    const b = BOARD;
    const phase = ({ setup: '팀 구성 전', draft: '팀 구성 중', review: '확정 대기', done: '확정됨' })[b.phase] || b.phase;
    const seg = [0, 1].map(i => {
      const co = coachName(i);
      return `<button type="button" data-t="${i}" class="${adTeam === i ? 'on' : ''}">
        ${esc((b.names || [])[i] || (i ? 'B팀' : 'A팀'))}${co ? ' · ' + esc(co) : ''}
        <small>${((b.teams || [])[i] || []).length}명</small></button>`;
    }).join('');
    const tp = teamParts(adTeam, null);
    let body;
    if (!tp.list.length) {
      body = '<p class="note">아직 이 팀에 뽑힌 선수가 없습니다.</p>';
    } else {
      body = (tp.hasField
        ? `<div class="fpitch" id="adField">${tp.field}</div>
           <p class="note">${tp.f.note ? '감독 메모 — ' + esc(tp.f.note) : '포메이션 ' + esc(tp.f.id || '')}</p>`
        : '<p class="note">감독이 아직 말을 배치하지 않았습니다. 팀원만 보여드립니다.</p>') +
        `<button type="button" class="ghost" data-share="1">라인업 이미지 저장 · 공유</button>
         <h3 class="sub">팀원 ${tp.list.length}명${tp.hasField ? ' <span class="sleg"><i class="sdot on"></i>스타팅</span>' : ''}</h3>
         <ul class="tmlist">${tp.listHtml}</ul>`;
    }
    $('adTeams').innerHTML =
      `<p class="note">현재 단계 — <b>${phase}</b> · 활동 ${(b.members || []).filter(m => m.active).length}명 중
        ${((b.teams || [])[0] || []).length + ((b.teams || [])[1] || []).length}명이 팀에 뽑힘</p>
       <div class="adseg" id="adSeg">${seg}</div>${body}`;
    if (tp.hasField && window.LU) requestAnimationFrame(() => LU.decoratePitch($('adField'), BOARD, adTeam, tp.f.pieces, 'member'));
  }

  // 포지션 관리 — 선수 아이콘을 눌러 고친다. 보드의 「내 포지션」 화면과 같은 규칙이다:
  //   활동은 밝게(주 포지션 묶음 색), 아직 안 적은 활동 회원은 점선, 휴면은 어둡게.
  const AGRP = { '골키퍼': 'gk', '수비': 'df', '미드필드': 'mf', '공격': 'fw' };
  const gOf = id => AGRP[(POSBY[id] || {}).group] || '';
  const FOOT_SHORT = { R: '오른발', L: '왼발', B: '양발' };
  const splitLabel = l => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(l); return m ? [m[1], m[2]] : [l, '']; };

  function adIcon(m) {
    const g = m.pos ? gOf(m.pos[0]) : '';
    const cls = (m.active ? 'act' : 'off') + (m.active && !m.pos ? ' none' : '') + (m.active && g ? ' adg-' + g : '');
    const [main, sub] = splitLabel(m.label);
    const badges = m.pos && m.pos.length
      ? `<span class="adbs">${m.pos.map((p, i) => `<i class="adpb adg-${gOf(p)}${i ? ' s' : ''}">${p}</i>`).join('')}</span>`
      : '<span class="adnp">미입력</span>';
    return `<button type="button" class="admem ${cls}" data-v="${esc(m.v)}"
        aria-label="${esc(m.label)}${m.active ? '' : ' (휴면)'} 포지션 고치기">
      <span class="adic"><b>${esc(main)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${m.active ? badges : '<span class="adnp">휴면</span>'}
      <span class="adft">${FOOT_SHORT[m.foot] || ''}</span></button>`;
  }

  function renderAdPos() {
    const ms = BOARD.members || [];
    const act = ms.filter(m => m.active), off = ms.filter(m => !m.active);
    const filled = act.filter(m => m.pos).length;
    const list = ms.filter(m => adShow === 'all' || (adShow === 'act' ? m.active : !m.active))
      .sort((a, b) => (b.active - a.active));
    $('adPos').innerHTML =
      `<p class="note">선수 아이콘을 누르면 그 선수의 포지션과 주발을 고칠 수 있습니다.</p>
       <div class="adlegend">
         <span><i class="dot g-df"></i>활동 (색 = 주 포지션)</span>
         <span><i class="dot none"></i>아직 안 적음</span>
         <span><i class="dot off"></i>휴면</span>
       </div>
       <div class="adprog">활동 ${act.length}명 중 <b>${filled}명</b>이 입력했습니다
         <div class="adbar"><i style="width:${act.length ? Math.round(filled / act.length * 100) : 0}%"></i></div></div>
       <div class="adseg adshow" id="adShow">
         <button type="button" data-s="all" class="${adShow === 'all' ? 'on' : ''}">전체 ${ms.length}</button>
         <button type="button" data-s="act" class="${adShow === 'act' ? 'on' : ''}">활동 ${act.length}</button>
         <button type="button" data-s="off" class="${adShow === 'off' ? 'on' : ''}">휴면 ${off.length}</button>
       </div>
       ${list.length ? `<div class="adgrid">${list.map(adIcon).join('')}</div>`
        : '<p class="note">조건에 맞는 회원이 없습니다.</p>'}`;
  }

  function adminEdit(v) {
    const m = (BOARD.members || []).find(x => x.v === v);
    if (!m) return;
    ADMIN_EDIT = true;
    voter = v;
    me = { pos: (m.pos || []).slice(), foot: m.foot || '' };
    showPlayer();
  }

  // ---------- 회원 페이지의 탭 · 감독 ----------
  // 각 회원은 자기 페이지(대시보드)를 갖고, 자체전 감독이면 「감독」 탭이 하나 더 생긴다.
  // 감독 탭은 보드(/board.html)를 임베드한다 — 선수 뽑기·최종 확정·포메이션 화면을 다시 만들지
  // 않고 같은 규칙·같은 화면을 쓴다. 감독 인증은 로그인에서 끝났으니 sessionStorage 로 넘겨
  // 한 번 더 묻지 않는다 (board.js 가 boardCoach 를 읽는다).
  const coachId = c => (c ? (typeof c === 'string' ? c : c.v) : '');
  // 감독이거나 위임받은 팀. 위임받은 회원에게도 「감독」 탭이 생긴다.
  const coachTeamOf = v => {
    if (!BOARD || !BOARD.coaches) return -1;
    const c = BOARD.coaches.findIndex(x => coachId(x) === v);
    if (c >= 0) return c;
    const dl = BOARD.delegates || [[], []];
    return dl[0].some(x => coachId(x) === v) ? 0 : dl[1].some(x => coachId(x) === v) ? 1 : -1;
  };
  const isDelegateV = v => coachTeamOf(v) >= 0 && !BOARD.coaches.some(x => coachId(x) === v);

  function setHomeTab(t, quiet) {
    if (t === 'coach' && coachTeamOf(voter) < 0) t = 'me';
    homeTab = t;
    document.querySelectorAll('#mTabs button').forEach(b => b.classList.toggle('on', b.dataset.m === t));
    $('mMe').hidden = t !== 'me';
    $('mCoach').hidden = t !== 'coach';
    if (t === 'coach') ensureCoachFrame();
    if (!quiet) window.scrollTo(0, 0);
  }

  // 같은 회원·같은 보기면 다시 불러오지 않는다. 사람이 바뀌면 새로 연다.
  function ensureCoachFrame() {
    const fr = $('coachFrame');
    const key = (VIEW_AS ? 'a:' : 'c:') + voter;
    if (fr.dataset.k === key) return;
    const q = new URLSearchParams({ embed: '1', tab: BOARD && BOARD.phase === 'done' ? 'form' : 'draft' });
    let verified = true;
    if (VIEW_AS) {
      // 총무 열쇠로 연다. 감독 로그인은 지우고, 그 감독의 팀을 먼저 보여준다.
      sset('kitKey', AKEY);
      sset('boardCoach', '');
      const t = coachTeamOf(voter);
      if (t >= 0) q.set('team', t);
    } else {
      const code = $('code').value.trim();
      verified = /^\d{4}$/.test(code);
      sset('boardCoach', verified ? JSON.stringify({ name: voter, code }) : '');
    }
    $('coachNote').hidden = verified;
    fr.dataset.k = key;
    fr.src = '/board.html?' + q.toString();
  }

  // 로그아웃·사람 바꾸기: 이 탭에 남은 감독·총무 인증과 임베드를 비운다.
  function resetFrames() {
    VIEW_AS = false; ADMIN_EDIT = false; homeTab = 'me';
    sset('boardCoach', '');
    for (const id of ['coachFrame', 'adFrame']) {
      const f = $(id);
      f.dataset.k = '';
      if (f.getAttribute('src')) f.src = 'about:blank';
    }
  }

  // ---------- 총무: 모든 회원 페이지 · 감독 보드 ----------
  function renderAdMembers() {
    const ms = (BOARD.members || []).slice().sort((a, b) =>
      ((coachTeamOf(b.v) >= 0) - (coachTeamOf(a.v) >= 0)) || (b.active - a.active)
      || a.label.localeCompare(b.label, 'ko'));
    $('adMembers').innerHTML =
      `<p class="note">회원을 누르면 그 회원이 보는 페이지를 그대로 볼 수 있습니다. 감독은 감독 탭도 열립니다.</p>
       <div class="adchips">${ms.map(m => {
        const t = coachTeamOf(m.v);
        return `<button type="button" class="adchip${m.active ? '' : ' off'}${t >= 0 ? ' co' : ''}" data-v="${esc(m.v)}">
          ${esc(m.label)}${t >= 0 ? `<i>${isDelegateV(m.v) ? '위임' : '감독'}</i>` : ''}${m.active ? '' : '<em>휴면</em>'}</button>`;
      }).join('')}</div>`;
  }

  async function adminViewMember(v) {
    VIEW_AS = true; ADMIN_EDIT = false; voter = v; homeTab = 'me';
    sset('kitKey', AKEY);
    pick = { number: null, size: '', note: null };   // 다른 회원을 열었으니 내 선택은 버린다
    const [mv, b, k] = await Promise.all([fetchMine(), fetchBoard(), fetchKit()]);
    if (b) BOARD = b;
    MYVOTE = mv && mv !== 'badcode' ? mv : null;
    readMe();
    readKit(k);
    showHome();
  }

  async function adminReturn() {
    resetFrames();
    adTab = 'members';
    show('admin');
    await adminMain();
    window.scrollTo(0, 0);
  }

  // 총무의 「감독 보드」 — 두 팀을 모두 보고 대신 조작한다. 감독 로그인은 지운다.
  function ensureAdFrame() {
    const fr = $('adFrame');
    if (fr.dataset.k === '1') return;
    sset('kitKey', AKEY);
    sset('boardCoach', '');
    fr.dataset.k = '1';
    fr.src = '/board.html?embed=1&tab=draft';
  }

  // 투표 화면으로. 전에 고른 것이 있으면 그 위에서 고치게 한다.
  function toChoose() {
    if (CFG.open === false) return;        // 마감된 투표는 들어가지 않는다 (총무 요청 2026-10-28)
    picks = (MYVOTE && MYVOTE.picks ? MYVOTE.picks : []).slice(0, need());
    paint();
    show('choose');
    window.scrollTo(0, 0);
  }

  // ---------- 디자인 고르기 ----------
  function buildGrid() {
    $('grid').innerHTML = CFG.kits.map((k, i) => `
      <div class="card" data-id="${k.id}" data-i="${i}">
        <div class="pic">
          <img src="/kits/${k.id}.jpg?v=${V}" alt="${k.name}" loading="lazy" decoding="async">
          <span class="rank"></span>
          <button type="button" class="mag" data-zoom="${i}" aria-label="${k.name} 크게 보기">⤢</button>
        </div>
        <span class="cname">${k.name}</span>
      </div>`).join('');
    paint();
  }

  function toggle(id) {
    const at = picks.indexOf(id);
    if (at >= 0) picks.splice(at, 1);
    else if (picks.length < need()) picks.push(id);
    else {                      // 다 찼으면 가장 먼저 고른 것을 내보낸다
      picks.shift(); picks.push(id);
    }
    paint();
  }

  function paint() {
    for (const c of document.querySelectorAll('#grid .card')) {
      const at = picks.indexOf(c.dataset.id);
      c.classList.toggle('on', at >= 0);
      c.querySelector('.rank').textContent = at >= 0 ? at + 1 : '';
    }
    $('pickCount').textContent = `${picks.length} / ${need()}`;
    $('slots').innerHTML = Array.from({ length: need() }, (_, i) => {
      const k = BY[picks[i]];
      return `<span class="slot${k ? ' filled' : ''}">${i + 1}. ${k ? k.name : '—'}</span>`;
    }).join('');
    $('submit').disabled = picks.length !== need();
    $('submit').textContent = picks.length === need()
      ? '제출하기' : `${need() - picks.length}개 더 골라주세요`;
    if (!$('zoom').hidden) paintZoom();
  }

  // ---------- 크게 보기 ----------
  function openZoom(i) {
    zi = i; $('zoom').hidden = false;
    document.body.style.overflow = 'hidden';
    paintZoom();
  }
  function closeZoom() { $('zoom').hidden = true; document.body.style.overflow = ''; }
  function paintZoom() {
    const k = CFG.kits[zi];
    $('zimg').src = `/kits/lg/${k.id}.jpg?v=${V}`;
    $('zimg').alt = k.name;
    $('zname').textContent = k.name;
    const on = picks.includes(k.id);
    $('zpick').textContent = on ? `해제 (${picks.indexOf(k.id) + 1}순위)` : '고르기';
    $('zpick').classList.toggle('on', on);
  }
  const step = d => { zi = (zi + d + CFG.kits.length) % CFG.kits.length; paintZoom(); };

  // ---------- 제출 ----------
  // 번호가 다르면 막지 않고 한 번 되묻는다. 그래도 다르면 그대로 받고 번호만 남긴다.
  async function submit(force) {
    const btn = force === undefined ? $('submit') : $('reSubmit');
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = '보내는 중…';
    try {
      const code = ($('recheck').hidden ? $('code').value : $('recode').value).trim();
      const r = await fetch('/api/vote', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voter, picks, code, confirm: force === true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '제출에 실패했습니다.');
      if (j.mismatch) {                 // 저장 안 됨 — 번호를 다시 묻는다
        $('recode').value = code;
        $('reMsg').textContent = '입력하신 번호가 명부와 다릅니다. 오타가 아닌지 봐주세요.';
        $('recheck').hidden = false;
        document.body.style.overflow = 'hidden';
        btn.disabled = false; btn.textContent = was;
        $('recode').focus();
        return;
      }
      $('recheck').hidden = true;
      document.body.style.overflow = '';
      $('doneLead').textContent = `${need()}개를 보내주셨습니다.`;
      $('mylist').innerHTML = picks.map((id, i) => `
        <div class="mine">
          <b>${i + 1}순위</b>
          <img src="/kits/${id}.jpg?v=${V}" alt="">
          <span>${BY[id].name}</span>
        </div>`).join('');
      $('doneMsg').textContent =
        `지금까지 ${j.voters}명이 투표했습니다. 창을 닫으셔도 됩니다.`;
      MYVOTE = { voted: true, picks: picks.slice(), at: new Date().toISOString(), canEdit: true };
      show('done'); window.scrollTo(0, 0);
    } catch (e) {
      btn.textContent = was;
      btn.disabled = false;
      alert(e.message);
    }
  }

  // ---------- 이벤트 ----------
  $('q').addEventListener('input', buildNames);
  $('names').addEventListener('click', e => {
    const b = e.target.closest('.nm'); if (b) pickName(b.dataset.v);
  });
  $('pinBack').addEventListener('click', () => { show('start'); window.scrollTo(0, 0); });
  $('keypad').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    tapKey(b.dataset.k);
  });
  $('pinSkip').addEventListener('click', () => { MYVOTE = null; afterLogin(); });
  $('tmBack').addEventListener('click', showHome);

  // 등번호·사이즈
  $('nbWinner').addEventListener('click', openKitZoom);
  $('kzClose').addEventListener('click', closeKitZoom);
  // 그림 말고 어디를 눌러도 닫힌다 — 닫는 법을 찾느라 헤매지 않게
  $('kzoom').addEventListener('click', e => { if (e.target.id !== 'kzImg') closeKitZoom(); });
  $('nbSizes').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]'); if (!b) return;
    pick.size = pick.size === b.dataset.s ? '' : b.dataset.s;   // 다시 누르면 해제
    renderKit();
  });
  $('nbGrid').addEventListener('click', e => {
    const b = e.target.closest('.num'); if (!b) return;
    tapNumber(+b.dataset.n, b.dataset.lock === '1', (b.querySelector('i') || {}).textContent || '');
  });
  const takeBig = () => {
    const el = $('nbBig');
    let n;
    try { n = KN.cleanNumber(el.value); } catch (err) {
      $('nbErr').textContent = err.message; $('nbErr').hidden = false; return;
    }
    if (KIT && KIT.taken[n]) {
      $('nbErr').textContent = `${n}번은 ${KIT.taken[n].join(' ')} 님이 쓰고 있어 고를 수 없습니다.`;
      $('nbErr').hidden = false;
      return;
    }
    el.value = '';
    $('nbErr').hidden = true;
    pick.number = n;
    renderKit();
  };
  $('nbBigAdd').addEventListener('click', takeBig);
  $('nbBig').addEventListener('keydown', e => { if (e.key === 'Enter') takeBig(); });
  $('nbSave').addEventListener('click', () => saveKit());
  $('nbSkip').addEventListener('click', () => {
    stopKitPoll();
    if (ADMIN_EDIT) backToAdmin(); else showHome();
  });

  $('adminLink').addEventListener('click', e => { e.preventDefault(); adminOpen(); });
  $('adBack').addEventListener('click', () => { show('start'); window.scrollTo(0, 0); });
  $('adEnter').addEventListener('click', adminEnter);
  $('adKey').addEventListener('keydown', e => { if (e.key === 'Enter') adminEnter(); });
  $('adOut').addEventListener('click', () => {
    sset('kitKey', ''); AKEY = ''; resetFrames(); show('start'); window.scrollTo(0, 0);
  });
  $('adTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    adTab = b.dataset.tab; renderAdmin();
  });
  $('adKit').addEventListener('click', e => {
    if (e.target.closest('#adKitCopy')) copyAdKit();
  });
  $('adTeams').addEventListener('click', e => {
    if (e.target.closest('[data-share]')) return shareTeam(adTeam);
    const b = e.target.closest('button[data-t]'); if (!b) return;
    adTeam = +b.dataset.t; renderAdmin();
  });
  $('tmShare').addEventListener('click', () => shareTeam(myTeam()));
  $('adPos').addEventListener('click', e => {
    const s = e.target.closest('#adShow button[data-s]');
    if (s) { adShow = s.dataset.s; renderAdPos(); return; }
    const b = e.target.closest('.admem'); if (!b) return;
    adminEdit(b.dataset.v);
  });

  $('grid').addEventListener('click', e => {
    const mag = e.target.closest('.mag');
    if (mag) { e.stopPropagation(); return openZoom(+mag.dataset.zoom); }
    const c = e.target.closest('.card');
    if (c) toggle(c.dataset.id);
  });

  $('zclose').addEventListener('click', closeZoom);
  $('zprev').addEventListener('click', () => step(-1));
  $('znext').addEventListener('click', () => step(1));
  $('zpick').addEventListener('click', () => toggle(CFG.kits[zi].id));
  $('zoom').addEventListener('click', e => { if (e.target.id === 'zoom') closeZoom(); });
  document.addEventListener('keydown', e => {
    if (!$('kzoom').hidden && e.key === 'Escape') return closeKitZoom();
    if ($('zoom').hidden) return;
    if (e.key === 'Escape') closeZoom();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  $('submit').addEventListener('click', () => submit());
  $('reSubmit').addEventListener('click', () => submit());
  $('reForce').addEventListener('click', () => submit(true));
  $('reCancel').addEventListener('click', () => {
    $('recheck').hidden = true; document.body.style.overflow = '';
  });
  $('recode').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  $('again').addEventListener('click', () => { show('choose'); window.scrollTo(0, 0); });
  // 투표를 마치면 자리를 아직 안 적은 분은 그리로, 다 한 분은 대시보드로
  $('toHome').addEventListener('click', () => { if (me.pos.length) showHome(); else showPlayer(); });

  $('pitch').addEventListener('click', e => {
    const b = e.target.closest('.zone'); if (!b) return;
    const id = b.dataset.p, at = me.pos.indexOf(id);
    if (at >= 0) me.pos.splice(at, 1);
    else { if (me.pos.length >= C.MAX_POS) me.pos.shift(); me.pos.push(id); }
    $('plErr').hidden = true;
    buildPitch();
  });
  $('feet').addEventListener('click', e => {
    const b = e.target.closest('.foot'); if (!b) return;
    me.foot = me.foot === b.dataset.f ? '' : b.dataset.f;   // 다시 누르면 해제
    buildFeet();
  });
  $('plSave').addEventListener('click', savePlayer);
  $('plSkip').addEventListener('click', () => { if (ADMIN_EDIT) backToAdmin(); else showHome(); });
  $('cards').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'vote') toChoose();
    if (b.dataset.go === 'kit') { ADMIN_EDIT = VIEW_AS; showNumbers(); }
    if (b.dataset.go === 'player') { ADMIN_EDIT = VIEW_AS; showPlayer(); }
    if (b.dataset.go === 'team') showTeam();
  });
  // 「처음 화면으로」 — 이름 고르는 첫 화면으로 돌아가고, 이 탭의 로그인도 푼다
  $('hmBack').addEventListener('click', () => { sset('hanMe', ''); resetFrames(); show('start'); window.scrollTo(0, 0); });
  $('mTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]'); if (b) setHomeTab(b.dataset.m);
  });
  $('asExit').addEventListener('click', adminReturn);
  $('adMembers').addEventListener('click', e => {
    const b = e.target.closest('.adchip'); if (b) adminViewMember(b.dataset.v);
  });
  // 폰 키보드로도 칠 수 있게 — 키패드와 같은 값을 넣는다
  document.addEventListener('keydown', e => {
    if (!$('pin').classList.contains('on')) return;
    if (/^[0-9]$/.test(e.key)) tapKey(e.key);
    else if (e.key === 'Backspace') tapKey('del');
  });

  boot();
})();
