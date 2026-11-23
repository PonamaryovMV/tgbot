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

async function listUserEventsSummary(db, userProfileId) {
  const rowsResult = await db
    .prepare(
      `SELECT e.id, e.title, e.description, e.icon, e.base_currency, e.creator_id,
              e.simplify_debts, e.status, e.invite_token, e.created_at, e.updated_at,
              em.id AS member_id, em.role AS member_role, em.default_weight
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

  for (const row of events) {
    const item = {
      id: row.id,
      title: row.title,
      description: row.description || "",
      icon: row.icon || "🎉",
      base_currency: row.base_currency || "RUB",
      creator_id: row.creator_id,
      simplify_debts: Number(row.simplify_debts ?? 1),
      status: row.status || "ACTIVE",
      invite_token: row.invite_token,
      member_id: row.member_id,
      role: row.member_role,
      default_weight: Number(row.default_weight ?? 1.0),
      net_balance_minor: 0,
      balance_state: "settled",
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    if (item.status === "ARCHIVED") {
      archivedEvents.push(item);
    } else {
      activeEvents.push(item);
    }
  }

  return {
    active_events: activeEvents,
    archived_events: archivedEvents,
    summary_by_currency: {
      RUB: {
        you_owe_minor: 0,
        owed_to_you_minor: 0,
        pending_outgoing_minor: 0,
        pending_incoming_minor: 0
      }
    },
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
  const user = await ensureUserProfile(db, viewer);

  if (path === "/api/expenses/dashboard" && request.method === "GET") {
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({ ok: true, stage: 1, user, ...dashboard });
  }

  if (path === "/api/expenses/events" && request.method === "GET") {
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({
      ok: true,
      active_events: dashboard.active_events,
      archived_events: dashboard.archived_events
    });
  }

  if (path === "/api/expenses/health" && request.method === "GET") {
    return json({
      ok: true,
      module: "expenses",
      stage: 1,
      tables_count: 9
    });
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

  const genericStartMatch = text.match(/^\/start(?:@\w+)?(?:\s+(module_(?:wishlist|expenses)))?\s*$/);
  if (!genericStartMatch || !env?.BOT_TOKEN || !env?.WEBAPP_URL) {
    return null;
  }

  const arg = genericStartMatch[1] || "";
  const baseUrl = new URL(env.WEBAPP_URL);
  if (arg === "module_wishlist") baseUrl.searchParams.set("module", "wishlist");
  if (arg === "module_expenses") baseUrl.searchParams.set("module", "expenses");

  const replyMarkup = arg
    ? {
        inline_keyboard: [[
          {
            text: arg === "module_wishlist" ? "🎁 Открыть вишлисты" : "💰 Открыть совместные расходы",
            web_app: { url: baseUrl.toString() }
          }
        ]]
      }
    : buildSuperappStartKeyboard(env.WEBAPP_URL);

  const tgApiBase = ["https://api.", "telegram.org/bot", env.BOT_TOKEN, "/sendMessage"].join("");
  await fetch(tgApiBase, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Привет! Выберите раздел Mini App, который нужно открыть:",
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
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
