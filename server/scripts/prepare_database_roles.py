"""Generate local credentials and a SQL role setup file containing SCRAM verifiers only.

Run once per database; apply the output SQL as database owner. Plaintext secrets
stay in ignored, mode-600 files. The importer role must be removed after loading.
"""
import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
from datetime import datetime, timedelta, timezone

root = Path(__file__).resolve().parents[2]
out = root / 'server/import-output'
out.mkdir(exist_ok=True)
host = os.environ.get('PGHOST', 'db.wyomahotilotufvdpior.supabase.co')
tables = ['import_runs','active_datasets','source_files','organizations','plants','generators','plant_snapshots',
          'generator_snapshots','generator_fuels','generator_ownership','plant_year_metrics','source_records','import_issues']

def write_secret(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(value)

def verifier(password):
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    stored = hashlib.sha256(hmac.new(salted, b'Client Key', hashlib.sha256).digest()).digest()
    server = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    b64 = lambda b: base64.b64encode(b).decode()
    return f'SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}'

reader, importer = secrets.token_urlsafe(36), secrets.token_urlsafe(36)
write_secret(root / 'server/.env', f'PORT=3000\nDATABASE_URL=postgresql://powermap_reader:{reader}@{host}:5432/postgres\n')
write_secret(out / 'import.env', f'DATABASE_URL=postgresql://powermap_importer:{importer}@{host}:5432/postgres\n')
sql = [f"create role powermap_reader login password '{verifier(reader)}' connection limit 6;",
       "alter role powermap_reader set default_transaction_read_only=on;",
       "alter role powermap_reader set statement_timeout='15s';",
       f"create role powermap_importer login password '{verifier(importer)}' connection limit 1;",
       f"alter role powermap_importer valid until '{(datetime.now(timezone.utc)+timedelta(hours=6)).isoformat()}';",
       "grant usage on schema public to powermap_reader, powermap_importer;",
       "grant select on public.plant_catalog to powermap_reader;"]
for table in tables:
    sql += [f'grant select on public.{table} to powermap_reader;',
            f'create policy app_reader on public.{table} for select to powermap_reader using(true);',
            f'grant select,insert,update on public.{table} to powermap_importer;',
            f'create policy import_writer on public.{table} for all to powermap_importer using(true) with check(true);']
(out / 'roles.sql').write_text('\n'.join(sql))
cleanup = [f'drop policy import_writer on public.{t}; revoke all on public.{t} from powermap_importer;' for t in tables]
cleanup += ['revoke usage on schema public from powermap_importer;', 'drop role powermap_importer;']
(out / 'cleanup-role.sql').write_text('\n'.join(cleanup))
print('Local credentials prepared. Apply server/import-output/roles.sql, then load, then apply cleanup-role.sql.')
