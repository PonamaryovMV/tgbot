import { cleanPlainText, json } from "../../worker.js";
import {
  EXPENSE_CURRENCIES,
  ExpensesApiError,
  getExpensesDb,
  sanitizePaymentPhone,
  sanitizePreferredBanks,
  sanitizeCurrency
} from "./schema.js";
import {
  formatUserRow,
  ensureUserProfile,
  listUserEventsSummary
} from "./queries.js";

export function buildSuperappStartKeyboard(webAppBaseUrl) {
  const base = webAppBaseUrl.endsWith("/") ? webAppBaseUrl : `${webAppBaseUrl}/`;
  const wishlistUrl = new URL(base);
  wishlistUrl.searchParams.set("module", "wishlist");

  const expensesUrl = new URL(base);
  expensesUrl.searchParams.set("module", "expenses");

  const hubUrl = new URL(base);

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

export async function tryHandleSuperappStartCommand(request, env) {
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
  const normalizedBase = env.WEBAPP_URL.endsWith("/") ? env.WEBAPP_URL : `${env.WEBAPP_URL}/`;
  const baseUrl = new URL(normalizedBase);
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
    replyMarkup = buildSuperappStartKeyboard(normalizedBase);
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
