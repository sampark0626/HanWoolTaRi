// 포메이션 보드 저장소. 투표 저장소(server.js의 store)와 따로 둔다.
// 테이블 준비가 실패해도 투표는 멀쩡해야 하기 때문이다.
//
//   board_positions  회원이 고른 포지션 (회원당 한 줄)
//   board_state      팀 구성·포메이션 (한 줄짜리 문서, 쓸 때 행을 잠가 두 감독이 겹쳐 써도 안 깨진다)
//
// pool이 없으면 메모리에 담는다 — 로컬 확인용.
const { initial } = require('./draft');

module.exports = function createBoardStore(pool) {
  if (!pool) {
    const pos = new Map();
    let state = initial();
    return {
      kind: 'memory',
      async posAll() { return [...pos.values()]; },
      async posPut(member, payload) { pos.set(member, { member, payload, updated_at: new Date() }); },
      async posDel(member) { return pos.delete(member) ? 1 : 0; },
      async state() { return structuredClone(state); },
      // fn은 동기 함수다. 던지면 아무것도 바뀌지 않는다.
      async update(fn) {
        const next = structuredClone(state);
        state = fn(next) || next;
        return structuredClone(state);
      },
    };
  }

  const ready = pool.query(`
    create table if not exists board_positions (
      member     text primary key,
      payload    jsonb       not null,
      updated_at timestamptz not null default now()
    );
    create table if not exists board_state (
      id         int primary key,
      state      jsonb       not null,
      updated_at timestamptz not null default now()
    )`).then(
      () => console.log('[보드] 테이블 준비 완료'),
      e => { console.error('[보드] 테이블 준비 실패:', e.message); throw e; });
  ready.catch(() => {});            // 처리되지 않은 거부로 서버가 죽지 않게 한다
  let chain = Promise.resolve();    // update를 한 줄로 세운다

  return {
    kind: 'postgres',
    async posAll() {
      await ready;
      const r = await pool.query('select member, payload, updated_at from board_positions');
      return r.rows;
    },
    async posPut(member, payload) {
      await ready;
      await pool.query(
        `insert into board_positions (member, payload, updated_at) values ($1, $2, now())
         on conflict (member) do update set payload = $2, updated_at = now()`, [member, payload]);
    },
    async posDel(member) {
      await ready;
      const r = await pool.query('delete from board_positions where member = $1', [member]);
      return r.rowCount;
    },
    async state() {
      await ready;
      const r = await pool.query('select state from board_state where id = 1');
      return r.rows[0] ? r.rows[0].state : initial();
    },
    // 한 서버 안에서는 줄을 세워 하나씩 처리하고, DB에서는 행을 잠근다(서버가 둘 떠도 안 깨진다).
    update(fn) {
      const run = chain.then(() => apply(fn));
      chain = run.catch(() => {});
      return run;
    },
  };

  async function apply(fn) {
    await ready;
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into board_state (id, state) values (1, $1) on conflict (id) do nothing',
        [initial()]);
      const cur = (await c.query('select state from board_state where id = 1 for update')).rows[0].state;
      const next = fn(cur) || cur;
      await c.query('update board_state set state = $1, updated_at = now() where id = 1', [next]);
      await c.query('commit');
      return next;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
};
