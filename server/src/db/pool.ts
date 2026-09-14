import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool, types } from 'pg'

// Resolve relative to this module so running from either the repo or server works.
const envPath = resolve(__dirname, '../../.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)
types.setTypeParser(1700, Number)

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'false'
      ? false
      : {
          rejectUnauthorized: true,
          ca: readFileSync(
            process.env.DATABASE_CA_PATH ||
              resolve(__dirname, '../../certs/supabase-ca.crt'),
            'utf8',
          ),
        },
  // Leave room for the dev server and integration suite within the role's six connections.
  max: 3,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  application_name: 'powermap-api',
})
pool.on('error', (error) =>
  console.error('Database connection error:', error.message),
)
