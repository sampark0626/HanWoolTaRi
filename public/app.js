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
      $('go').disabled = true;
      return;
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
        $('go').disabled = true;
        $('startErr').textContent = s.ready === false
          ? '아직 준비 중입니다. 조금 뒤에 다시 들어와 주세요.'
          : '투표가 마감되었습니다.';
        $('startErr').hidden = false;
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
    const m = CFG.roster.find(x => x.v === v);
    $('picked').textContent = `${m ? m.label : v} 님으로 투표합니다`;
    $('picked').hidden = false;
    $('go').disabled = false;
    $('startErr').hidden = true;
    $('skip').hidden = true;
    if (CFG.needCode) { $('auth').hidden = false; }
    buildNames();
  }

  function start() {
    if (!voter) {
      $('startErr').textContent = '본인 이름을 골라주세요.';
      $('startErr').hidden = false; return;
    }
    if (CFG.needCode && !/^\d{4}$/.test($('code').value.trim())) {
      $('startErr').textContent = '전화번호 뒷 4자리를 넣어주세요.';
      $('startErr').hidden = false; $('code').focus(); return;
    }
    $('startErr').hidden = true;
    $('skip').hidden = true;
    enter();
  }

  // ---------- 들어가기 ----------
  // 이름 + 뒷 4자리로 두 가지를 한 번에 읽는다: 내 유니폼 투표, 보드에 적어둔 내 자리.
  // 자리를 아직 안 적었으면 선수 정보부터 받고, 적어뒀으면 바로 대시보드로 간다.
  //
  // 번호가 틀리면 지난 투표는 보여주지 않는다(남의 선택을 보는 창구가 되면 안 된다).
  // 그래도 막지는 않는다 — 「그냥 들어가기」로 넘어갈 수 있다.
  async function enter() {
    const btn = $('go'), was = btn.textContent;
    btn.disabled = true;
    btn.textContent = '불러오는 중…';
    try {
      const [v, b] = await Promise.all([fetchMine(), fetchBoard()]);
      if (v === 'badcode') {
        $('startErr').textContent = '전화번호 뒷 4자리가 맞지 않습니다.';
        $('startErr').hidden = false;
        $('skip').hidden = false;
        return;
      }
      MYVOTE = v;
      BOARD = b;
      readMe();
      if (me.pos.length) showHome(); else showPlayer();
    } catch (e) {
      MYVOTE = null; BOARD = null; me = { pos: [], foot: '' };
      showPlayer();                       // 조회가 안 되는 것이 입력을 막지는 않는다
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
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
    $('plWho').textContent = me.pos.length ? '자리를 고치시겠어요?' : '어디서 뛰시나요?';
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
      const r = await fetch('/api/board/positions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          member: voter, positions: me.pos, foot: me.foot || null,
          code: $('code').value.trim(), confirm: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '저장하지 못했습니다.');
      BOARD = await fetchBoard();
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
  $('go').addEventListener('click', start);
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') start(); });

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
  $('toHome').addEventListener('click', showHome);

  // 번호가 틀려도 들어갈 수는 있다. 지난 투표만 안 보여줄 뿐이다.
  $('skip').addEventListener('click', () => {
    MYVOTE = null;
    fetchBoard().then(b => { BOARD = b; readMe(); if (me.pos.length) showHome(); else showPlayer(); });
  });

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
  $('plSkip').addEventListener('click', showHome);
  $('cards').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'vote') toChoose();
    if (b.dataset.go === 'player') showPlayer();
  });
  $('hmBack').addEventListener('click', () => { show('start'); window.scrollTo(0, 0); });
  // 번호를 고쳐 넣기 시작하면 앞서 띄운 오류를 치운다
  $('code').addEventListener('input', () => {
    $('skip').hidden = true; $('startErr').hidden = true;
  });

  boot();
})();
