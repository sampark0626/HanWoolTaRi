// 17종을 한 화면에 늘어놓고, 마음에 드는 것을 골라 담는다.
// 고른 순서가 곧 순위다 — 1순위 3점, 2순위 2점, 3순위 1점.
// 대진표는 걷어냈다. 붙는 상대에 따라 결과가 흔들려 공정한 비교가 안 됐다.
(() => {
  const V = '14';          // 이미지를 교체하면 올린다 — 안 올리면 옛 그림이 남는다
  const $ = id => document.getElementById(id);
  const show = id => document.querySelectorAll('.screen')
    .forEach(s => s.classList.toggle('on', s.id === id));

  const C = window.BoardCore;
  const POSBY = Object.fromEntries(C.POSITIONS.map(p => [p.id, p]));
  // 위(상대 골대)에서 아래(우리 골대)로. 좌우를 안 묻기 때문에 한 줄에 한 자리씩 놓인다.
  const PITCH_ROWS = ['ST', 'WG', 'AM', 'CM', 'DM', 'SB', 'CB', 'GK'];
  const WIDE = { WG: 1, SB: 1 };          // 좌·우를 함께 덮는 자리 — 넓게 그린다

  let CFG = null, BY = {};
  let voter = '', picks = [], zi = 0;
  let me = { pos: [], foot: '' };         // 내 선수 정보
  let MYVOTE = null, BOARD = null;        // 대시보드가 보여줄 현재 상태
  let AKEY = '', ADMIN_EDIT = false;      // 관리자 키(이 탭에서만), 관리자가 남의 자리를 고치는 중인지
  let adTab = 'teams', adTeam = 0;
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
        // 투표만 닫힌 것이다. 자리 입력과 내 팀 보기는 그대로 되니 알리기만 한다.
        $('statusNote').textContent = s.ready === false
          ? '아직 준비 중입니다. 조금 뒤에 다시 들어와 주세요.'
          : '유니폼 투표는 마감되었습니다. 자리 입력과 팀 확인은 그대로 하실 수 있습니다.';
      }
    } catch (e) { /* 상태 조회 실패가 투표를 막지는 않는다 */ }
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
      const [v, b] = await Promise.all([fetchMine(), fetchBoard()]);
      BOARD = b;
      readMe();
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

  // 들어오면 **유니폼부터 확인**시키고, 그다음 자리를 받는다 (총무 확인 2026-10-17).
  // 둘 다 끝낸 사람은 대시보드로 바로 간다.
  function afterLogin() {
    if (me.pos.length) showHome(); else showKit();
  }

  // ---------- 내 유니폼 확인 ----------
  function showKit() {
    const m = CFG.roster.find(x => x.v === voter);
    $('ktWho').textContent = `${m ? m.label : voter} 님`;
    const voted = !!(MYVOTE && MYVOTE.voted);
    if (voted) {
      $('ktTitle').textContent = '이 유니폼을 고르셨습니다';
      $('ktLead').textContent = '맞으면 넘어가서 뛸 자리를 알려주세요.';
      $('ktList').innerHTML = MYVOTE.picks.map((id, i) => `
        <div class="mine"><b>${i + 1}순위</b><img src="/kits/${id}.jpg?v=${V}" alt="">
        <span>${BY[id] ? BY[id].name : id}</span></div>`).join('');
      $('ktList').hidden = false;
      $('ktNext').textContent = '확인했습니다 · 자리 고르러 가기';
    } else {
      $('ktTitle').textContent = '유니폼 투표를 아직 안 하셨습니다';
      $('ktLead').textContent = CFG.open === false
        ? '투표가 마감되었습니다.'
        : `2027 시즌 유니폼을 회원 투표로 정합니다. ${CFG.kits.length}종 중 ${need()}개, 2~3분이면 됩니다.`;
      $('ktList').hidden = true;
      $('ktNext').textContent = '나중에 하기 · 자리 고르러 가기';
    }
    $('ktVote').hidden = voted || CFG.open === false;
    $('ktRevote').hidden = !(voted && MYVOTE.canEdit);
    show('kit');
    window.scrollTo(0, 0);
  }

  async function fetchMine() {
    const r = await fetch('/api/mine', {
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
    $('plWho').textContent = ADMIN_EDIT ? '자리를 고쳐 주세요'
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

    // 유니폼 투표
    if (MYVOTE && MYVOTE.voted) {
      out.push(card('kit', '유니폼 투표', '하셨습니다',
        `<div class="mylist">${MYVOTE.picks.map((id, i) => `
          <div class="mine"><b>${i + 1}순위</b><img src="/kits/${id}.jpg?v=${V}" alt="">
          <span>${BY[id] ? BY[id].name : id}</span></div>`).join('')}</div>`,
        MYVOTE.canEdit
          ? '<button type="button" class="ghost" data-go="vote">다시 고르기</button>'
          : '<p class="note">투표가 마감되어 수정은 안 됩니다.</p>'));
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
        closed ? '<p class="note">입력 기간이 끝났습니다.</p>'
          : '<button type="button" class="ghost" data-go="player">고치기</button>'));
    } else if (!closed) {
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
      out.push(card('team', '내 팀', draft ? '아직 안 뽑히셨습니다' : '팀에 들지 않으셨습니다',
        `<p class="note">${draft
          ? '감독들이 한 명씩 번갈아 뽑는 중입니다. 조금 뒤에 다시 보세요.'
          : '이번 경기 팀에는 들어가지 않으셨습니다. 총무에게 문의해 주세요.'}</p>`));
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
    show('home');
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
        <i style="background:${color}">${first}</i><b>${esc(labOf(v))}</b></span>`;
    }).join('');
    const list = (BOARD.teams || [])[t] || [];
    const listHtml = list.map(v => {
      const ps = posOfV(v).join(' · ');
      return `<li${v === meV ? ' class="me"' : ''}><b>${esc(labOf(v))}</b>
        <span>${ps || '자리 미입력'}</span></li>`;
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
    $('tmList').innerHTML = tp.listHtml;

    show('team');
    window.scrollTo(0, 0);
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
    ADMIN_EDIT = false;
    adTab = 'pos';
    show('admin');
    renderAdmin();
    window.scrollTo(0, 0);
  }

  function renderAdmin() {
    document.querySelectorAll('#adTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === adTab));
    $('adTeams').hidden = adTab !== 'teams';
    $('adPos').hidden = adTab !== 'pos';
    if (!BOARD) {
      $('adTeams').innerHTML = $('adPos').innerHTML = '<p class="note">보드 정보를 불러오지 못했습니다. 잠시 뒤에 다시 열어 주세요.</p>';
      return;
    }
    if (adTab === 'teams') renderAdTeams(); else renderAdPos();
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
        ? `<div class="fpitch">${tp.field}</div>
           <p class="note">${tp.f.note ? '감독 메모 — ' + esc(tp.f.note) : '포메이션 ' + esc(tp.f.id || '')}</p>`
        : '<p class="note">감독이 아직 말을 배치하지 않았습니다. 팀원만 보여드립니다.</p>') +
        `<h3 class="sub">팀원 ${tp.list.length}명</h3><ul class="tmlist">${tp.listHtml}</ul>`;
    }
    $('adTeams').innerHTML =
      `<p class="note">현재 단계 — <b>${phase}</b> · 활동 ${(b.members || []).filter(m => m.active).length}명 중
        ${((b.teams || [])[0] || []).length + ((b.teams || [])[1] || []).length}명이 팀에 뽑힘</p>
       <div class="adseg" id="adSeg">${seg}</div>${body}`;
  }

  const FOOT_NAME = { R: '오른발', L: '왼발', B: '양발' };
  function renderAdPos() {
    const ms = (BOARD.members || []).slice()
      .sort((a, b) => (b.active - a.active) || a.label.localeCompare(b.label, 'ko'));
    const act = ms.filter(m => m.active);
    const done = act.filter(m => m.pos).length;
    $('adPos').innerHTML =
      `<p class="note">활동 ${act.length}명 중 <b>${done}명</b>이 입력했습니다. 누르면 고칠 수 있습니다.</p>
       <ul class="tmlist adpos">${ms.map(m => {
        const ps = (m.pos || []).map(id => (POSBY[id] ? POSBY[id].name : id)).join(' · ');
        const foot = FOOT_NAME[m.foot] || '';
        return `<li${m.active ? '' : ' class="off"'}>
          <div><b>${esc(m.label)}</b>${m.active ? '' : '<em>휴면</em>'}
          <span>${ps ? esc(ps) : '미입력'}${foot ? ' · ' + foot : ''}</span></div>
          <button type="button" class="adedit" data-v="${esc(m.v)}">${m.pos ? '고치기' : '입력'}</button></li>`;
      }).join('')}</ul>`;
  }

  function adminEdit(v) {
    const m = (BOARD.members || []).find(x => x.v === v);
    if (!m) return;
    ADMIN_EDIT = true;
    voter = v;
    me = { pos: (m.pos || []).slice(), foot: m.foot || '' };
    showPlayer();
  }

  // 투표 화면으로. 전에 고른 것이 있으면 그 위에서 고치게 한다.
  function toChoose() {
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
  $('ktNext').addEventListener('click', showPlayer);
  $('ktVote').addEventListener('click', toChoose);
  $('ktRevote').addEventListener('click', toChoose);
  $('tmBack').addEventListener('click', showHome);

  $('adminLink').addEventListener('click', e => { e.preventDefault(); adminOpen(); });
  $('adBack').addEventListener('click', () => { show('start'); window.scrollTo(0, 0); });
  $('adEnter').addEventListener('click', adminEnter);
  $('adKey').addEventListener('keydown', e => { if (e.key === 'Enter') adminEnter(); });
  $('adOut').addEventListener('click', () => {
    sset('kitKey', ''); AKEY = ''; show('start'); window.scrollTo(0, 0);
  });
  $('adTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    adTab = b.dataset.tab; renderAdmin();
  });
  $('adTeams').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    adTeam = +b.dataset.t; renderAdmin();
  });
  $('adPos').addEventListener('click', e => {
    const b = e.target.closest('.adedit'); if (!b) return;
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
    if (b.dataset.go === 'player') showPlayer();
    if (b.dataset.go === 'team') showTeam();
  });
  $('hmBack').addEventListener('click', () => { show('start'); window.scrollTo(0, 0); });
  // 폰 키보드로도 칠 수 있게 — 키패드와 같은 값을 넣는다
  document.addEventListener('keydown', e => {
    if (!$('pin').classList.contains('on')) return;
    if (/^[0-9]$/.test(e.key)) tapKey(e.key);
    else if (e.key === 'Backspace') tapKey('del');
  });

  boot();
})();
