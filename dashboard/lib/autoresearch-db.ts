import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "autoresearch.db");

let db: Database.Database | null = null;

export function getAutoresearchDb(): Database.Database | null {
  if (!fs.existsSync(DB_PATH)) {
    return null;
  }
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
  }
  return db;
}
