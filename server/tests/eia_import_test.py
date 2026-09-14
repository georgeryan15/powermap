import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('eia', ROOT / 'server/scripts/eia_import.py')
eia = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eia)


class NormalizationTests(unittest.TestCase):
    def test_missing_is_not_zero(self):
        for value in (None, '', '.', 'W', 'NA', 'nan', 'inf'):
            self.assertIsNone(eia.number(value))
        self.assertEqual(eia.number(0), 0)
        self.assertEqual(eia.number('-125.5'), -125.5)
        self.assertIsNone(eia.complete_sum([1, None]))
        self.assertEqual(eia.complete_sum([0, 0]), 0)

    def test_generator_identifiers_preserve_leading_zeroes(self):
        self.assertEqual(eia.identifier('01'), '01')
        self.assertEqual(eia.identifier(1.0), '1')

    def test_capacity_hours_and_leap_year(self):
        g = dict(status='OP', operating_year=2020, operating_month=None, retirement_year=None, retirement_month=None, nameplate_mw=10)
        self.assertEqual(eia.capacity_hours(g, 2024), 87840)
        self.assertEqual(eia.capacity_hours(g), 87600)
        g.update(operating_year=2025, operating_month=12)
        self.assertEqual(eia.capacity_hours(g), 7440)
        g.update(status='RE', operating_year=2000, operating_month=1, retirement_year=2025, retirement_month=1)
        self.assertEqual(eia.capacity_hours(g), 7440)
        g.update(retirement_month=None)
        self.assertIsNone(eia.capacity_hours(g))
        g.update(status='U')
        self.assertEqual(eia.capacity_hours(g), 0)

    def test_storage_is_not_hydro_or_generation(self):
        self.assertEqual(eia.fuel_type('WAT','PS'), 'Pumped storage')
        self.assertEqual(eia.fuel_type('WAT','HY'), 'Hydro')
        self.assertEqual(eia.fuel_type('MWH','BA'), 'Battery')
        self.assertEqual(eia.fuel_type('BIT','ST'), 'Coal')


@unittest.skipUnless((eia.OUT / 'report.json').exists(), 'Run the extractor first for full source reconciliation')
class ExtractedDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        def read(table):
            with (eia.OUT / (table+'.jsonl')).open() as file:
                return [json.loads(line) for line in file]
        cls.plants = {p['plant_id']: p for p in read('plant_snapshots')}
        cls.generators = read('generator_snapshots')
        cls.metrics = {p['plant_id']: p for p in read('plant_year_metrics')}
        cls.raw = read('source_records')
        cls.sources = {s['id']: s for s in read('source_files')}
        cls.owners = read('generator_ownership')

    def test_one_plant_per_identity_and_every_unit_has_parent(self):
        self.assertEqual(len(self.plants), 16935)
        keys = {(g['plant_id'],g['generator_id']) for g in self.generators}
        self.assertEqual(len(keys), len(self.generators))
        self.assertTrue(all(g['plant_id'] in self.plants for g in self.generators))
        self.assertTrue(all(p['name'] for p in self.plants.values()))
        self.assertTrue(all(o['owner_name'] for o in self.owners))

    def test_every_plant_capacity_reconciles_to_register_not_supplements(self):
        from collections import defaultdict
        capacities = defaultdict(float)
        for g in self.generators:
            if g['status'] in eia.OPERABLE: capacities[g['plant_id']] += g['nameplate_mw']
        for pid,p in self.plants.items(): self.assertAlmostEqual(p['nameplate_mw'], capacities[pid], places=5)

    def test_nuclear_units_sum_once_at_plant_level(self):
        pid = 6008  # Palo Verde: three nuclear units, one plant identity.
        raw = [r['data'] for r in self.raw if r['plant_id']==pid and self.sources[r['source_id']]['sheet']=='Page 1 Generation and Fuel Data']
        self.assertGreater(len(raw),1)
        expected = sum(float(r['Net Generation (Megawatthours)']) for r in raw)
        self.assertAlmostEqual(self.metrics[pid]['net_generation_mwh'], expected, places=4)
        generators = [g for g in self.generators if g['plant_id']==pid and g['status'] in eia.OPERABLE]
        self.assertAlmostEqual(self.plants[pid]['nameplate_mw'], sum(g['nameplate_mw'] for g in generators))

    def test_storage_not_double_counted(self):
        pid = next(pid for pid,p in self.plants.items() if p['primary_fuel']=='Battery' and p['nameplate_mw']==p['storage_mw'] and self.metrics[pid]['storage_net_generation_mwh'] is not None)
        self.assertIsNone(self.metrics[pid]['capacity_factor'])
        self.assertIsNone(self.metrics[pid]['net_generation_mwh'])
        raw = [r['data'] for r in self.raw if r['plant_id']==pid and self.sources[r['source_id']]['sheet']=='Page 1 Energy Storage']
        self.assertAlmostEqual(self.metrics[pid]['storage_net_generation_mwh'], sum(float(r['Net Generation (Megawatthours)']) for r in raw))

    def test_invalid_ownership_not_normalized_to_100_percent(self):
        owners = [o for o in self.owners if o['plant_id']==341 and o['generator_id']=='CT5']
        self.assertEqual(sum(o['fraction'] for o in owners), 1.5)
        # CT5 retired in 2004: its bad historical shares must not contaminate current ownership.
        self.assertEqual(self.plants[341]['ownership_status'], 'complete')
        self.assertEqual(self.plants[341]['ownership_coverage_percent'], 100)
        self.assertEqual(sum(o['attributed_mw'] for o in self.plants[341]['owners']), 252)

    def test_suspect_coordinates_quarantined_but_offshore_kept(self):
        for pid in (64670,68028,68296,68876,68937,69059,69377):
            self.assertIsNone(self.plants[pid]['latitude'])
            self.assertEqual(self.plants[pid]['coordinate_status'], 'quarantined')
        self.assertIsNotNone(self.plants[65561]['latitude'])
        self.assertIsNotNone(self.plants[67435]['latitude'])

    def test_every_source_schedule_count_matches(self):
        from collections import Counter
        counts=Counter(r['source_id'] for r in self.raw)
        self.assertEqual(len(counts),46)
        for sid,source in self.sources.items(): self.assertEqual(counts[sid],source['row_count'])


if __name__=='__main__': unittest.main()
