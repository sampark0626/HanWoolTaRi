// 유니폼 번호·사이즈 저장소. 투표·보드 저장소와 따로 둔다 —
// 이쪽 테이블 준비가 실패해도 투표와 보드는 멀쩡해야 하기 때문이다.
//
//   uniform_state  회원별 번호·사이즈와 설정 (한 줄짜리 문서). 쓸 때 행을 잠가서
//                  두 사람이 같은 번호를 동시에 눌러도 한 사람만 가져간다.
//
// pool이 없으면 메모리에 담는다 — 로컬 확인용. board-store.js 와 같은 모양이다.
const { initial } = require('./numbers');

module.exports = function createUniformStore(pool) {
  if (!pool) {
    let state = initial();
    return {
      kind: 'memory',
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
    create table if not exists uniform_state (
      id         int primary key,
      state      jsonb       not null,
      updated_at timestamptz not null default now()
    )`).then(
      () => console.log('[번호] 테이블 준비 완료'),
      e => { console.error('[번호] 테이블 준비 실패:', e.message); throw e; });
  ready.catch(() => {});            // 처리되지 않은 거부로 서버가 죽지 않게 한다
  let chain = Promise.resolve();    // update를 한 줄로 세운다

  return {
    kind: 'postgres',
    async state() {
      await ready;
      const r = await pool.query('select state from uniform_state where id = 1');
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
      await c.query('insert into uniform_state (id, state) values (1, $1) on conflict (id) do nothing',
        [initial()]);
      const cur = (await c.query('select state from uniform_state where id = 1 for update')).rows[0].state;
      const next = fn(cur) || cur;
      await c.query('update uniform_state set state = $1, updated_at = now() where id = 1', [next]);
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
