// 2027 한울타리 FC — 실착 360° 3D 회전 뷰어 (Photorealistic 6-Limb 3D Cylindrical Z-Buffer Engine)
(() => {
  const W = 327;
  const H = 402;
  const V = '11';

  // 각 유니폼별 등번호/네임플레이트 색상 및 외곽선 색상
  const KIT_STYLE = {
    'nebula':        { txt: '#dceefb', out: '#10253f' },
    'solar':         { txt: '#ffffff', out: '#0d1b3a' },
    'aero':          { txt: '#13243b', out: '#a8dadc' },
    'wave':          { txt: '#132840', out: '#9be7e5' },
    'football':      { txt: '#ffffff', out: '#111111' },
    'fantasista':    { txt: '#ff2a85', out: '#141418' },
    'element':       { txt: '#1f242d', out: '#ffffff' },
    'kirinco-white': { txt: '#181c24', out: '#ffffff' },
    'helix':         { txt: '#173f2a', out: '#ffffff' },
    'doubleteam':    { txt: '#122652', out: '#ffffff' },
    'zenith':        { txt: '#162347', out: '#7ec8f8' },
    'kirinco-teal':  { txt: '#0f2342', out: '#5ce1e6' },
    'legion':        { txt: '#d4af37', out: '#102533' },
    'kirinco-black': { txt: '#e5c158', out: '#141414' },
    'blueshield':    { txt: '#ffffff', out: '#2b6cb0' },
    'kirinco-navy':  { txt: '#e07a5f', out: '#0d182e' },
    'kirinco-mint':  { txt: '#4a2c82', out: '#ccf2e5' }
  };

  // 6개 신체 부위별 깊이 비율(b/a) 및 Z축 오프셋
  // 1: 머리/목, 2: 상체/골반(유니폼 상의+쇼츠 상단), 3: 왼팔, 4: 오른팔, 5: 왼다리, 6: 오른다리
  const DEPTH_RATIO = [0.0, 0.86, 0.56, 0.85, 0.85, 0.78, 0.78];
  const PIVOT_Z     = [0.0, 0.0,  0.0,  1.2,  1.2,  0.0,  0.0];

  let maskPromise = null;
  let spanTable = null; // { xMin: Int16Array[7], xMax: Int16Array[7] }
  const kitCache = new Map(); // key: `${kitId}|${who}` -> Promise<KitModel>
  const slots = new Map();    // slotName ('A'|'B'|'Champ') -> { container, canvas, ctx, imgData, kitId, who, model }

  let currentAngleDeg = 0;
  let targetAngleDeg = 0;
  let autoRotate = false;
  let mode3D = true;
  let rafId = null;
  let lastDragMoved = false;
  let lastDragTime = 0;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function ensureMask() {
    if (!maskPromise) {
      maskPromise = loadImage(`/kits_3d/player_mask.png?v=${V}`).then(maskImg => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(maskImg, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;

        const xMin = Array.from({ length: 7 }, () => new Int16Array(H).fill(999));
        const xMax = Array.from({ length: 7 }, () => new Int16Array(H).fill(-1));

        for (let y = 16; y <= 387; y++) {
          for (let x = 95; x <= 232; x++) {
            const idx = (y * W + x) * 4;
            const a = data[idx + 3];
            if (a > 0) {
              const id = Math.round(data[idx] / 40);
              if (id >= 1 && id <= 6) {
                if (x < xMin[id][y]) xMin[id][y] = x;
                if (x > xMax[id][y]) xMax[id][y] = x;
              }
            }
          }
          // 허리~팔 사이 배경 여백 및 손~쇼츠 사이 여백 배제
          if (y >= 130 && y <= 217) {
            if (xMin[2][y] < 127) xMin[2][y] = 127;
            if (xMax[2][y] > 200) xMax[2][y] = 200;
          }
          if (y >= 218 && y <= 250) {
            if (xMin[2][y] < 125) xMin[2][y] = 125;
            if (xMax[2][y] > 202) xMax[2][y] = 202;
          }
          if (y >= 251 && y <= 266) {
            if (xMax[5][y] > 158) xMax[5][y] = 158;
            if (xMin[6][y] < 169) xMin[6][y] = 169;
          }
        }
        spanTable = { xMin, xMax, maskData: data };
        return spanTable;
      });
    }
    return maskPromise;
  }

  async function getKitModel(kitId, who) {
    const cacheKey = `${kitId}|${who || ''}`;
    if (kitCache.has(cacheKey)) return kitCache.get(cacheKey);

    const p = (async () => {
      const [spans, frontImg] = await Promise.all([
        ensureMask(),
        loadImage(`/kits/${kitId}.jpg?v=${V}`)
      ]);

      // 1. 정면 픽셀 버퍼 추출
      const fc = document.createElement('canvas');
      fc.width = W;
      fc.height = H;
      const fctx = fc.getContext('2d');
      fctx.drawImage(frontImg, 0, 0, W, H);
      const frontData = fctx.getImageData(0, 0, W, H).data;

      // 2. 스튜디오 배경 버퍼 생성 (좌/우 여백 보간)
      const bgData = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) {
        const iL = (y * W + 8) * 4;
        const iR = (y * W + (W - 9)) * 4;
        const rL = frontData[iL], gL = frontData[iL + 1], bL = frontData[iL + 2];
        const rR = frontData[iR], gR = frontData[iR + 1], bR = frontData[iR + 2];
        for (let x = 0; x < W; x++) {
          const t = x / (W - 1);
          const idx = (y * W + x) * 4;
          bgData[idx]     = (rL * (1 - t) + rR * t) | 0;
          bgData[idx + 1] = (gL * (1 - t) + gR * t) | 0;
          bgData[idx + 2] = (bL * (1 - t) + bR * t) | 0;
          bgData[idx + 3] = 255;
        }
      }

      // 3. 후면(등판) 텍스처 합성
      const bc = document.createElement('canvas');
      bc.width = W;
      bc.height = H;
      const bctx = bc.getContext('2d');
      const backImgData = fctx.getImageData(0, 0, W, H);
      const bd = backImgData.data;
      const { xMin, xMax, maskData } = spans;

      // 목 피부색 샘플 (x=163, y=74)
      const neckIdx = (74 * W + 163) * 4;
      const neckR = frontData[neckIdx], neckG = frontData[neckIdx + 1], neckB = frontData[neckIdx + 2];

      // 3-1. 머리 뒷면(헤어) 및 목덜미, 뒷칼라 합성
      for (let y = 16; y <= 96; y++) {
        for (let x = 132; x <= 195; x++) {
          const idx = (y * W + x) * 4;
          if (maskData[idx + 3] === 0) continue;
          const id = Math.round(maskData[idx] / 40);
          if (id === 1) {
            const mn = xMin[1][y], mx = xMax[1][y];
            const u = mx > mn ? (x - mn) / (mx - mn) : 0.5;
            const distC = Math.min(1.2, Math.abs(u - 0.5) * 2.0);
            if (y <= 57) {
              const dy = (y - 32.0) / 22.0;
              const crown = Math.max(0.0, 1.0 - Math.sqrt(distC * distC + dy * dy));
              bd[idx]     = (22 + 24 * crown) | 0;
              bd[idx + 1] = (20 + 22 * crown) | 0;
              bd[idx + 2] = (24 + 25 * crown) | 0;
            } else if (y <= 64) {
              const hairEnd = 63.0 - 3.5 * distC * distC;
              const blend = Math.max(0.0, Math.min(1.0, (y - (hairEnd - 2.5)) / 4.5));
              const shade = 0.92 - 0.16 * distC * distC;
              const sr = neckR * shade, sg = neckG * shade, sb = neckB * shade;
              bd[idx]     = (22 * (1 - blend) + sr * blend) | 0;
              bd[idx + 1] = (20 * (1 - blend) + sg * blend) | 0;
              bd[idx + 2] = (24 * (1 - blend) + sb * blend) | 0;
            } else {
              const shade = 0.93 - 0.18 * distC * distC;
              bd[idx]     = Math.min(255, (neckR * shade) | 0);
              bd[idx + 1] = Math.min(255, (neckG * shade) | 0);
              bd[idx + 2] = Math.min(255, (neckB * shade) | 0);
            }
          } else if (id === 2 && y <= 96 && x >= 142 && x <= 185) {
            const sampleX = x < 163 ? 136 : 190;
            const sampleY = y <= 85 ? 85 : Math.max(88, y);
            const sx = y <= 85 ? 143 : sampleX;
            const sIdx = (sampleY * W + sx) * 4;
            bd[idx]     = frontData[sIdx];
            bd[idx + 1] = frontData[sIdx + 1];
            bd[idx + 2] = frontData[sIdx + 2];
          }
        }
      }

      // 3-2. 상의 등판 클린 패브릭 복원 (정면 엠블럼/가슴번호 영역 y=95..162 제거 후 패턴 복원)
      for (let y = 95; y <= 162; y++) {
        const iL = (y * W + 132) * 4;
        const iR = (y * W + 195) * 4;
        const srcY = 163 + ((y - 95) % 34);
        for (let x = 130; x <= 197; x++) {
          const idx = (y * W + x) * 4;
          const pIdx = (srcY * W + x) * 4;
          const t = (x - 130.0) / 67.0;
          const rowR = frontData[iL] * (1 - t) + frontData[iR] * t;
          const rowG = frontData[iL + 1] * (1 - t) + frontData[iR + 1] * t;
          const rowB = frontData[iL + 2] * (1 - t) + frontData[iR + 2] * t;
          bd[idx]     = Math.min(255, (frontData[pIdx] * 0.72 + rowR * 0.28) | 0);
          bd[idx + 1] = Math.min(255, (frontData[pIdx + 1] * 0.72 + rowG * 0.28) | 0);
          bd[idx + 2] = Math.min(255, (frontData[pIdx + 2] * 0.72 + rowB * 0.28) | 0);
        }
      }

      // 3-3. 하의(쇼츠) 뒷면 클린 패브릭 복원 (정면 허벅지 번호/엠블럼 y=235..266 제거)
      for (let y = 235; y <= 266; y++) {
        const srcY = 223 + ((y - 235) % 11);
        for (let x = 120; x <= 207; x++) {
          const sx = Math.max(126, Math.min(201, x));
          const idx = (y * W + x) * 4;
          const sIdx = (srcY * W + sx) * 4;
          bd[idx]     = frontData[sIdx];
          bd[idx + 1] = frontData[sIdx + 1];
          bd[idx + 2] = frontData[sIdx + 2];
        }
      }

      bctx.putImageData(backImgData, 0, 0);

      // 3-4. 등판 네임플레이트(HANULTHARI 또는 투표자 이름) + 대형 등번호 10 마킹
      const st = KIT_STYLE[kitId] || { txt: '#ffffff', out: '#111111' };
      bctx.save();
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      bctx.lineJoin = 'round';

      // 상단 팀명 또는 선수명
      const topLabel = 'HANULTHARI';
      bctx.font = '900 10.5px "Arial", "Noto Sans KR", sans-serif';
      bctx.lineWidth = 2.4;
      bctx.strokeStyle = st.out;
      bctx.fillStyle = st.txt;
      bctx.strokeText(topLabel, 163.5, 110);
      bctx.fillText(topLabel, 163.5, 110);

      // 중앙 대형 등번호 10
      bctx.font = '900 42px "Arial", sans-serif';
      bctx.lineWidth = 2.8;
      bctx.strokeText('10', 163.5, 145);
      bctx.fillText('10', 163.5, 145);

      // 투표자 이름이 있으면 등번호 아래에 선수 마킹 표시
      if (who) {
        bctx.font = '900 11px "Noto Sans KR", sans-serif';
        bctx.lineWidth = 2.4;
        bctx.strokeText(who, 163.5, 178);
        bctx.fillText(who, 163.5, 178);
      }
      bctx.restore();

      const backData = bctx.getImageData(0, 0, W, H).data;
      return { frontImg, frontData, backData, bgData, spans };
    })();

    kitCache.set(cacheKey, p);
    return p;
  }

  function renderSlot(slot, deg) {
    const { ctx, imgData, model } = slot;
    if (!model) return;

    const normDeg = ((deg % 360) + 360) % 360;
    const { frontImg, frontData, backData, bgData, spans } = model;
    const { xMin, xMax } = spans;

    // 정면(0°) 근처일 때는 원본 스튜디오 사진을 그대로 렌더링하여 100% 원본 화질 유지
    if (normDeg < 0.4 || normDeg > 359.6) {
      ctx.drawImage(frontImg, 0, 0, W, H);
      drawTurntableOverlay(ctx, 0);
      return;
    }

    const theta = (normDeg * Math.PI) / 180.0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const turnAmt = Math.abs(sinT);

    const out = imgData.data;
    out.set(bgData);

    const zBuf = new Float32Array(W);

    for (let y = 16; y <= 387; y++) {
      zBuf.fill(-9999.0);

      for (let id = 1; id <= 6; id++) {
        const mn = xMin[id][y];
        const mx = xMax[id][y];
        const width = mx - mn;
        if (width < 3) continue;

        const cx0 = (mn + mx) * 0.5;
        const a = width * 0.5;

        // 회전 시 외곽 배경 경계 픽셀이 샘플링되지 않도록 내부 안전 영역(pad) 설정
        const rotFactor = Math.min(1.0, turnAmt * 1.8 + (1.0 - cosT) * 0.5);
        const pad = Math.min(5.0, width * 0.22) * rotFactor;
        const sMin = mn + pad;
        const sMax = mx - pad;

        // 어깨 상단 경사면(y=80..93) 및 정수리(y=16..23)는 회전 시 안쪽 행(y+5)에서 샘플링
        let texY = y;
        if (rotFactor > 0.15) {
          if (id === 2 && y >= 80 && y <= 93) texY = Math.min(96, y + 5);
          else if (id === 1 && y >= 16 && y <= 23) texY = Math.min(26, y + 4);
        }

        let dr = DEPTH_RATIO[id];
        if ((id === 5 || id === 6) && y >= 355) dr = 1.30; // 축구화는 앞뒤 길이가 더 김
        const b = a * dr;

        const dx = cx0 - 163.5;
        let dz = PIVOT_Z[id];
        if ((id === 5 || id === 6) && y >= 355) {
          dz = ((y - 355.0) / 32.0) * 5.0;
        }

        const projCX = 163.5 + dx * cosT + dz * sinT;
        const centerZ = -dx * sinT + dz * cosT;

        let rProj = Math.sqrt((a * cosT) * (a * cosT) + (b * sinT) * (b * sinT));
        if (rProj < 1.0) rProj = 1.0;

        const startX = Math.max(0, Math.floor(projCX - rProj));
        const endX = Math.min(W - 1, Math.ceil(projCX + rProj));

        const sMinInt = Math.ceil(sMin);
        const sMaxInt = Math.floor(sMax);
        const spanW = Math.max(1.0, sMax - sMin);

        for (let px = startX; px <= endX; px++) {
          const s = (px - projCX) / rProj;
          if (s < -1.0 || s > 1.0) continue;
          const nz = Math.sqrt(Math.max(0.0, 1.0 - s * s));
          const z = centerZ + b * nz;
          if (z <= zBuf[px]) continue;

          const phi = Math.asin(Math.max(-1.0, Math.min(1.0, s)));
          const alpha = phi - theta;
          const cosA = Math.cos(alpha);
          const sinA = Math.sin(alpha);

          const uFront = 0.5 + 0.5 * sinA;
          const uBack  = 0.5 - 0.5 * sinA;

          const srcXF = Math.max(sMinInt, Math.min(sMaxInt, Math.round(sMin + uFront * spanW)));
          const srcXB = Math.max(sMinInt, Math.min(sMaxInt, Math.round(sMin + uBack  * spanW)));

          let r, g, bl;
          if (cosA >= 0.0) {
            const fIdx = (texY * W + srcXF) * 4;
            r = frontData[fIdx];
            g = frontData[fIdx + 1];
            bl = frontData[fIdx + 2];
          } else {
            const bIdx = (texY * W + srcXB) * 4;
            r = backData[bIdx];
            g = backData[bIdx + 1];
            bl = backData[bIdx + 2];
          }

          // 측면 재봉선(Seam) 부드러운 블렌딩
          const absCosA = Math.abs(cosA);
          if (absCosA < 0.25) {
            const edgeX = sinA >= 0.0 ? sMaxInt : sMinInt;
            const eIdx = (texY * W + edgeX) * 4;
            const srcBuf = cosA >= 0.0 ? frontData : backData;
            const wSeam = 1.0 - (absCosA / 0.25);
            r  = (r * (1.0 - wSeam) + srcBuf[eIdx]     * wSeam) | 0;
            g  = (g * (1.0 - wSeam) + srcBuf[eIdx + 1] * wSeam) | 0;
            bl = (bl * (1.0 - wSeam) + srcBuf[eIdx + 2] * wSeam) | 0;
          }

          // 입체 원통형 스튜디오 라이팅
          const light = 1.0 - turnAmt * (0.14 * (1.0 - nz) + 0.04 * s);
          const outIdx = (y * W + px) * 4;
          out[outIdx]     = Math.max(0, Math.min(255, (r * light) | 0));
          out[outIdx + 1] = Math.max(0, Math.min(255, (g * light) | 0));
          out[outIdx + 2] = Math.max(0, Math.min(255, (bl * light) | 0));
          out[outIdx + 3] = 255;

          zBuf[px] = z;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    drawTurntableOverlay(ctx, normDeg);
  }

  function drawTurntableOverlay(ctx, normDeg) {
    const rad = (normDeg * Math.PI) / 180.0;
    ctx.save();

    // 발 아래 3D 회전 턴테이블 링
    ctx.beginPath();
    ctx.ellipse(163.5, 379, 64, 11, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.22)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 회전 각도 눈금 포인트 (턴테이블 위를 함께 회전)
    for (let i = 0; i < 8; i++) {
      const a = rad + (i * Math.PI) / 4;
      const tx = 163.5 + Math.sin(a) * 64;
      const ty = 379 + Math.cos(a) * 11;
      ctx.beginPath();
      ctx.arc(tx, ty, i === 0 ? 3.0 : 1.6, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? 'rgba(19, 91, 216, 0.65)' : 'rgba(30, 58, 95, 0.28)';
      ctx.fill();
    }

    // 우측 상단 현재 각도 배지
    let label = '정면 0°';
    const d = Math.round(normDeg) % 360;
    if (d > 155 && d < 205) label = `등판 ${d}°`;
    else if (d >= 65 && d <= 115) label = `측면 ${d}°`;
    else if (d >= 245 && d <= 295) label = `측면 ${d}°`;
    else if (d !== 0) label = `${d}°`;

    ctx.font = '700 11px "Noto Sans KR", sans-serif';
    const tw = ctx.measureText(label).width;
    const bx = W - tw - 18;
    const by = 10;
    ctx.fillStyle = 'rgba(21, 24, 29, 0.68)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, tw + 12, 20, 10) : ctx.rect(bx, by, tw + 12, 20);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + (tw + 12) * 0.5, by + 10.5);

    ctx.restore();
  }

  function renderAllSlots() {
    if (!mode3D) return;
    for (const slot of slots.values()) {
      renderSlot(slot, currentAngleDeg);
    }
    syncButtons();
  }

  function syncButtons() {
    const norm = Math.round(((targetAngleDeg % 360) + 360) % 360) % 360;
    document.querySelectorAll('.rot-btn[data-angle]').forEach(btn => {
      const a = Number(btn.dataset.angle);
      btn.classList.toggle('on', !autoRotate && Math.abs(norm - a) <= 12);
    });
    const autoBtn = document.getElementById('rotAutoBtn');
    if (autoBtn) autoBtn.classList.toggle('on', autoRotate);
    const modeBtn = document.getElementById('toggleModeBtn');
    if (modeBtn) {
      modeBtn.textContent = mode3D ? '2D 사진 보기' : '3D 회전 보기';
      modeBtn.classList.toggle('on', !mode3D);
    }
  }

  function startLoop() {
    if (rafId) return;
    const tick = () => {
      let needMore = false;
      if (autoRotate && mode3D) {
        targetAngleDeg = (targetAngleDeg + 1.15) % 360;
        currentAngleDeg = targetAngleDeg;
        needMore = true;
      } else {
        // 최단 방향 부드러운 감속 회전
        let diff = ((targetAngleDeg - currentAngleDeg + 540) % 360) - 180;
        if (Math.abs(diff) > 0.35) {
          currentAngleDeg = (currentAngleDeg + diff * 0.28 + 360) % 360;
          needMore = true;
        } else {
          currentAngleDeg = ((targetAngleDeg % 360) + 360) % 360;
        }
      }
      renderAllSlots();
      if (needMore) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  function mountSlot(slotName, container, kitId, who) {
    if (!container) return;
    let slot = slots.get(slotName);
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.className = 'kit3d-canvas';
      canvas.width = W;
      canvas.height = H;
      container.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(W, H);
      slot = { container, canvas, ctx, imgData, kitId: '', who: '', model: null };
      slots.set(slotName, slot);
    }
    slot.kitId = kitId;
    slot.who = who || '';

    getKitModel(kitId, who).then(model => {
      if (slot.kitId !== kitId) return;
      slot.model = model;
      renderSlot(slot, currentAngleDeg);
    }).catch(() => {});
  }

  function bindCard(el) {
    if (!el || el.dataset.rotBound) return;
    el.dataset.rotBound = '1';

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startAngle = 0;
    let moved = false;

    el.addEventListener('pointerdown', e => {
      if (!mode3D) return;
      if (e.target.closest('.pick-btn')) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startAngle = targetAngleDeg;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });

    el.addEventListener('pointermove', e => {
      if (!dragging || !mode3D) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        moved = true;
        autoRotate = false;
      }
      if (moved) {
        const rect = el.getBoundingClientRect();
        const degPerPx = 220 / Math.max(160, rect.width);
        targetAngleDeg = (startAngle + dx * degPerPx + 360) % 360;
        currentAngleDeg = targetAngleDeg;
        renderAllSlots();
      }
    });

    const endDrag = e => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        lastDragMoved = true;
        lastDragTime = Date.now();
      }
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  }

  window.Kit3D = {
    mountSlot,
    bindCard,
    setAngleDeg(deg) {
      if (!mode3D) this.setMode3D(true);
      autoRotate = false;
      targetAngleDeg = ((deg % 360) + 360) % 360;
      startLoop();
    },
    toggleAutoRotate() {
      if (!mode3D) this.setMode3D(true);
      autoRotate = !autoRotate;
      syncButtons();
      if (autoRotate) startLoop();
    },
    setMode3D(flag) {
      mode3D = Boolean(flag);
      document.body.classList.toggle('mode-2d', !mode3D);
      if (!mode3D) autoRotate = false;
      syncButtons();
      if (mode3D) renderAllSlots();
    },
    resetFront() {
      if (!autoRotate) {
        targetAngleDeg = 0;
        currentAngleDeg = 0;
        renderAllSlots();
      }
    },
    wasDragged() {
      if (lastDragMoved && Date.now() - lastDragTime < 350) {
        lastDragMoved = false;
        return true;
      }
      return false;
    },
    getState() {
      return { angleDeg: currentAngleDeg, autoRotate, mode3D };
    }
  };
})();
