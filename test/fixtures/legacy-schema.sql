-- LAGBO NAKI? - database schema (SQLite). Idempotent: safe to run repeatedly.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin users with role-based access. Roles: owner (everything), dispatcher (requests), viewer (read-only)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','dispatcher','viewer')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Service requests (structured service records)
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_code TEXT NOT NULL UNIQUE,          -- shown to customer, e.g. LN-7K2M9Q
  tracking_token_hash TEXT NOT NULL,          -- sha256 of secret token given to customer once
  request_type TEXT NOT NULL CHECK (request_type IN ('battery','repair','other')),
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','confirmed','in_progress','completed','cancelled','out_of_area')),
  next_step TEXT NOT NULL DEFAULT 'technician' CHECK (next_step IN ('technician','callback','chat_only')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','bn')),

  customer_name TEXT NOT NULL,
  callback_phone TEXT NOT NULL,
  area_id INTEGER REFERENCES service_areas(id),
  location_text TEXT NOT NULL,
  map_lat REAL,
  map_lng REAL,
  in_service_area INTEGER NOT NULL DEFAULT 0, -- 1 = matched a configured area, 0 = unknown/outside

  vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  vehicle_year INTEGER,
  fuel_type TEXT,
  registration TEXT,                           -- optional, customer-provided
  maintenance_history TEXT,

  symptoms TEXT NOT NULL,
  started_when TEXT,
  safety_flag INTEGER NOT NULL DEFAULT 0,      -- customer reported unsafe place / injury

  ai_summary TEXT,                             -- AI or fallback summary, never a confirmed diagnosis
  ai_source TEXT,                              -- 'model' | 'fallback' | 'none'
  ai_assessment TEXT,                          -- tentative, unconfirmed
  estimate_min INTEGER,                        -- BDT, from pricing table only
  estimate_max INTEGER,
  estimate_basis TEXT,                         -- which pricing rows were used

  consent_store INTEGER NOT NULL DEFAULT 0,    -- consent to store/process the request
  consent_ai_photos INTEGER NOT NULL DEFAULT 0,
  consent_whatsapp_share INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,

  technician_notes TEXT,                       -- internal only, never returned to customer API
  final_bill_note TEXT,                        -- itemized bill text after completion (shown to customer)
  correction_requested INTEGER NOT NULL DEFAULT 0,
  deletion_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);

-- Draft uploads: photos are uploaded BEFORE the request exists, then attached on submit.
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id TEXT NOT NULL UNIQUE,              -- random id, unguessable
  draft_token_hash TEXT NOT NULL,              -- binds photo to the browser session that uploaded it
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,                   -- random filename inside private uploads dir
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  label TEXT,                                  -- vehicle | dashboard | damage | battery | other
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_request ON photos(request_id);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,                         -- 'customer' | admin username | 'system'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Business-editable configuration -------------------------------------------------
CREATE TABLE IF NOT EXISTS service_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL,
  name_bn TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',           -- comma separated lowercase match words
  active INTEGER NOT NULL DEFAULT 1
);

-- Pricing: ONLY source of estimates. Empty table => "needs inspection".
CREATE TABLE IF NOT EXISTS pricing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                   -- e.g. battery_start_service
  label_en TEXT NOT NULL,
  label_bn TEXT NOT NULL,
  category TEXT NOT NULL,                      -- matches symptom category: battery, tyre, brakes ...
  min_bdt INTEGER NOT NULL CHECK (min_bdt >= 0),
  max_bdt INTEGER NOT NULL CHECK (max_bdt >= min_bdt),
  note_en TEXT,
  note_bn TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,                         -- e.g. admin_login, admin_login_failed, status_change
  target TEXT,                                 -- e.g. request code (no personal data)
  ip_hash TEXT                                 -- salted hash, not raw IP
);

-- Session store
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
