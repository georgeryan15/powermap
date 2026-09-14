import { Router } from 'express'
import type { Request } from 'express'
import { pool } from '../db/pool'

const router = Router()
const invalid = (message: string) =>
  Object.assign(new Error(message), { statusCode: 400 })
export function intParam(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw invalid('Expected an integer parameter')
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw invalid(`Integer must be between ${min} and ${max}`)
  return n
}
const year = (req: Request) => intParam(req.query.year, 2025, 1900, 2200)
const id = (req: Request) => intParam(req.params.id, 0, 1, 999999999)
const textParam = (value: unknown, max = 120) => {
  if (value === undefined) return null
  if (typeof value !== 'string' || value.length > max)
    throw invalid('Invalid text parameter')
  return value.trim() || null
}
const missing = () =>
  Object.assign(new Error('Plant not found for this year'), { statusCode: 404 })
router.use((req, _res, next) => {
  const allowed = new Set([
    'year',
    'limit',
    'offset',
    'q',
    'state',
    'fuel',
    'status',
    'sort',
    'source',
  ])
  if (Object.keys(req.query).some((key) => !allowed.has(key)))
    throw invalid('Unsupported query parameter')
  next()
})

router.get('/dataset', async (req, res) => {
  const { rows } = await pool.query(
    `select r.id, r.year, r.warning, r.completed_at, r.report,
    (select jsonb_agg(jsonb_build_object('id',f.id,'path',f.path,'sheet',f.sheet,'row_count',f.row_count) order by f.path,f.sheet)
      from public.source_files f where f.import_id=r.id) as sources
    from public.import_runs r join public.active_datasets a on a.import_id=r.id where a.year=$1 and r.status='complete'`,
    [year(req)],
  )
  if (!rows[0])
    throw Object.assign(new Error('No imported dataset for this year'), {
      statusCode: 404,
    })
  res.set('Cache-Control', 'public, max-age=300').json(rows[0])
})

router.get('/map', async (req, res) => {
  const { rows } = await pool.query(
    `select plant_id as id, name, operator_name, state, county, latitude, longitude,
    nameplate_mw, proposed_mw, retired_mw, storage_mw, unit_count, operable_unit_count, status,
    primary_fuel, fuel_types, first_operating_year, latest_operating_year, net_generation_mwh, capacity_factor,
    generation_status, coordinate_status from public.plant_catalog where year=$1 order by plant_id`,
    [year(req)],
  )
  res
    .set('Cache-Control', 'public, max-age=300')
    .json({ year: year(req), plants: rows })
})

router.get('/', async (req, res) => {
  const limit = intParam(req.query.limit, 50, 1, 500)
  const offset = intParam(req.query.offset, 0, 0, 1000000)
  const q = textParam(req.query.q),
    state = textParam(req.query.state, 2),
    fuel = textParam(req.query.fuel, 40),
    status = textParam(req.query.status, 40)
  if (state && !/^[A-Z]{2}$/.test(state))
    throw invalid('State must be a two-letter uppercase code')
  const sort = textParam(req.query.sort, 30) || 'name'
  const sorts: Record<string, string> = {
    name: 'name asc',
    capacity: 'nameplate_mw desc',
    generation: 'net_generation_mwh desc nulls last',
    newest: 'first_operating_year desc nulls last',
  }
  if (!sorts[sort]) throw invalid('Unsupported sort')
  const args = [year(req), q, state, fuel, status]
  const where = `year=$1 and ($2::text is null or strpos(lower(name || ' ' || coalesce(operator_name,'') || ' ' || plant_id::text),lower($2))>0)
    and ($3::text is null or state=$3) and ($4::text is null or fuel_types ? $4) and ($5::text is null or status=$5)`
  const [data, count] = await Promise.all([
    pool.query(
      `select * from public.plant_catalog where ${where} order by ${sorts[sort]},plant_id limit $6 offset $7`,
      [...args, limit, offset],
    ),
    pool.query(
      `select count(*)::int as total from public.plant_catalog where ${where}`,
      args,
    ),
  ])
  res.json({
    plants: data.rows,
    total: count.rows[0].total,
    limit,
    offset,
    year: year(req),
  })
})

router.get('/:id/generation', async (req, res) => {
  const { rows } = await pool.query(
    `select m.* from public.plant_year_metrics m
    join public.active_datasets a on a.import_id=m.import_id and a.year=m.year where m.plant_id=$1 and m.year=$2`,
    [id(req), year(req)],
  )
  if (!rows[0]) throw missing()
  res.json(rows[0])
})

router.get('/:id/metadata', async (req, res) => {
  const limit = intParam(req.query.limit, 25, 1, 100),
    offset = intParam(req.query.offset, 0, 0, 1000000)
  const source = textParam(req.query.source, 24)
  const args = [id(req), year(req), source]
  const from = `from public.source_records r join public.active_datasets a on a.import_id=r.import_id
    join public.source_files f on f.import_id=r.import_id and f.id=r.source_id
    where r.plant_id=$1 and a.year=$2 and ($3::text is null or r.source_id=$3)`
  const [records, count] = await Promise.all([
    pool.query(
      `select r.source_id,r.row_number,r.generator_id,r.data,f.path,f.sheet ${from} order by f.path,f.sheet,r.row_number limit $4 offset $5`,
      [...args, limit, offset],
    ),
    pool.query(`select count(*)::int as total ${from}`, args),
  ])
  res.json({ records: records.rows, total: count.rows[0].total, limit, offset })
})

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'select * from public.plant_catalog where plant_id=$1 and year=$2',
    [id(req), year(req)],
  )
  if (!rows[0]) throw missing()
  const plant = rows[0],
    params = [plant.import_id, plant.plant_id]
  const [metrics, generators, issues, sources] = await Promise.all([
    pool.query(
      'select * from public.plant_year_metrics where import_id=$1 and plant_id=$2',
      params,
    ),
    pool.query(
      `select g.*, coalesce((select jsonb_agg(jsonb_build_object('fuel_code',f.fuel_code,'role',f.role,'priority',f.priority) order by f.role,f.priority)
      from public.generator_fuels f where f.import_id=g.import_id and f.plant_id=g.plant_id and f.generator_id=g.generator_id),'[]') as fuels,
      coalesce((select jsonb_agg(jsonb_build_object('name',o.owner_name,'fraction',o.fraction,'basis',o.basis)) from public.generator_ownership o
        where o.import_id=g.import_id and o.plant_id=g.plant_id and o.generator_id=g.generator_id),'[]') as owners
      from public.generator_snapshots g where g.import_id=$1 and g.plant_id=$2 order by g.nameplate_mw desc,g.generator_id`,
      params,
    ),
    pool.query(
      'select code,generator_id,context from public.import_issues where import_id=$1 and plant_id=$2 order by issue_number',
      params,
    ),
    pool.query(
      `select f.id,f.path,f.sheet,count(*)::int as records from public.source_records r
      join public.source_files f on f.import_id=r.import_id and f.id=r.source_id where r.import_id=$1 and r.plant_id=$2
      group by f.id,f.path,f.sheet order by f.path,f.sheet`,
      params,
    ),
  ])
  res
    .set('Cache-Control', 'public, max-age=300')
    .json({
      plant,
      metrics: metrics.rows[0],
      generators: generators.rows,
      issues: issues.rows,
      sources: sources.rows,
    })
})

export default router
