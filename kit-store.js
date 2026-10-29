// 등번호·사이즈 신청 저장소.  kit_orders  (회원당 한 줄)
//
// 투표·보드 저장소와 따로 둔다. 테이블 준비가 실패해도 투표와 보드는 멀쩡해야 한다.
//
// **저장은 반드시 save() 로 한다.** 두 회원이 같은 번호를 동시에 누를 수 있어서,
// 「지금 누가 무엇을 쥐고 있는지」를 읽는 것과 쓰는 것이 한 덩어리여야 한다.
// Postgres 에서는 자문 잠금으로, 메모리에서는 줄을 세워 하나씩 처리한다.
const LOCK = 907261;        // 이 테이블 전용 자문 잠금 번호 (다른 기능과 겹치지 않게)

module.exports = function createKitStore(pool) {
  if (!pool) {
    const mem = new Map();
    let chain = Promise.resolve();
    const run = fn => {
      const p = chain.then(fn);
      chain = p.catch(() => {});
      return p;
    };
    return {
      kind: 'memory',
      async all() { return [...mem.values()]; },
      async del(member) { return mem.delete(member) ? 1 : 0; },
      // build(orders) → payload. 던지면 아무것도 바뀌지 않는다.
      save(member, build) {
        return run(() => {
          const orders = Object.fromEntries([...mem.values()].map(r => [r.member, r.payload]));
          const payload = build(orders);
          mem.set(member, { member, payload, updated_at: new Date() });
          return payload;
        });
      },
    };
  }

  const ready = pool.query(`
    create table if not exists kit_orders (
      member     text primary key,
      payload    jsonb       not null,
      updated_at timestamptz not null default now()
    )`).then(
      () => console.log('[등번호] 테이블 준비 완료'),
      e => { console.error('[등번호] 테이블 준비 실패:', e.message); throw e; });
  ready.catch(() => {});          // 처리되지 않은 거부로 서버가 죽지 않게 한다

  return {
    kind: 'postgres',
    async all() {
      await ready;
      const r = await pool.query(
        'select member, payload, updated_at from kit_orders order by updated_at');
      return r.rows;
    },
    async del(member) {
      await ready;
      const r = await pool.query('delete from kit_orders where member = $1', [member]);
      return r.rowCount;
    },
    async save(member, build) {
      await ready;
      const c = await pool.connect();
      try {
        await c.query('begin');
        // 잠금은 트랜잭션이 끝나면 저절로 풀린다. 서버가 둘 떠 있어도 한 명씩 지나간다.
        await c.query('select pg_advisory_xact_lock($1)', [LOCK]);
        const rows = (await c.query('select member, payload from kit_orders')).rows;
        const orders = Object.fromEntries(rows.map(r => [r.member, r.payload]));
        const payload = build(orders);
        await c.query(
          `insert into kit_orders (member, payload, updated_at) values ($1, $2, now())
           on conflict (member) do update set payload = $2, updated_at = now()`,
          [member, payload]);
        await c.query('commit');
        return payload;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
};
