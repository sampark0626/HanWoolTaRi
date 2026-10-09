// 17종을 한 화면에 늘어놓고, 마음에 드는 것을 골라 담는다.
// 고른 순서가 곧 순위다 — 1순위 3점, 2순위 2점, 3순위 1점.
// 대진표는 걷어냈다. 붙는 상대에 따라 결과가 흔들려 공정한 비교가 안 됐다.
(() => {
  const V = '11';          // 이미지를 교체하면 올린다 — 안 올리면 옛 그림이 남는다
  const $ = id => document.getElementById(id);
  const show = id => document.querySelectorAll('.screen')
    .forEach(s => s.classList.toggle('on', s.id === id));

  let CFG = null, BY = {};
  let voter = '', picks = [], zi = 0;

  const need = () => (CFG && CFG.picks) || 3;

  async function boot() {
    CFG = await (await fetch('/api/config')).json();
    BY = Object.fromEntries(CFG.kits.map(k => [k.id, k]));

    if (CFG.round) {
      $('roundTag').textContent = CFG.round;
      $('intro').textContent = `후보 ${CFG.kits.length}종 중 ${need()}개를 골라주세요.`;
    } else {
      $('intro').textContent =
        `후보 ${CFG.kits.length}종을 쭉 보시고 마음에 드는 ${need()}개를 골라주세요. 2~3분이면 됩니다.`;
    }
    $('pickLabel').textContent = `${need()}개를 골라주세요`;
    buildNames();
    buildGrid();

    try {
      const s = await (await fetch('/api/status')).json();
      if (s.voters > 0) {
        $('statusNote').textContent =
          `지금까지 ${s.voters}명이 투표했습니다. 다시 하시면 마지막 투표로 바뀝니다.`;
      }
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
    for (const c of document.querySelectorAll('.card')) {
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

  boot();
})();
