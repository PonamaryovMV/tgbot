export const DEFAULT_GROUPS = Object.freeze([
  { id: "family", name: "Семья" },
  { id: "close", name: "Близкие" },
  { id: "friends", name: "Друзья" },
  { id: "colleagues", name: "Коллеги" }
]);

export const LEGACY_GROUP_NAMES = Object.freeze({
  contacts: "Контакты",
  family: "Семья",
  girlfriend: "Девушка",
  friends: "Друзья"
});

export const MAX_SOCIAL_ITEMS = 200;
export const MAX_GROUPS = 20;
export const MAX_OCCASIONS = 20;
export const MAX_NEW_GIFT_NOTIFICATIONS = 20;
export const NOTIFICATION_BATCH_SIZE = 5;

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = 1100 * 1024;
export const MAX_JSON_BYTES = 1024 * 1024;
export const INIT_DATA_TTL_SEC = 7 * 24 * 60 * 60;
export const SELECTION_TTL_SEC = 900;

export const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
  "Access-Control-Max-Age": "86400"
});

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createShortId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export function dispatchBackground(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
    return Promise.resolve();
  }
  return promise;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function assertContentLength(request, maximum) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maximum) {
    throw new ApiError(413, "Request body is too large");
  }
}

export async function readJsonBody(request, maxBytes = MAX_JSON_BYTES) {
  assertContentLength(request, maxBytes);
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
      throw new ApiError(413, "Request body is too large");
    }
    return JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON body");
  }
}

export function cleanPlainText(value, maxLen) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ApiError(400, "Invalid text field");
  }
  const text = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > maxLen) {
    throw new ApiError(400, "Text field is too long");
  }
  return text;
}

export function normalizeUsername(value, required = true) {
  const username = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  if (!username) {
    if (required) throw new ApiError(400, "Telegram username is required");
    return "";
  }
  if (!/^[a-z0-9_]{5,32}$/.test(username)) {
    if (required) throw new ApiError(400, "Invalid Telegram username");
    return "";
  }
  return username;
}

export function parseId(value, fieldName = "id") {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
  return id;
}

export function sanitizeHttpUrl(value, fieldName = "link") {
  const text = cleanPlainText(value, 2048);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("protocol");
    }
    return url.toString();
  } catch {
    throw new ApiError(400, `Invalid ${fieldName} URL`);
  }
}

export function sanitizeImage(value) {
  const text = cleanPlainText(value, 2048);
  if (!text) return "";
  if (/^\/api\/img\/[A-Za-z0-9_-]{8,64}$/.test(text)) return text;
  return sanitizeHttpUrl(text, "image");
}

export function sanitizePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const numericPrice = Number(value);
  if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice > 1_000_000_000) {
    throw new ApiError(400, "Invalid gift price");
  }
  return Math.round(numericPrice);
}

export function sanitizeDesire(value, legacyPriority = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return legacyPriority ? "high" : "medium";
  if (raw === "high" || raw === "medium" || raw === "wait") return raw;
  throw new ApiError(400, "Invalid desire level");
}

export function displayDesire(gift) {
  try {
    return sanitizeDesire(gift?.desire, Boolean(gift?.priority));
  } catch {
    return Boolean(gift?.priority) ? "high" : "medium";
  }
}

export function sanitizeTags(values) {
  if (values === undefined || values === null || values === "") return [];
  if (!Array.isArray(values)) throw new ApiError(400, "Tags must be an array");
  if (values.length > 8) throw new ApiError(400, "No more than 8 tags are allowed");
  const tags = [];
  const seen = new Set();
  for (const rawValue of values) {
    const cleaned = cleanPlainText(rawValue, 30);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(cleaned);
  }
  return tags;
}

export function normalizeGroupId(value) {
  const raw = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(raw) ? raw : "";
}

export function normalizeOccasionId(value) {
  const raw = String(value ?? "").trim();
  return /^occ_[A-Za-z0-9_-]{1,32}$/.test(raw) ? raw : "";
}

export function sanitizeGiftGroupIds(values, allowedIds = null) {
  if (values === undefined || values === null || values === "") return [];
  if (!Array.isArray(values)) throw new ApiError(400, "Gift groups must be an array");
  const allowedSet = allowedIds instanceof Set
    ? allowedIds
    : Array.isArray(allowedIds)
      ? new Set(allowedIds.map(item => (typeof item === "string" ? item : item.id)))
      : null;
  const unique = [];
  for (const raw of values) {
    const id = normalizeGroupId(raw) || String(raw ?? "").trim();
    if (allowedSet && !allowedSet.has(id)) {
      throw new ApiError(400, "Unknown gift group");
    }
    if (!id) continue;
    if (!unique.includes(id)) unique.push(id);
  }
  return unique;
}

export function sanitizeGiftOccasionIds(values, allowedIds = null) {
  if (values === undefined || values === null || values === "") return [];
  if (!Array.isArray(values)) throw new ApiError(400, "Gift occasions must be an array");
  const allowedSet = allowedIds instanceof Set
    ? allowedIds
    : Array.isArray(allowedIds)
      ? new Set(allowedIds.map(item => (typeof item === "string" ? item : item.id)))
      : null;
  const unique = [];
  for (const raw of values) {
    const id = normalizeOccasionId(raw) || String(raw ?? "").trim();
    if (allowedSet && !allowedSet.has(id)) {
      throw new ApiError(400, "Unknown gift occasion");
    }
    if (!id) continue;
    if (!unique.includes(id)) unique.push(id);
  }
  return unique;
}

export function sanitizeGroupName(rawName) {
  const name = cleanPlainText(rawName, 32);
  if (!name) throw new ApiError(400, "Group name is required");
  return name;
}

export function sanitizeOccasionTitle(rawTitle) {
  const title = cleanPlainText(rawTitle, 40);
  if (!title) throw new ApiError(400, "Occasion title is required");
  return title;
}

export function findGiftIndex(gifts, rawId) {
  const id = parseId(rawId, "gift id");
  return gifts.findIndex(gift => Number(gift.id) === id);
}

export function createGiftId(existingGifts = []) {
  const taken = new Set(existingGifts.map(gift => Number(gift.id)));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const random = crypto.getRandomValues(new Uint16Array(1))[0];
    const candidate = Date.now() * 1000 + random;
    if (!taken.has(candidate)) return candidate;
  }
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

export async function getBotToken(envOrToken) {
  const binding = typeof envOrToken === "object" && envOrToken !== null && "BOT_TOKEN" in envOrToken
    ? envOrToken.BOT_TOKEN
    : envOrToken;
  if (!binding) {
    throw new ApiError(500, "BOT_TOKEN is not configured");
  }
  let value = binding;
  if (typeof binding !== "string") {
    if (typeof binding.get !== "function") {
      throw new ApiError(500, "BOT_TOKEN binding is invalid");
    }
    value = await binding.get();
  }
  const token = String(value || "").trim();
  if (!token) {
    throw new ApiError(500, "BOT_TOKEN is not configured");
  }
  return token;
}

async function hmacSha256(keyData, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, data);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

export async function verifyTelegramInitData(initData, botTokenOrEnv) {
  const botToken = await getBotToken(botTokenOrEnv);
  if (!initData) {
    throw new ApiError(401, "Telegram initData is required");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") || "";
  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new ApiError(401, "Invalid Telegram hash");
  }

  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || age > INIT_DATA_TTL_SEC || age < -300) {
    throw new ApiError(401, "Telegram initData has expired");
  }

  const checkPairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") checkPairs.push(`${key}=${value}`);
  }
  checkPairs.sort();
  const dataCheckString = checkPairs.join("\n");
  const encoder = new TextEncoder();

  const secretKey = await hmacSha256(
    encoder.encode("WebAppData"),
    encoder.encode(botToken)
  );
  const calculatedHash = toHex(await hmacSha256(secretKey, encoder.encode(dataCheckString)));
  if (!timingSafeEqual(calculatedHash, receivedHash.toLowerCase())) {
    throw new ApiError(401, "Telegram signature validation failed");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    throw new ApiError(401, "Invalid Telegram user data");
  }
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError(401, "Telegram user is missing");
  }

  return {
    id: userId,
    first_name: cleanPlainText(user.first_name || "Пользователь", 64) || "Пользователь",
    username: normalizeUsername(user.username || "", false)
  };
}

export async function callTelegramApi(env, method, payload) {
  const botToken = await getBotToken(env);
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(502, "Invalid response from Telegram");
  }
  if (!response.ok || !result.ok) {
    console.error("Telegram API error:", result?.description || response.status);
    throw new ApiError(502, "Telegram API request failed");
  }
  return result.result;
}

export async function getBotUsername(env) {
  await getBotToken(env);
  const cached = await env.DB.get("config:bot", "json");
  if (cached?.username) return cached.username;

  const me = await callTelegramApi(env, "getMe", {});
  if (!me?.username) {
    throw new ApiError(502, "Telegram bot username is unavailable");
  }
  await env.DB.put("config:bot", JSON.stringify({ username: me.username }), {
    expirationTtl: 86400
  });
  return me.username;
}
