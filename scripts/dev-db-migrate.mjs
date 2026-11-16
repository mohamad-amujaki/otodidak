import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const migrationsDir = join(root, 'migrations');
const d1Dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');

if (!existsSync(d1Dir)) {
  console.log('tidak ada state D1 lokal, lewati');
  process.exit(0);
}

const files = readdirSync(d1Dir).filter(
  (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite',
);

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    statements: readFileSync(join(migrationsDir, name), 'utf8')
      .split('--> statement-breakpoint')
      .map((sql) => sql.trim())
      .filter(Boolean),
  }));

for (const file of files) {
  const db = new DatabaseSync(join(d1Dir, file));
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)',
  );
  const applied = new Set(
    db
      .prepare('select name from d1_migrations')
      .all()
      .map((row) => row.name),
  );
  let appliedCount = 0;
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      db.exec('BEGIN');
      for (const statement of migration.statements) db.exec(statement);
      db.prepare(
        'insert into d1_migrations (name, applied_at) values (?, ?)',
      ).run(migration.name, new Date().toISOString());
      db.exec('COMMIT');
      appliedCount += 1;
    } catch (error) {
      db.exec('ROLLBACK');
      console.log(`${file}: gagal ${migration.name}: ${error.message}`);
    }
  }
  console.log(`${file}: ${appliedCount} migrasi diterapkan`);
  db.close();
}
