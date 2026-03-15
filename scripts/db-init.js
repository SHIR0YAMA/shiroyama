import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve(process.env.DB_PATH ?? './data/app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const schemaSql = fs.readFileSync(path.resolve('./db/schema.sql'), 'utf8');
const db = new DatabaseSync(dbPath);
db.exec(schemaSql);

console.log(`Banco inicializado em: ${dbPath}`);
