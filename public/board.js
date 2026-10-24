// 자체전 포메이션 보드 화면.
//   ① 내 포지션  회원이 자기 자리를 1~3개 고른다. 활동 회원은 밝게, 휴면은 어둡게.
//   ② 팀 구성    일요일에 두 감독이 감독 모드로 들어와 한 명씩 번갈아 고른다(연령대 비율 맞춤) → 최종 확정.
//   ③ 포메이션   정해진 전술에서 출발해 말을 어디로든 끌어 놓는다. 보기는 누구나, 짜기는 그 팀 감독만.
(() => {
  const C = window.BoardCore;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // 저장소가 막힌 브라우저(사생활 보호 모드 등)에서도 화면은 떠야 한다.
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };

  const POS = Object.fromEntries(C.POSITIONS.map(p => [p.id, p]));
  const GCLS = { 골키퍼: 'g-gk', 수비: 'g-df', 미드필드: 'g-mf', 공격: 'g-fw' };
  const GROUPS = ['골키퍼', '수비', '미드필드', '공격'];
  const gOf = id => GCLS[POS[id].group];
  const splitLabel = l => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(l); return m ? [m[1], m[2]] : [l, '']; };
  const badges = pos => pos && pos.length
    ? `<span class="pbs">${pos.map((p, i) => `<i class="pb ${gOf(p)}${i ? ' s' : ''}">${p}</i>`).join('')}</span>`
    : '<span class="nopos">미입력</span>';
  const hm = iso => {
    const t = new Date(iso);
    return `${t.getMonth() + 1}/${t.getDate()} ${p2(t.getHours())}:${p2(t.getMinutes())}`;
  };

  const S = {
    data: null, byV: {}, tab: 'pos',
    show: 'all', posFilter: '', poolFilter: '',
    me: null,                         // 감독 로그인 {name, code}
    admin: ss.get('kitKey') || '',    // 투표 집계 화면과 같은 열쇠를 쓴다
    adminOk: false, actTeam: 0,
    mine: null,                       // 내 팀의 이번 라운드 지명 상태
    team: 0, teamInit: false,
    fm: [null, null], dirty: [false, false], ver: [0, 0], chain: [Promise.resolve(), Promise.resolve()],
    timers: [null, null], sel: null, busy: 0,
  };
  try { S.me = JSON.parse(ss.get('boardCoach') || 'null'); } catch (e) { S.me = null; }

  // 회원 페이지의 「감독」 탭 안에 들어갈 때 쓰는 모드. 감독·총무 로그인은 부모 페이지가
  // sessionStorage(boardCoach / kitKey)에 미리 넣어 두므로 여기서 다시 묻지 않는다.
  //   ?embed=1  머리글·바닥글·감독 나가기를 감춘다    ?tab=pos|draft|form  처음 탭
  //   ?team=0|1 총무가 한 팀을 대신 조작할 때 볼 팀
  const QS = new URLSearchParams(location.search);
  const EMBED = QS.get('embed') === '1';
  if (EMBED) document.body.classList.add('embed');
  if (['pos', 'draft', 'form'].includes(QS.get('tab'))) S.tab = QS.get('tab');
  if (QS.get('team') === '0' || QS.get('team') === '1') {
    S.actTeam = S.team = +QS.get('team'); S.teamInit = true;
  }

  const isAdmin = () => !!(S.admin && S.adminOk);
  const coachTeam = () => (S.data && S.me ? S.data.coaches.findIndex(c => c && c.v === S.me.name) : -1);
  const actTeam = () => (isAdmin()
    ? (S.data && S.data.phase === 'draft' && S.data.turn != null ? S.data.turn : S.actTeam)
    : coachTeam());
  const canEdit = t => isAdmin() || coachTeam() === t;
  const lab = v => (S.byV[v] ? S.byV[v].label : v);
  const kq = () => '?key=' + encodeURIComponent(S.admin);

  // ---------- 통신 ----------
  async function api(path, body) {
    const opt = body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    };
    const r = await fetch(path, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || '요청이 실패했습니다.'); e.status = r.status; throw e; }
    return j;
  }
  // 감독 요청: 총무 열쇠가 있으면 열쇠로, 아니면 이름+번호로 매번 확인받는다.
  function coachCall(path, extra, team) {
    if (isAdmin()) return api(path + kq(), { ...extra, team });
    return api(path, { ...extra, name: S.me.name, code: S.me.code });
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- 불러오기 ----------
  async function load() {
    try {
      const d = await api('/api/board');
      S.data = d;
      S.byV = Object.fromEntries(d.members.map(m => [m.v, m]));
      for (let t = 0; t < 2; t++) {
        if (!S.dirty[t]) {
          const f = d.formation[t];
          S.fm[t] = { id: f.id, pieces: JSON.parse(JSON.stringify(f.pieces)), note: f.note || '', at: f.at };
        }
      }
      if (!S.teamInit) { S.teamInit = true; const ct = coachTeam(); if (ct >= 0) S.team = ct; }
      if (S.me && coachTeam() < 0 && d.phase !== 'setup') logoutCoach(true);
      $('loadErr').hidden = true;
      await refreshMine();
      // 바뀐 게 없으면 다시 그리지 않는다 — 눌렀다 떼는 사이에 버튼이 새로 만들어져 클릭이 사라지는 걸 막는다.
      const sig = JSON.stringify([d, S.mine, isAdmin(), S.actTeam, S.me && S.me.name, S.dirty]);
      if (sig === S.sig) return;
      S.sig = sig;
      render();
    } catch (e) {
      $('loadErr').textContent = e.message || '불러오지 못했습니다.';
      $('loadErr').hidden = false;
      $('phase').textContent = '연결 안 됨';
    }
  }

  async function refreshMine() {
    S.mine = null;
    if (!S.data || (S.data.phase !== 'draft' && S.data.phase !== 'review')) return;
    const t = actTeam();
    if (t < 0) return;
    try { S.mine = await coachCall('/api/board/mine', {}, t); }
    catch (e) { if (e.status === 403 && !isAdmin()) logoutCoach(true); }
  }

  function logoutCoach(quiet) {
    S.me = null; ss.del('boardCoach'); S.mine = null;
    if (!quiet) toast('로그아웃했습니다.');
  }

  // ---------- 그리기 ----------
  function render() {
    if (!S.data) return;
    const d = S.data;
    const chip = $('phase');
    chip.className = 'b-chip' + (d.phase === 'draft' || d.phase === 'review' ? ' live' : d.phase === 'done' ? ' done' : '');
    chip.textContent = d.phase === 'draft' ? `팀 구성 중 · ${d.picks + 1}번째`
      : d.phase === 'review' ? '확정 대기' : d.phase === 'done' ? '팀 확정' : '준비 중';
    $('modeTag').hidden = !isAdmin();
    $('modeTag').textContent = '총무 모드';
    document.querySelectorAll('.b-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
    for (const k of ['pos', 'draft', 'form']) $('pane-' + k).classList.toggle('on', S.tab === k);
    if (S.tab === 'pos') renderPos();
    else if (S.tab === 'draft') renderDraft();
    else renderForm();
  }

  // ===== ① 포지션 =====
  function memHtml(m) {
    const [main, sub] = splitLabel(m.label);
    const g = m.pos ? gOf(m.pos[0]) : '';
    const cls = (m.active ? 'act' : 'off') + (m.active && !m.pos ? ' none' : '') + (m.active && g ? ' ' + g : '');
    return `<button type="button" class="b-mem ${cls}" data-act="mem" data-v="${esc(m.v)}"
        aria-label="${esc(m.label)}${m.active ? '' : ' (휴면)'}">
      <span class="ic"><b>${esc(main)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${m.active ? badges(m.pos) : '<span class="tag">휴면</span>'}</button>`;
  }

  // 포지션 입력 기간 안내
  const dayLabel = iso => {
    const t = new Date(iso);
    return `${t.getMonth() + 1}/${t.getDate()}(${'일월화수목금토'[t.getDay()]}) ${p2(t.getHours())}:${p2(t.getMinutes())}`;
  };
  function windowBanner(d) {
    const w = d.window || {};
    const range = w.from || w.to ? `${w.from ? dayLabel(w.from) : '지금'} ~ ${w.to ? dayLabel(w.to) : '제한 없음'}` : '';
    if (d.positionsState === 'before')
      return `<div class="b-strip warn"><span>아직 입력 기간이 아닙니다. <b>${range}</b>${isAdmin() ? ' (총무는 지금도 입력할 수 있습니다)' : ''}</span></div>`;
    if (d.positionsState === 'after')
      return `<div class="b-strip warn"><span>포지션 입력이 마감되었습니다. (${range})${isAdmin() ? ' 총무는 지금도 고칠 수 있습니다.' : ''}</span></div>`;
    return range ? `<div class="b-strip"><span>지금 입력할 수 있습니다. 마감 <b>${w.to ? dayLabel(w.to) : '없음'}</b></span></div>` : '';
  }

  function renderPos() {
    const d = S.data, ms = d.members;
    const act = ms.filter(m => m.active), off = ms.filter(m => !m.active);
    const filled = act.filter(m => m.pos).length;
    const count = id => act.filter(m => m.pos && m.pos.includes(id)).length;

    let list = ms.filter(m => S.show === 'all' || (S.show === 'act' ? m.active : !m.active));
    if (S.posFilter) {
      list = list.filter(m => m.pos && m.pos.includes(S.posFilter))
        .sort((a, b) => a.pos.indexOf(S.posFilter) - b.pos.indexOf(S.posFilter));
    } else {
      list = [...list].sort((a, b) => (b.active - a.active));
    }

    $('pane-pos').innerHTML = windowBanner(d) + `
      <div class="b-card">
        <h2>내 포지션 알리기</h2>
        <p>아래에서 <b>본인 아이콘</b>을 눌러 뛸 수 있는 자리를 1~3개 골라주세요.
           감독들이 일요일에 이 결과를 보고 팀을 꾸립니다. 다시 눌러 고치면 마지막 선택이 반영됩니다.</p>
        <div class="b-legend">
          <span><i class="dot on"></i>활동 회원 (밝게)</span><span><i class="dot off"></i>휴면 (어둡게 · 지명 대상 아님)</span>
          <span><i class="dot none"></i>아직 안 적음</span>
        </div>
        <p class="b-keys">밝은 아이콘의 색은 <b style="background:var(--gk)">GK</b><b style="background:var(--df)">수비</b><b style="background:var(--mf)">미드</b><b style="background:var(--fw)">공격</b> 주 포지션을 뜻합니다.</p>
      </div>
      <div class="b-prog">활동 회원 ${act.length}명 중 <b>${filled}명</b>이 입력했습니다
        <div class="b-bar2"><i style="width:${act.length ? Math.round(filled / act.length * 100) : 0}%"></i></div></div>
      <div class="b-seg">
        <button type="button" data-act="show" data-s="all" class="${S.show === 'all' ? 'on' : ''}">전체 ${ms.length}</button>
        <button type="button" data-act="show" data-s="act" class="${S.show === 'act' ? 'on' : ''}">활동 ${act.length}</button>
        <button type="button" data-act="show" data-s="off" class="${S.show === 'off' ? 'on' : ''}">휴면 ${off.length}</button>
      </div>
      <div class="b-poschips" aria-label="포지션별 보기">
        ${C.POSITIONS.map(p => `<button type="button" data-act="pf" data-p="${p.id}"
          class="b-pc${S.posFilter === p.id ? ' on' : ''}"><i class="pb ${gOf(p.id)}">${p.id}</i><b>${count(p.id)}</b></button>`).join('')}
      </div>
      ${list.length ? `<div class="b-grid">${list.map(memHtml).join('')}</div>`
        : '<p class="b-empty">조건에 맞는 회원이 없습니다.</p>'}`;
  }

  // 포지션 고르기 시트
  let ps = null;
  function openPos(v) {
    const m = S.byV[v]; if (!m) return;
    if (!S.data.positionsOpen && !isAdmin()) { toast(S.data.positionsState === 'before' ? '아직 입력 기간이 아닙니다.' : '포지션 입력이 마감되었습니다.'); return; }
    ps = { v, sel: (m.pos || []).slice(), foot: m.foot || '' };
    $('psTitle').textContent = `${m.label} 님의 포지션`;
    $('psCode').value = '';
    $('psAuth').hidden = !(S.data.needCode && !isAdmin());
    $('psErr').hidden = true; $('psForce').hidden = true; $('psSave').disabled = false;
    $('psAdmin').hidden = !isAdmin();
    $('psToggle').textContent = m.active ? '휴면으로 표시' : '활동으로 표시';
    $('psClear').hidden = !m.pos;
    buildPosGrid();
    $('posSheet').hidden = false; document.body.style.overflow = 'hidden'; S.busy++;
  }
  function closePos() {
    if ($('posSheet').hidden) return;
    $('posSheet').hidden = true; document.body.style.overflow = ''; S.busy = Math.max(0, S.busy - 1); ps = null;
  }
  function buildPosGrid() {
    $('psGrid').innerHTML = GROUPS.map(g => `<div class="b-pg"><h5>${g}</h5><div>
      ${C.POSITIONS.filter(p => p.group === g).map(p => {
        const at = ps.sel.indexOf(p.id);
        return `<button type="button" class="b-pbtn ${gOf(p.id)}${at >= 0 ? ' on' : ''}" data-p="${p.id}">
          <span class="rk">${at + 1}</span><b>${p.id}</b><small>${p.name}</small></button>`;
      }).join('')}</div></div>`).join('') +
      // 좌우를 묻지 않는 대신 주발을 받는다 — 왼쪽·오른쪽 자리는 이걸로 가늠한다
      `<div class="b-pg"><h5>주발</h5><div class="b-feet">
        ${C.FEET.map(f => `<button type="button" class="b-fbtn${ps.foot === f.id ? ' on' : ''}" data-f="${f.id}">${f.name}</button>`).join('')}
      </div></div>`;
  }
  function psError(msg) { $('psErr').textContent = msg; $('psErr').hidden = !msg; }
  async function savePos(force) {
    if (!ps.sel.length) return psError('포지션을 1개 이상 골라주세요.');
    const code = $('psCode').value.trim();
    if (S.data.needCode && !isAdmin() && !/^\d{4}$/.test(code)) return psError('전화번호 뒷 4자리를 넣어주세요.');
    psError(''); $('psSave').disabled = true; $('psForce').disabled = true;
    try {
      const j = await api('/api/board/positions' + (isAdmin() ? kq() : ''),
        { member: ps.v, positions: ps.sel, foot: ps.foot || null, code, confirm: force === true });
      if (j.mismatch) {
        psError('입력하신 번호가 기존 기록과 다릅니다. 오타인지 봐주세요. 맞는 번호라면 아래 버튼으로 그대로 저장할 수 있습니다.');
        $('psForce').hidden = false;
        return;
      }
      const who = lab(ps.v);
      closePos(); toast(`${who} 님 포지션을 저장했습니다.`); load();
    } catch (e) { psError(e.message); }
    finally { $('psSave').disabled = false; $('psForce').disabled = false; }
  }

  // ===== ② 팀 구성 =====
  const ruleHtml = d => `
    <details class="b-card b-rule"><summary>어떻게 고르나요? (규칙)</summary><ol>
      <li>일요일 경기에서 두 감독이 <b>감독 모드</b>로 들어와 <b>한 명씩 번갈아</b> 고릅니다. 선공은 추첨(또는 총무 지정)입니다.</li>
      ${d.ageOn ? `<li><b>연령대 비율</b>을 맞춥니다. 활동 회원 전체의 연령대 비율을 두 팀이 똑같이 나눠 갖도록, 한 팀이 한 연령대에서
        가져갈 수 있는 인원은 그 연령대 활동 회원의 절반(홀수면 올림)까지입니다. 팀 인원도 한 명 넘게 차이 나지 않게 같이 맞춥니다.</li>
      <li>고를 수 있는 선수가 없는 감독은 차례를 건너뜁니다.</li>` : ''}
      <li>모두 고르면 두 감독이 각각 <b>최종 확정</b>을 누릅니다. 둘 다 확정하면 팀이 잠깁니다.</li>
      <li>방금 고른 선수는 상대 감독이 고르기 전이면 되돌릴 수 있습니다.</li>
    </ol></details>`;

  function coachStrip(d) {
    if (!d.coaches[0]) return '';
    if (isAdmin()) {
      const note = d.phase === 'draft' ? `지금 ${d.names[d.turn]} 차례를 대신 조작합니다` : '모든 화면을 볼 수 있고 두 팀을 대신 조작할 수 있습니다';
      return `<div class="b-strip warn"><span>총무 모드 — ${esc(note)}</span></div>`;
    }
    const t = coachTeam();
    if (t >= 0) {
      return `<div class="b-strip coach" style="--tc:${d.colors[t]}"><span>✓ 감독 모드 · ${esc(d.names[t])} ${esc(d.coaches[t].label)}님</span>
        ${EMBED ? '' : '<button type="button" class="b-mini" data-act="logout">나가기</button>'}</div>`;
    }
    if (EMBED) return '';          // 임베드에서는 감독 로그인을 다시 묻지 않는다
    return `<div class="b-strip"><span>감독이신가요? 감독 모드로 들어가세요.</span>
      <button type="button" class="b-mini pri" data-act="coachLogin">감독 모드</button></div>`;
  }

  const bandTag = v => (S.mine && S.mine.bands && S.mine.bands[v]) ? `<i class="bandtag">${esc(S.mine.bands[v])}</i>` : '';

  function teamCard(d, t) {
    const members = d.teams[t];
    const rows = members.map(v => {
      const m = S.byV[v] || { label: v, pos: null };
      const isCo = d.coaches[t] && d.coaches[t].v === v;
      return `<li><span class="nm1">${esc(m.label)}</span>${isCo ? '<span class="co">감독</span>' : ''}${bandTag(v)}
        ${badges(m.pos)}${isAdmin() && !isCo ? `<button type="button" class="x" data-act="release" data-v="${esc(v)}">제외</button>` : ''}</li>`;
    }).join('');
    const turn = d.phase === 'draft' && d.turn === t ? ' turn' : '';
    return `<div class="b-team${turn}" style="--tc:${d.colors[t]}">
      <h3>${esc(d.names[t])}${turn ? ' <em class="now">선택 중</em>' : ''}<small>${d.coaches[t] ? `감독 ${esc(d.coaches[t].label)} · ` : ''}${members.length}명</small></h3>
      ${rows ? `<ul>${rows}</ul>` : '<p class="none">아직 팀원이 없습니다.</p>'}</div>`;
  }

  // 연령대별 두 팀 인원 — 감독·총무에게만 보인다(서버가 감독 요청에만 내려준다).
  function balanceCard(d) {
    const m = S.mine;
    if (!m || !m.balance) return '';
    const on = m.ageOn;
    const rows = m.balance.map(r => {
      const full = [0, 1].map(t => r.counts[t] >= r.cap);
      return `<tr><th>${esc(r.band)}</th><td>${r.total}</td><td>${r.cap}</td>
        <td class="${full[0] ? 'full' : ''}">${r.counts[0]}</td><td class="${full[1] ? 'full' : ''}">${r.counts[1]}</td></tr>`;
    }).join('');
    return `<details class="b-card b-bal"${on ? ' open' : ''}><summary>연령대 비율 ${on ? '' : '(맞춤 꺼짐)'}</summary>
      <table><thead><tr><th>연령대</th><th>활동</th><th>정원</th><th style="color:${d.colors[0]}">${esc(d.names[0])}</th><th style="color:${d.colors[1]}">${esc(d.names[1])}</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="b-balnote">정원 = 활동 회원의 절반(홀수면 올림). 정원이 찬 칸은 굵게 표시됩니다. 인원을 맞추기 위해 홀수 연령대의 "한 명 더"는 팀당 ${m.extra.max}곳까지입니다.</p></details>`;
  }

  function renderDraft() {
    const d = S.data;
    const t = actTeam();
    const mine = S.mine;
    const poolSet = d.pool;
    const activeN = d.members.filter(m => m.active).length;
    let status = '';

    if (d.phase === 'setup') {
      status = `<div class="b-card"><h2>일요일에 열립니다</h2>
        <p>${d.coaches[0]
          ? `감독이 정해졌습니다. <b>${esc(d.names[0])}</b> ${esc(d.coaches[0].label)} · <b>${esc(d.names[1])}</b> ${esc(d.coaches[1].label)}.`
          : '아직 감독이 정해지지 않았습니다.'}
           일요일 경기에서 두 감독이 감독 모드로 들어와 한 명씩 번갈아 팀을 꾸립니다.</p>
        <p>그 전에 <b>① 내 포지션</b>에서 각자 자리를 알려주세요. 활동 회원 ${activeN}명 중 ${d.members.filter(m => m.active && m.pos).length}명이 입력했습니다.</p></div>`;
    } else if (d.phase === 'draft') {
      const mt = mine && mine.myTurn;
      status = `<div class="b-card turn${mt ? ' myturn' : ''}"><h2>${d.picks + 1}번째 선택 — ${esc(d.names[d.turn])} 차례</h2>
        <p>${mt ? '<b>지금 내 차례입니다.</b> 아래 남은 선수에서 한 명을 골라주세요.'
          : `${esc(d.coaches[d.turn].label)} 감독이 고르는 중입니다. 남은 선수 ${poolSet.length}명.`}</p>
        <div class="b-round">${[0, 1].map(i => `<div class="b-co${d.turn === i ? ' ok' : ''}" style="--tc:${d.colors[i]}"><small>${esc(d.names[i])}${d.first === i ? ' · 선공' : ''}</small>
          <b>${esc(d.coaches[i].label)}</b><em>${d.turn === i ? '선택 중' : '대기'} · ${d.teams[i].length}명</em></div>`).join('')}</div>
        ${mine && mine.canUndo ? `<button type="button" class="ghost" data-act="undo" style="margin-top:12px">방금 고른 선수 되돌리기</button>` : ''}</div>`;
    } else if (d.phase === 'review') {
      const btns = [0, 1].map(i => {
        const can = isAdmin() || t === i;
        return `<div class="b-co${d.confirmed[i] ? ' ok' : ''}" style="--tc:${d.colors[i]}"><small>${esc(d.names[i])}</small>
          <b>${esc(d.coaches[i].label)}</b><em>${d.confirmed[i] ? '확정 ✓' : '확정 전'} · ${d.teams[i].length}명</em>
          ${can ? `<button type="button" class="b-mini ${d.confirmed[i] ? '' : 'pri'}" data-act="confirm" data-t="${i}" data-v="${d.confirmed[i] ? 0 : 1}" style="margin-top:8px">${d.confirmed[i] ? '확정 취소' : '최종 확정'}</button>` : ''}</div>`;
      }).join('');
      status = `<div class="b-card turn"><h2>선택이 끝났습니다</h2>
        <p>팀을 확인하고 두 감독이 각각 <b>최종 확정</b>을 누르면 팀이 잠깁니다.${poolSet.length ? ` (팀이 없는 활동 회원 ${poolSet.length}명)` : ''}</p>
        <div class="b-round">${btns}</div>
        ${mine && mine.canUndo ? `<button type="button" class="ghost" data-act="undo" style="margin-top:12px">방금 고른 선수 되돌리기</button>` : ''}</div>`;
    } else {
      status = `<div class="b-card"><h2>팀이 확정되었습니다</h2>
        <p>${esc(d.names[0])} ${d.teams[0].length}명 · ${esc(d.names[1])} ${d.teams[1].length}명.
           <b>③ 포메이션</b> 탭에서 감독이 짠 라인업을 볼 수 있습니다.</p></div>`;
    }

    const teams = d.phase === 'setup' ? '' : `<div class="b-teams">${teamCard(d, 0)}${teamCard(d, 1)}</div>`;

    // 남은 선수
    let pool = '';
    if (d.phase === 'draft' || (d.phase === 'review' && poolSet.length)) {
      let list = poolSet.map(v => S.byV[v]).filter(Boolean);
      if (S.poolFilter) {
        list = list.filter(m => m.pos && m.pos.includes(S.poolFilter))
          .sort((a, b) => a.pos.indexOf(S.poolFilter) - b.pos.indexOf(S.poolFilter));
      } else {
        list = [...list].sort((a, b) => (!!b.pos - !!a.pos));
      }
      const myTurn = d.phase === 'draft' && mine && mine.myTurn;
      const rows = list.map(m => {
        const [main, sub] = splitLabel(m.label);
        const why = mine && mine.blocked && mine.blocked[m.v];
        let btn = '';
        if (myTurn) {
          btn = why
            ? `<span class="blockedtag">${why === 'band' ? '정원 참' : '인원 균형'}</span>`
            : `<button type="button" class="b-mini pri" data-act="pick" data-v="${esc(m.v)}">선택</button>`;
        }
        return `<div class="b-row${why && myTurn ? ' dim' : ''}">
          <span class="ic"><b>${esc(main)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
          <div class="who"><b>${esc(m.label)}</b>${bandTag(m.v)}${badges(m.pos)}</div>${btn}</div>`;
      }).join('');
      pool = `<h2 class="b-h">남은 선수 <small>${poolSet.length}명${S.poolFilter ? ` · ${S.poolFilter} 보기` : ''}</small></h2>
        <div class="b-poschips">
          <button type="button" data-act="pool" data-p="" class="b-pc${S.poolFilter ? '' : ' on'}">전체</button>
          ${C.POSITIONS.map(p => `<button type="button" data-act="pool" data-p="${p.id}"
            class="b-pc${S.poolFilter === p.id ? ' on' : ''}"><i class="pb ${gOf(p.id)}">${p.id}</i></button>`).join('')}
        </div>
        ${rows ? `<div class="b-pool">${rows}</div>` : '<p class="b-empty">조건에 맞는 선수가 없습니다.</p>'}`;
    }

    const logs = d.log.length ? `<details class="b-card"><summary style="cursor:pointer;font-weight:900;font-size:14px">진행 기록 (${d.log.length})</summary>
      <ul class="b-log">${d.log.map(l => `<li><time>${hm(l.t)}</time><span class="${l.kind}">${esc(l.text)}</span></li>`).join('')}</ul></details>` : '';

    $('pane-draft').innerHTML = coachStrip(d) + status + balanceCard(d) + (d.phase === 'setup' ? '' : ruleHtml(d)) + teams + pool +
      (d.phase === 'setup' ? ruleHtml(d) : '') + `<div style="height:14px"></div>` + logs;
  }

  // 감독 모드 동작. 총무는 지금 차례인 팀을 대신한다.
  async function coachDo(path, extra, okMsg) {
    try {
      const j = await coachCall(path, extra, actTeam());
      S.mine = j;
      if (okMsg) toast(okMsg);
    } catch (e) { toast(e.message); }
    S.sig = null;
    load();
  }
  const pickPlayer = v => coachDo('/api/board/pick', { player: v }, `${lab(v)} 님을 선택했습니다.`);

  // 감독 확인 시트
  let csPick = '';
  function openCoach() {
    const d = S.data;
    csPick = '';
    $('csWho').innerHTML = [0, 1].map(t => `<button type="button" data-n="${esc(d.coaches[t].v)}">
      ${esc(d.coaches[t].label)}<small>${esc(d.names[t])} 감독</small></button>`).join('');
    $('csCode').value = ''; $('csErr').hidden = true;
    $('coachSheet').hidden = false; document.body.style.overflow = 'hidden'; S.busy++;
  }
  function closeCoach() {
    if ($('coachSheet').hidden) return;
    $('coachSheet').hidden = true; document.body.style.overflow = ''; S.busy = Math.max(0, S.busy - 1);
  }
  async function coachLogin() {
    const code = $('csCode').value.trim();
    const err = m => { $('csErr').textContent = m; $('csErr').hidden = false; };
    if (!csPick) return err('감독 이름을 골라주세요.');
    if (!/^\d{4}$/.test(code)) return err('전화번호 뒷 4자리를 넣어주세요.');
    $('csGo').disabled = true;
    try {
      await api('/api/board/mine', { name: csPick, code });
      S.me = { name: csPick, code };
      ss.set('boardCoach', JSON.stringify(S.me));
      closeCoach(); toast('감독으로 확인했습니다.');
      S.team = coachTeam() >= 0 ? coachTeam() : S.team;
      load();
    } catch (e) { err(e.message); }
    finally { $('csGo').disabled = false; }
  }

  // ===== ③ 포메이션 =====
  const LINES = `<svg class="lines" viewBox="0 0 680 1050" preserveAspectRatio="none" aria-hidden="true">
    <g fill="none" stroke="rgba(255,255,255,.72)" stroke-width="3">
      <rect x="20" y="20" width="640" height="1010"/><line x1="20" y1="525" x2="660" y2="525"/>
      <circle cx="340" cy="525" r="91.5"/>
      <rect x="138.5" y="20" width="403" height="165"/><rect x="248.5" y="20" width="183" height="55"/>
      <rect x="138.5" y="865" width="403" height="165"/><rect x="248.5" y="975" width="183" height="55"/>
      <path d="M266.9 185 A91.5 91.5 0 0 0 413.1 185"/><path d="M266.9 865 A91.5 91.5 0 0 1 413.1 865"/>
      <path d="M20 40 A20 20 0 0 0 40 20"/><path d="M640 20 A20 20 0 0 0 660 40"/>
      <path d="M20 1010 A20 20 0 0 1 40 1030"/><path d="M640 1030 A20 20 0 0 1 660 1010"/>
    </g>
    <g fill="rgba(255,255,255,.8)"><circle cx="340" cy="525" r="4"/><circle cx="340" cy="130" r="4"/><circle cx="340" cy="920" r="4"/></g>
  </svg>`;

  const posOf = v => (S.byV[v] && S.byV[v].pos) || [];
  const footOf = v => (S.byV[v] && S.byV[v].foot) || null;
  const onField = t => Object.keys(S.fm[t].pieces);

  function tokHtml(n, p, t) {
    const m = S.byV[n] || { label: n, pos: null };
    const [main, sub] = splitLabel(m.label);
    const first = m.pos ? m.pos[0] : '';
    return `<div class="tok${first === 'GK' ? ' gk' : ''}${S.sel === n ? ' sel' : ''}" data-n="${esc(n)}"
      style="left:${p.x * 100}%;top:${p.y * 100}%"><span class="c">${first || '·'}</span>
      <span class="l">${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></div>`;
  }

  function renderForm() {
    if (document.activeElement && document.activeElement.id === 'fmNote') return;   // 메모 쓰는 중에는 건드리지 않는다
    const d = S.data, t = S.team, pane = $('pane-form');
    const seg = `<div class="b-seg">${[0, 1].map(i => `<button type="button" data-act="team" data-t="${i}" class="${t === i ? 'on' : ''}">
      ${esc(d.names[i])}${d.coaches[i] ? ' · ' + esc(d.coaches[i].label) : ''}</button>`).join('')}</div>`;
    if (d.phase === 'setup' || !d.teams[t].length) {
      pane.innerHTML = seg + `<div class="b-empty">아직 팀이 정해지지 않았습니다.<br>② 팀 구성이 진행되면 여기서 포메이션을 볼 수 있습니다.</div>`;
      return;
    }
    const f = S.fm[t], edit = canEdit(t), team = d.teams[t];
    if (S.sel && !team.includes(S.sel)) S.sel = null;
    const bench = team.filter(v => !(v in f.pieces))
      .sort((a, b) => (!!posOf(b).length - !!posOf(a).length));
    const color = d.colors[t];

    const head = `<div class="b-fhead"><b>${esc(f.id)}</b>
      <span>${edit ? '말을 끌어 원하는 곳에 놓으세요' : '감독이 짠 라인업입니다'}</span>
      ${edit ? `<button type="button" class="b-mini" data-act="auto">자동 배치</button>` : ''}</div>`;
    const chips = edit ? `<div class="b-fchips" style="--tc:${color}">${C.FORMATIONS.map(x =>
      `<button type="button" data-act="fm" data-f="${x.id}" class="${x.id === f.id ? 'on' : ''}">${x.id}</button>`).join('')}</div>` : '';

    const def = C.FORMATION_BY_ID[f.id];
    const slots = def.slots.map(s => `<i class="fslot" style="left:${s.x * 100}%;top:${s.y * 100}%">${s.role}</i>`).join('');
    const toks = Object.entries(f.pieces).map(([n, p]) => tokHtml(n, p, t)).join('');
    const pitch = `<div class="b-pitch${edit ? '' : ' ro'}" id="pitch" style="--tc:${color}">${LINES}${slots}${toks}</div>`;

    let sel = '<div class="b-sel hint">말이나 벤치 선수를 누르면 정보가 나옵니다.</div>';
    if (S.sel) {
      const m = S.byV[S.sel], on = S.sel in f.pieces;
      sel = `<div class="b-sel"><div class="who"><b>${esc(m.label)}</b>${badges(m.pos)}</div>
        ${edit ? (on ? `<button type="button" class="b-mini" data-act="tobench">벤치로</button>`
          : `<button type="button" class="b-mini pri" data-act="tofield">필드에 올리기</button>`) : ''}</div>`;
    }

    const benchHtml = `<div class="b-bench" id="bench"><h4>벤치 · 교체 ${bench.length}명${edit ? ' (끌어서 필드에 올리고, 필드의 말을 여기로 끌면 벤치로)' : ''}</h4>
      <div class="bl">${bench.map(v => `<span class="bn${S.sel === v ? ' sel' : ''}" data-n="${esc(v)}">${esc(lab(v))}${badges(posOf(v))}</span>`).join('') ||
        '<span class="nopos">벤치 선수가 없습니다</span>'}</div></div>`;

    const note = edit
      ? `<textarea id="fmNote" class="b-note" maxlength="300" placeholder="작전 메모 — 예) 좌측 풀백은 오버래핑, 세트피스는 ○○가 맡기">${esc(f.note)}</textarea>`
      : (f.note ? `<div class="b-notero">${esc(f.note)}</div>` : '');
    const saved = `<div class="b-save" id="saveState">${f.at ? '마지막 저장 ' + hm(f.at) : (edit ? '아직 저장된 라인업이 없습니다.' : '감독이 아직 라인업을 올리지 않았습니다.')}</div>`;

    pane.innerHTML = seg + head + chips + pitch + sel + benchHtml + note + saved;
  }

  // ----- 편집 -----
  const setSave = txt => { const el = $('saveState'); if (el) el.textContent = txt; };

  function touch(t) {
    S.dirty[t] = true; S.ver[t]++;
    setSave('저장 중…');
    clearTimeout(S.timers[t]);
    S.timers[t] = setTimeout(() => flush(t), 350);
  }
  function flush(t) {
    S.chain[t] = S.chain[t].then(async () => {
      const v = S.ver[t], f = S.fm[t];
      try {
        const j = await coachCall('/api/board/formation',
          { formation: f.id, pieces: f.pieces, note: f.note }, t);
        f.at = j.formation.at;
        if (S.ver[t] === v) S.dirty[t] = false;
        if (S.team === t) setSave('저장됨 ' + hm(f.at));
      } catch (e) {
        S.dirty[t] = false; toast(e.message);
        if (e.status === 403 && !isAdmin()) logoutCoach(true);
        load();
      }
    });
  }

  function placeAt(t, name, x, y) {
    const f = S.fm[t], on = onField(t);
    if (!(name in f.pieces) && on.length >= C.FIELD_MAX) {          // 필드가 가득 — 가장 가까운 선수와 교체
      let best = null, bd = 9;
      for (const n of on) {
        const p = f.pieces[n], dd = Math.hypot(p.x - x, p.y - y);
        if (dd < bd) { bd = dd; best = n; }
      }
      delete f.pieces[best];
      toast(`${lab(best)} ↔ ${lab(name)} 교체`);
    }
    f.pieces[name] = { x: Math.round(clamp(x, .03, .97) * 1000) / 1000, y: Math.round(clamp(y, .03, .97) * 1000) / 1000 };
    touch(t);
  }

  // 비어 있는 슬롯 중 이 선수에게 가장 잘 맞는 자리에 올린다.
  function placeBest(t, name) {
    const f = S.fm[t];
    if (onField(t).length >= C.FIELD_MAX) {
      toast('필드가 가득 찼습니다. 선수를 벤치로 보내거나, 벤치 선수를 필드의 말 위로 끌어 교체하세요.');
      return;
    }
    const taken = Object.values(f.pieces);
    const free = C.FORMATION_BY_ID[f.id].slots.filter(s => !taken.some(p => Math.hypot(p.x - s.x, p.y - s.y) < .07));
    let best = { x: .5, y: .5 }, bc = Infinity;
    for (const s of free) { const c = C.fitCost(posOf(name), s.role, footOf(name)); if (c < bc) { bc = c; best = s; } }
    f.pieces[name] = { x: best.x, y: best.y };
    touch(t);
  }

  function toBench(t, name) { delete S.fm[t].pieces[name]; touch(t); }

  // 포메이션을 바꾸면 지금 필드에 있는 선수들을 새 모양에 다시 앉힌다. 벤치는 그대로.
  function changeFormation(t, id) {
    const f = S.fm[t], cur = onField(t);
    const names = cur.length ? cur : S.data.teams[t];
    f.id = id;
    f.pieces = C.autoLayout(id, names, posOf, footOf);
    touch(t);
  }
  function autoAll(t) {
    const f = S.fm[t];
    f.pieces = C.autoLayout(f.id, S.data.teams[t], posOf, footOf);
    touch(t);
  }

  // ----- 끌기 -----
  let drag = null, ghost = null;
  const pitchEl = () => $('pitch');
  const inRect = (el, x, y) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const xy = e => {
    const r = pitchEl().getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  $('pane-form').addEventListener('pointerdown', e => {
    const el = e.target.closest('.tok, .bn');
    if (!el) return;
    drag = { name: el.dataset.n, el, bench: el.classList.contains('bn'), id: e.pointerId,
      sx: e.clientX, sy: e.clientY, moved: false, edit: canEdit(S.team), t: S.team };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  });

  $('pane-form').addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || !drag.edit) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (!drag.moved) { drag.moved = true; S.busy++; drag.el.classList.add('drag'); }
    if (drag.bench) {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'ghost-chip';
        ghost.style.setProperty('--tc', S.data.colors[drag.t]);
        ghost.textContent = lab(drag.name);
        document.body.appendChild(ghost);
      }
      ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    } else {
      const p = xy(e);
      drag.x = clamp(p.x, .03, .97); drag.y = clamp(p.y, .03, .97);
      drag.el.style.left = drag.x * 100 + '%'; drag.el.style.top = drag.y * 100 + '%';
      $('bench').classList.toggle('over', inRect($('bench'), e.clientX, e.clientY));
    }
  });

  function endDrag(e, cancel) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (ghost) { ghost.remove(); ghost = null; }
    if (d.moved) S.busy = Math.max(0, S.busy - 1);
    if (cancel) { renderForm(); return; }
    if (!d.moved) {                                   // 그냥 눌렀다 — 선택
      S.sel = S.sel === d.name ? null : d.name; renderForm(); return;
    }
    if (d.bench) {
      if (inRect(pitchEl(), e.clientX, e.clientY)) { const p = xy(e); placeAt(d.t, d.name, p.x, p.y); }
    } else if (inRect($('bench'), e.clientX, e.clientY)) {
      toBench(d.t, d.name);
    } else {
      S.fm[d.t].pieces[d.name] = { x: Math.round(d.x * 1000) / 1000, y: Math.round(d.y * 1000) / 1000 };
      touch(d.t);
    }
    renderForm();
  }
  $('pane-form').addEventListener('pointerup', e => endDrag(e, false));
  $('pane-form').addEventListener('pointercancel', e => endDrag(e, true));

  $('pane-form').addEventListener('input', e => {
    if (e.target.id !== 'fmNote') return;
    S.fm[S.team].note = e.target.value; touch(S.team);
  });
  $('pane-form').addEventListener('focusout', e => { if (e.target.id === 'fmNote') renderForm(); });

  // ===== 총무 =====
  // 다가오는 토요일 하루 (오늘이 토요일이면 오늘). datetime-local 값(브라우저 시간대 = 한국)으로 돌려준다.
  const localInput = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  function nextSaturday() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + ((6 - t.getDay() + 7) % 7));
    const end = new Date(t); end.setDate(end.getDate() + 1);
    return { from: t, to: end };
  }

  function adminHtml() {
    const d = S.data;
    if (!isAdmin()) {
      return `<p>비밀번호를 넣으면 총무 기능이 열립니다. (유니폼 투표 집계 화면과 같은 비밀번호)</p>
        <div class="b-form"><label for="asKey">비밀번호</label><input id="asKey" type="password" autocomplete="off"></div>
        <p id="asErr" class="err" hidden></p>
        <button type="button" class="primary" data-act="asLogin" style="margin-top:12px">열기</button>`;
    }
    const opt = sel => '<option value="">선택</option>' + d.members.map(m =>
      `<option value="${esc(m.v)}"${m.v === sel ? ' selected' : ''}>${esc(m.label)}${m.active ? '' : ' (휴면)'}</option>`).join('');
    const w = d.window || {};
    const sat = nextSaturday();
    const ageWarn = S.adminInfo && !S.adminInfo.ageOn
      ? '<p class="err" style="margin:0 0 10px">연령대 정보(AGE 환경변수)가 없어서 연령대 비율 맞춤이 꺼져 있습니다.</p>' : '';

    const hub = `<div class="b-adminblock"><h4>모든 화면 보기</h4><div class="b-adminrow">
        <a class="b-mini" href="/results.html">유니폼 투표 집계</a>
        <a class="b-mini" href="/">유니폼 투표 화면</a></div>
        <p style="font-size:12px;color:var(--mute);line-height:1.6;margin-top:8px">이 보드의 ①②③ 탭은 총무에게 모두 열려 있고, 두 팀을 대신 조작할 수 있습니다.
          팀 구성 탭에서는 연령대와 지금 차례인 팀의 선택 버튼이 보입니다.</p></div>`;

    const win = `<div class="b-adminblock b-form"><h4>회원 포지션 입력 기간 (토요일 하루)</h4>
        <p style="font-size:13px;color:var(--mute);line-height:1.6">기간 밖에는 회원이 입력할 수 없습니다. 비워 두면 항상 열려 있습니다. 총무는 언제든 입력할 수 있습니다.</p>
        <div class="two stack"><div><label for="asWF">시작</label><input id="asWF" type="datetime-local" value="${w.from ? localInput(new Date(w.from)) : ''}"></div>
        <div><label for="asWT">마감</label><input id="asWT" type="datetime-local" value="${w.to ? localInput(new Date(w.to)) : ''}"></div></div>
        <div class="b-adminrow" style="margin-top:10px">
          <button type="button" class="b-mini pri" data-act="asWin">기간 저장</button>
          <button type="button" class="b-mini" data-act="asWinSat">토요일 하루로 (${sat.from.getMonth() + 1}/${sat.from.getDate()})</button>
          <button type="button" class="b-mini" data-act="asWinOpen">항상 열기</button></div></div>`;

    let flow = '';
    if (d.phase === 'setup') {
      flow = `<div class="b-adminblock b-form"><h4>감독 두 명 지정</h4>
        <div class="two"><div><label for="asC0">${esc(d.names[0])} 감독</label><select id="asC0">${opt(d.coaches[0] && d.coaches[0].v)}</select></div>
        <div><label for="asC1">${esc(d.names[1])} 감독</label><select id="asC1">${opt(d.coaches[1] && d.coaches[1].v)}</select></div></div>
        <div class="two"><div><label for="asN0">팀 이름</label><input id="asN0" type="text" maxlength="12" value="${esc(d.names[0])}"></div>
        <div><label for="asN1">팀 이름</label><input id="asN1" type="text" maxlength="12" value="${esc(d.names[1])}"></div></div>
        <div class="two"><div><label for="asK0">팀 색</label><input id="asK0" type="color" value="${esc(d.colors[0])}"></div>
        <div><label for="asK1">팀 색</label><input id="asK1" type="color" value="${esc(d.colors[1])}"></div></div>
        <button type="button" class="primary" data-act="asSetup" style="margin-top:12px">감독 저장</button>
        <p style="font-size:12px;color:var(--mute);line-height:1.6;margin-top:8px">지정된 감독은 본인 이름과 전화번호 뒷 4자리로 <b>감독 모드</b>에 들어옵니다.</p></div>
        <div class="b-adminblock b-form"><h4>일요일: 팀 구성 시작</h4>
        ${ageWarn}
        <p style="font-size:13px;color:var(--mute);line-height:1.6;margin-bottom:10px">휴면이 아닌 회원 ${d.pool.length}명이 선택 대상입니다. 시작하면 감독을 바꿀 수 없습니다.</p>
        <label for="asFirst">선공</label>
        <select id="asFirst"><option value="">추첨 (기본)</option>
          <option value="0">${esc(d.names[0])}</option><option value="1">${esc(d.names[1])}</option></select>
        <button type="button" class="primary" data-act="asStart" style="margin-top:12px" ${d.coaches[0] ? '' : 'disabled'}>팀 구성 시작</button></div>`;
    } else {
      flow = `<div class="b-adminblock"><h4>진행 (${{ draft: '선택 중', review: '확정 대기', done: '확정됨' }[d.phase]})</h4><div class="b-adminrow">
        ${d.phase === 'draft' ? '<button type="button" class="b-mini" data-act="asFinish">여기서 선택 마감 (남은 선수는 팀 없음)</button>' : ''}
        ${d.phase === 'review' || d.phase === 'done' ? '<button type="button" class="b-mini" data-act="asReopen">한 단계 되돌리기</button>' : ''}
        <button type="button" class="b-mini danger" data-act="asReset">처음으로 되돌리기</button></div>
        <p style="font-size:12px;color:var(--mute);line-height:1.6;margin-top:8px">팀 구성 탭에서 각 팀원의 <b>제외</b>를 누르면 한 명씩 풀로 돌릴 수 있습니다. 지금 차례인 팀의 선택·되돌리기·확정은 총무가 대신할 수 있습니다.</p></div>`;
    }
    const bal = d.phase === 'setup' || d.phase === 'draft'
      ? `<div class="b-adminblock"><h4>연령대 비율 맞춤</h4><div class="b-adminrow">
          <button type="button" class="b-mini ${d.ageOn ? 'pri' : ''}" data-act="asBal" data-on="1">켜기</button>
          <button type="button" class="b-mini ${d.ageOn ? '' : 'pri'}" data-act="asBal" data-on="0">끄기</button></div></div>` : '';
    return hub + win + flow + bal + `<div class="b-adminblock"><h4>번호가 달라 표시만 남은 포지션 입력</h4><p id="asFlags" style="font-size:13px;color:var(--mute)">확인 중…</p></div>
      <div class="b-adminblock"><button type="button" class="ghost" data-act="asLogout" style="margin:0">총무 모드 끝내기</button></div>`;
  }
  async function openAdmin() {
    $('asBody').innerHTML = adminHtml();
    $('adminSheet').hidden = false; document.body.style.overflow = 'hidden'; S.busy++;
    if (isAdmin()) { loadFlags(); loadAdminInfo(); }
  }
  function closeAdmin() {
    if ($('adminSheet').hidden) return;
    $('adminSheet').hidden = true; document.body.style.overflow = ''; S.busy = Math.max(0, S.busy - 1);
  }
  async function loadFlags() {
    try {
      const j = await api('/api/board/admin/flags' + kq());
      const el = $('asFlags');
      if (el) el.textContent = j.flagged.length ? j.flagged.map(lab).join(', ') : '없습니다.';
    } catch (e) { /* 표시만 못 할 뿐이다 */ }
  }
  async function loadAdminInfo() {
    try {
      S.adminInfo = await api('/api/board/admin/check' + kq());
      if (!$('adminSheet').hidden && S.adminInfo && !S.adminInfo.ageOn) $('asBody').innerHTML = adminHtml();
    } catch (e) { /* 안내만 못 보일 뿐이다 */ }
  }
  async function adminCheck(key) {
    S.adminInfo = await api('/api/board/admin/check?key=' + encodeURIComponent(key));
    S.admin = key; S.adminOk = true; ss.set('kitKey', key);
  }
  async function adminDo(path, body, okMsg, qs) {
    try {
      await api(path + kq() + (qs || ''), body || {});
      toast(okMsg);
      await load();
      if (!$('adminSheet').hidden) { $('asBody').innerHTML = adminHtml(); loadFlags(); }
    } catch (e) { toast(e.message); }
  }

  // ---------- 이벤트 ----------
  document.querySelector('.b-tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    S.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
  });

  $('main').addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, d = S.data;
    if (a === 'mem') openPos(el.dataset.v);
    else if (a === 'show') { S.show = el.dataset.s; renderPos(); }
    else if (a === 'pf') { S.posFilter = S.posFilter === el.dataset.p ? '' : el.dataset.p; renderPos(); }
    else if (a === 'pool') { S.poolFilter = el.dataset.p; renderDraft(); }
    else if (a === 'coachLogin') openCoach();
    else if (a === 'logout') { logoutCoach(); render(); }
    else if (a === 'pick') pickPlayer(el.dataset.v);
    else if (a === 'undo') coachDo('/api/board/undo', {}, '되돌렸습니다.');
    else if (a === 'confirm') {
      const t = +el.dataset.t, v = el.dataset.v === '1';
      try { await coachCall('/api/board/confirm', { value: v }, t); toast(v ? '최종 확정했습니다.' : '확정을 취소했습니다.'); }
      catch (err) { toast(err.message); }
      S.sig = null; load();
    }
    else if (a === 'release') {
      if (!confirm(`${lab(el.dataset.v)} 님을 팀에서 빼고 선수 풀로 돌릴까요?`)) return;
      adminDo('/api/board/admin/release', { player: el.dataset.v }, '풀로 돌렸습니다.');
    }
    else if (a === 'team') { S.team = +el.dataset.t; S.sel = null; renderForm(); }
    else if (a === 'fm') { if (canEdit(S.team)) { changeFormation(S.team, el.dataset.f); renderForm(); } }
    else if (a === 'auto') { if (canEdit(S.team)) { autoAll(S.team); renderForm(); toast('포지션을 보고 자동으로 앉혔습니다. 끌어서 고쳐 주세요.'); } }
    else if (a === 'tobench') { toBench(S.team, S.sel); renderForm(); }
    else if (a === 'tofield') { placeBest(S.team, S.sel); renderForm(); }
    void d;
  });

  $('adminBtn').addEventListener('click', openAdmin);
  $('asClose').addEventListener('click', closeAdmin);
  $('adminSheet').addEventListener('click', async e => {
    if (e.target.id === 'adminSheet') return closeAdmin();
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, d = S.data;
    if (a === 'asLogin') {
      const key = $('asKey').value.trim(); if (!key) return;
      try { await adminCheck(key); await load(); $('asBody').innerHTML = adminHtml(); loadFlags(); }
      catch (err) { const m = $('asErr'); m.textContent = err.message; m.hidden = false; }
    } else if (a === 'asLogout') {
      S.admin = ''; S.adminOk = false; ss.del('kitKey'); closeAdmin(); toast('총무 모드를 껐습니다.'); load();
    } else if (a === 'asSetup') {
      const c0 = $('asC0').value, c1 = $('asC1').value;
      adminDo('/api/board/admin/setup', {
        coaches: [c0, c1], names: [$('asN0').value, $('asN1').value], colors: [$('asK0').value, $('asK1').value],
      }, '감독을 저장했습니다.');
    } else if (a === 'asStart') {
      const fv = $('asFirst').value;
      if (confirm(`${d.pool.length}명을 대상으로 팀 구성을 시작할까요?\n시작하면 감독을 바꿀 수 없습니다.`))
        adminDo('/api/board/admin/start', fv === '' ? {} : { first: +fv }, '팀 구성을 시작했습니다.');
    } else if (a === 'asWin') {
      const iso = v => (v ? new Date(v).toISOString() : null);
      adminDo('/api/board/admin/window', { from: iso($('asWF').value), to: iso($('asWT').value) }, '입력 기간을 저장했습니다.');
    } else if (a === 'asWinSat') {
      const sat = nextSaturday();
      adminDo('/api/board/admin/window', { from: sat.from.toISOString(), to: sat.to.toISOString() }, '토요일 하루로 정했습니다.');
    } else if (a === 'asWinOpen') {
      adminDo('/api/board/admin/window', {}, '입력 기간 제한을 풀었습니다.');
    } else if (a === 'asBal') {
      adminDo('/api/board/admin/balance', { on: el.dataset.on === '1' }, el.dataset.on === '1' ? '연령대 비율 맞춤을 켰습니다.' : '연령대 비율 맞춤을 껐습니다.');
    } else if (a === 'asFinish') {
      if (confirm('지금 마감할까요? 남은 선수는 팀이 없는 채로 끝납니다. (나중에 다시 열 수 있습니다)'))
        adminDo('/api/board/admin/finish', {}, '마감했습니다.');
    } else if (a === 'asReopen') adminDo('/api/board/admin/reopen', {}, '다시 열었습니다.');
    else if (a === 'asReset') {
      if (confirm('팀 구성과 포메이션을 모두 지우고 처음으로 되돌릴까요?\n회원이 입력한 포지션은 남습니다.'))
        adminDo('/api/board/admin/reset', {}, '처음으로 되돌렸습니다.', '&confirm=yes');
    }
  });

  // 포지션 시트
  $('psGrid').addEventListener('click', e => {
    const f = e.target.closest('.b-fbtn');
    if (f) {                                   // 주발 — 같은 것을 다시 누르면 해제
      ps.foot = ps.foot === f.dataset.f ? '' : f.dataset.f;
      psError(''); $('psForce').hidden = true;
      buildPosGrid();
      return;
    }
    const b = e.target.closest('.b-pbtn'); if (!b) return;
    const id = b.dataset.p, at = ps.sel.indexOf(id);
    if (at >= 0) ps.sel.splice(at, 1);
    else { if (ps.sel.length >= C.MAX_POS) ps.sel.shift(); ps.sel.push(id); }
    psError(''); $('psForce').hidden = true;
    buildPosGrid();
  });
  $('psSave').addEventListener('click', () => savePos(false));
  $('psForce').addEventListener('click', () => savePos(true));
  $('psCode').addEventListener('keydown', e => { if (e.key === 'Enter') savePos(false); });
  $('psClose').addEventListener('click', closePos);
  $('posSheet').addEventListener('click', e => { if (e.target.id === 'posSheet') closePos(); });
  $('psToggle').addEventListener('click', async () => {
    const m = S.byV[ps.v];
    try { await api('/api/board/admin/active' + kq(), { member: ps.v, active: !m.active }); toast(m.active ? '휴면으로 표시했습니다.' : '활동으로 표시했습니다.'); closePos(); load(); }
    catch (e) { psError(e.message); }
  });
  $('psClear').addEventListener('click', async () => {
    if (!confirm(`${lab(ps.v)} 님의 포지션 입력을 지울까요?`)) return;
    try { await api('/api/board/admin/position-delete' + kq(), { member: ps.v }); toast('지웠습니다.'); closePos(); load(); }
    catch (e) { psError(e.message); }
  });

  // 감독 시트
  $('csWho').addEventListener('click', e => {
    const b = e.target.closest('button[data-n]'); if (!b) return;
    csPick = b.dataset.n;
    $('csWho').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('csCode').focus();
  });
  $('csGo').addEventListener('click', coachLogin);
  $('csCode').addEventListener('keydown', e => { if (e.key === 'Enter') coachLogin(); });
  $('csClose').addEventListener('click', closeCoach);
  $('coachSheet').addEventListener('click', e => { if (e.target.id === 'coachSheet') closeCoach(); });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closePos(); closeCoach(); closeAdmin();
  });

  // 유니폼 투표를 막 끝낸 회원이면 본인 포지션 시트를 바로 연다 (같은 날 한 번에 끝내도록).
  function openFromVote() {
    let who = null, code = '';
    try {
      who = sessionStorage.getItem('boardMember'); code = sessionStorage.getItem('boardCode') || '';
      sessionStorage.removeItem('boardMember'); sessionStorage.removeItem('boardCode');
    } catch (e) { /* 무시 */ }
    if (!who || !S.data || !S.byV[who]) return;
    if (!S.data.positionsOpen && !isAdmin()) return;
    S.tab = 'pos'; render();
    openPos(who);
    if (/^\d{4}$/.test(code)) $('psCode').value = code;
  }

  // ---------- 시작 ----------
  (async function boot() {
    if (S.admin) {
      try { await adminCheck(S.admin); } catch (e) { S.admin = ''; S.adminOk = false; ss.del('kitKey'); }
    }
    await load();
    // 다른 사람(상대 감독, 총무)이 바꾼 걸 따라간다. 끌거나 입력하는 중에는 건드리지 않는다.
    const tick = () => {
      if (!document.hidden && !S.busy && !drag && !S.dirty[0] && !S.dirty[1]) load();
      const live = S.data && (S.data.phase === 'draft' || S.data.phase === 'review');
      setTimeout(tick, live ? 3000 : 7000);
    };
    setTimeout(tick, 5000);
    openFromVote();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.busy && !drag) load(); });
  })();
})();
