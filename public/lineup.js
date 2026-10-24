// 라인업 공유 — 후보 이름 자리 잡기, 공유용 이미지, 저장·공유 시트.
// 서버(테스트)와 브라우저가 같은 파일을 쓴다. 순수 함수(placeBench 등)는 어디서나 돌고,
// 그리는 부분(renderCard·openShare·decoratePitch)은 브라우저에서만 쓴다.
//
// 보여주는 방식 (총무 확인 2026-10-24)
//   · 스타팅은 이름 왼쪽의 작은 초록 동그라미로 표시한다. 「제외」 같은 말은 쓰지 않는다.
//   · 스타팅이 아닌 선수는 **희망 포지션 자리에 작게 이름만** 적는다 — 선수 배치가 목적이라서.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LU = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const POS_ORDER = ['GK', 'CB', 'SB', 'DM', 'CM', 'AM', 'WG', 'ST'];

  // 후보 이름을 놓는 기준점 — 희망 포지션(1순위)별 피치 비율 좌표. 좌우가 있는 자리는 번갈아 쓴다.
  // 같은 자리에 여럿이면 기준점에서 바깥으로 한 칸씩 밀려난다.
  const ANCHORS = {
    GK: [[.5, .965]],
    CB: [[.5, .85]],
    SB: [[.075, .735], [.925, .735]],
    DM: [[.5, .65]],
    CM: [[.5, .535]],
    AM: [[.5, .405]],
    WG: [[.075, .265], [.925, .265]],
    ST: [[.5, .115]],
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const splitLabel = l => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(l || ''); return m ? [m[1], m[2]] : [l || '', '']; };
  const mainName = l => splitLabel(l)[0];

  // 글자 폭 어림 — 한글·한자는 한 글자가 1em, 영문·숫자는 약 0.58em. 캔버스에서는 measureText 를 쓴다.
  function approxWidth(text, fs) {
    let w = 0;
    for (const ch of String(text)) w += (ch.codePointAt(0) > 0x2e80 ? 1 : 0.58) * fs;
    return w;
  }

  // 후보 이름이 앉을 자리를 찾는다. 모두 픽셀 단위이고 피치 왼쪽 위가 (0,0)이다.
  //   boxes  이미 차지한 사각형들(말과 이름표) [{x0,y0,x1,y1}]
  //   items  [{key, label, pos:[…]}]            measure(text, fs) → 폭
  // 반환: { key: {cx, cy} } — 놓을 자리를 못 찾은 이름은 빠진다.
  // 기준점에서 가까운 빈 곳부터 고르므로 결과는 같은 입력에 항상 같다.
  function placeBench(o) {
    const { W, H, boxes = [], items = [], measure, fs = 12, pad = 4, gap = 3 } = o;
    const taken = boxes.map(b => ({ ...b }));
    const out = {}, cnt = {};
    const rank = it => { const i = POS_ORDER.indexOf((it.pos && it.pos[0]) || ''); return i < 0 ? 4 : i; };
    const order = items.slice().sort((a, b) => rank(a) - rank(b) || String(a.label).localeCompare(String(b.label), 'ko'));
    const hit = r => r.x0 < pad || r.y0 < pad || r.x1 > W - pad || r.y1 > H - pad ||
      taken.some(p => !(r.x1 + gap <= p.x0 || r.x0 - gap >= p.x1 || r.y1 + gap <= p.y0 || r.y0 - gap >= p.y1));
    for (const it of order) {
      const p1 = (it.pos && it.pos[0]) || 'CM';
      const list = ANCHORS[p1] || ANCHORS.CM;
      cnt[p1] = (cnt[p1] || 0) + 1;
      const a = list[(cnt[p1] - 1) % list.length];
      const w = measure(it.label, fs) + fs * 0.9, h = fs * 1.5;
      const step = Math.max(2, fs * 0.55);
      let spot = null;
      for (let ring = 0; ring <= 90 && !spot; ring++) {
        const n = ring === 0 ? 1 : Math.min(40, 6 + ring * 2);
        for (let j = 0; j < n && !spot; j++) {
          const ang = (j / n) * Math.PI * 2;
          const cx = a[0] * W + Math.cos(ang) * ring * step;
          const cy = a[1] * H + Math.sin(ang) * ring * step * 0.8;
          const r = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
          if (!hit(r)) spot = { cx, cy, r };
        }
      }
      if (spot) { taken.push(spot.r); out[it.key] = { cx: spot.cx, cy: spot.cy }; }
    }
    return out;
  }

  // 보드 응답(/api/board)과 한 팀의 말 위치에서 그릴 내용을 만든다.
  //   tokens  스타팅(말이 놓인 선수)   bench  나머지   roster  명단 전체(start 표시)
  function fromBoard(d, t, pieces, formationId) {
    const byV = Object.fromEntries((d.members || []).map(m => [m.v, m]));
    const tokens = [], bench = [], roster = [];
    for (const n of (d.teams && d.teams[t]) || []) {
      const m = byV[n] || { label: n, pos: null };
      const row = { name: n, label: m.label || n, pos: m.pos || [] };
      const pc = pieces && pieces[n];
      roster.push({ ...row, start: !!pc });
      if (pc) tokens.push({ ...row, x: pc.x, y: pc.y }); else bench.push(row);
    }
    const co = d.coaches && d.coaches[t];
    return {
      teamName: (d.names && d.names[t]) || (t ? 'B팀' : 'A팀'),
      color: (d.colors && d.colors[t]) || '#2e86de',
      coach: co ? (co.label || co.v) : '',
      formationId: formationId || '',
      tokens, bench, roster,
    };
  }

  // ───────────────────────── 화면의 피치에 후보 이름 얹기 ─────────────────────────
  // kind: 'board'(보드의 읽기 전용 피치) | 'member'(회원 페이지·총무 팀 보기)
  function decoratePitch(el, d, t, pieces, kind) {
    if (!el || typeof document === 'undefined') return;
    el.querySelectorAll('.bsm').forEach(n => n.remove());
    const rc = el.getBoundingClientRect(), W = rc.width, H = rc.height;
    if (!W || !H) return;
    const card = fromBoard(d, t, pieces, '');
    const board = kind === 'board';
    const boxes = card.tokens.map(tk => {
      const nm = mainName(tk.label);
      if (board) {
        const D = W * 0.115, w = Math.max(D, approxWidth(nm, 12) + 16);
        return { x0: tk.x * W - w / 2, x1: tk.x * W + w / 2, y0: tk.y * H - D / 2, y1: tk.y * H + D / 2 + 30 };
      }
      const w = Math.max(40, approxWidth(nm, 11) + 16);
      return { x0: tk.x * W - w / 2, x1: tk.x * W + w / 2, y0: tk.y * H - 19, y1: tk.y * H + 19 + 24 };
    });
    const fs = board ? 11 : 10.5;
    const put = placeBench({
      W, H, boxes, fs, measure: approxWidth,
      items: card.bench.map(b => ({ key: b.name, label: mainName(b.label), pos: b.pos })),
    });
    for (const b of card.bench) {
      const p = put[b.name];
      if (!p) continue;
      const s = document.createElement('span');
      s.className = 'bsm';
      s.textContent = mainName(b.label);
      s.style.left = (p.cx / W * 100) + '%';
      s.style.top = (p.cy / H * 100) + '%';
      el.appendChild(s);
    }
  }

  // ───────────────────────── 공유용 이미지 (캔버스) ─────────────────────────
  const FONT = '"Noto Sans KR","Malgun Gothic",-apple-system,sans-serif';
  const font = (w, s) => `${w} ${s}px ${FONT}`;

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawPitch(g, x, y, w, h) {
    g.save();
    rr(g, x, y, w, h, 30); g.clip();
    const n = 11, sh = h / n;                                   // 잔디 줄무늬 (CSS 와 같은 11줄)
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 === 0 ? '#278a4c' : '#34a461'; g.fillRect(x, y + i * sh, w, sh + 1); }
    const sp = g.createRadialGradient(x + w / 2, y + h * 0.36, 0, x + w / 2, y + h * 0.36, Math.max(w, h) * 0.62);
    sp.addColorStop(0, 'rgba(255,255,255,.17)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp; g.fillRect(x, y, w, h);
    // 라인 — 680×1050 좌표계 (보드의 SVG 와 같은 그림)
    g.save(); g.translate(x, y); g.scale(w / 680, h / 1050);
    g.strokeStyle = 'rgba(255,255,255,.78)'; g.lineWidth = 3; g.shadowColor = 'rgba(255,255,255,.45)'; g.shadowBlur = 3;
    g.strokeRect(20, 20, 640, 1010);
    g.beginPath(); g.moveTo(20, 525); g.lineTo(660, 525); g.stroke();
    g.beginPath(); g.arc(340, 525, 91.5, 0, Math.PI * 2); g.stroke();
    g.strokeRect(138.5, 20, 403, 165); g.strokeRect(248.5, 20, 183, 55);
    g.strokeRect(138.5, 865, 403, 165); g.strokeRect(248.5, 975, 183, 55);
    g.stroke(new Path2D('M266.9 185 A91.5 91.5 0 0 0 413.1 185'));
    g.stroke(new Path2D('M266.9 865 A91.5 91.5 0 0 1 413.1 865'));
    g.fillStyle = 'rgba(255,255,255,.85)';
    [[340, 525], [340, 130], [340, 920]].forEach(([cx, cy]) => { g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill(); });
    g.restore();
    // 가장자리를 어둡게
    g.save(); g.translate(x + w / 2, y + h / 2); g.scale(w * 0.65, h * 0.6);
    const vg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    vg.addColorStop(0.52, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.4)');
    g.fillStyle = vg; g.fillRect(-2, -2, 4, 4);
    g.restore();
    g.restore();
    g.save(); rr(g, x + 1, y + 1, w - 2, h - 2, 30); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2; g.stroke(); g.restore();
  }

  // 이름 알약 하나 — 말 아래 이름표와 후보 이름이 같이 쓴다.
  function pill(g, cx, top, w, h, fill, stroke) {
    rr(g, cx - w / 2, top, w, h, h / 2);
    g.fillStyle = fill; g.fill();
    g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
  }

  function drawToken(g, o, tk, ox, oy, PW, PH, R, fs) {
    const cx = ox + tk.x * PW, cy = oy + tk.y * PH;
    const gk = tk.pos && tk.pos[0] === 'GK';
    g.save();
    g.translate(cx, cy + R * 0.95); g.scale(1, 0.32);        // 잔디에 지는 그림자
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.15);
    sg.addColorStop(0, 'rgba(0,0,0,.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(0, 0, R * 1.15, 0, Math.PI * 2); g.fill();
    g.restore();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = gk ? '#f2b52a' : o.color; g.fill();
    let gr = g.createRadialGradient(cx - R * 0.36, cy - R * 0.5, 0, cx - R * 0.36, cy - R * 0.5, R * 0.95);
    gr.addColorStop(0, 'rgba(255,255,255,.64)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    gr = g.createRadialGradient(cx + R * 0.45, cy + R * 0.64, 0, cx + R * 0.45, cy + R * 0.64, R * 1.1);
    gr.addColorStop(0, 'rgba(0,0,0,.36)'); gr.addColorStop(0.62, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.97)'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = font('900', Math.round(R * 0.62)); g.fillStyle = gk ? '#3b2600' : '#fff';
    g.fillText((tk.pos && tk.pos[0]) || '·', cx, cy + 2);
    // 이름표
    const [nm, sub] = splitLabel(tk.label);
    g.font = font('700', fs); const w1 = g.measureText(nm).width;
    g.font = font('600', Math.round(fs * 0.78)); const w2 = sub ? g.measureText(sub).width + 8 : 0;
    const w = w1 + w2 + 30, h = fs * 1.55, top = cy + R + 8;
    pill(g, cx, top, w, h, 'rgba(8,22,14,.66)', 'rgba(255,255,255,.24)');
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = font('700', fs); g.fillStyle = '#fff'; g.fillText(nm, cx - w / 2 + 15, top + h / 2 + 1);
    if (sub) { g.font = font('600', Math.round(fs * 0.78)); g.fillStyle = 'rgba(255,255,255,.72)'; g.fillText(sub, cx - w / 2 + 15 + w1 + 8, top + h / 2 + 2); }
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - R, y1: top + h };
  }

  function drawDot(g, cx, cy, r, on) {
    if (on) {                                             // 초록불
      g.save(); g.shadowColor = 'rgba(61,220,132,.9)'; g.shadowBlur = r * 1.4;
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 0, cx, cy, r);
      gr.addColorStop(0, '#9af7bd'); gr.addColorStop(0.7, '#1fa65a'); gr.addColorStop(1, '#168a49');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.restore();
    } else {
      g.beginPath(); g.arc(cx, cy, r - 1.5, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#c3c9d0'; g.stroke();
    }
  }

  // o: fromBoard() 의 결과. 캔버스를 돌려준다. (웹폰트는 호출하기 전에 미리 불러 둔다 — openShare 가 한다)
  function renderCard(o) {
    const CW = 1080, PAD = 40, HEAD = 200, PW = 720, PH = Math.round(PW * 105 / 68), GAP = 24, FOOT = 100;
    const PY = HEAD + GAP, CH = PY + PH + FOOT, PX = PAD;
    const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
    const g = cv.getContext('2d');
    g.fillStyle = '#eef1f4'; g.fillRect(0, 0, CW, CH);

    // 머리글
    const hg = g.createLinearGradient(0, 0, 0, HEAD); hg.addColorStop(0, '#0e1a13'); hg.addColorStop(1, '#183024');
    g.fillStyle = hg; g.fillRect(0, 0, CW, HEAD);
    g.fillStyle = o.color; g.fillRect(0, 0, 18, HEAD);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#8fd4aa'; g.font = font('700', 28); g.fillText('한울타리 FC · 자체전', PAD + 10, 56);
    g.fillStyle = '#fff'; g.font = font('900', 78); g.fillText(o.teamName, PAD + 10, 134);
    g.fillStyle = '#cfe3d6'; g.font = font('500', 30);
    g.fillText(o.coach ? `감독 ${mainName(o.coach)}` : '', PAD + 10, 180);
    if (o.formationId) {
      g.font = font('900', 46); const fw = g.measureText(o.formationId).width + 56;
      rr(g, CW - PAD - fw, 62, fw, 76, 38); g.fillStyle = o.color; g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(o.formationId, CW - PAD - fw / 2, 101); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    }

    // 피치
    drawPitch(g, PX, PY, PW, PH);
    const R = PW * 0.0575, TFS = 27;
    const boxes = [];
    for (const tk of o.tokens) {
      const b = drawToken(g, o, tk, PX, PY, PW, PH, R, TFS);
      boxes.push({ x0: b.x0 - PX, x1: b.x1 - PX, y0: b.y0 - PY, y1: b.y1 - PY });
    }
    // 스타팅이 아닌 선수 — 희망 포지션 자리에 작게
    const BFS = 23;
    const measure = (s, fs) => { g.font = font('600', fs); return g.measureText(s).width; };
    const put = placeBench({
      W: PW, H: PH, boxes, fs: BFS, measure,
      items: o.bench.map(b => ({ key: b.name, label: mainName(b.label), pos: b.pos })),
    });
    for (const b of o.bench) {
      const p = put[b.name]; if (!p) continue;
      const nm = mainName(b.label), w = measure(nm, BFS) + BFS * 0.9, h = BFS * 1.5;
      pill(g, PX + p.cx, PY + p.cy - h / 2, w, h, 'rgba(255,255,255,.17)', 'rgba(255,255,255,.4)');
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font('600', BFS); g.fillStyle = 'rgba(255,255,255,.95)';
      g.fillText(nm, PX + p.cx, PY + p.cy + 1);
    }

    // 명단 — 스타팅은 이름 왼쪽에 초록불
    const LX = PX + PW + 30, LW = CW - PAD - LX;
    const starters = o.roster.filter(r => r.start).sort((a, b) => {
      const ta = o.tokens.find(t => t.name === a.name), tb = o.tokens.find(t => t.name === b.name);
      return (tb.y - ta.y) || (ta.x - tb.x);
    });
    const others = o.roster.filter(r => !r.start).sort((a, b) => {
      const ra = POS_ORDER.indexOf((a.pos || [])[0]), rb = POS_ORDER.indexOf((b.pos || [])[0]);
      return ((ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb)) || String(a.label).localeCompare(String(b.label), 'ko');
    });
    const rows = starters.concat(others);
    g.fillStyle = '#16212b'; g.font = font('900', 34); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('명단', LX, PY + 40);
    g.fillStyle = '#7a8591'; g.font = font('600', 24); g.fillText(`${rows.length}명`, LX + 86, PY + 40);
    const top = PY + 76, rowH = Math.max(34, Math.min(64, (PH - 90) / Math.max(1, rows.length)));
    rows.forEach((r, i) => {
      const cy = top + i * rowH + rowH / 2;
      drawDot(g, LX + 14, cy, 11, r.start);
      const [nm, sub] = splitLabel(r.label);
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = font(r.start ? '800' : '500', 29); g.fillStyle = r.start ? '#16212b' : '#5b6672';
      const maxW = LW - 40 - 78;
      let txt = nm; while (g.measureText(txt).width > maxW && txt.length > 1) txt = txt.slice(0, -1);
      g.fillText(txt, LX + 38, cy + 1);
      const nw = g.measureText(txt).width;
      if (sub) { g.font = font('600', 20); g.fillStyle = '#8a919c'; g.fillText(sub, LX + 38 + nw + 6, cy + 3); }
      g.textAlign = 'right'; g.font = font('700', 21); g.fillStyle = '#8a919c';
      g.fillText((r.pos || []).slice(0, 2).join('·'), LX + LW, cy + 1);
      g.textAlign = 'left';
    });

    // 바닥글
    const fy = PY + PH + 58;
    drawDot(g, PX + 14, fy - 8, 11, true);
    g.textBaseline = 'alphabetic'; g.fillStyle = '#16212b'; g.font = font('800', 26); g.fillText('스타팅', PX + 38, fy);
    g.fillStyle = '#7a8591'; g.font = font('500', 24); g.fillText('작은 이름은 희망 포지션 자리에 표시', PX + 150, fy);
    g.textAlign = 'right'; g.fillStyle = '#9aa3ad'; g.font = font('700', 24); g.fillText('한울타리 FC', CW - PAD, fy);
    return cv;
  }

  // ───────────────────────── 저장·공유 시트 ─────────────────────────
  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all(['500', '600', '700', '800', '900'].map(w => document.fonts.load(`${w} 24px "Noto Sans KR"`, '한글ABC12')));
    } catch (e) { /* 폰트를 못 불러오면 기본 글꼴로 그린다 */ }
  }

  async function openShare(o) {
    if (typeof document === 'undefined') return;
    const ov = document.createElement('div');
    ov.className = 'lu-ov';
    ov.innerHTML = '<div class="lu-box"><p class="lu-load">이미지를 만드는 중…</p></div>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    let url = '';
    const close = () => {
      ov.remove(); document.body.style.overflow = '';
      if (url) URL.revokeObjectURL(url);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    try {
      await ensureFonts();
      const cv = renderCard(o);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (!blob) throw new Error('이미지를 만들지 못했습니다.');
      url = URL.createObjectURL(blob);
      const fname = `${String(o.teamName).replace(/[\\/:*?"<>|]/g, '')}_라인업.png`;     // 파일 이름에 못 쓰는 글자는 뺀다
      const tn = esc(o.teamName), fn = esc(fname);
      const file = new File([blob], fname, { type: 'image/png' });
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      ov.innerHTML = `<div class="lu-box" role="dialog" aria-modal="true" aria-label="${tn} 라인업 이미지">
        <h3>${tn} 라인업</h3>
        <img src="${url}" alt="${tn} 라인업">
        <p class="lu-hint">이미지를 길게 눌러 저장하거나, 아래 버튼으로 바로 보내세요.</p>
        ${canShare ? '<button type="button" class="primary" data-lu="share">공유하기</button>' : ''}
        <a class="${canShare ? 'ghost' : 'primary'} linkbtn" data-lu="save" href="${url}" download="${fn}">이미지 저장</a>
        <button type="button" class="plainlink" data-lu="close">닫기</button></div>`;
      ov.querySelector('[data-lu="close"]').addEventListener('click', close);
      const sh = ov.querySelector('[data-lu="share"]');
      if (sh) sh.addEventListener('click', async () => {
        try { await navigator.share({ files: [file], title: `${o.teamName} 라인업` }); }
        catch (e) { /* 공유 창을 닫았거나 막힌 경우 — 저장 버튼이 남아 있다 */ }
      });
    } catch (e) {
      ov.innerHTML = `<div class="lu-box"><p class="lu-load">${esc((e && e.message) || '이미지를 만들지 못했습니다.')}</p>
        <button type="button" class="plainlink" data-lu="close">닫기</button></div>`;
      ov.querySelector('[data-lu="close"]').addEventListener('click', close);
    }
  }

  return { POS_ORDER, ANCHORS, splitLabel, mainName, approxWidth, placeBench, fromBoard, decoratePitch, renderCard, openShare };
});
