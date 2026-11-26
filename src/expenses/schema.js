import { cleanPlainText, json } from "../../worker.js";

export const EXPENSE_CURRENCIES = Object.freeze(["RUB", "USD", "EUR", "KZT", "TRY", "GEL"]);
export const EVENT_STATUSES = Object.freeze(["ACTIVE", "SETTLING", "ARCHIVED"]);
export const OPERATION_TYPES = Object.freeze(["EXPENSE", "PREPAYMENT", "TRANSFER"]);
export const SPLIT_TYPES = Object.freeze(["EQUAL", "SHARES", "EXACT", "PERCENT", "MANUAL_ITEMS"]);
export const CONTRIBUTION_STATUSES = Object.freeze(["UNPAID", "PENDING", "PAID"]);

export const EXPENSE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT NOT NULL,
  payment_phone TEXT,
  preferred_banks_json TEXT NOT NULL DEFAULT '[]',
  default_currency TEXT NOT NULL DEFAULT 'RUB',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT '🎉',
  event_date TEXT,
  base_currency TEXT NOT NULL DEFAULT 'RUB',
  creator_id TEXT NOT NULL REFERENCES users(id),
  telegram_chat_id INTEGER,
  bot_card_message_id INTEGER,
  simplify_debts INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SETTLING', 'ARCHIVED')),
  invite_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_members (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  member_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY')),
  default_weight REAL NOT NULL DEFAULT 1.0,
  linked_payer_member_id TEXT REFERENCES event_members(id),
  joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by_member_id TEXT NOT NULL REFERENCES event_members(id),
  operation_type TEXT NOT NULL DEFAULT 'EXPENSE' CHECK (operation_type IN ('EXPENSE', 'PREPAYMENT', 'TRANSFER')),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Прочее',
  original_amount_minor INTEGER NOT NULL,
  original_currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1.0,
  base_amount_minor INTEGER NOT NULL,
  split_type TEXT NOT NULL CHECK (split_type IN ('EQUAL', 'SHARES', 'EXACT', 'PERCENT', 'MANUAL_ITEMS')),
  items_json TEXT,
  split_meta_json TEXT,
  comment TEXT,
  expense_date TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES event_members(id),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0,
  owed_amount_minor INTEGER NOT NULL DEFAULT 0,
  share_value REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  from_user_id TEXT REFERENCES users(id),
  to_user_id TEXT REFERENCES users(id),
  from_member_id TEXT REFERENCES event_members(id),
  to_member_id TEXT REFERENCES event_members(id),
  total_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_method TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS settlement_allocations (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  allocated_amount_minor INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_goals (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_per_member_minor INTEGER NOT NULL,
  receiver_member_id TEXT NOT NULL REFERENCES event_members(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED'))
);

CREATE TABLE IF NOT EXISTS goal_contributions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES event_goals(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES event_members(id),
  status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PENDING', 'PAID')),
  settlement_id TEXT REFERENCES settlements(id)
);

CREATE TABLE IF NOT EXISTS event_audit_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);
`;

export class ExpensesApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getExpensesDb(env) {
  const db = env?.EXPENSES_DB;
  if (!db || typeof db.prepare !== "function") {
    throw new ExpensesApiError(503, "D1 database EXPENSES_DB is not bound");
  }
  return db;
}

export function getExpensesErrorResponse(error) {
  if (error instanceof ExpensesApiError) {
    return json({ error: error.message }, error.status);
  }
  return null;
}

export function getExpensesCorsHeaders(request) {
  const origin = request?.headers?.get("Origin") || "";
  const requestedHeaders = request?.headers?.get("Access-Control-Request-Headers") || "";
  const headers = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || "Content-Type, X-Telegram-Init-Data",
    "Access-Control-Max-Age": "86400"
  };
  if (origin) {
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function withExpensesCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function sanitizePaymentPhone(value) {
  const raw = cleanPlainText(value, 32);
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+\s()-]/g, "").trim();
  if (!/^\+?\d[\d\s()-]{6,22}\d$/.test(cleaned)) {
    throw new ExpensesApiError(400, "Invalid payment phone format");
  }
  return cleaned;
}

export function sanitizePreferredBanks(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      list = Array.isArray(parsed) ? parsed : value.split(",");
    } catch {
      list = value.split(",");
    }
  }
  const normalized = [];
  const seen = new Set();
  for (const item of list) {
    const bank = cleanPlainText(item, 40);
    if (!bank) continue;
    const key = bank.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(bank);
    if (normalized.length >= 10) break;
  }
  return normalized;
}

export function sanitizeCurrency(value, fallback = "RUB") {
  const code = String(value || fallback).trim().toUpperCase();
  if (!EXPENSE_CURRENCIES.includes(code)) {
    throw new ExpensesApiError(400, "Unsupported currency");
  }
  return code;
}

export function sanitizeEventIcon(value) {
  const raw = cleanPlainText(value, 8);
  return raw || "🎉";
}

export function sanitizeWeight(value, fallback = 1.0) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0.5 || num > 20) {
    throw new ExpensesApiError(400, "Weight must be between 0.5 and 20");
  }
  return Math.round(num * 2) / 2;
}

export function sanitizeDateISO(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

export function sanitizeOptionalDateISO(value) {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ExpensesApiError(400, "Invalid event date format");
  }
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ExpensesApiError(400, "Invalid event date");
  }
  return raw;
}

export function generateInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `exp_${hex}`;
}

export function parseBanksJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
