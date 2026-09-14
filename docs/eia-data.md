# EIA plant catalogue

The app's object is a **power plant identified by EIA Plant Code**. Generator IDs are strings scoped to that plant, including leading zeroes. Units never become independent map markers. Names and coordinates are not identity keys.

The completed 2025 import contains **16,935 plants**, **36,106 units** and **230,394 original source rows**. Of these plants, 16,893 have usable map coordinates and 12,786 match non-storage generation. See [the import report](eia-2025-import-report.json) for the release fingerprint and issue counts. Issue counts include documented overlaps excluded from aggregation; they do not all represent unresolved errors.

## Data model

| Table | Purpose |
| --- | --- |
| `plants` | Stable EIA plant ID |
| `plant_snapshots` | Versioned annual plant identity, location, operator, lifecycle capacity, capacity by primary source, ownership rollup and commissioning range |
| `generators` | Stable `(plant_id, generator_id)` identities |
| `generator_snapshots` | Annual unit capacity, status, technology, dates and source row |
| `generator_fuels` | Operating, cofire and startup fuels, without multiplying unit capacity |
| `generator_ownership` | Reported fractional shares, source and attribution basis |
| `organizations` | EIA utility and owner IDs |
| `plant_year_metrics` | Non-storage generation, monthly values, capacity factor and separate storage metrics |
| `source_files` / `source_records` | File SHA-256, worksheet, row number and original nonblank fields from **all 46 data worksheets**, including environmental, technology and fuel-receipt schedules |
| `import_runs` / `import_issues` | Reproducible import identity, reference-document manifest, counts and auditable consistency findings |
| `active_datasets` | One completed release per reporting year |
| `plant_catalog` | Read-only, security-invoker view of the active annual plant records |

Snapshots use `(import_id, plant_id)` and generators add `generator_id`. The import record carries the reporting year and source fingerprint, so another year's or revised release's facts do not overwrite historical facts. Organizations are identity records; annual operator names and reported owner names are retained separately.

## Source and aggregation rules

1. `data/2___Plant_Y2025_Early_Release.xlsx` supplies plant attributes. The three worksheets in `3_1_Generator...` are the authoritative generator register. Wind, solar, energy-storage and multifuel worksheets supplement the same units; their capacity is **never added again**.
2. Headline nameplate MW sums `OP`, `SB`, `OA`, `OS` units. In-service (`OP`), proposed, retired and storage capacity are separately available. Storage MW is a subset of operable nameplate MW. Canceled and retired generators remain inspectable but do not increase operable capacity.
3. A plant's primary colour/source is its largest operable capacity category. Plants without operable units fall back to proposed, then retired capacity. Capacity by fuel assigns each unit once to its primary source; additional operating and cofire sources remain on `fuel_types` and in the unit records. Startup fuels are retained separately.
4. Owner shares in EIA-860 are fractions (`0.6` means 60%). Each owner's attributed MW is `sum(unit MW × ownership fraction)`. Plant percentages divide by total operable MW. Missing ownership is never silently assigned to the operator. The `S` ownership code explicitly means sole ownership by respondent; that supports a 100% attribution when no ownership schedule row exists. Contradictory totals greater than 100% are retained but plant percentages are withheld as inconsistent.
5. Non-storage net generation comes **only** from EIA-923 Page 1 Generation and Fuel Data, grouped by Plant ID across fuel/prime-mover/nuclear-unit rows. Page 4 generator generation and the nonutility source/disposition file overlap this information and are not added. Page 4 differences are diagnostic because its coverage is partial. Puerto Rico rows without an EIA-860 base plant remain in source records and unmatched-record notes. EIA's synthetic state-fuel adjustments (e.g. plant 99999) and non-generating transfer facilities never become plants.
6. Storage Page 1 is authoritative for gross discharge and net storage generation. The matching 864 storage rows in the main generation sheet are not counted again. Charging and losses may yield negative net storage generation. Storage is excluded from conventional capacity factor.
7. Capacity factor is a ratio: `annual non-storage net MWh / sum(non-storage nameplate MW × service hours in year)`. Service hours include the commissioning month and retirement month in full and account for leap years. Unknown relevant dates give an unknown denominator. Proposed and canceled capacity contributes no hours. Retired units contribute if they operated in the reporting year. This is explicitly an approximate **nameplate-based** capacity factor, not EIA's published net-summer-capacity method. Within-year uprates, derates and outages are not reconstructed. Values outside 0–100% remain visible with review notes.
8. Missing values (`.`, blank, withheld symbols) become null in typed numeric facts. Zero remains zero and negative net generation is preserved. A missing component makes an aggregate incomplete, not zero. Monthly data may include EIA estimates for annual respondents and are not described as live or hourly observations.
9. Commissioning is represented by first reported unit operating year and latest operable unit operating year, with individual dates and proposed/retirement years available in supporting details. Construction start date and construction cost are not invented from these years.

Both releases explicitly warn against state, regional or national aggregation. The UI therefore displays catalogue coverage counts, not national MW/MWh totals or invented carbon intensity, live output or daily changes.

## Import quality handling

- Missing or invalid coordinates are not plotted. Non-offshore positions more than 0.5 degrees outside the reported state's coarse bounds are quarantined. The original coordinates remain in `source_records` and `import_issues`; coordinates are never guessed or silently moved.
- `scripts/state-bounds.json` is derived from the existing `client/node_modules/us-atlas/states-10m.json` (us-atlas 3.0.1, Census cartographic boundaries) using topojson-client 3.1.0. This is a coarse anomaly check, not proof that every point is in the correct county. Alaska's antimeridian and offshore wind are handled explicitly.
- Seven quarantined state mismatches: 64670, 68028, 68296, 68876, 68937, 69059, 69377. Offshore plants 65561 and 67435 are retained.
- The two generator-only plants 60781 and 64649 have no plant name, state or location in the supplied rows. They remain searchable as `EIA Plant <ID>` with source and quality notes.
- Invalid legacy service-month values (`0`, `88`) become unknown months; original values remain in the source records.
- Ownership at plant 341 contains a 150% total for unit CT5, retired in 2004. That inconsistency is preserved and flagged on the historical unit; it does not contaminate the correctly reconciled ownership of today's operable units. An over-100% total on an operable unit would withhold plant percentages rather than rescale them. Missing owner names fall back to the same EIA organization's registered name.
- Every supplied Excel file is inventoried. `EIA-860 Form.xlsx` is a blank collection form/reference workbook, not a data export (one sheet extends to over a million formatted rows). The field directory, reference tables and instructions PDF are reference documents with hashes in the import manifest; their rows are not fabricated into plant records.

## Run the app

The local server is configured with an ignored `server/.env` containing a dedicated read-only database login. No database credentials are shipped to the browser.

```sh
cd server
npm ci
npm run dev
```

In another terminal:

```sh
cd client
npm ci
npm run dev
```

Vite proxies `/api` to port 3000. For production, run `server` behind your normal HTTPS reverse proxy and route `/api` to it. Serve `client/dist` from the same origin. `VITE_API_BASE_URL` can override the API prefix; if using a separate origin, configure CORS on the deployment proxy for that origin. This change does not deploy a public website.

Database TLS verifies both the CA and hostname. `server/certs/supabase-ca.crt` is Supabase's public Root 2021 CA from `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`; it contains no private key. Set `DATABASE_CA_PATH` if the project's CA changes. Direct database access requires IPv6; an IPv4-only deployment should use the project's Supavisor session endpoint and matching username in `DATABASE_URL`.

## API

All routes are read-only and default to `year=2025`.

| Route | Response |
| --- | --- |
| `GET /api/v1/plants/dataset` | Active release, warning, coverage report, source manifest |
| `GET /api/v1/plants/map` | Compact catalogue, including unmapped plants with null coordinates; not limited to 1,000 rows |
| `GET /api/v1/plants` | Paginated plant records; `q`, `state`, `fuel`, `status`, `sort`, `limit`, `offset` |
| `GET /api/v1/plants/:id` | Plant rollup, generation, supporting units/fuels/owners, quality notes, source schedules |
| `GET /api/v1/plants/:id/generation` | Annual/monthly generation, storage and capacity-factor method |
| `GET /api/v1/plants/:id/metadata` | Original source rows; optional `source` ID, `limit`, `offset` |

Sort values: `name`, `capacity`, `generation`, `newest`. List limit: 1–500; metadata limit: 1–100. Values are parameterized, sort expressions are allowlisted, and malformed parameters return 400. Missing plants return 404; database failures return a generic 500 without leaking connection details. The map and browser share filters, show every plant once and paginate rendered list rows.

## Reproduce the import

```sh
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/scripts/requirements.txt
server/.venv/bin/python server/scripts/eia_import.py
server/.venv/bin/python -m unittest discover -s server/tests -p '*_test.py' -v
```

Extraction writes ignored `server/import-output/*.jsonl` and `report.json`. The input files are unchanged. The import ID fingerprints source hashes, reference hashes, transformation code and coordinate-validation bounds. No database access is required for extraction or reconciliation tests.

Apply `supabase/migrations/20260914111710_eia_plant_database.sql` to an empty Supabase project, then load using a trusted server-side database account with insert/update rights and appropriate RLS policies:

```sh
# DATABASE_URL must be supplied securely in the environment.
server/.venv/bin/python server/scripts/eia_import.py --load
```

All data is inserted in one transaction protected by an advisory lock. Only after successful insertion and checks does the importer mark the release complete and atomically activate it. Any constraint/error rolls back the entire import. Loading an already-completed identical import is a no-op; distinct releases are retained. Do not edit extracted JSON files manually for production imports.

For a new database, `prepare_database_roles.py` can create a local setup SQL file with SCRAM password verifiers and exclusive mode-600 credential files. Apply its role SQL as administrator, load, and then apply its `cleanup-role.sql` to remove the temporary importer. The app reader has only SELECT grants, RLS read policies, a read-only transaction default, a 15-second statement timeout and a connection limit. The importer never receives database DDL or superuser privileges. Do not commit credentials or temporary role files.

## Verification

```sh
cd server
RUN_DATABASE_TESTS=1 npm test
cd ../client
npm run build
npm run lint
```

The database integration suite performs read-only endpoint checks, reconciles a three-unit nuclear plant, checks the full map count, tests injection/validation/404 cases and verifies that the app's database role cannot write. Python tests reconcile every plant's capacity to the generator register, confirm nuclear and storage counting, enforce ownership uncertainty and test coordinate, missing-value, date and identifier edge cases.

Primary methodology references: [EIA-860](https://www.eia.gov/electricity/data/eia860/), [EIA-923](https://www.eia.gov/electricity/data/eia923/), [EIA Electric Power Annual capacity-factor methodology](https://www.eia.gov/electricity/annual/pdf/epa.pdf), [Supabase TLS verification](https://supabase.com/docs/guides/database/connecting-to-postgres).
