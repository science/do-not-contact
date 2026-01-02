/**
 * SQLite state management for tracking organization processing status
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DB_PATH = join(DATA_DIR, "state.db");

export interface Organization {
  id: number;
  name: string;
  website: string | null;
  contact_type: "email" | "form" | "both" | "none" | null;
  contact_value: string | null; // email address or form URL
  status: "pending" | "success" | "failed" | "manual";
  error_message: string | null;
  attempts: number;
  last_attempt_at: string | null;
  created_at: string;
}

export interface Attempt {
  id: number;
  org_id: number;
  attempt_type: "search" | "contact_find" | "email" | "form";
  success: boolean;
  details: string | null; // JSON blob
  screenshot_path: string | null;
  created_at: string;
}

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      website TEXT,
      contact_type TEXT,
      contact_value TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      attempts INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY,
      org_id INTEGER REFERENCES organizations(id),
      attempt_type TEXT,
      success BOOLEAN,
      details TEXT,
      screenshot_path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_org_status ON organizations(status);
    CREATE INDEX IF NOT EXISTS idx_attempts_org ON attempts(org_id);
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDb(): Database.Database {
  if (!db) {
    return initDb();
  }
  return db;
}

// Organization CRUD operations

export function importOrgs(names: string[]): number {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO organizations (name) VALUES (?)
  `);

  const insertMany = db.transaction((names: string[]) => {
    let count = 0;
    for (const name of names) {
      const result = insert.run(name);
      if (result.changes > 0) count++;
    }
    return count;
  });

  return insertMany(names);
}

export function getOrg(name: string): Organization | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM organizations WHERE name = ?").get(name) as Organization | undefined;
}

export function getOrgById(id: number): Organization | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as Organization | undefined;
}

export function getAllOrgs(): Organization[] {
  const db = getDb();
  return db.prepare("SELECT * FROM organizations ORDER BY name").all() as Organization[];
}

export function getOrgsByStatus(status: Organization["status"]): Organization[] {
  const db = getDb();
  return db.prepare("SELECT * FROM organizations WHERE status = ? ORDER BY name").all(status) as Organization[];
}

export function updateOrgContact(
  name: string,
  data: {
    website?: string;
    contact_type: Organization["contact_type"];
    contact_value?: string | null;
    status: Organization["status"];
    error_message?: string | null;
  }
): void {
  const db = getDb();
  db.prepare(`
    UPDATE organizations
    SET website = COALESCE(?, website),
        contact_type = ?,
        contact_value = ?,
        status = ?,
        error_message = ?,
        attempts = attempts + 1,
        last_attempt_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(
    data.website ?? null,
    data.contact_type,
    data.contact_value ?? null,
    data.status,
    data.error_message ?? null,
    name
  );
}

export function resetOrg(name: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE organizations
    SET status = 'pending',
        error_message = NULL
    WHERE name = ?
  `).run(name);
}

export function resetAllOrgs(): void {
  const db = getDb();
  db.prepare("UPDATE organizations SET status = 'pending', error_message = NULL").run();
}

// Attempt logging

export function logAttempt(
  orgName: string,
  attemptType: Attempt["attempt_type"],
  success: boolean,
  details?: Record<string, unknown>,
  screenshotPath?: string
): void {
  const db = getDb();
  const org = getOrg(orgName);
  if (!org) return;

  db.prepare(`
    INSERT INTO attempts (org_id, attempt_type, success, details, screenshot_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    org.id,
    attemptType,
    success ? 1 : 0,
    details ? JSON.stringify(details) : null,
    screenshotPath ?? null
  );
}

export function getAttempts(orgName: string): Attempt[] {
  const db = getDb();
  const org = getOrg(orgName);
  if (!org) return [];

  return db.prepare(`
    SELECT * FROM attempts WHERE org_id = ? ORDER BY created_at DESC
  `).all(org.id) as Attempt[];
}

// Stats

export function getStats(): {
  total: number;
  pending: number;
  success: number;
  failed: number;
  manual: number;
  withEmail: number;
  withForm: number;
} {
  const db = getDb();
  const result = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'manual' THEN 1 ELSE 0 END) as manual,
      SUM(CASE WHEN contact_type IN ('email', 'both') THEN 1 ELSE 0 END) as withEmail,
      SUM(CASE WHEN contact_type IN ('form', 'both') THEN 1 ELSE 0 END) as withForm
    FROM organizations
  `).get() as Record<string, number>;

  return {
    total: result.total ?? 0,
    pending: result.pending ?? 0,
    success: result.success ?? 0,
    failed: result.failed ?? 0,
    manual: result.manual ?? 0,
    withEmail: result.withEmail ?? 0,
    withForm: result.withForm ?? 0,
  };
}
