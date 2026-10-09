// 이상형 월드컵 진행. 대진은 서버(kits.js)가 내려준다.
(() => {
  const V = '5';   // 이미지를 교체하면 올린다 — 안 올리면 브라우저가 옛 그림을 계속 쓴다
  const $ = id => document.getElementById(id);
  const show = id => document.querySelectorAll('.screen')
    .forEach(s => s.classList.toggle('on', s.id === id));

  let CFG = null, BY = {};
  let queue = [];        // 이번 라운드에 치를 경기들
  let nextRound = [];    // 이번 라운드 승자들
  let round = '';        // playin | r16 | qf | sf | final
  let picks = [];        // {round, winner, loser}
  let total = 0, played = 0;
  let voter = '';

  const ORDER = ['playin', 'r16', 'qf', 'sf', 'final'];

  async function boot() {
    CFG = await (await fetch('/api/config')).json();
    BY = Object.fromEntries(CFG.kits.map(k => [k.id, k]));

    if (CFG.roster && CFG.roster.length) {
      $('roster').innerHTML = CFG.roster
        .map(n => `<option value="${n}">`).join('');
    }
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
    } catch (e) { /* 상태 조회 실패는 투표를 막지 않는다 */ }
  }

  function start() {
    voter = $('voter').value.trim().replace(/\s+/g, ' ');
    if (voter.length < 2) {
      $('startErr').textContent = '이름을 적어주세요.';
      $('startErr').hidden = false;
      return;
    }
    $('startErr').hidden = true;

    picks = []; played = 0;
    // 예선 → 16강 → … 전체 경기 수를 미리 센다 (진행바용)
    total = 1 + CFG.round16.length + 4 + 2 + 1;

    round = 'playin';
    queue = [CFG.playin.slice()];
    nextRound = [];
    show('duel');
    render();
  }

  function render() {
    const [a, b] = queue[0];
    const ka = BY[a], kb = BY[b];
    $('roundLabel').textContent = CFG.roundLabel[round];
    $('matchCount').textContent = `${played + 1} / ${total}`;
    $('progBar').style.width = (played / total * 100) + '%';

    fill('A', ka); fill('B', kb);
    for (const id of ['kitA', 'kitB']) {
      const el = $(id);
      el.classList.remove('picked', 'enter', 'b');
      void el.offsetWidth;                 // 애니메이션 재시작
      el.classList.add('enter');
      if (id === 'kitB') el.classList.add('b');
    }
  }

  // 유니폼 마킹 — 입력한 이름을 등판 네임플레이트처럼 보여준다.
  // 앞면 사진이라 가슴에는 이미 팀명이 박혀 있어 겹친다. 그래서 아래에 붙인다.
  function mark(el) { el.textContent = voter; }

  function fill(side, k) {
    $('img' + side).src = `/kits/${k.id}.jpg?v=${V}`;
    $('img' + side).alt = k.name;
    $('name' + side).textContent = k.name;
    $('sub' + side).textContent = `${k.vendor} · ${k.price.toLocaleString()}원`;
    mark($('plate' + side));
  }

  function choose(side) {
    const [a, b] = queue[0];
    const winner = side === 'A' ? a : b;
    const loser = side === 'A' ? b : a;
    $('kit' + side).classList.add('picked');

    picks.push({ round, winner, loser });
    nextRound.push(winner);
    played += 1;
    $('progBar').style.width = (played / total * 100) + '%';

    setTimeout(() => {
      queue.shift();
      if (queue.length) return render();

      if (round === 'final') return finish(winner);

      // 다음 라운드 편성
      round = ORDER[ORDER.indexOf(round) + 1];
      if (round === 'r16') {
        const w = nextRound[0];
        queue = CFG.round16.map(([x, y]) => [x === 'W' ? w : x, y === 'W' ? w : y]);
      } else {
        queue = [];
        for (let i = 0; i < nextRound.length; i += 2) queue.push([nextRound[i], nextRound[i + 1]]);
      }
      nextRound = [];
      render();
    }, 260);
  }

  function finish(champ) {
    const k = BY[champ];
    $('champImg').src = `/kits/${k.id}.jpg?v=${V}`;
    $('champImg').alt = k.name;
    $('champName').textContent = k.name;
    $('champSub').textContent = `${k.vendor} · ${k.price.toLocaleString()}원`;
    mark($('plateC'));

    const rows = picks
      .filter(p => p.round !== 'playin')
      .map(p => `<li><b>${CFG.roundLabel[p.round]}</b>
        <span>${BY[p.winner].name} <s>${BY[p.loser].name}</s></span></li>`).join('');
    $('path').innerHTML = `<h3>${voter}님이 고른 길</h3><ol>${rows}</ol>`;

    $('submit').disabled = false;
    $('doneMsg').textContent = '';
    show('done');
    window.scrollTo(0, 0);
  }

  async function submit() {
    $('submit').disabled = true;
    $('doneMsg').textContent = '보내는 중…';
    try {
      const champion = picks[picks.length - 1].winner;
      const r = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voter, picks, champion }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '제출에 실패했습니다.');
      $('doneMsg').textContent =
        `제출됐습니다. 지금까지 ${j.voters}명이 투표했습니다. 창을 닫으셔도 됩니다.`;
      $('again').textContent = '다시 고르기';
    } catch (e) {
      $('doneMsg').textContent = e.message + ' 다시 눌러주세요.';
      $('submit').disabled = false;
    }
  }

  // 3D 틸트 — 포인터를 따라 살짝 기운다
  for (const id of ['kitA', 'kitB']) {
    const el = $(id);
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5;
      const y = (e.clientY - r.top) / r.height - .5;
      el.style.transform = `rotateY(${x * 7}deg) rotateX(${-y * 7}deg) translateZ(6px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    el.addEventListener('click', () => { el.style.transform = ''; choose(id.slice(-1)); });
  }

  $('go').addEventListener('click', start);
  $('voter').addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
  $('submit').addEventListener('click', submit);
  $('again').addEventListener('click', () => { show('start'); });

  boot();
})();
