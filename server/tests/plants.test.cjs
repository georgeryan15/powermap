const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const app = require('../dist/app').default
const { pool } = require('../dist/db/pool')
const { intParam } = require('../dist/routes/plants.routes')
let server, base
before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}/api/v1/plants`
})
after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await pool.end()
})

test('pagination validation rejects malformed or oversized values', () => {
  assert.equal(intParam(undefined, 50, 1, 500), 50)
  for (const v of ['-1', '501', '1.5', '10abc', '1 OR 1=1', ['5']])
    assert.throws(() => intParam(v, 50, 1, 500))
})
test('bad query parameters return 400 before contacting the database', async () => {
  for (const suffix of [
    '?limit=0',
    '?limit=999999',
    '?offset=-1',
    '?sort=invalid',
    '?state=California',
    '?q[x]=hello',
    '/not-an-id',
    '/1?year=0',
  ]) {
    assert.equal((await fetch(base + suffix)).status, 400, suffix)
  }
})
test('unknown endpoint returns 404', async () =>
  assert.equal((await fetch(base + '/1/does-not-exist')).status, 404))

test(
  'Supabase API integration',
  { skip: process.env.RUN_DATABASE_TESTS !== '1' },
  async (t) => {
    await t.test(
      'map returns every plant, beyond the REST default row limit',
      async () => {
        const r = await fetch(base + '/map')
        assert.equal(r.status, 200)
        const data = await r.json()
        assert.equal(data.plants.length, 16935)
        assert.equal(new Set(data.plants.map((p) => p.id)).size, 16935)
      },
    )
    await t.test(
      'Palo Verde details reconcile unit capacity and plant generation',
      async () => {
        const r = await fetch(base + '/6008')
        assert.equal(r.status, 200)
        const d = await r.json()
        assert.equal(d.plant.plant_id, 6008)
        assert.equal(d.generators.length, 3)
        assert.equal(
          d.plant.nameplate_mw,
          d.generators.reduce((n, g) => n + g.nameplate_mw, 0),
        )
        assert.equal(d.metrics.net_generation_mwh, d.plant.net_generation_mwh)
        assert.ok(
          d.metrics.capacity_factor > 0 && d.metrics.capacity_factor < 1.1,
        )
        assert.equal(d.metrics.monthly_generation_mwh.length, 12)
      },
    )
    await t.test(
      'search, pagination and absent plant behave correctly',
      async () => {
        const d = await (await fetch(base + '?q=Palo%20Verde&limit=1')).json()
        assert.equal(d.plants.length, 1)
        assert.ok(d.total >= 1)
        assert.equal((await fetch(base + '/99999999')).status, 404)
        const injection = await (
          await fetch(base + '?q=' + encodeURIComponent("' OR 1=1 --"))
        ).json()
        assert.equal(injection.total, 0)
      },
    )
    await t.test(
      'source data are bounded, queryable and include provenance',
      async () => {
        const d = await (await fetch(base + '/6008/metadata?limit=2')).json()
        assert.equal(d.records.length, 2)
        assert.ok(d.total > 2)
        assert.ok(d.records[0].path)
        assert.ok(d.records[0].row_number > 0)
        assert.ok(d.records[0].data)
      },
    )
    await t.test('application database role cannot write', async () => {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await assert.rejects(
          client.query('update public.plants set id=id where false'),
          (e) => ['25006', '42501'].includes(e.code),
        )
      } finally {
        await client.query('rollback')
        client.release()
      }
    })
  },
)
