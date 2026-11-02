import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL,
  UNIQUE (orgId, code)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  username TEXT NOT NULL,
  displayName TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  mustChangePwd INTEGER NOT NULL DEFAULT 0,
  failedCount INTEGER NOT NULL DEFAULT 0,
  lockedUntil TEXT,
  createdAt TEXT NOT NULL,
  UNIQUE (orgId, username)
);

CREATE TABLE IF NOT EXISTS store_members (
  storeId TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (storeId, userId)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activeStoreId TEXT REFERENCES stores(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  storeId TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'DIRECT',
  enabled INTEGER NOT NULL DEFAULT 0,
  configured INTEGER NOT NULL DEFAULT 0,
  lastCheckAt TEXT,
  lastCheckOk INTEGER,
  lastCheckMsg TEXT,
  credentialMask TEXT,
  UNIQUE (storeId, code)
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  storeId TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  openAt TEXT NOT NULL,
  closeAt TEXT,
  floatCashFen INTEGER NOT NULL DEFAULT 0,
  expectedCashFen INTEGER NOT NULL DEFAULT 0,
  expectedOnlineFen INTEGER NOT NULL DEFAULT 0,
  countedCashFen INTEGER,
  diffFen INTEGER,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_open ON shifts(userId) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  storeId TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  orderNo TEXT NOT NULL UNIQUE,
  clientRequestId TEXT NOT NULL,
  amountFen INTEGER NOT NULL,
  status TEXT NOT NULL,
  codeType TEXT NOT NULL,
  channelCode TEXT NOT NULL,
  channelOrderNo TEXT,
  subject TEXT,
  remark TEXT,
  shiftId TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  createdById TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewedById TEXT,
  exceptionReason TEXT,
  amountFenPaid INTEGER,
  paidAt TEXT,
  closedAt TEXT,
  nextQueryAt TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  UNIQUE (storeId, clientRequestId)
);
CREATE INDEX IF NOT EXISTS idx_orders_scope ON orders(storeId, createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shiftId);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fromStatus TEXT,
  toStatus TEXT NOT NULL,
  source TEXT NOT NULL,
  actorId TEXT,
  note TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  storeId TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  refundNo TEXT NOT NULL UNIQUE,
  orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amountFen INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  initiatedById TEXT NOT NULL,
  approvedById TEXT,
  channelRefundNo TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(orderId, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  orgId TEXT NOT NULL,
  storeId TEXT,
  actorId TEXT,
  actorRole TEXT,
  action TEXT NOT NULL,
  targetType TEXT NOT NULL,
  targetId TEXT,
  beforeJson TEXT,
  afterJson TEXT,
  amountFen INTEGER,
  prevHash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_logs(orgId, ts);

CREATE TABLE IF NOT EXISTS settings (
  storeId TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (storeId, key)
);
`
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  return db
}

export function nowIso() {
  return new Date().toISOString()
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function hashOf(prevHash, payload) {
  return createHash('sha256').update(`${prevHash ?? ''}\n${payload}`).digest('hex')
}

export function lastAuditHash(db, orgId) {
  const row = db
    .prepare('SELECT hash FROM audit_logs WHERE orgId = ? ORDER BY id DESC LIMIT 1')
    .get(orgId)
  return row?.hash ?? null
}

export function appendAudit(db, entry) {
  const prevHash = lastAuditHash(db, entry.orgId)
  const payload = JSON.stringify({
    ts: entry.ts,
    orgId: entry.orgId,
    storeId: entry.storeId ?? null,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    beforeJson: entry.beforeJson ?? null,
    afterJson: entry.afterJson ?? null,
    amountFen: entry.amountFen ?? null,
  })
  const hash = hashOf(prevHash, payload)
  db.prepare(
    `INSERT INTO audit_logs
     (ts, orgId, storeId, actorId, actorRole, action, targetType, targetId, beforeJson, afterJson, amountFen, prevHash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.ts,
    entry.orgId,
    entry.storeId ?? null,
    entry.actorId ?? null,
    entry.actorRole ?? null,
    entry.action,
    entry.targetType,
    entry.targetId ?? null,
    entry.beforeJson ?? null,
    entry.afterJson ?? null,
    entry.amountFen ?? null,
    prevHash,
    hash,
  )
  return hash
}

export function verifyAuditChain(db, orgId) {
  const rows = db
    .prepare('SELECT * FROM audit_logs WHERE orgId = ? ORDER BY id ASC')
    .all(orgId)
  let prevHash = null
  for (const row of rows) {
    const payload = JSON.stringify({
      ts: row.ts,
      orgId: row.orgId,
      storeId: row.storeId ?? null,
      actorId: row.actorId ?? null,
      actorRole: row.actorRole ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      beforeJson: row.beforeJson ?? null,
      afterJson: row.afterJson ?? null,
      amountFen: row.amountFen ?? null,
    })
    const expected = hashOf(prevHash, payload)
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return { ok: false, brokenAt: row.id }
    }
    prevHash = row.hash
  }
  return { ok: true, count: rows.length, head: prevHash }
}
