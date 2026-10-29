// 로컬에서 보기용 실행기.  node dev.js   (http://localhost:3000)
//
// Render 에서는 환경변수로 들어오는 값들을 여기서는 이 폴더의 *.txt 에서 읽어 채운다.
// 그 파일들은 git 에 올라가지 않는다 (.gitignore) — 운영에서는 이 파일을 쓰지 않는다.
//
//   ROSTER.txt DORMANT.txt AGE.txt NUMBERS.txt SIZES.txt   한 줄짜리 값
//   AUTH.txt ADMIN_KEY.txt                                 KEY=VALUE 또는 값 한 줄
//
// **본인 확인(AUTH)은 기본으로 끈다.** 켜면 로컬에서도 전화 뒷 4자리를 넣어야 한다.
//   DEV_AUTH=1 node dev.js   ← 확인 절차까지 그대로 보고 싶을 때
const fs = require('fs');
const path = require('path');

const read = f => {
  try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch (e) { return null; }
};
// 주석(#)과 빈 줄을 걷어낸다. KEY=VALUE 줄이 있으면 그대로 환경변수로, 없으면 값 한 줄로 본다.
function load(file, key) {
  const raw = read(file);
  if (raw == null) { console.log('[dev] %s 없음 — %s 를 비워 둡니다', file, key || file); return; }
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  // 이미 들어와 있는 환경변수는 덮지 않는다 — ADMIN_KEY=test node dev.js 처럼 그때만 바꿔 쓸 수 있게.
  const put = (k, v) => { if (!process.env[k]) process.env[k] = v; };
  let any = false;
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i > 0 && /^[A-Z_]+$/.test(line.slice(0, i))) {
      put(line.slice(0, i), line.slice(i + 1));
      any = true;
    }
  }
  if (!any && key && lines.length) put(key, lines.join(','));
}

load('ROSTER.txt', 'ROSTER');
load('DORMANT.txt', 'DORMANT');
load('AGE.txt', 'AGE');
load('NUMBERS.txt', 'NUMBERS');
load('SIZES.txt', 'SIZES');
load('ADMIN_KEY.txt', 'ADMIN_KEY');
if (process.env.DEV_AUTH === '1') load('AUTH.txt');
else console.log('[dev] 본인 확인 없이 띄웁니다 (DEV_AUTH=1 로 켤 수 있습니다)');

// 동명이인은 명부 표기(최지훈S/B)로 보여주면 본인도 헷갈린다 — Render 와 같은 라벨을 쓴다.
process.env.ROSTER_LABELS = process.env.ROSTER_LABELS
  || '최지훈S=최지훈 (동생),최지훈B=최지훈 (형님)';

require('./server');
