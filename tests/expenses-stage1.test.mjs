import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXPENSE_SCHEMA_SQL,
  handleCoreApi,
  handleExpensesApi,
  getExpensesErrorResponse,
  buildSuperappStartKeyboard
} from "../expenses-worker.js";

function createMockD1() {
  const usersByTelegramId = new Map();
  const usersById = new Map();

  function prepare(sql) {
    return {
      _sql: sql,
      _params: [],
      bind(...params) {
        this._params = params;
        return this;
      },
      async first() {
        const q = this._sql.toLowerCase();
        if (q.includes("from users where telegram_id")) {
          const tgId = Number(this._params[0]);
          const row = usersByTelegramId.get(tgId);
          return row ? { ...row } : null;
        }
        if (q.includes("from users where id")) {
          const id = String(this._params[0] || "");
          const row = usersById.get(id);
          return row ? { ...row } : null;
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        const q = this._sql.trim().toLowerCase().replace(/\s+/g, " ");
        if (q.startsWith("insert into users")) {
          const [id, telegramId, username, displayName, createdAt, updatedAt] = this._params;
          const record = {
            id: String(id),
            telegram_id: Number(telegramId),
            username: username ? String(username) : "",
            display_name: String(displayName),
            payment_phone: "",
            preferred_banks_json: "[]",
            default_currency: "RUB",
            created_at: String(createdAt),
            updated_at: String(updatedAt)
          };
          usersById.set(record.id, record);
          usersByTelegramId.set(record.telegram_id, record);
          return { success: true };
        }
        if (q.startsWith("update users set username")) {
          const [username, displayName, updatedAt, id] = this._params;
          const existing = usersById.get(String(id));
          if (existing) {
            existing.username = String(username || "");
            existing.display_name = String(displayName || existing.display_name);
            existing.updated_at = String(updatedAt);
            usersByTelegramId.set(existing.telegram_id, existing);
          }
          return { success: true };
        }
        if (q.startsWith("update users set display_name")) {
          const [displayName, paymentPhone, preferredBanksJson, defaultCurrency, updatedAt, id] = this._params;
          const existing = usersById.get(String(id));
          if (existing) {
            existing.display_name = String(displayName || existing.display_name);
            existing.payment_phone = String(paymentPhone || "");
            existing.preferred_banks_json = String(preferredBanksJson || "[]");
            existing.default_currency = String(defaultCurrency || "RUB");
            existing.updated_at = String(updatedAt);
            usersByTelegramId.set(existing.telegram_id, existing);
          }
          return { success: true };
        }
        return { success: true };
      }
    };
  }

  return {
    prepare,
    _usersByTelegramId: usersByTelegramId
  };
}

test("Stage 1 SQL migration defines all required tables and D1 id", async () => {
  const sql = await readFile(new URL("../migrations/0001_expenses_schema.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("d3e17054-e5c6-4f3d-b6fb-eee6cae0cb63"));
  const requiredTables = [
    "users",
    "events",
    "event_members",
    "expenses",
    "expense_splits",
    "settlements",
    "settlement_allocations",
    "event_goals",
    "goal_contributions",
    "event_audit_log"
  ];
  for (const table of requiredTables) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Missing table ${table}`);
    assert.ok(EXPENSE_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Missing table in constant ${table}`);
  }
});

test("Stage 1 core endpoints update SBP details in D1", async () => {
  const db = createMockD1();
  const env = { EXPENSES_DB: db };
  const viewer = { id: 1001, first_name: "Максим", username: "maxim" };
  const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

  const bootReq = new Request(`${baseOrigin}/api/core/bootstrap`, { method: "GET" });
  const bootRes = await handleCoreApi(bootReq, env, viewer, new URL(bootReq.url));
  assert.equal(bootRes.status, 200);
  const bootData = await bootRes.json();
  assert.equal(bootData.ok, true);
  assert.equal(bootData.d1_bound, true);
  assert.equal(bootData.user.telegram_id, 1001);
  assert.equal(bootData.user.default_currency, "RUB");

  const updateReq = new Request(`${baseOrigin}/api/core/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payment_phone: "+7 999 123-45-67",
      preferred_banks: ["Т-Банк", "Сбер"],
      default_currency: "EUR"
    })
  });
  const updateRes = await handleCoreApi(updateReq, env, viewer, new URL(updateReq.url));
  assert.equal(updateRes.status, 200);
  const updatedData = await updateRes.json();
  assert.equal(updatedData.user.payment_phone, "+7 999 123-45-67");
  assert.deepEqual(updatedData.user.preferred_banks, ["Т-Банк", "Сбер"]);
  assert.equal(updatedData.user.default_currency, "EUR");
});

test("Stage 1 expenses health and dashboard respond cleanly", async () => {
  const db = createMockD1();
  const env = { EXPENSES_DB: db };
  const viewer = { id: 2002, first_name: "Анна", username: "anna1" };
  const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

  const healthReq = new Request(`${baseOrigin}/api/expenses/health`, { method: "GET" });
  const healthRes = await handleExpensesApi(healthReq, env, viewer, new URL(healthReq.url));
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.ok, true);
  assert.equal(healthData.stage, 5);
  assert.equal(healthData.tables_count, 9);

  const dashReq = new Request(`${baseOrigin}/api/expenses/dashboard`, { method: "GET" });
  const dashRes = await handleExpensesApi(dashReq, env, viewer, new URL(dashReq.url));
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json();
  assert.equal(dashData.ok, true);
  assert.deepEqual(dashData.active_events, []);

  const errRes = getExpensesErrorResponse(new Error("generic"));
  assert.equal(errRes, null);
});

test("Bot /start keyboard exposes both Wishlists and Shared Expenses modules", () => {
  const appUrl = ["https://", "ponamaryovmv.github.io/tgbot/"].join("");
  const kb = buildSuperappStartKeyboard(appUrl);
  assert.equal(kb.inline_keyboard.length, 2);
  assert.equal(kb.inline_keyboard[0][0].text, "🎁 Вишлисты");
  assert.equal(new URL(kb.inline_keyboard[0][0].web_app.url).searchParams.get("module"), "wishlist");
  assert.equal(kb.inline_keyboard[0][1].text, "💰 Совместные расходы");
  assert.equal(new URL(kb.inline_keyboard[0][1].web_app.url).searchParams.get("module"), "expenses");
  assert.equal(kb.inline_keyboard[1][0].text, "🧭 Главное меню");
});
