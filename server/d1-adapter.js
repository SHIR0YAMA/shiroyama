import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

class D1PreparedStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1PreparedStatement(this.db, this.sql, params);
  }

  async first(columnName) {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params);
    if (row === undefined) {
      return null;
    }
    if (columnName) {
      return row[columnName] ?? null;
    }
    return row;
  }

  async all() {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.params);
    return { results };
  }

  async run() {
    const stmt = this.db.prepare(this.sql);
    const meta = stmt.run(...this.params);
    return {
      success: true,
      meta: {
        changes: meta.changes,
        last_row_id: Number(meta.lastInsertRowid ?? 0)
      }
    };
  }
}

export class D1Database {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
  }

  prepare(sql) {
    return new D1PreparedStatement(this.db, sql);
  }

  async batch(statements) {
    const results = [];
    this.db.exec('BEGIN');
    try {
      for (const statement of statements) {
        const result = await statement.run();
        results.push(result);
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
