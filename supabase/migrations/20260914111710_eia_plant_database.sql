-- Stable identities + versioned annual facts. Only complete imports are activated.
create table public.import_runs (
  id text primary key, year integer not null check(year between 1900 and 2200),
  fingerprint text not null unique, status text not null check(status in ('loading','complete')),
  warning text not null, reference_documents jsonb not null default '[]', report jsonb,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.active_datasets (
  year integer primary key, import_id text not null references public.import_runs(id)
);
create table public.source_files (
  import_id text not null references public.import_runs(id), id text not null,
  path text not null, sheet text not null, sha256 text not null, row_count integer not null,
  primary key(import_id,id)
);
create table public.organizations (id integer primary key, name text not null);
create table public.plants (id integer primary key check(id>0));
create table public.generators (
  plant_id integer not null references public.plants(id), generator_id text not null,
  primary key(plant_id,generator_id)
);
create table public.plant_snapshots (
  import_id text not null references public.import_runs(id), plant_id integer not null references public.plants(id),
  year integer not null, name text not null, operator_id integer references public.organizations(id), operator_name text,
  state text, county text, city text, address text,
  latitude double precision check(latitude between -90 and 90), longitude double precision check(longitude between -180 and 180),
  coordinate_status text not null, nerc_region text, balancing_authority text,
  source_id text not null, source_row integer not null,
  nameplate_mw numeric not null check(nameplate_mw>=0), operating_mw numeric not null check(operating_mw>=0),
  proposed_mw numeric not null check(proposed_mw>=0), retired_mw numeric not null check(retired_mw>=0), storage_mw numeric not null check(storage_mw>=0),
  unit_count integer not null, operable_unit_count integer not null, status text not null,
  primary_fuel text not null, fuel_types jsonb not null, fuel_capacity jsonb not null,
  first_operating_year integer, latest_operating_year integer, owners jsonb not null,
  ownership_coverage_percent numeric, ownership_status text not null,
  primary key(import_id,plant_id), foreign key(import_id,source_id) references public.source_files(import_id,id),
  check((latitude is null) = (longitude is null))
);
create index plant_snapshots_plant_idx on public.plant_snapshots(plant_id,year);
create index plant_snapshots_operator_idx on public.plant_snapshots(operator_id);
create index plant_snapshots_source_idx on public.plant_snapshots(import_id,source_id);
create index plant_snapshots_filter_idx on public.plant_snapshots(import_id,state,status,primary_fuel);
create table public.generator_snapshots (
  import_id text not null references public.import_runs(id), plant_id integer not null, generator_id text not null, year integer not null,
  status text not null, lifecycle text not null, nameplate_mw numeric not null check(nameplate_mw>=0), summer_mw numeric, winter_mw numeric,
  technology text, prime_mover text, unit_code text, operating_year integer, operating_month integer check(operating_month between 1 and 12),
  retirement_year integer, retirement_month integer check(retirement_month between 1 and 12),
  planned_operating_year integer, planned_retirement_year integer, ownership_code text,
  operator_id integer references public.organizations(id), primary_fuel text, fuel_type text not null, is_storage boolean not null,
  source_id text not null, source_row integer not null, capacity_hours numeric,
  primary key(import_id,plant_id,generator_id), foreign key(plant_id,generator_id) references public.generators(plant_id,generator_id),
  foreign key(import_id,source_id) references public.source_files(import_id,id)
);
create index generator_snapshots_identity_idx on public.generator_snapshots(plant_id,generator_id);
create index generator_snapshots_operator_idx on public.generator_snapshots(operator_id);
create index generator_snapshots_source_idx on public.generator_snapshots(import_id,source_id);
create table public.generator_fuels (
  import_id text not null, plant_id integer not null, generator_id text not null,
  role text not null check(role in ('operating','startup','cofire')), fuel_code text not null, priority integer not null,
  source_id text not null, source_row integer not null,
  primary key(import_id,plant_id,generator_id,role,fuel_code),
  foreign key(import_id,plant_id,generator_id) references public.generator_snapshots(import_id,plant_id,generator_id),
  foreign key(import_id,source_id) references public.source_files(import_id,id)
);
create index generator_fuels_source_idx on public.generator_fuels(import_id,source_id);
create table public.generator_ownership (
  import_id text not null, plant_id integer not null, generator_id text not null,
  owner_id integer not null references public.organizations(id), owner_name text not null,
  fraction numeric not null check(fraction between 0 and 1), basis text not null,
  source_id text not null, source_row integer not null,
  primary key(import_id,plant_id,generator_id,owner_id),
  foreign key(import_id,plant_id,generator_id) references public.generator_snapshots(import_id,plant_id,generator_id),
  foreign key(import_id,source_id) references public.source_files(import_id,id)
);
create index generator_ownership_owner_idx on public.generator_ownership(owner_id);
create index generator_ownership_source_idx on public.generator_ownership(import_id,source_id);
create table public.plant_year_metrics (
  import_id text not null, plant_id integer not null, year integer not null,
  net_generation_mwh numeric, monthly_generation_mwh jsonb not null,
  capacity_factor double precision, capacity_hours_mwh numeric, capacity_factor_method text not null,
  generation_status text not null, storage_net_generation_mwh numeric, storage_gross_generation_mwh numeric,
  monthly_storage_net_mwh jsonb not null, reporting_frequencies jsonb not null,
  generation_by_fuel jsonb not null, sources jsonb not null,
  primary key(import_id,plant_id), foreign key(import_id,plant_id) references public.plant_snapshots(import_id,plant_id)
);
-- Original fields from every data schedule; a source row can be equipment, fuel, or a plant.
-- Unmatched records intentionally retain their supplied ID without a plants FK.
create table public.source_records (
  import_id text not null, source_id text not null, row_number integer not null,
  plant_id integer, generator_id text, data jsonb not null,
  primary key(import_id,source_id,row_number), foreign key(import_id,source_id) references public.source_files(import_id,id)
);
create index source_records_plant_idx on public.source_records(import_id,plant_id,source_id,row_number);
create table public.import_issues (
  import_id text not null references public.import_runs(id), issue_number integer not null,
  plant_id integer, generator_id text, code text not null, context jsonb not null,
  primary key(import_id,issue_number)
);
create index import_issues_plant_idx on public.import_issues(import_id,plant_id);
create index active_datasets_import_idx on public.active_datasets(import_id);

-- This catalogue consists of published government data. The app may read, never write.
do $$
declare t text;
begin
  foreach t in array array['import_runs','active_datasets','source_files','organizations','plants','generators',
    'plant_snapshots','generator_snapshots','generator_fuels','generator_ownership','plant_year_metrics','source_records','import_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy public_catalog_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

create view public.plant_catalog with (security_invoker=true) as
select p.*, m.net_generation_mwh, m.capacity_factor, m.generation_status,
  m.storage_net_generation_mwh, m.storage_gross_generation_mwh
from public.plant_snapshots p
join public.active_datasets a on a.year=p.year and a.import_id=p.import_id
join public.import_runs r on r.id=a.import_id and r.status='complete'
left join public.plant_year_metrics m on m.import_id=p.import_id and m.plant_id=p.plant_id;
grant select on public.plant_catalog to anon, authenticated;

comment on column public.plant_snapshots.nameplate_mw is 'Sum of EIA-860 operable generators (OP, SB, OA, OS), including storage. Proposed and retired capacity separate.';
comment on column public.plant_year_metrics.capacity_factor is 'Ratio, not percentage. Non-storage net generation / nameplate MW-hours using reported operating and retirement months inclusive. Approximation, not EIA published net-summer method. Null if denominator unavailable; outliers retained and flagged.';
comment on column public.plant_snapshots.owners is 'Capacity-weighted ownership of operable units. Not legal ownership of the plant. Unknown coverage is not reassigned to operator.';
