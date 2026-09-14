-- Read-only assertions against the deployed catalogue. Raises on any failure.
do $$
declare t text; r text;
begin
  foreach t in array array['import_runs','active_datasets','source_files','organizations','plants','generators',
    'plant_snapshots','generator_snapshots','generator_fuels','generator_ownership','plant_year_metrics','source_records','import_issues'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then
      raise exception 'RLS missing: %',t;
    end if;
    foreach r in array array['anon','authenticated','powermap_reader'] loop
      if not has_table_privilege(r,'public.'||t,'SELECT') then raise exception '% cannot read %',r,t; end if;
      if has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE') then raise exception '% can write %',r,t; end if;
    end loop;
  end loop;
  if not (select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.plant_catalog'::regclass) then
    raise exception 'Catalogue view must use invoker security';
  end if;
end $$;
begin;
set local role anon;
do $$ begin
  if (select count(*) from public.plant_catalog) = 0 then raise exception 'Public read policy returned no plants'; end if;
end $$;
rollback;
begin;
set local role authenticated;
do $$ begin
  if (select count(*) from public.plant_catalog) = 0 then raise exception 'Authenticated read policy returned no plants'; end if;
end $$;
rollback;
select 'Catalogue grants, RLS and invoker view checks passed' as result;
