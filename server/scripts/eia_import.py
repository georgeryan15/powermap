"""Reproducible EIA-860/923 import. See docs/eia-data.md for conventions.

Extract without database access: python eia_import.py
Load/promote atomically: DATABASE_URL=... python eia_import.py --load
"""
import argparse
import calendar
from collections import Counter, defaultdict
from datetime import date, datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'server/import-output'
YEAR = 2025
MONTHS = list(calendar.month_name)[1:]
OPERABLE = {'OP', 'SB', 'OA', 'OS'}
STORAGE_PM = {'BA', 'CE', 'FW', 'PS', 'ES'}
WARNING = '2025 early release: incomplete and not fully edited. Do not use for state, regional or national totals.'
STATE_BOUNDS = json.loads((Path(__file__).parent / 'state-bounds.json').read_text())


def clean(value):
    if isinstance(value, str):
        return ' '.join(value.split()) or None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(str(value).replace(',', '').strip())
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def integer(value):
    n = number(value)
    return int(n) if n is not None and n.is_integer() else None


def identifier(value):
    if value is None:
        return None
    return str(int(value)) if isinstance(value, (int, float)) and float(value).is_integer() else str(value).strip()


def fuel_type(code, prime_mover=None):
    if prime_mover in STORAGE_PM or code == 'MWH':
        return 'Pumped storage' if prime_mover == 'PS' else 'Battery' if prime_mover == 'BA' else 'Other storage'
    if code == 'SUN': return 'Solar'
    if code == 'WND': return 'Wind'
    if code == 'WAT': return 'Hydro'
    if code == 'NUC': return 'Nuclear'
    if code == 'NG': return 'Natural gas'
    if code == 'GEO': return 'Geothermal'
    if code in {'ANT', 'BIT', 'LIG', 'SUB', 'WC', 'RC', 'SGC'}: return 'Coal'
    if code in {'DFO', 'RFO', 'JF', 'KER', 'PC', 'WO', 'SGP'}: return 'Petroleum'
    if code in {'AB', 'BLQ', 'LFG', 'OBG', 'OBL', 'OBS', 'SLW', 'WDL', 'WDS'}: return 'Biomass'
    if code in {'MSW', 'TDF'}: return 'Waste'
    if code in {'BFG', 'OG', 'PG', 'SG'}: return 'Other gas'
    return 'Other'


def capacity_hours(g, year=YEAR):
    """Month-resolution approximation, including operating and retirement months."""
    if g['status'] not in OPERABLE | {'RE'}:
        return 0.0
    sy, sm, ey, em = g['operating_year'], g['operating_month'], g['retirement_year'], g['retirement_month']
    if sy is None or (sy == year and sm is None) or (g['status'] == 'RE' and ey is None) or (ey == year and em is None):
        return None
    return (g['nameplate_mw'] or 0) * sum(calendar.monthrange(year, m)[1] * 24 for m in range(1, 13)
        if (year, m) >= (sy, sm or 1) and (ey is None or (year, m) <= (ey, em or 12)))


def complete_sum(values):
    values = list(values)
    return sum(values) if values and all(v is not None for v in values) else None


def read_sources():
    sources, rows, documents = [], [], []
    for folder in ['data', 'f923_2025er']:
        for path in sorted((ROOT / folder).iterdir()):
            if path.suffix.lower() not in {'.xlsx', '.pdf'}: continue
            rel = str(path.relative_to(ROOT))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if path.suffix == '.pdf' or path.name in {'EIA-860 Form.xlsx', 'LayoutY2025_Early_Release.xlsx'}:
                documents.append({'path': rel, 'sha256': digest, 'kind': 'reference'})
                continue
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            for ws in wb:
                if 'layout' in ws.title.lower(): continue
                sid = hashlib.sha256((rel + '|' + ws.title).encode()).hexdigest()[:24]
                headers = None
                count = 0
                for row_number, values in enumerate(ws.values, 1):
                    if headers is None:
                        normalized = [clean(v) for v in values]
                        if any(v in normalized for v in ['Plant Code', 'Plant Id', 'Plant ID', 'Utility ID', 'Census Division and State']):
                            headers = [v if v and len(str(v)) < 150 and not str(v).startswith('Early release data') else None for v in normalized]
                            # Some published sheets repeat Reserved columns. Preserve their positions.
                            counts = Counter()
                            for i, h in enumerate(headers):
                                if h:
                                    counts[h] += 1
                                    if counts[h] > 1: headers[i] = f'{h} [column {i+1}]'
                        continue
                    record = {h: clean(v) for h, v in zip(headers, values) if h and clean(v) is not None}
                    pid = integer(record.get('Plant Code', record.get('Plant Id', record.get('Plant ID'))))
                    uid = integer(record.get('Utility ID'))
                    if not record or (pid is None and uid is None and 'Census Division and State' not in record): continue
                    gid = identifier(record.get('Generator ID', record.get('Generator Id')))
                    rows.append({'source_id': sid, 'row_number': row_number, 'plant_id': pid,
                                 'generator_id': gid, 'data': record})
                    count += 1
                if headers is None:
                    raise ValueError(f'No header found: {rel} {ws.title}')
                sources.append({'id': sid, 'path': rel, 'sheet': ws.title, 'sha256': digest, 'row_count': count})
            wb.close()
    return sources, rows, documents


def extract():
    OUT.mkdir(exist_ok=True)
    sources, raw, documents = read_sources()
    source_by_id = {s['id']: s for s in sources}
    fingerprint = hashlib.sha256(json.dumps({'sources': sources, 'references': documents, 'year': YEAR,
        'importer': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'state_bounds': STATE_BOUNDS}, sort_keys=True).encode()).hexdigest()
    run = f'eia-{YEAR}-{fingerprint[:16]}'
    tables = defaultdict(list)
    issues = []
    def issue(kind, pid=None, gid=None, **context):
        issues.append({'import_id': run, 'issue_number': len(issues)+1, 'plant_id': pid, 'generator_id': gid,
                       'code': kind, 'context': context})
    def matching(prefix=None, sheet=None):
        return [r for r in raw if (prefix is None or Path(source_by_id[r['source_id']]['path']).name.startswith(prefix))
                and (sheet is None or source_by_id[r['source_id']]['sheet'] == sheet)]
    orgs = {}
    def org(oid, name):
        if oid is None: return None
        if oid not in orgs: orgs[oid] = {'id': oid, 'name': name or f'EIA organization {oid}'}
        return oid
    for r in matching('1___'):
        d = r['data']; org(integer(d['Utility ID']), d.get('Utility Name'))

    offshore = {r['plant_id'] for r in matching('3_1_') if r['data'].get('Prime Mover') == 'WS'}
    plants = {}
    for r in matching('2___'):
        d = r['data']; pid = r['plant_id']
        if pid in plants: raise ValueError(f'Duplicate plant {pid}')
        lat, lon = number(d.get('Latitude')), number(d.get('Longitude'))
        coord_status = 'reported'
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            issue('invalid_coordinates', pid, latitude=lat, longitude=lon)
            lat = lon = None; coord_status = 'unavailable'
        # Alaska legitimately crosses the antimeridian. Never blindly negate longitude.
        elif d.get('State') != 'AK' and (lat < 17 or lat > 50 or lon > -64 or lon < -161):
            issue('suspect_coordinates', pid, latitude=lat, longitude=lon, state=d.get('State'))
            lat = lon = None; coord_status = 'quarantined'
        elif lat is not None and (bounds := STATE_BOUNDS.get(d.get('State'))) and pid not in offshore:
            # Coarse state bounds plus 0.5 degrees tolerance avoid border/shoreline false positives.
            # Offshore wind legitimately lies beyond the named state's land boundaries.
            if not (bounds[0]-.5 <= lon <= bounds[2]+.5 and bounds[1]-.5 <= lat <= bounds[3]+.5):
                issue('coordinates_outside_reported_state', pid, latitude=lat, longitude=lon, state=d.get('State'))
                lat = lon = None; coord_status = 'quarantined'
        plants[pid] = {'import_id': run, 'plant_id': pid, 'year': YEAR, 'name': d['Plant Name'],
            'operator_id': org(integer(d.get('Utility ID')), d.get('Utility Name')), 'operator_name': d.get('Utility Name'),
            'state': d.get('State'), 'county': d.get('County'), 'city': d.get('City'), 'address': d.get('Street Address'),
            'latitude': lat, 'longitude': lon, 'coordinate_status': coord_status,
            'nerc_region': d.get('NERC Region'), 'balancing_authority': d.get('Balancing Authority Name'),
            'source_id': r['source_id'], 'source_row': r['row_number']}
    gens = {}
    for r in matching('3_1_'):
        d = r['data']; pid, gid = r['plant_id'], r['generator_id']
        if (pid, gid) in gens: raise ValueError(f'Duplicate generator {pid}/{gid}')
        if pid not in plants:
            issue('generator_without_plant_record', pid, gid)
            plants[pid] = {'import_id': run, 'plant_id': pid, 'year': YEAR, 'name': d.get('Plant Name') or f'EIA Plant {pid}',
                'operator_id': org(integer(d.get('Utility ID')), d.get('Utility Name')), 'operator_name': d.get('Utility Name'),
                'state': d.get('State'), 'county': d.get('County'), 'coordinate_status': 'unavailable',
                'source_id': r['source_id'], 'source_row': r['row_number']}
        if d.get('State') != plants[pid]['state']: issue('generator_state_mismatch', pid, gid)
        cap = number(d.get('Nameplate Capacity (MW)'))
        if cap is None or cap < 0: raise ValueError(f'Invalid capacity {pid}/{gid}')
        g = {'import_id': run, 'plant_id': pid, 'generator_id': gid, 'year': YEAR,
            'status': d.get('Status'), 'lifecycle': source_by_id[r['source_id']]['sheet'],
            'nameplate_mw': cap, 'summer_mw': number(d.get('Summer Capacity (MW)')), 'winter_mw': number(d.get('Winter Capacity (MW)')),
            'technology': d.get('Technology'), 'prime_mover': d.get('Prime Mover'), 'unit_code': identifier(d.get('Unit Code')),
            'operating_year': integer(d.get('Operating Year')), 'operating_month': integer(d.get('Operating Month')),
            'retirement_year': integer(d.get('Retirement Year')), 'retirement_month': integer(d.get('Retirement Month')),
            'planned_operating_year': integer(d.get('Current Year')), 'planned_retirement_year': integer(d.get('Planned Retirement Year')),
            'ownership_code': d.get('Ownership'), 'operator_id': org(integer(d.get('Utility ID')), d.get('Utility Name')),
            'primary_fuel': d.get('Energy Source 1'), 'fuel_type': fuel_type(d.get('Energy Source 1'), d.get('Prime Mover')),
            'is_storage': d.get('Prime Mover') in STORAGE_PM,
            'source_id': r['source_id'], 'source_row': r['row_number']}
        for field in ['operating_month', 'retirement_month']:
            if g[field] is not None and not 1 <= g[field] <= 12:
                issue('invalid_service_month', pid, gid, field=field, reported=g[field])
                g[field] = None
        g['capacity_hours'] = capacity_hours(g)
        if g['capacity_hours'] is None: issue('unknown_service_dates', pid, gid)
        gens[(pid, gid)] = g

    fuels = {}
    for r in matching('3_1_') + matching('3_5_'):
        for key, value in r['data'].items():
            match = re.fullmatch(r'(Energy Source|Startup Source|Cofire Energy Source) (\d+)', key)
            if not match: continue
            role = {'Energy Source': 'operating', 'Startup Source': 'startup', 'Cofire Energy Source': 'cofire'}[match[1]]
            k = (r['plant_id'], r['generator_id'], role, str(value))
            if k[:2] not in gens:
                issue('supplement_without_generator', *k[:2], source_id=r['source_id']); continue
            fuels.setdefault(k, {'import_id': run, 'plant_id': k[0], 'generator_id': k[1], 'role': role,
                'fuel_code': value, 'priority': int(match[2]), 'source_id': r['source_id'], 'source_row': r['row_number']})

    ownership = defaultdict(list)
    for r in matching('4___'):
        d = r['data']; key = (r['plant_id'], r['generator_id'])
        if key not in gens:
            issue('owner_without_generator', *key, source_row=r['row_number']); continue
        oid = org(integer(d.get('Ownership ID')), d.get('Owner Name')); share = number(d.get('Percent Owned'))
        if oid is None or share is None or not 0 <= share <= 1:
            issue('invalid_ownership', *key, owner_id=oid, fraction=share); continue
        if any(o['owner_id'] == oid for o in ownership[key]):
            issue('duplicate_ownership', *key, owner_id=oid); continue
        ownership[key].append({'import_id': run, 'plant_id': key[0], 'generator_id': key[1], 'owner_id': oid,
            'owner_name': d.get('Owner Name') or orgs[oid]['name'], 'fraction': share, 'basis': 'reported', 'source_id': r['source_id'], 'source_row': r['row_number']})
    for key, g in gens.items():
        if not ownership[key] and g['ownership_code'] == 'S' and g['operator_id'] is not None:
            ownership[key].append({'import_id': run, 'plant_id': key[0], 'generator_id': key[1], 'owner_id': g['operator_id'],
                'owner_name': orgs[g['operator_id']]['name'], 'fraction': 1.0, 'basis': 'single_owner_code',
                'source_id': g['source_id'], 'source_row': g['source_row']})
        total = sum(o['fraction'] for o in ownership[key])
        if abs(total - 1) > .001:
            issue('ownership_incomplete' if total < 1 else 'ownership_exceeds_100_percent', *key, reported_fraction=total)

    fuels_by_generator = defaultdict(list)
    for f in fuels.values(): fuels_by_generator[(f['plant_id'], f['generator_id'])].append(f)

    # All supplemental source fields remain queryable, but do not add their capacity again.
    for prefix in ['3_2_', '3_3_', '3_4_', '3_5_']:
        for r in matching(prefix):
            key = r['plant_id'], r['generator_id']; g = gens.get(key)
            if not g: issue('supplement_without_generator', *key, source_id=r['source_id']); continue
            for field, normalized in [('Nameplate Capacity (MW)', 'nameplate_mw'), ('Status', 'status'), ('Operating Year', 'operating_year')]:
                value = number(r['data'].get(field)) if normalized != 'status' else r['data'].get(field)
                if value is not None and g[normalized] is not None and value != g[normalized]:
                    issue('supplement_conflict', *key, field=field, canonical=g[normalized], supplemental=value, source_id=r['source_id'])

    by_plant = defaultdict(list)
    for g in gens.values(): by_plant[g['plant_id']].append(g)
    generation = defaultdict(list); storage = defaultdict(list)
    seen = set()
    for sheet in ['Page 1 Generation and Fuel Data', 'Page 1 Puerto Rico', 'Page 1 Energy Storage']:
        for r in matching(sheet=sheet):
            d = r['data']; pid = r['plant_id']
            # 99999-style state fuel adjustments are not physical plants.
            if pid not in plants:
                issue('generation_without_860_plant', pid, source_id=r['source_id'], source_row=r['row_number'], name=d.get('Plant Name'))
                continue
            if integer(d.get('YEAR')) != YEAR: raise ValueError('Unexpected generation year')
            is_storage = d.get('Reported Prime Mover') in STORAGE_PM or sheet == 'Page 1 Energy Storage'
            if is_storage and sheet != 'Page 1 Energy Storage':
                issue('storage_in_main_generation', pid, source_row=r['row_number']); continue
            key = (sheet, pid, d.get('Nuclear Unit Id'), d.get('Reported Prime Mover'), d.get('Reported Fuel Type Code'))
            if key in seen: raise ValueError(f'Duplicate generation grain: {key}')
            seen.add(key)
            annual = number(d.get('Net Generation (Megawatthours)'))
            months = [number(d.get('Netgen ' + m)) for m in MONTHS]
            if annual is not None and complete_sum(months) is not None and abs(annual-sum(months)) > max(1, abs(annual)*1e-6):
                issue('monthly_annual_mismatch', pid, annual=annual, monthly=sum(months), source_row=r['row_number'])
            if plants[pid]['state'] != d.get('Plant State'): issue('generation_state_mismatch', pid, eia923=d.get('Plant State'))
            if integer(d.get('Operator Id')) != plants[pid]['operator_id']: issue('operator_mismatch', pid, eia923=d.get('Operator Id'))
            if d.get('Plant Name') != plants[pid]['name']: issue('plant_name_variant', pid, eia923=d.get('Plant Name'))
            (storage if is_storage else generation)[pid].append({'annual': annual, 'months': months, 'source_id': r['source_id'],
                'source_row': r['row_number'], 'fuel_code': d.get('Reported Fuel Type Code'), 'prime_mover': d.get('Reported Prime Mover'),
                'gross': number(d.get('Gross Generation (Megawatthours)')), 'frequency': d.get('Respondent Frequency')})

    for pid, p in plants.items():
        units = by_plant[pid]; active = [g for g in units if g['status'] in OPERABLE]
        operating = [g for g in units if g['status'] == 'OP']
        proposed = [g for g in units if g['lifecycle'] == 'Proposed']; retired = [g for g in units if g['status'] == 'RE']
        cap = sum(g['nameplate_mw'] for g in active)
        mix = defaultdict(float)
        fuel_types = set()
        for g in (active or proposed or retired or units):
            mix[g['fuel_type']] += g['nameplate_mw']
            fuel_types.add(g['fuel_type'])
            for f in fuels_by_generator[(pid, g['generator_id'])]:
                if f['role'] != 'startup': fuel_types.add(fuel_type(f['fuel_code'], g['prime_mover']))
        by_owner = defaultdict(float)
        owner_bad = False
        for g in active:
            oo = ownership[(pid, g['generator_id'])]
            if sum(o['fraction'] for o in oo) > 1.001: owner_bad = True
            for o in oo: by_owner[o['owner_id']] += g['nameplate_mw'] * o['fraction']
        years = [g['operating_year'] for g in units if g['operating_year'] is not None and g['status'] != 'CN']
        active_years = [g['operating_year'] for g in active if g['operating_year'] is not None]
        p.update({'nameplate_mw': round(cap, 6), 'operating_mw': round(sum(g['nameplate_mw'] for g in operating), 6),
            'proposed_mw': round(sum(g['nameplate_mw'] for g in proposed), 6), 'retired_mw': round(sum(g['nameplate_mw'] for g in retired), 6),
            'storage_mw': round(sum(g['nameplate_mw'] for g in active if g['is_storage']), 6),
            'unit_count': len(units), 'operable_unit_count': len(active), 'status': 'Operating' if operating else 'Standby / out of service' if active else 'Proposed' if proposed else 'Retired' if retired else 'Canceled / unknown',
            'primary_fuel': max(mix, key=mix.get) if mix else 'Other', 'fuel_types': sorted(fuel_types),
            'fuel_capacity': [{'fuel': f, 'capacity_mw': round(v, 6)} for f, v in sorted(mix.items(), key=lambda x: -x[1])],
            'first_operating_year': min(years) if years else None, 'latest_operating_year': max(active_years) if active_years else None,
            'owners': [{'id': oid, 'name': orgs[oid]['name'], 'attributed_mw': round(mw, 6),
                        'plant_capacity_percent': round(mw/cap*100, 4) if cap and not owner_bad else None} for oid, mw in sorted(by_owner.items(), key=lambda x: -x[1])],
            'ownership_coverage_percent': round(sum(by_owner.values())/cap*100, 4) if cap and not owner_bad else None,
            'ownership_status': 'inconsistent' if owner_bad else 'complete' if cap and abs(sum(by_owner.values())-cap) < .001 else 'partial' if by_owner else 'unavailable'})
        gg, ss = generation[pid], storage[pid]
        annual = complete_sum(x['annual'] for x in gg)
        monthly = [complete_sum(x['months'][m] for x in gg) for m in range(12)]
        # Storage charging/discharging is not a conventional generation capacity factor.
        eligible = [g for g in units if not g['is_storage'] and (g['status'] in OPERABLE or (g['status'] == 'RE' and (g['retirement_year'] or 0) >= YEAR))]
        denominator = complete_sum(g['capacity_hours'] for g in eligible)
        cf = annual / denominator if annual is not None and denominator is not None and denominator > 0 else None
        if cf is not None and (cf < 0 or cf > 1): issue('capacity_factor_out_of_range', pid, value=cf)
        if annual is not None and not eligible: issue('generation_without_eligible_capacity', pid, generation_mwh=annual)
        metrics = {'import_id': run, 'plant_id': pid, 'year': YEAR, 'net_generation_mwh': annual,
            'monthly_generation_mwh': monthly, 'capacity_factor': cf, 'capacity_hours_mwh': denominator,
            'capacity_factor_method': 'nameplate_month_prorated_non_storage',
            'generation_status': 'reported' if annual is not None else 'incomplete' if gg else 'not_reported',
            'storage_net_generation_mwh': complete_sum(x['annual'] for x in ss),
            'storage_gross_generation_mwh': complete_sum(x['gross'] for x in ss),
            'monthly_storage_net_mwh': [complete_sum(x['months'][m] for x in ss) for m in range(12)],
            'reporting_frequencies': sorted(set(x['frequency'] for x in gg + ss if x['frequency'])),
            'generation_by_fuel': [{'fuel_code': x['fuel_code'], 'prime_mover': x['prime_mover'], 'generation_mwh': x['annual']} for x in gg],
            'sources': [{'source_id': x['source_id'], 'row': x['source_row']} for x in gg + ss]}
        tables['plant_year_metrics'].append(metrics)

    # Page 4 overlaps Page 1: reconcile as a diagnostic, never add it to the totals.
    page4 = defaultdict(list)
    for r in matching(sheet='Page 4 Generator Data'):
        page4[r['plant_id']].append(number(r['data'].get('Net Generation Year To Date')))
    metric_by_id = {r['plant_id']: r for r in tables['plant_year_metrics']}
    for pid, values in page4.items():
        total = complete_sum(values); main = metric_by_id.get(pid, {}).get('net_generation_mwh')
        if total is not None and main is not None and abs(total-main) > max(1, abs(main)*.001):
            issue('generator_schedule_differs_from_plant_total', pid, page4=total, page1=main)

    tables['import_runs'] = [{'id': run, 'year': YEAR, 'fingerprint': fingerprint, 'status': 'loading', 'warning': WARNING,
                              'reference_documents': documents}]
    tables['source_files'] = [dict(s, import_id=run) for s in sources]
    tables['organizations'] = list(orgs.values())
    tables['plants'] = [{'id': pid} for pid in sorted(plants)]
    tables['generators'] = [{'plant_id': pid, 'generator_id': gid} for pid, gid in gens]
    tables['plant_snapshots'] = list(plants.values())
    tables['generator_snapshots'] = list(gens.values())
    tables['generator_fuels'] = list(fuels.values())
    tables['generator_ownership'] = [o for oo in ownership.values() for o in oo]
    tables['source_records'] = [dict(r, import_id=run) for r in raw]
    tables['import_issues'] = issues
    report = {'import_id': run, 'year': YEAR, 'warning': WARNING, 'counts': {t: len(v) for t,v in tables.items()},
        'issues': dict(Counter(i['code'] for i in issues)), 'mapped_plants': sum(p.get('latitude') is not None for p in plants.values()),
        'plants_with_generation': sum(m['net_generation_mwh'] is not None for m in tables['plant_year_metrics']),
        'method': 'Plant Code joins. Generator register owns capacity. Page 1 owns non-storage generation. Storage separate. Capacity factor is net generation / month-prorated nameplate capacity-hours.'}
    for t, records in tables.items():
        with (OUT / (t + '.jsonl')).open('w') as f:
            for r in records: f.write(json.dumps(r, separators=(',', ':'), allow_nan=False) + '\n')
    (OUT / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return report


def load():
    import psycopg
    from psycopg.types.json import Jsonb
    report = json.loads((OUT / 'report.json').read_text())
    order = ['import_runs','source_files','organizations','plants','generators','plant_snapshots','generator_snapshots',
             'generator_fuels','generator_ownership','plant_year_metrics','source_records','import_issues']
    # A single transaction means readers never see a partial dataset, including repeat imports.
    with psycopg.connect(os.environ['DATABASE_URL'], sslmode='verify-full',
                         sslrootcert=str(ROOT / 'server/certs/supabase-ca.crt')) as conn:
        with conn.cursor() as cur:
            cur.execute('select pg_advisory_xact_lock(860923)')
            cur.execute('select status from public.import_runs where id = %s', (report['import_id'],))
            existing = cur.fetchone()
            if existing and existing[0] == 'complete':
                print('Identical import already complete; no changes.'); return
            for table in order:
                records = [json.loads(line) for line in (OUT / (table+'.jsonl')).open()]
                columns = list(dict.fromkeys(k for r in records for k in r))
                if not records: continue
                # Stable identities may already exist in earlier annual releases.
                if table in {'organizations','plants','generators'}:
                    for start in range(0,len(records),1000):
                        cur.execute(f'insert into public.{table} select * from jsonb_populate_recordset(null::public.{table}, %s) on conflict do nothing', (Jsonb(records[start:start+1000]),))
                else:
                    # INSERT honors RLS for the constrained importer role (COPY does not).
                    names = ','.join(columns)
                    for start in range(0, len(records), 500):
                        cur.execute(f'insert into public.{table} ({names}) select {names} from jsonb_populate_recordset(null::public.{table}, %s)', (Jsonb(records[start:start+500]),))
                print(f'Loaded {table}: {len(records)}', flush=True)
            cur.execute('select count(*) from public.plant_snapshots where import_id=%s', (report['import_id'],))
            assert cur.fetchone()[0] == report['counts']['plant_snapshots']
            cur.execute("update public.import_runs set status='complete', report=%s, completed_at=now() where id=%s", (Jsonb(report), report['import_id']))
            cur.execute('insert into public.active_datasets(year,import_id) values (%s,%s) on conflict(year) do update set import_id=excluded.import_id', (YEAR, report['import_id']))
        conn.commit()
    print('Committed and activated import.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--load', action='store_true', help='Load previously extracted files using DATABASE_URL')
    args = parser.parse_args()
    load() if args.load else extract()
