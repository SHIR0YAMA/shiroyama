import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve(process.env.DB_PATH ?? './data/app.db');
const migrationsDir = path.resolve('./db/migrations');
const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
)
`);

function runMigrationSql(sql) {
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (error) {
      const msg = String(error.message || '');
      const ignorable = msg.includes('duplicate column name') || msg.includes('already exists');
      if (!ignorable) throw error;
    }
  }
}

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const exists = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(file);
  if (exists) continue;

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  db.exec('BEGIN');
  try {
    runMigrationSql(sql);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    db.exec('COMMIT');
    console.log(`Migração aplicada: ${file}`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

console.log('Migrações concluídas.');
