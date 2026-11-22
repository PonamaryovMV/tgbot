-- Cloudflare D1 (SQLite) миграция v2.1 для модуля совместных расходов
-- database_id = d3e17054-e5c6-4f3d-b6fb-eee6cae0cb63

PRAGMA foreign_keys = ON;

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_members_event_user_unique
  ON event_members(event_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_members_event_id
  ON event_members(event_id);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by_member_id TEXT NOT NULL REFERENCES event_members(id),
  operation_type TEXT NOT NULL DEFAULT 'EXPENSE' CHECK (operation_type IN ('EXPENSE', 'PREPAYMENT')),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Прочее',
  original_amount_minor INTEGER NOT NULL,
  original_currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1.0,
  base_amount_minor INTEGER NOT NULL,
  split_type TEXT NOT NULL CHECK (split_type IN ('EQUAL', 'SHARES', 'EXACT', 'PERCENT', 'MANUAL_ITEMS')),
  items_json TEXT,
  comment TEXT,
  expense_date TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_event_id
  ON expenses(event_id, is_deleted);

CREATE TABLE IF NOT EXISTS expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES event_members(id),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0,
  owed_amount_minor INTEGER NOT NULL DEFAULT 0,
  share_value REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id
  ON expense_splits(expense_id);

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
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_settlements_from_user
  ON settlements(from_user_id, status);

CREATE INDEX IF NOT EXISTS idx_settlements_to_user
  ON settlements(to_user_id, status);

CREATE TABLE IF NOT EXISTS settlement_allocations (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  allocated_amount_minor INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_allocations_settlement_id
  ON settlement_allocations(settlement_id);

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

CREATE INDEX IF NOT EXISTS idx_event_audit_log_event_id
  ON event_audit_log(event_id, created_at);
