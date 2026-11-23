import {
  DEFAULT_GROUPS,
  LEGACY_GROUP_NAMES,
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  MAX_OCCASIONS,
  MAX_NEW_GIFT_NOTIFICATIONS,
  NOTIFICATION_BATCH_SIZE,
  createShortId,
  dispatchBackground,
  json,
  cleanPlainText,
  normalizeUsername,
  parseId,
  sanitizeHttpUrl,
  sanitizeImage,
  sanitizeDesire,
  sanitizeTags,
  sanitizeGiftGroupIds,
  sanitizeGiftOccasionIds,
  sanitizeGroupName,
  sanitizeOccasionTitle,
  findGiftIndex,
  createGiftId,
  getInternalImageId,
  assertInternalImageOwnership,
  cloneInternalImage,
  loadWishlist,
  saveWishlist,
  directoryKey,
  groupsKey,
  removeSubscriber,
  loadGroups,
  saveGroups,
  getGroup,
  buildSocialPayload,
  requestTelegramUserSelection,
  collectGiftViewerIds,
  canViewerAccessGift,
  assertGiftVisible,
  cleanupGiftAudience,
  cleanupRecordAudience,
  syncWishlistParticipation,
  handleParticipationsGet,
  serializeWishlist,
  handleTelegramWebhook,
  handleSharedUserSelection
} from "./worker.js";

const EXPENSE_CURRENCIES = Object.freeze(["RUB", "USD", "EUR", "KZT", "TRY", "GEL"]);
const EVENT_STATUSES = Object.freeze(["ACTIVE", "SETTLING", "ARCHIVED"]);
const OPERATION_TYPES = Object.freeze(["EXPENSE", "PREPAYMENT", "TRANSFER"]);
const SPLIT_TYPES = Object.freeze(["EQUAL", "SHARES", "EXACT", "PERCENT", "MANUAL_ITEMS"]);

const EXPENSE_SCHEMA_SQL = `
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
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
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

class ExpensesApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getExpensesDb(env) {
  const db = env?.EXPENSES_DB;
  if (!db || typeof db.prepare !== "function") {
    throw new ExpensesApiError(503, "D1 database EXPENSES_DB is not bound");
  }
  return db;
}

function sanitizePaymentPhone(value) {
  const raw = cleanPlainText(value, 32);
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+\s()-]/g, "").trim();
  if (!/^\+?\d[\d\s()-]{6,22}\d$/.test(cleaned)) {
    throw new ExpensesApiError(400, "Invalid payment phone format");
  }
  return cleaned;
}

function sanitizePreferredBanks(value) {
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

function sanitizeCurrency(value, fallback = "RUB") {
  const code = String(value || fallback).trim().toUpperCase();
  if (!EXPENSE_CURRENCIES.includes(code)) {
    throw new ExpensesApiError(400, "Unsupported currency");
  }
  return code;
}

function sanitizeEventIcon(value) {
  const raw = cleanPlainText(value, 8);
  return raw || "🎉";
}

function sanitizeWeight(value, fallback = 1.0) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0.5 || num > 20) {
    throw new ExpensesApiError(400, "Weight must be between 0.5 and 20");
  }
  return Math.round(num * 2) / 2;
}

function sanitizeDateISO(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function generateInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `exp_${hex}`;
}

function parseBanksJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatUserRow(row, viewer) {
  const preferredBanks = parseBanksJson(row?.preferred_banks_json);
  return {
    id: row?.id || `usr_${viewer.id}`,
    telegram_id: Number(row?.telegram_id || viewer.id),
    username: row?.username || normalizeUsername(viewer.username || "", false),
    display_name: row?.display_name || cleanPlainText(viewer.first_name, 64) || "Пользователь",
    payment_phone: row?.payment_phone || "",
    preferred_banks: preferredBanks,
    preferred_banks_json: JSON.stringify(preferredBanks),
    default_currency: row?.default_currency || "RUB",
    created_at: row?.created_at || "",
    updated_at: row?.updated_at || ""
  };
}

async function ensureUserProfile(db, viewer) {
  const now = new Date().toISOString();
  const displayName = cleanPlainText(viewer.first_name, 64) || "Пользователь";
  const username = normalizeUsername(viewer.username || "", false);
  const existing = await db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(viewer.id)
    .first();

  if (!existing) {
    const userId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO users (
          id, telegram_id, username, display_name, payment_phone,
          preferred_banks_json, default_currency, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '', '[]', 'RUB', ?, ?)`
      )
      .bind(userId, viewer.id, username, displayName, now, now)
      .run();
    const created = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first();
    return formatUserRow(created, viewer);
  }

  const nextUsername = username || existing.username || "";
  const nextDisplayName = displayName || existing.display_name || "Пользователь";
  if (nextUsername !== (existing.username || "") || nextDisplayName !== existing.display_name) {
    await db
      .prepare("UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?")
      .bind(nextUsername, nextDisplayName, now, existing.id)
      .run();
  }
  const refreshed = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(existing.id)
    .first();
  return formatUserRow(refreshed || existing, viewer);
}

async function appendAuditLog(db, eventId, actorUserId, action, details = {}) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO event_audit_log (id, event_id, actor_user_id, action, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      eventId,
      actorUserId || null,
      action,
      JSON.stringify(details || {}),
      now
    )
    .run();
}

function buildUnifiedWalletsFromMembers(members) {
  const byId = new Map(members.map(m => [m.id, m]));
  const groups = new Map();

  for (const m of members) {
    const headId = m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
      ? m.linked_payer_member_id
      : m.id;
    if (!groups.has(headId)) groups.set(headId, []);
    groups.get(headId).push(m);
  }

  const wallets = [];
  for (const [headId, groupMembers] of groups.entries()) {
    if (groupMembers.length >= 2) {
      wallets.push({
        id: headId,
        head_member_id: headId,
        name: groupMembers.map(m => m.member_name).join(" + "),
        member_ids: groupMembers.map(m => m.id)
      });
    }
  }
  return wallets;
}

/* ==========================================================================
   ДВИЖОК РАСПРЕДЕЛЕНИЯ ДОЛЕЙ (MINOR UNITS — КОПЕЙКИ/ЦЕНТЫ)
   ========================================================================== */
export function distributeExactMinor(totalMinor, items) {
  const total = Math.round(Number(totalMinor) || 0);
  if (!Array.isArray(items) || items.length === 0 || total <= 0) return [];
  const totalWeight = items.reduce((s, it) => s + (Number(it.weight) || 0), 0);
  if (totalWeight <= 0) return [];

  const rows = items.map((it, idx) => {
    const exact = (total * (Number(it.weight) || 0)) / totalWeight;
    const floored = Math.floor(exact);
    return {
      member_id: it.member_id,
      weight: Number(it.weight) || 0,
      minor: floored,
      remainder: exact - floored,
      idx
    };
  });

  let remainderMinor = total - rows.reduce((s, r) => s + r.minor, 0);
  const byRemainder = [...rows].sort((a, b) => (b.remainder - a.remainder) || (a.idx - b.idx));
  for (let i = 0; i < remainderMinor; i += 1) {
    byRemainder[i % byRemainder.length].minor += 1;
  }

  return rows.map(r => ({
    member_id: r.member_id,
    amount_minor: r.minor,
    share_value: r.weight
  }));
}

export function computeOperationSplits({
  operationType,
  originalAmountMinor,
  exchangeRate,
  splitType,
  payers,
  transferFromId,
  transferToId,
  includedMemberIds,
  weightsMap,
  exactMinorMap,
  percentMap,
  items,
  members
}) {
  const memberIds = new Set(members.map(m => m.id));
  const opType = String(operationType || "EXPENSE").toUpperCase();
  if (!OPERATION_TYPES.includes(opType)) {
    throw new ExpensesApiError(400, "Unsupported operation type");
  }

  const rate = Number(exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000000) {
    throw new ExpensesApiError(400, "Exchange rate must be a positive number");
  }

  let origMinor = Math.round(Number(originalAmountMinor) || 0);
  const mode = opType === "TRANSFER" ? "EXACT" : String(splitType || "EQUAL").toUpperCase();
  if (!SPLIT_TYPES.includes(mode)) {
    throw new ExpensesApiError(400, "Unsupported split mode");
  }

  if (opType === "TRANSFER") {
    if (!transferFromId || !transferToId || !memberIds.has(transferFromId) || !memberIds.has(transferToId)) {
      throw new ExpensesApiError(400, "Select valid sender and recipient for transfer");
    }
    if (transferFromId === transferToId) {
      throw new ExpensesApiError(400, "Sender and recipient must be different members");
    }
    if (origMinor <= 0) {
      throw new ExpensesApiError(400, "Amount must be greater than zero");
    }
    const baseMinor = Math.round(origMinor * rate);
    return {
      operation_type: "TRANSFER",
      split_type: "EXACT",
      original_amount_minor: origMinor,
      exchange_rate: rate,
      base_amount_minor: baseMinor,
      normalized_items: [],
      splits: [
        { member_id: transferFromId, paid_amount_minor: baseMinor, owed_amount_minor: 0, share_value: 0 },
        { member_id: transferToId, paid_amount_minor: 0, owed_amount_minor: baseMinor, share_value: baseMinor }
      ]
    };
  }

  // Валидация плательщиков
  const validPayers = [...new Set((Array.isArray(payers) ? payers : []).filter(id => memberIds.has(id)))];
  if (validPayers.length === 0) {
    throw new ExpensesApiError(400, "Select at least one payer");
  }

  let normalizedItems = [];
  if (mode === "MANUAL_ITEMS") {
    const rawItems = Array.isArray(items) ? items : [];
    if (rawItems.length === 0) {
      throw new ExpensesApiError(400, "Add at least one receipt item");
    }
    let itemsOrigSum = 0;
    for (const raw of rawItems) {
      const itemTitle = cleanPlainText(raw?.title, 80) || "Позиция";
      const itemMinor = Math.round(Number(raw?.amount_minor) || 0);
      const itemPids = [...new Set((Array.isArray(raw?.member_ids) ? raw.member_ids : []).filter(id => memberIds.has(id)))];
      if (itemMinor <= 0) {
        throw new ExpensesApiError(400, "Each item must have a positive amount");
      }
      if (itemPids.length === 0) {
        throw new ExpensesApiError(400, `Select participants for item «${itemTitle}»`);
      }
      itemsOrigSum += itemMinor;
      normalizedItems.push({
        title: itemTitle,
        amount_minor: itemMinor,
        member_ids: itemPids
      });
    }
    origMinor = itemsOrigSum;
  }

  if (origMinor <= 0) {
    throw new ExpensesApiError(400, "Amount must be greater than zero");
  }

  const baseMinor = Math.round(origMinor * rate);
  const paidRows = distributeExactMinor(
    baseMinor,
    validPayers.map(id => ({ member_id: id, weight: 1 }))
  );
  const paidByMember = new Map(paidRows.map(r => [r.member_id, r.amount_minor]));

  const owedByMember = new Map();
  const shareValByMember = new Map();

  if (mode === "EQUAL") {
    const inc = [...new Set((Array.isArray(includedMemberIds) ? includedMemberIds : []).filter(id => memberIds.has(id)))];
    if (inc.length === 0) {
      throw new ExpensesApiError(400, "Select at least one participant to split equally");
    }
    const dist = distributeExactMinor(
      baseMinor,
      inc.map(id => ({ member_id: id, weight: 1 }))
    );
    for (const d of dist) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, 1);
    }
  } else if (mode === "SHARES") {
    const inc = [...new Set((Array.isArray(includedMemberIds) ? includedMemberIds : []).filter(id => memberIds.has(id)))];
    if (inc.length === 0) {
      throw new ExpensesApiError(400, "Select at least one participant");
    }
    const weighted = inc.map(id => {
      const m = members.find(x => x.id === id);
      const rawW = weightsMap && weightsMap[id] !== undefined ? Number(weightsMap[id]) : Number(m?.default_weight ?? 1);
      if (!Number.isFinite(rawW) || rawW <= 0 || rawW > 100) {
        throw new ExpensesApiError(400, "Share weight must be positive");
      }
      return { member_id: id, weight: rawW };
    });
    const dist = distributeExactMinor(baseMinor, weighted);
    for (const d of dist) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, d.share_value);
    }
  } else if (mode === "EXACT") {
    let sumExact = 0;
    for (const m of members) {
      const val = Math.round(Number(exactMinorMap?.[m.id]) || 0);
      if (val < 0) throw new ExpensesApiError(400, "Exact share cannot be negative");
      if (val > 0) {
        owedByMember.set(m.id, val);
        shareValByMember.set(m.id, val);
        sumExact += val;
      }
    }
    if (Math.abs(sumExact - baseMinor) > 1) {
      throw new ExpensesApiError(400, "Sum of exact amounts must equal total amount");
    }
    // Если разница 1 минорная единица из-за округления, корректируем последнюю долю
    if (sumExact !== baseMinor && owedByMember.size > 0) {
      const lastKey = [...owedByMember.keys()].at(-1);
      owedByMember.set(lastKey, owedByMember.get(lastKey) + (baseMinor - sumExact));
    }
  } else if (mode === "PERCENT") {
    const pctItems = [];
    let sumPct = 0;
    for (const m of members) {
      const pct = Number(percentMap?.[m.id]) || 0;
      if (pct < 0) throw new ExpensesApiError(400, "Percent cannot be negative");
      if (pct > 0) {
        pctItems.push({ member_id: m.id, weight: pct });
        sumPct += pct;
      }
    }
    if (pctItems.length === 0 || Math.abs(sumPct - 100) > 0.05) {
      throw new ExpensesApiError(400, "Percentages must sum to 100%");
    }
    const dist = distributeExactMinor(baseMinor, pctItems);
    for (const d of dist) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, d.share_value);
    }
  } else if (mode === "MANUAL_ITEMS") {
    // Распределяем сумму каждой позиции пропорционально (или поровну между участниками позиции)
    // с сохранением точной суммы baseMinor
    const rawTotals = new Map();
    for (const item of normalizedItems) {
      const itemBaseMinor = Math.round(item.amount_minor * rate);
      const dist = distributeExactMinor(
        itemBaseMinor,
        item.member_ids.map(id => ({ member_id: id, weight: 1 }))
      );
      for (const d of dist) {
        rawTotals.set(d.member_id, (rawTotals.get(d.member_id) || 0) + d.amount_minor);
      }
    }
    const totalRaw = [...rawTotals.values()].reduce((s, v) => s + v, 0);
    if (totalRaw <= 0) {
      throw new ExpensesApiError(400, "Items distribution failed");
    }
    const scaled = distributeExactMinor(
      baseMinor,
      [...rawTotals.entries()].map(([member_id, weight]) => ({ member_id, weight }))
    );
    for (const d of scaled) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, d.amount_minor);
    }
  }

  const allInvolved = new Set([...paidByMember.keys(), ...owedByMember.keys()]);
  const splits = [];
  for (const memberId of allInvolved) {
    const paid = paidByMember.get(memberId) || 0;
    const owed = owedByMember.get(memberId) || 0;
    if (paid === 0 && owed === 0) continue;
    splits.push({
      member_id: memberId,
      paid_amount_minor: paid,
      owed_amount_minor: owed,
      share_value: shareValByMember.get(memberId) || 0
    });
  }

  return {
    operation_type: opType,
    split_type: mode,
    original_amount_minor: origMinor,
    exchange_rate: rate,
    base_amount_minor: baseMinor,
    normalized_items: normalizedItems,
    splits
  };
}

async function loadEventMembers(db, eventId) {
  const res = await db
    .prepare(
      `SELECT em.id, em.event_id, em.user_id, em.member_name, em.role,
              em.default_weight, em.linked_payer_member_id, em.joined_at,
              u.telegram_id, u.username, u.display_name, u.payment_phone, u.preferred_banks_json
       FROM event_members em
       LEFT JOIN users u ON u.id = em.user_id
       WHERE em.event_id = ?
       ORDER BY em.joined_at ASC, em.member_name ASC`
    )
    .bind(eventId)
    .all();

  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map(row => ({
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id || null,
    telegram_id: row.telegram_id ? Number(row.telegram_id) : null,
    username: row.username || "",
    member_name: row.member_name,
    is_ghost: !row.user_id,
    role: row.role || "MEMBER",
    default_weight: Number(row.default_weight ?? 1.0),
    linked_payer_member_id: row.linked_payer_member_id || null,
    payment_phone: row.payment_phone || "",
    preferred_banks: parseBanksJson(row.preferred_banks_json),
    joined_at: row.joined_at || ""
  }));
}

async function loadEventOperations(db, eventId) {
  const expRes = await db
    .prepare(
      `SELECT id, event_id, created_by_member_id, operation_type, title, category,
              original_amount_minor, original_currency, exchange_rate, base_amount_minor,
              split_type, items_json, split_meta_json, comment, expense_date, is_deleted, created_at
       FROM expenses
       WHERE event_id = ? AND is_deleted = 0
       ORDER BY expense_date DESC, created_at DESC`
    )
    .bind(eventId)
    .all();

  const expenses = Array.isArray(expRes?.results) ? expRes.results : [];
  if (expenses.length === 0) return [];

  const splitsRes = await db
    .prepare(
      `SELECT es.id, es.expense_id, es.member_id, es.paid_amount_minor, es.owed_amount_minor, es.share_value
       FROM expense_splits es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.event_id = ? AND e.is_deleted = 0`
    )
    .bind(eventId)
    .all();

  const allSplits = Array.isArray(splitsRes?.results) ? splitsRes.results : [];
  const splitsByExpense = new Map();
  for (const s of allSplits) {
    if (!splitsByExpense.has(s.expense_id)) splitsByExpense.set(s.expense_id, []);
    splitsByExpense.get(s.expense_id).push({
      id: s.id,
      member_id: s.member_id,
      paid_amount_minor: Number(s.paid_amount_minor) || 0,
      owed_amount_minor: Number(s.owed_amount_minor) || 0,
      share_value: Number(s.share_value) || 0
    });
  }

  return expenses.map(row => {
    let items = [];
    let splitMeta = {};
    try {
      items = row.items_json ? JSON.parse(row.items_json) : [];
    } catch {
      items = [];
    }
    try {
      splitMeta = row.split_meta_json ? JSON.parse(row.split_meta_json) : {};
    } catch {
      splitMeta = {};
    }
    const opSplits = splitsByExpense.get(row.id) || [];
    const payers = opSplits.filter(s => s.paid_amount_minor > 0).map(s => s.member_id);
    const sharesMinor = {};
    for (const s of opSplits) {
      if (s.owed_amount_minor > 0) {
        sharesMinor[s.member_id] = s.owed_amount_minor;
      }
    }

    return {
      id: row.id,
      event_id: row.event_id,
      created_by_member_id: row.created_by_member_id,
      operation_type: row.operation_type || "EXPENSE",
      title: row.title,
      category: row.category || "Другое",
      original_amount_minor: Number(row.original_amount_minor) || 0,
      original_currency: row.original_currency || "RUB",
      exchange_rate: Number(row.exchange_rate ?? 1),
      base_amount_minor: Number(row.base_amount_minor) || 0,
      split_type: row.split_type || "EQUAL",
      items,
      split_meta: splitMeta,
      comment: row.comment || "",
      expense_date: row.expense_date || "",
      created_at: row.created_at || "",
      payers,
      shares_minor: sharesMinor,
      splits: opSplits
    };
  });
}

function computeMemberNetBalancesMinor(members, operations) {
  const balances = {};
  for (const m of members) balances[m.id] = 0;

  for (const op of operations) {
    for (const s of op.splits || []) {
      const paid = Number(s.paid_amount_minor) || 0;
      const owed = Number(s.owed_amount_minor) || 0;
      balances[s.member_id] = (balances[s.member_id] || 0) + (paid - owed);
    }
  }
  return balances;
}

function computeViewerUnitNetMinor(members, operations, viewerMemberId) {
  if (!viewerMemberId) return 0;
  const memberBalances = computeMemberNetBalancesMinor(members, operations);
  const byId = new Map(members.map(m => [m.id, m]));
  const viewer = byId.get(viewerMemberId);
  if (!viewer) return 0;
  const viewerUnitHead = viewer.linked_payer_member_id && byId.has(viewer.linked_payer_member_id)
    ? viewer.linked_payer_member_id
    : viewer.id;

  let sum = 0;
  for (const m of members) {
    const head = m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
      ? m.linked_payer_member_id
      : m.id;
    if (head === viewerUnitHead) {
      sum += memberBalances[m.id] || 0;
    }
  }
  return sum;
}

async function loadEventAuditLog(db, eventId, limit = 50) {
  const res = await db
    .prepare(
      `SELECT id, event_id, actor_user_id, action, details_json, created_at
       FROM event_audit_log
       WHERE event_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(eventId, limit)
    .all();

  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map(row => {
    let details = {};
    try {
      details = row.details_json ? JSON.parse(row.details_json) : {};
    } catch {
      details = {};
    }
    return {
      id: row.id,
      event_id: row.event_id,
      actor_user_id: row.actor_user_id || null,
      action: row.action,
      text: details.text || row.action,
      details,
      created_at: row.created_at
    };
  });
}

async function requireEventAccess(db, eventId, userProfileId, { requireAdmin = false } = {}) {
  const eventRow = await db
    .prepare("SELECT * FROM events WHERE id = ?")
    .bind(eventId)
    .first();
  if (!eventRow) {
    throw new ExpensesApiError(404, "Event not found");
  }
  const members = await loadEventMembers(db, eventId);
  const viewerMember = members.find(m => m.user_id === userProfileId);
  if (!viewerMember) {
    throw new ExpensesApiError(403, "You are not a member of this event");
  }
  if (requireAdmin && !["OWNER", "ADMIN"].includes(viewerMember.role)) {
    throw new ExpensesApiError(403, "Only event owner or admin can perform this action");
  }
  return { eventRow, members, viewerMember };
}

function serializeEventDetail(eventRow, members, viewerMember, operations = [], auditLog = []) {
  const totalSpentMinor = operations
    .filter(op => op.operation_type !== "TRANSFER")
    .reduce((sum, op) => sum + (Number(op.base_amount_minor) || 0), 0);
  const netBalanceMinor = computeViewerUnitNetMinor(members, operations, viewerMember?.id || null);

  return {
    id: eventRow.id,
    title: eventRow.title,
    description: eventRow.description || "",
    icon: eventRow.icon || "🎉",
    base_currency: eventRow.base_currency || "RUB",
    creator_id: eventRow.creator_id,
    simplify_debts: Boolean(Number(eventRow.simplify_debts ?? 1)),
    status: eventRow.status || "ACTIVE",
    invite_token: eventRow.invite_token,
    created_at: eventRow.created_at,
    updated_at: eventRow.updated_at,
    viewer_member_id: viewerMember?.id || null,
    viewer_role: viewerMember?.role || null,
    members,
    wallets: buildUnifiedWalletsFromMembers(members),
    total_spent_minor: totalSpentMinor,
    net_balance_minor: netBalanceMinor,
    operations,
    settlements: [],
    audit_log: auditLog
  };
}

async function listUserEventsSummary(db, userProfileId) {
  const rowsResult = await db
    .prepare(
      `SELECT e.id, e.title, e.description, e.icon, e.base_currency, e.creator_id,
              e.simplify_debts, e.status, e.invite_token, e.created_at, e.updated_at,
              em.id AS member_id, em.role AS member_role, em.default_weight,
              (SELECT COUNT(*) FROM event_members em2 WHERE em2.event_id = e.id) AS members_count
       FROM events e
       JOIN event_members em ON em.event_id = e.id
       WHERE em.user_id = ?
       ORDER BY e.updated_at DESC, e.created_at DESC`
    )
    .bind(userProfileId)
    .all();

  const events = Array.isArray(rowsResult?.results) ? rowsResult.results : [];
  const activeEvents = [];
  const archivedEvents = [];
  const summaryByCurrency = {};

  for (const row of events) {
    const members = await loadEventMembers(db, row.id);
    const operations = await loadEventOperations(db, row.id);
    const totalSpentMinor = operations
      .filter(op => op.operation_type !== "TRANSFER")
      .reduce((sum, op) => sum + (Number(op.base_amount_minor) || 0), 0);
    const netMinor = computeViewerUnitNetMinor(members, operations, row.member_id);
    const cur = row.base_currency || "RUB";

    const item = {
      id: row.id,
      title: row.title,
      description: row.description || "",
      icon: row.icon || "🎉",
      base_currency: cur,
      creator_id: row.creator_id,
      simplify_debts: Boolean(Number(row.simplify_debts ?? 1)),
      status: row.status || "ACTIVE",
      invite_token: row.invite_token,
      member_id: row.member_id,
      role: row.member_role,
      default_weight: Number(row.default_weight ?? 1.0),
      members_count: Number(row.members_count ?? members.length ?? 1),
      total_spent_minor: totalSpentMinor,
      net_balance_minor: netMinor,
      balance_state: netMinor > 0 ? "owed_to_you" : netMinor < 0 ? "you_owe" : "settled",
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    if (item.status === "ARCHIVED") {
      archivedEvents.push(item);
    } else {
      activeEvents.push(item);
      if (!summaryByCurrency[cur]) {
        summaryByCurrency[cur] = {
          you_owe_minor: 0,
          owed_to_you_minor: 0,
          pending_outgoing_minor: 0,
          pending_incoming_minor: 0
        };
      }
      if (netMinor > 0) summaryByCurrency[cur].owed_to_you_minor += netMinor;
      else if (netMinor < 0) summaryByCurrency[cur].you_owe_minor += Math.abs(netMinor);
    }
  }

  if (!summaryByCurrency.RUB) {
    summaryByCurrency.RUB = {
      you_owe_minor: 0,
      owed_to_you_minor: 0,
      pending_outgoing_minor: 0,
      pending_incoming_minor: 0
    };
  }

  return {
    active_events: activeEvents,
    archived_events: archivedEvents,
    summary_by_currency: summaryByCurrency,
    cross_event_debts: []
  };
}

export async function handleCoreApi(request, env, viewer, url) {
  const db = getExpensesDb(env);
  const path = url.pathname;

  if (path === "/api/core/bootstrap" && request.method === "GET") {
    const user = await ensureUserProfile(db, viewer);
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({
      ok: true,
      module: "superapp_core",
      d1_bound: true,
      user,
      dashboard,
      supported_currencies: EXPENSE_CURRENCIES
    });
  }

  if (path === "/api/core/profile" && request.method === "GET") {
    const user = await ensureUserProfile(db, viewer);
    return json({ ok: true, user });
  }

  if (path === "/api/core/profile" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const current = await ensureUserProfile(db, viewer);
    const paymentPhone = body.payment_phone !== undefined
      ? sanitizePaymentPhone(body.payment_phone)
      : current.payment_phone;
    const preferredBanks = body.preferred_banks !== undefined || body.preferred_banks_json !== undefined
      ? sanitizePreferredBanks(body.preferred_banks !== undefined ? body.preferred_banks : body.preferred_banks_json)
      : current.preferred_banks;
    const defaultCurrency = body.default_currency !== undefined
      ? sanitizeCurrency(body.default_currency, current.default_currency)
      : sanitizeCurrency(current.default_currency, "RUB");
    const displayName = body.display_name !== undefined
      ? (cleanPlainText(body.display_name, 64) || current.display_name)
      : current.display_name;
    const now = new Date().toISOString();

    await db
      .prepare(
        `UPDATE users
         SET display_name = ?, payment_phone = ?, preferred_banks_json = ?, default_currency = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        displayName,
        paymentPhone,
        JSON.stringify(preferredBanks),
        defaultCurrency,
        now,
        current.id
      )
      .run();

    const updated = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(current.id)
      .first();

    return json({ ok: true, user: formatUserRow(updated || current, viewer) });
  }

  throw new ExpensesApiError(404, "Not found");
}

export async function handleExpensesApi(request, env, viewer, url) {
  const db = getExpensesDb(env);
  const path = url.pathname;
  const method = request.method;
  const user = await ensureUserProfile(db, viewer);

  if (path === "/api/expenses/health" && method === "GET") {
    return json({
      ok: true,
      module: "expenses",
      stage: 3,
      tables_count: 9
    });
  }

  if (path === "/api/expenses/dashboard" && method === "GET") {
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({ ok: true, stage: 3, user, ...dashboard });
  }

  if (path === "/api/expenses/events" && method === "GET") {
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({
      ok: true,
      active_events: dashboard.active_events,
      archived_events: dashboard.archived_events
    });
  }

  // POST /api/expenses/events — создание события + копирование участников + Ghost Profiles
  if (path === "/api/expenses/events" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const title = cleanPlainText(body.title, 80);
    if (!title) {
      throw new ExpensesApiError(400, "Event title is required");
    }
    const description = cleanPlainText(body.description, 240);
    const icon = sanitizeEventIcon(body.icon);
    const baseCurrency = sanitizeCurrency(body.base_currency, user.default_currency || "RUB");
    const simplifyDebts = body.simplify_debts === false || body.simplify_debts === 0 ? 0 : 1;
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const inviteToken = generateInviteToken();

    await db
      .prepare(
        `INSERT INTO events (
          id, title, description, icon, base_currency, creator_id,
          simplify_debts, status, invite_token, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
      )
      .bind(eventId, title, description, icon, baseCurrency, user.id, simplifyDebts, inviteToken, now, now)
      .run();

    const ownerMemberId = crypto.randomUUID();
    const ownerName = cleanPlainText(body.owner_name, 64) || user.display_name || "Участник";
    await db
      .prepare(
        `INSERT INTO event_members (
          id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
        ) VALUES (?, ?, ?, ?, 'OWNER', 1.0, NULL, ?)`
      )
      .bind(ownerMemberId, eventId, user.id, ownerName, now)
      .run();

    const seenUserIds = new Set([user.id]);
    const seenNames = new Set([ownerName.toLocaleLowerCase("ru-RU")]);

    const copyFromEventId = cleanPlainText(body.copy_from_event_id, 64);
    if (copyFromEventId) {
      const sourceAccess = await requireEventAccess(db, copyFromEventId, user.id).catch(() => null);
      if (sourceAccess) {
        for (const srcMember of sourceAccess.members) {
          if (srcMember.user_id && seenUserIds.has(srcMember.user_id)) continue;
          const nameKey = srcMember.member_name.toLocaleLowerCase("ru-RU");
          if (!srcMember.user_id && seenNames.has(nameKey)) continue;
          if (srcMember.user_id) seenUserIds.add(srcMember.user_id);
          seenNames.add(nameKey);

          await db
            .prepare(
              `INSERT INTO event_members (
                id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
              ) VALUES (?, ?, ?, ?, 'MEMBER', ?, NULL, ?)`
            )
            .bind(
              crypto.randomUUID(),
              eventId,
              srcMember.user_id || null,
              srcMember.member_name,
              sanitizeWeight(srcMember.default_weight, 1.0),
              now
            )
            .run();
        }
      }
    }

    const rawGhosts = Array.isArray(body.ghost_names)
      ? body.ghost_names
      : typeof body.ghost_names === "string"
        ? body.ghost_names.split(/[\n,;]+/)
        : [];
    for (const rawName of rawGhosts) {
      const ghostName = cleanPlainText(rawName, 64);
      if (!ghostName) continue;
      const key = ghostName.toLocaleLowerCase("ru-RU");
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      await db
        .prepare(
          `INSERT INTO event_members (
            id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
          ) VALUES (?, ?, NULL, ?, 'MEMBER', 1.0, NULL, ?)`
        )
        .bind(crypto.randomUUID(), eventId, ghostName, now)
        .run();
    }

    await appendAuditLog(db, eventId, user.id, "EVENT_CREATED", {
      text: `${ownerName} создал(а) событие «${title}»`
    });

    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(eventRow, members, viewerMember, operations, auditLog) }, 201);
  }

  // GET /api/expenses/invite/:token
  const inviteGetMatch = path.match(/^\/api\/expenses\/invite\/([A-Za-z0-9_-]+)$/);
  if (inviteGetMatch && method === "GET") {
    const token = inviteGetMatch[1];
    const eventRow = await db
      .prepare("SELECT * FROM events WHERE invite_token = ?")
      .bind(token)
      .first();
    if (!eventRow) {
      throw new ExpensesApiError(404, "Invite link is invalid or expired");
    }
    const members = await loadEventMembers(db, eventRow.id);
    const existingMember = members.find(m => m.user_id === user.id) || null;
    const ghostProfiles = members.filter(m => !m.user_id);

    return json({
      ok: true,
      event: {
        id: eventRow.id,
        title: eventRow.title,
        description: eventRow.description || "",
        icon: eventRow.icon || "🎉",
        base_currency: eventRow.base_currency || "RUB",
        status: eventRow.status || "ACTIVE",
        invite_token: eventRow.invite_token,
        members_count: members.length
      },
      already_joined: Boolean(existingMember),
      viewer_member: existingMember,
      ghost_profiles: ghostProfiles
    });
  }

  // POST /api/expenses/invite/:token/claim
  const inviteClaimMatch = path.match(/^\/api\/expenses\/invite\/([A-Za-z0-9_-]+)\/claim$/);
  if (inviteClaimMatch && method === "POST") {
    const token = inviteClaimMatch[1];
    const body = await request.json().catch(() => ({}));
    const eventRow = await db
      .prepare("SELECT * FROM events WHERE invite_token = ?")
      .bind(token)
      .first();
    if (!eventRow) {
      throw new ExpensesApiError(404, "Invite link is invalid or expired");
    }

    const members = await loadEventMembers(db, eventRow.id);
    const alreadyMember = members.find(m => m.user_id === user.id);
    if (alreadyMember) {
      const operations = await loadEventOperations(db, eventRow.id);
      const auditLog = await loadEventAuditLog(db, eventRow.id);
      return json({
        ok: true,
        claimed: false,
        already_joined: true,
        event: serializeEventDetail(eventRow, members, alreadyMember, operations, auditLog)
      });
    }

    const now = new Date().toISOString();
    const targetMemberId = cleanPlainText(body?.member_id, 64);

    if (targetMemberId && targetMemberId !== "__new") {
      const ghost = members.find(m => m.id === targetMemberId);
      if (!ghost) {
        throw new ExpensesApiError(404, "Selected profile not found in this event");
      }
      if (ghost.user_id) {
        throw new ExpensesApiError(409, "This profile has already been claimed");
      }
      const nextName = cleanPlainText(body?.member_name, 64) || ghost.member_name;
      await db
        .prepare("UPDATE event_members SET user_id = ?, member_name = ? WHERE id = ?")
        .bind(user.id, nextName, ghost.id)
        .run();

      await appendAuditLog(db, eventRow.id, user.id, "PROFILE_CLAIMED", {
        member_id: ghost.id,
        text: `${user.display_name} привязал(а) профиль «${nextName}» по инвайт-ссылке`
      });
    } else {
      const joinName = cleanPlainText(body?.member_name, 64) || user.display_name || "Участник";
      const newMemberId = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO event_members (
            id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
          ) VALUES (?, ?, ?, ?, 'MEMBER', 1.0, NULL, ?)`
        )
        .bind(newMemberId, eventRow.id, user.id, joinName, now)
        .run();

      await appendAuditLog(db, eventRow.id, user.id, "MEMBER_JOINED", {
        member_id: newMemberId,
        text: `${joinName} присоединился(ась) к событию по инвайт-ссылке`
      });
    }

    await db
      .prepare("UPDATE events SET updated_at = ? WHERE id = ?")
      .bind(now, eventRow.id)
      .run();

    const updatedAccess = await requireEventAccess(db, eventRow.id, user.id);
    const operations = await loadEventOperations(db, eventRow.id);
    const auditLog = await loadEventAuditLog(db, eventRow.id);
    return json({
      ok: true,
      claimed: Boolean(targetMemberId && targetMemberId !== "__new"),
      event: serializeEventDetail(updatedAccess.eventRow, updatedAccess.members, updatedAccess.viewerMember, operations, auditLog)
    });
  }

  // GET / PATCH /api/expenses/events/:id
  const eventMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)$/);
  if (eventMatch && method === "GET") {
    const eventId = eventMatch[1];
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(eventRow, members, viewerMember, operations, auditLog) });
  }

  if (eventMatch && method === "PATCH") {
    const eventId = eventMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow } = await requireEventAccess(db, eventId, user.id, { requireAdmin: true });
    const now = new Date().toISOString();

    const title = body.title !== undefined ? (cleanPlainText(body.title, 80) || eventRow.title) : eventRow.title;
    const description = body.description !== undefined ? cleanPlainText(body.description, 240) : (eventRow.description || "");
    const icon = body.icon !== undefined ? sanitizeEventIcon(body.icon) : (eventRow.icon || "🎉");
    const baseCurrency = body.base_currency !== undefined
      ? sanitizeCurrency(body.base_currency, eventRow.base_currency)
      : eventRow.base_currency;
    const simplifyDebts = body.simplify_debts !== undefined
      ? (body.simplify_debts ? 1 : 0)
      : Number(eventRow.simplify_debts ?? 1);
    let status = eventRow.status || "ACTIVE";
    if (body.status !== undefined) {
      const nextStatus = String(body.status).trim().toUpperCase();
      if (!EVENT_STATUSES.includes(nextStatus)) {
        throw new ExpensesApiError(400, "Invalid event status");
      }
      status = nextStatus;
    }

    await db
      .prepare(
        `UPDATE events
         SET title = ?, description = ?, icon = ?, base_currency = ?, simplify_debts = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(title, description, icon, baseCurrency, simplifyDebts, status, now, eventId)
      .run();

    if (status !== eventRow.status) {
      const statusText = status === "ARCHIVED"
        ? "Событие перемещено в архив"
        : status === "SETTLING"
          ? "Траты заморожены — идут расчёты"
          : "Событие активно";
      await appendAuditLog(db, eventId, user.id, "STATUS_CHANGED", { status, text: statusText });
    } else if (body.simplify_debts !== undefined && simplifyDebts !== Number(eventRow.simplify_debts ?? 1)) {
      await appendAuditLog(db, eventId, user.id, "SIMPLIFY_TOGGLED", {
        simplify_debts: Boolean(simplifyDebts),
        text: simplifyDebts ? "Включено упрощение долгов" : "Включены прямые долги"
      });
    }

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  // POST /api/expenses/events/:id/members
  const membersCollectionMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/members$/);
  if (membersCollectionMatch && method === "POST") {
    const eventId = membersCollectionMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const now = new Date().toISOString();
    const seenNames = new Set(members.map(m => m.member_name.toLocaleLowerCase("ru-RU")));

    const rawNames = Array.isArray(body.names)
      ? body.names
      : body.member_name
        ? [body.member_name]
        : [];
    const weight = sanitizeWeight(body.default_weight, 1.0);
    const added = [];

    for (const rawName of rawNames) {
      const name = cleanPlainText(rawName, 64);
      if (!name) continue;
      const key = name.toLocaleLowerCase("ru-RU");
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      await db
        .prepare(
          `INSERT INTO event_members (
            id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
          ) VALUES (?, ?, NULL, ?, 'MEMBER', ?, NULL, ?)`
        )
        .bind(crypto.randomUUID(), eventId, name, weight, now)
        .run();
      added.push(name);
    }

    if (!added.length) {
      throw new ExpensesApiError(400, "Provide at least one unique participant name");
    }

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "MEMBER_ADDED", {
      names: added,
      text: `Добавлен(ы) участник(и): ${added.join(", ")}`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) }, 201);
  }

  // PATCH / DELETE /api/expenses/events/:id/members/:memberId
  const memberItemMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/members\/([A-Za-z0-9_-]+)$/);
  if (memberItemMatch && method === "PATCH") {
    const [, eventId, memberId] = memberItemMatch;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const target = members.find(m => m.id === memberId);
    if (!target) {
      throw new ExpensesApiError(404, "Member not found");
    }

    const nextName = body.member_name !== undefined
      ? (cleanPlainText(body.member_name, 64) || target.member_name)
      : target.member_name;
    const nextWeight = body.default_weight !== undefined
      ? sanitizeWeight(body.default_weight, target.default_weight)
      : target.default_weight;
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE event_members SET member_name = ?, default_weight = ? WHERE id = ?")
      .bind(nextName, nextWeight, memberId)
      .run();

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    if (nextWeight !== target.default_weight) {
      await appendAuditLog(db, eventId, user.id, "MEMBER_WEIGHT_UPDATED", {
        member_id: memberId,
        weight: nextWeight,
        text: `Вес участника «${nextName}» изменён на ${nextWeight}x`
      });
    }

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  if (memberItemMatch && method === "DELETE") {
    const [, eventId, memberId] = memberItemMatch;
    const { members } = await requireEventAccess(db, eventId, user.id, { requireAdmin: true });
    const target = members.find(m => m.id === memberId);
    if (!target) {
      throw new ExpensesApiError(404, "Member not found");
    }
    if (target.role === "OWNER") {
      throw new ExpensesApiError(400, "Cannot remove event owner");
    }
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE event_members SET linked_payer_member_id = NULL WHERE event_id = ? AND linked_payer_member_id = ?")
      .bind(eventId, memberId)
      .run();
    await db
      .prepare("DELETE FROM event_members WHERE id = ? AND event_id = ?")
      .bind(memberId, eventId)
      .run();

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "MEMBER_REMOVED", {
      member_id: memberId,
      text: `Участник «${target.member_name}» удалён из события`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  // POST / DELETE /api/expenses/events/:id/wallets
  const walletsCollectionMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/wallets$/);
  if (walletsCollectionMatch && method === "POST") {
    const eventId = walletsCollectionMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const rawIds = Array.isArray(body.member_ids) ? body.member_ids.map(String) : [];
    const uniqueIds = [...new Set(rawIds)];
    if (uniqueIds.length < 2) {
      throw new ExpensesApiError(400, "Select at least 2 members to create a unified wallet");
    }

    const selectedMembers = uniqueIds.map(id => members.find(m => m.id === id)).filter(Boolean);
    if (selectedMembers.length !== uniqueIds.length) {
      throw new ExpensesApiError(404, "One or more selected members not found");
    }

    const headMember = selectedMembers.find(m => m.role === "OWNER")
      || selectedMembers.find(m => Boolean(m.user_id))
      || selectedMembers[0];

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE event_members SET linked_payer_member_id = NULL WHERE id = ?")
      .bind(headMember.id)
      .run();

    for (const member of selectedMembers) {
      if (member.id === headMember.id) continue;
      await db
        .prepare("UPDATE event_members SET linked_payer_member_id = ? WHERE event_id = ? AND linked_payer_member_id = ?")
        .bind(headMember.id, eventId, member.id)
        .run();
      await db
        .prepare("UPDATE event_members SET linked_payer_member_id = ? WHERE id = ?")
        .bind(headMember.id, member.id)
        .run();
    }

    const walletLabel = selectedMembers.map(m => m.member_name).join(" + ");
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "WALLET_MERGED", {
      head_member_id: headMember.id,
      member_ids: selectedMembers.map(m => m.id),
      text: `Создан единый кошелёк «${walletLabel}»`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  const walletItemMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/wallets\/([A-Za-z0-9_-]+)$/);
  if (walletItemMatch && method === "DELETE") {
    const [, eventId, headMemberId] = walletItemMatch;
    const { members } = await requireEventAccess(db, eventId, user.id);
    const head = members.find(m => m.id === headMemberId);
    if (!head) {
      throw new ExpensesApiError(404, "Wallet not found");
    }
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE event_members SET linked_payer_member_id = NULL WHERE event_id = ? AND (id = ? OR linked_payer_member_id = ?)")
      .bind(eventId, headMemberId, headMemberId)
      .run();

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "WALLET_UNMERGED", {
      head_member_id: headMemberId,
      text: `Единый кошелёк с главой «${head.member_name}» разъединён`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  // POST /api/expenses/events/:id/operations — создание операции (EXPENSE / PREPAYMENT / TRANSFER)
  const opsCollectionMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/operations$/);
  if (opsCollectionMatch && method === "POST") {
    const eventId = opsCollectionMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    if (eventRow.status === "SETTLING" || eventRow.status === "ARCHIVED") {
      throw new ExpensesApiError(409, "Event expenses are frozen during settlement or archive");
    }

    const title = cleanPlainText(body.title, 100);
    if (!title) {
      throw new ExpensesApiError(400, "Operation title is required");
    }
    const category = cleanPlainText(body.category, 40) || "Другое";
    const originalCurrency = sanitizeCurrency(body.original_currency, eventRow.base_currency || "RUB");
    const exchangeRate = originalCurrency === (eventRow.base_currency || "RUB")
      ? 1.0
      : Number(body.exchange_rate || 0);
    const comment = cleanPlainText(body.comment, 240);
    const expenseDate = sanitizeDateISO(body.expense_date);

    const computed = computeOperationSplits({
      operationType: body.operation_type || "EXPENSE",
      originalAmountMinor: body.original_amount_minor,
      exchangeRate,
      splitType: body.split_type || "EQUAL",
      payers: body.payers,
      transferFromId: body.transfer_from_id,
      transferToId: body.transfer_to_id,
      includedMemberIds: body.included_member_ids,
      weightsMap: body.weights_map,
      exactMinorMap: body.exact_minor_map,
      percentMap: body.percent_map,
      items: body.items,
      members
    });

    const opId = crypto.randomUUID();
    const now = new Date().toISOString();
    const splitMeta = {
      included_member_ids: Array.isArray(body.included_member_ids) ? body.included_member_ids : [],
      weights_map: body.weights_map || {},
      exact_minor_map: body.exact_minor_map || {},
      percent_map: body.percent_map || {},
      transfer_from_id: body.transfer_from_id || null,
      transfer_to_id: body.transfer_to_id || null
    };

    await db
      .prepare(
        `INSERT INTO expenses (
          id, event_id, created_by_member_id, operation_type, title, category,
          original_amount_minor, original_currency, exchange_rate, base_amount_minor,
          split_type, items_json, split_meta_json, comment, expense_date, is_deleted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(
        opId,
        eventId,
        viewerMember.id,
        computed.operation_type,
        title,
        category,
        computed.original_amount_minor,
        originalCurrency,
        computed.exchange_rate,
        computed.base_amount_minor,
        computed.split_type,
        JSON.stringify(computed.normalized_items),
        JSON.stringify(splitMeta),
        comment,
        expenseDate,
        now
      )
      .run();

    for (const s of computed.splits) {
      await db
        .prepare(
          `INSERT INTO expense_splits (
            id, expense_id, member_id, paid_amount_minor, owed_amount_minor, share_value
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          opId,
          s.member_id,
          s.paid_amount_minor,
          s.owed_amount_minor,
          s.share_value
        )
        .run();
    }

    const opLabel = computed.operation_type === "TRANSFER"
      ? "перевод"
      : computed.operation_type === "PREPAYMENT"
        ? "пополнение котла"
        : "трату";
    const humanAmt = `${Math.round(computed.original_amount_minor / 100)} ${originalCurrency}`;
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "OPERATION_ADDED", {
      expense_id: opId,
      operation_type: computed.operation_type,
      text: `${viewerMember.member_name} добавил(а) ${opLabel} «${title}» — ${humanAmt}`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({
      ok: true,
      operation_id: opId,
      event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog)
    }, 201);
  }

  // PATCH / DELETE /api/expenses/events/:id/operations/:opId — редактирование и soft-delete операции
  const opItemMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/operations\/([A-Za-z0-9_-]+)$/);
  if (opItemMatch && method === "PATCH") {
    const [, eventId, opId] = opItemMatch;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    if (eventRow.status === "SETTLING" || eventRow.status === "ARCHIVED") {
      throw new ExpensesApiError(409, "Event expenses are frozen during settlement or archive");
    }

    const existing = await db
      .prepare("SELECT * FROM expenses WHERE id = ? AND event_id = ? AND is_deleted = 0")
      .bind(opId, eventId)
      .first();
    if (!existing) {
      throw new ExpensesApiError(404, "Operation not found");
    }

    const title = body.title !== undefined ? cleanPlainText(body.title, 100) : existing.title;
    if (!title) {
      throw new ExpensesApiError(400, "Operation title is required");
    }
    const category = body.category !== undefined ? (cleanPlainText(body.category, 40) || "Другое") : existing.category;
    const originalCurrency = body.original_currency !== undefined
      ? sanitizeCurrency(body.original_currency, eventRow.base_currency || "RUB")
      : existing.original_currency;
    const exchangeRate = originalCurrency === (eventRow.base_currency || "RUB")
      ? 1.0
      : Number(body.exchange_rate !== undefined ? body.exchange_rate : existing.exchange_rate);
    const comment = body.comment !== undefined ? cleanPlainText(body.comment, 240) : (existing.comment || "");
    const expenseDate = body.expense_date !== undefined ? sanitizeDateISO(body.expense_date) : existing.expense_date;

    const computed = computeOperationSplits({
      operationType: body.operation_type || existing.operation_type || "EXPENSE",
      originalAmountMinor: body.original_amount_minor !== undefined ? body.original_amount_minor : existing.original_amount_minor,
      exchangeRate,
      splitType: body.split_type || existing.split_type || "EQUAL",
      payers: body.payers,
      transferFromId: body.transfer_from_id,
      transferToId: body.transfer_to_id,
      includedMemberIds: body.included_member_ids,
      weightsMap: body.weights_map,
      exactMinorMap: body.exact_minor_map,
      percentMap: body.percent_map,
      items: body.items,
      members
    });

    const now = new Date().toISOString();
    const splitMeta = {
      included_member_ids: Array.isArray(body.included_member_ids) ? body.included_member_ids : [],
      weights_map: body.weights_map || {},
      exact_minor_map: body.exact_minor_map || {},
      percent_map: body.percent_map || {},
      transfer_from_id: body.transfer_from_id || null,
      transfer_to_id: body.transfer_to_id || null
    };

    await db
      .prepare(
        `UPDATE expenses
         SET operation_type = ?, title = ?, category = ?, original_amount_minor = ?,
             original_currency = ?, exchange_rate = ?, base_amount_minor = ?,
             split_type = ?, items_json = ?, split_meta_json = ?, comment = ?, expense_date = ?
         WHERE id = ? AND event_id = ?`
      )
      .bind(
        computed.operation_type,
        title,
        category,
        computed.original_amount_minor,
        originalCurrency,
        computed.exchange_rate,
        computed.base_amount_minor,
        computed.split_type,
        JSON.stringify(computed.normalized_items),
        JSON.stringify(splitMeta),
        comment,
        expenseDate,
        opId,
        eventId
      )
      .run();

    await db.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(opId).run();
    for (const s of computed.splits) {
      await db
        .prepare(
          `INSERT INTO expense_splits (
            id, expense_id, member_id, paid_amount_minor, owed_amount_minor, share_value
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          opId,
          s.member_id,
          s.paid_amount_minor,
          s.owed_amount_minor,
          s.share_value
        )
        .run();
    }

    const humanAmt = `${Math.round(computed.original_amount_minor / 100)} ${originalCurrency}`;
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "OPERATION_UPDATED", {
      expense_id: opId,
      text: `${viewerMember.member_name} изменил(а) операцию «${title}» — ${humanAmt}`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  if (opItemMatch && method === "DELETE") {
    const [, eventId, opId] = opItemMatch;
    const { eventRow, viewerMember } = await requireEventAccess(db, eventId, user.id);
    if (eventRow.status === "SETTLING" || eventRow.status === "ARCHIVED") {
      throw new ExpensesApiError(409, "Event expenses are frozen during settlement or archive");
    }

    const existing = await db
      .prepare("SELECT * FROM expenses WHERE id = ? AND event_id = ? AND is_deleted = 0")
      .bind(opId, eventId)
      .first();
    if (!existing) {
      throw new ExpensesApiError(404, "Operation not found");
    }

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE expenses SET is_deleted = 1 WHERE id = ? AND event_id = ?")
      .bind(opId, eventId)
      .run();

    const humanAmt = `${Math.round((Number(existing.original_amount_minor) || 0) / 100)} ${existing.original_currency || "RUB"}`;
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "OPERATION_DELETED", {
      expense_id: opId,
      text: `${viewerMember.member_name} удалил(а) операцию «${existing.title}» — ${humanAmt}`
    });

    const updated = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const auditLog = await loadEventAuditLog(db, eventId);
    return json({ ok: true, event: serializeEventDetail(updated.eventRow, updated.members, updated.viewerMember, operations, auditLog) });
  }

  throw new ExpensesApiError(404, "Not found");
}

export function getExpensesErrorResponse(error) {
  if (error instanceof ExpensesApiError) {
    return json({ error: error.message }, error.status);
  }
  return null;
}

export function buildSuperappStartKeyboard(webAppBaseUrl) {
  const wishlistUrl = new URL(webAppBaseUrl);
  wishlistUrl.searchParams.set("module", "wishlist");

  const expensesUrl = new URL(webAppBaseUrl);
  expensesUrl.searchParams.set("module", "expenses");

  const hubUrl = new URL(webAppBaseUrl);

  return {
    inline_keyboard: [
      [
        { text: "🎁 Вишлисты", web_app: { url: wishlistUrl.toString() } },
        { text: "💰 Совместные расходы", web_app: { url: expensesUrl.toString() } }
      ],
      [
        { text: "🧭 Главное меню", web_app: { url: hubUrl.toString() } }
      ]
    ]
  };
}

async function tryHandleSuperappStartCommand(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/webhook") return null;

  const secretHeader = env?.WEBHOOK_SECRET || "";
  if (secretHeader && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secretHeader) {
    return null;
  }

  const rawBody = await request.clone().text().catch(() => "");
  if (!rawBody) return null;

  let update;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const message = update?.message;
  const text = String(message?.text || "").trim();
  const chatId = message?.chat?.id;
  if (!chatId || !text) return null;

  const genericStartMatch = text.match(
    /^\/start(?:@\w+)?(?:\s+(module_(?:wishlist|expenses)|exp_[A-Za-z0-9_-]{4,40}))?\s*$/
  );
  if (!genericStartMatch || !env?.BOT_TOKEN || !env?.WEBAPP_URL) {
    return null;
  }

  const arg = genericStartMatch[1] || "";
  const baseUrl = new URL(env.WEBAPP_URL);
  if (arg === "module_wishlist") baseUrl.searchParams.set("module", "wishlist");
  if (arg === "module_expenses") baseUrl.searchParams.set("module", "expenses");
  if (arg.startsWith("exp_")) {
    baseUrl.searchParams.set("module", "expenses");
    baseUrl.searchParams.set("invite", arg);
  }

  let replyMarkup;
  let promptText = "Привет! Выберите раздел Mini App, который нужно открыть:";
  if (arg.startsWith("exp_")) {
    promptText = "Вас пригласили в событие модуля «Совместные расходы». Нажмите кнопку ниже, чтобы открыть событие:";
    replyMarkup = {
      inline_keyboard: [[
        {
          text: "💰 Открыть событие расходов",
          web_app: { url: baseUrl.toString() }
        }
      ]]
    };
  } else if (arg) {
    replyMarkup = {
      inline_keyboard: [[
        {
          text: arg === "module_wishlist" ? "🎁 Открыть вишлисты" : "💰 Открыть совместные расходы",
          web_app: { url: baseUrl.toString() }
        }
      ]]
    };
  } else {
    replyMarkup = buildSuperappStartKeyboard(env.WEBAPP_URL);
  }

  const tgApiBase = ["https://api.", "telegram.org/bot", env.BOT_TOKEN, "/sendMessage"].join("");
  await fetch(tgApiBase, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: promptText,
      reply_markup: replyMarkup
    })
  });

  return json({ ok: true });
}

export {
  DEFAULT_GROUPS,
  LEGACY_GROUP_NAMES,
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  MAX_OCCASIONS,
  MAX_NEW_GIFT_NOTIFICATIONS,
  NOTIFICATION_BATCH_SIZE,
  EXPENSE_SCHEMA_SQL,
  createShortId,
  dispatchBackground,
  json,
  cleanPlainText,
  normalizeUsername,
  parseId,
  sanitizeHttpUrl,
  sanitizeImage,
  sanitizeDesire,
  sanitizeTags,
  sanitizeGiftGroupIds,
  sanitizeGiftOccasionIds,
  sanitizeGroupName,
  sanitizeOccasionTitle,
  findGiftIndex,
  createGiftId,
  getInternalImageId,
  assertInternalImageOwnership,
  cloneInternalImage,
  loadWishlist,
  saveWishlist,
  directoryKey,
  groupsKey,
  removeSubscriber,
  loadGroups,
  saveGroups,
  getGroup,
  buildSocialPayload,
  requestTelegramUserSelection,
  collectGiftViewerIds,
  canViewerAccessGift,
  assertGiftVisible,
  cleanupGiftAudience,
  cleanupRecordAudience,
  syncWishlistParticipation,
  handleParticipationsGet,
  serializeWishlist,
  handleTelegramWebhook,
  handleSharedUserSelection
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/core/") || url.pathname.startsWith("/api/expenses/")) {
      const origin = request.headers.get("Origin") || "";
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin || "*",
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      try {
        const { verifyTelegramInitData } = await import("./worker.js");
        const viewer = await verifyTelegramInitData(
          request.headers.get("X-Telegram-Init-Data") || "",
          env?.BOT_TOKEN || ""
        );
        if (url.pathname.startsWith("/api/core/")) {
          return await handleCoreApi(request, env, viewer, url);
        }
        return await handleExpensesApi(request, env, viewer, url);
      } catch (error) {
        const mapped = getExpensesErrorResponse(error);
        if (mapped) return mapped;
        return json({ error: error?.message || "Unauthorized" }, error?.status || 401);
      }
    }

    const startResponse = await tryHandleSuperappStartCommand(request, env);
    if (startResponse) return startResponse;

    const baseWorker = await import("./worker.js");
    return await baseWorker.default.fetch(request, env, ctx);
  }
};
