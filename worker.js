// ==========================================================================
// 1. КОНСТАНТЫ И СХЕМА СУЩНОСТЕЙ
// ==========================================================================
export const DEFAULT_GROUPS = Object.freeze([
  { id: "family", name: "Семья" },
  { id: "close", name: "Близкие" },
  { id: "friends", name: "Друзья" },
  { id: "colleagues", name: "Коллеги" }
]);

export const LEGACY_GROUP_NAMES = Object.freeze(
  Object.fromEntries(DEFAULT_GROUPS.map(group => [group.id, group.name]))
);

export const MAX_SOCIAL_ITEMS = 200;
export const MAX_GROUPS = 20;
export const MAX_OCCASIONS = 20;
export const MAX_NEW_GIFT_NOTIFICATIONS = 25;
export const NOTIFICATION_BATCH_SIZE = 5;

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/webp", ".webp"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"]
]);
const MAX_IMAGE_BYTES = 512 * 1024;
const INIT_DATA_TTL_SEC = 86400;
const SELECTION_TTL_SEC = 900;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createShortId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

function getCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
    "Access-Control-Max-Age": "86400"
  };
}

export function dispatchBackground(ctx, promise) {
  const safePromise = Promise.resolve(promise).catch(error => {
    console.error("Background task failed:", error);
  });
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(safePromise);
  }
  return safePromise;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

// ==========================================================================
// 2. САНИТИЗАЦИЯ И ВАЛИДАЦИЯ ДАННЫХ
// ==========================================================================
export function cleanPlainText(value, maxLen) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function normalizeUsername(value, required = true) {
  const cleaned = String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (!cleaned) {
    if (required) throw new ApiError(400, "Username is required");
    return "";
  }
  if (!/^[a-z0-9_]{3,32}$/.test(cleaned)) {
    throw new ApiError(400, "Invalid Telegram username");
  }
  return cleaned;
}

export function parseId(value, fieldName = "id") {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
  return num;
}

export function sanitizeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ApiError(400, "Only http and https URLs are allowed");
    }
    return parsed.toString().slice(0, 1024);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "Invalid URL");
  }
}

export function sanitizeImage(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/api/img/")) {
    const id = raw.slice("/api/img/".length);
    if (!/^[a-z0-9_-]{8,64}$/i.test(id)) {
      throw new ApiError(400, "Invalid internal image reference");
    }
    return `/api/img/${id}`;
  }
  return sanitizeHttpUrl(raw);
}

function sanitizePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1_000_000_000) {
    throw new ApiError(400, "Invalid price");
  }
  return Math.round(num);
}

export function sanitizeDesire(value, legacyPriority = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "wait") return raw;
  return legacyPriority ? "high" : "medium";
}

export function sanitizeTags(values) {
  if (!Array.isArray(values)) return [];
  const tags = [];
  const seen = new Set();
  for (const rawValue of values) {
    const cleaned = cleanPlainText(String(rawValue ?? "").replace(/^#+/, ""), 30);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(cleaned);
    if (tags.length >= 8) break;
  }
  return tags;
}

function normalizeGroupId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(id)) return "";
  return id;
}

function normalizeOccasionId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(id)) return "";
  return id;
}

export function sanitizeGiftGroupIds(values, allowedIds = null) {
  if (!Array.isArray(values)) return [];
  const unique = [];
  for (const raw of values) {
    const id = normalizeGroupId(raw);
    if (!id) continue;
    if (allowedIds && !allowedIds.has(id)) continue;
    if (!unique.includes(id)) unique.push(id);
  }
  return unique;
}

export function sanitizeGiftOccasionIds(values, allowedIds = null) {
  if (!Array.isArray(values)) return [];
  const unique = [];
  for (const raw of values) {
    const id = normalizeOccasionId(raw);
    if (!id) continue;
    if (allowedIds && !allowedIds.has(id)) continue;
    if (!unique.includes(id)) unique.push(id);
  }
  return unique;
}

export function sanitizeGroupName(value) {
  const name = cleanPlainText(value, 32);
  if (!name) {
    throw new ApiError(400, "Group name is required");
  }
  return name;
}

export function sanitizeOccasionTitle(value) {
  const title = cleanPlainText(value, 40);
  if (!title) {
    throw new ApiError(400, "Occasion title is required");
  }
  return title;
}

export function findGiftIndex(gifts, id) {
  const target = String(id ?? "");
  return gifts.findIndex(item => String(item.id) === target);
}

export function createGiftId(gifts) {
  let candidate = Date.now();
  const used = new Set(gifts.map(item => String(item.id)));
  while (used.has(String(candidate))) {
    candidate += 1;
  }
  return candidate;
}

export function getInternalImageId(imagePath) {
  if (!imagePath || !imagePath.startsWith("/api/img/")) return "";
  return imagePath.slice("/api/img/".length);
}

export async function assertInternalImageOwnership(env, ownerId, imagePath) {
  const imageId = getInternalImageId(imagePath);
  if (!imageId) return;

  const { metadata } = await env.DB.getWithMetadata(`img:${imageId}`, "arrayBuffer");
  if (!metadata || Number(metadata.ownerId) !== ownerId) {
    throw new ApiError(403, "Image does not belong to this wishlist");
  }
}

export async function cloneInternalImage(env, sourceImagePath, targetOwnerId) {
  const sourceId = getInternalImageId(sourceImagePath);
  if (!sourceId) return "";

  const { value, metadata } = await env.DB.getWithMetadata(`img:${sourceId}`, "arrayBuffer");
  if (!value) {
    throw new ApiError(404, "Source image not found");
  }

  const newImageId = crypto.randomUUID().replaceAll("-", "");
  const contentType = metadata?.contentType || "image/webp";
  await env.DB.put(`img:${newImageId}`, value, {
    metadata: {
      ownerId: targetOwnerId,
      contentType,
      uploadedAt: new Date().toISOString()
    }
  });
  return `/api/img/${newImageId}`;
}

// ==========================================================================
// 3. TELEGRAM INITDATA И ПОЛЬЗОВАТЕЛЬСКИЙ СПРАВОЧНИК
// ==========================================================================
export async function verifyTelegramInitData(initData, botToken) {
  if (!botToken) {
    throw new ApiError(500, "BOT_TOKEN is not configured");
  }
  if (!initData || typeof initData !== "string") {
    throw new ApiError(401, "Missing Telegram initData");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new ApiError(401, "Missing initData hash");
  }

  const authDate = Number(params.get("auth_date"));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSec - authDate > INIT_DATA_TTL_SEC || authDate - nowSec > 300) {
    throw new ApiError(401, "Expired Telegram initData");
  }

  const checkPairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      checkPairs.push([key, value]);
    }
  }
  checkPairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = checkPairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const encoder = new TextEncoder();
  const webAppKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secretKeyBytes = await crypto.subtle.sign("HMAC", webAppKey, encoder.encode(botToken));
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(dataCheckString));
  const expectedHash = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHash.length !== hash.length) {
    throw new ApiError(401, "Invalid initData signature");
  }
  let diff = 0;
  for (let i = 0; i < expectedHash.length; i += 1) {
    diff |= expectedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  if (diff !== 0) {
    throw new ApiError(401, "Invalid initData signature");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    throw new ApiError(401, "Malformed initData user");
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new ApiError(401, "Invalid initData user");
  }

  return {
    id: user.id,
    first_name: cleanPlainText(user.first_name, 64) || "Пользователь",
    username: user.username ? normalizeUsername(user.username, false) : ""
  };
}

function normalizeOccasions(rawOccasions) {
  if (!Array.isArray(rawOccasions)) return [];
  const items = [];
  const seenIds = new Set();
  const seenTitles = new Set();
  for (const raw of rawOccasions) {
    const id = normalizeOccasionId(raw?.id);
    const title = cleanPlainText(raw?.title, 40);
    if (!id || !title || seenIds.has(id)) continue;
    const titleKey = title.toLocaleLowerCase("ru-RU");
    if (seenTitles.has(titleKey)) continue;
    seenIds.add(id);
    seenTitles.add(titleKey);
    items.push({ id, title });
    if (items.length >= MAX_OCCASIONS) break;
  }
  return items;
}

export async function loadWishlist(env, ownerId) {
  const raw = await env.DB.get(`user:${ownerId}`, "json");
  if (!raw || typeof raw !== "object") {
    return {
      owner: { id: ownerId, first_name: "Пользователь", username: "" },
      occasions: [],
      gifts: []
    };
  }
  return {
    owner: {
      id: ownerId,
      first_name: cleanPlainText(raw.owner?.first_name, 64) || "Пользователь",
      username: raw.owner?.username ? normalizeUsername(raw.owner.username, false) : ""
    },
    occasions: normalizeOccasions(raw.occasions),
    gifts: Array.isArray(raw.gifts) ? raw.gifts : []
  };
}

export async function saveWishlist(env, ownerId, data) {
  await env.DB.put(`user:${ownerId}`, JSON.stringify(data));
}

export function directoryKey(userId) {
  return `directory:${userId}`;
}

function usernameKey(username) {
  return `username:${username}`;
}

function subscriptionsKey(viewerId) {
  return `subscriptions:${viewerId}`;
}

function subscribersKey(ownerId) {
  return `subscribers:${ownerId}`;
}

export function groupsKey(ownerId) {
  return `groups:${ownerId}`;
}

function selectionKey(requestId) {
  return `selection:${requestId}`;
}

function normalizeIdList(values, maxItems = MAX_SOCIAL_ITEMS) {
  if (!Array.isArray(values)) return [];
  const unique = [];
  for (const value of values) {
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num <= 0) continue;
    if (!unique.includes(num)) unique.push(num);
    if (unique.length >= maxItems) break;
  }
  return unique;
}

async function loadProfile(env, userId) {
  const id = parseId(userId, "user_id");
  const entry = await env.DB.get(directoryKey(id), "json");
  if (entry && typeof entry === "object") {
    return {
      id,
      first_name: cleanPlainText(entry.first_name, 64) || "Пользователь",
      username: entry.username ? normalizeUsername(entry.username, false) : ""
    };
  }
  const wishlist = await env.DB.get(`user:${id}`, "json");
  if (wishlist?.owner) {
    return {
      id,
      first_name: cleanPlainText(wishlist.owner.first_name, 64) || "Пользователь",
      username: wishlist.owner.username ? normalizeUsername(wishlist.owner.username, false) : ""
    };
  }
  return { id, first_name: "Пользователь", username: "" };
}

async function loadProfiles(env, userIds) {
  const ids = normalizeIdList(userIds);
  return await Promise.all(ids.map(id => loadProfile(env, id)));
}

async function upsertUserDirectory(env, user) {
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const id = user.id;
  const previous = await env.DB.get(directoryKey(id), "json");
  const firstName = cleanPlainText(user.first_name, 64)
    || cleanPlainText(previous?.first_name, 64)
    || "Пользователь";
  const username = user.username !== undefined
    ? normalizeUsername(user.username, false)
    : (previous?.username ? normalizeUsername(previous.username, false) : "");

  if (previous?.username && previous.username !== username) {
    const oldMapped = await env.DB.get(usernameKey(previous.username));
    if (Number(oldMapped) === id) {
      await env.DB.delete(usernameKey(previous.username));
    }
  }

  const profile = {
    id,
    first_name: firstName,
    username,
    updatedAt: new Date().toISOString()
  };
  await env.DB.put(directoryKey(id), JSON.stringify(profile));
  if (username) {
    await env.DB.put(usernameKey(username), String(id));
  }

  const wishlist = await env.DB.get(`user:${id}`, "json");
  if (wishlist && typeof wishlist === "object") {
    const nextOwner = {
      id,
      first_name: firstName,
      username
    };
    if (
      wishlist.owner?.first_name !== nextOwner.first_name ||
      (wishlist.owner?.username || "") !== nextOwner.username
    ) {
      wishlist.owner = nextOwner;
      await saveWishlist(env, id, wishlist);
    }
  }

  return profile;
}

async function resolveUserByUsername(env, rawUsername) {
  const username = normalizeUsername(rawUsername, true);
  const directId = Number(await env.DB.get(usernameKey(username)));
  if (Number.isSafeInteger(directId) && directId > 0) {
    const profile = await loadProfile(env, directId);
    if (!profile.username || profile.username === username) {
      return { ...profile, username };
    }
  }
  return null;
}

async function loadSubscriptions(env, viewerId) {
  return normalizeIdList(await env.DB.get(subscriptionsKey(viewerId), "json"));
}

async function loadSubscribers(env, ownerId) {
  return normalizeIdList(await env.DB.get(subscribersKey(ownerId), "json"), MAX_NEW_GIFT_NOTIFICATIONS * 4);
}

async function addSubscriber(env, viewerId, ownerId) {
  if (viewerId === ownerId) {
    throw new ApiError(400, "Cannot subscribe to your own wishlist");
  }
  const current = await loadSubscriptions(env, viewerId);
  if (!current.includes(ownerId)) {
    if (current.length >= MAX_SOCIAL_ITEMS) {
      throw new ApiError(400, `Maximum ${MAX_SOCIAL_ITEMS} subscriptions allowed`);
    }
    current.unshift(ownerId);
    await env.DB.put(subscriptionsKey(viewerId), JSON.stringify(current));
  }

  const subscribers = await loadSubscribers(env, ownerId);
  if (!subscribers.includes(viewerId)) {
    subscribers.unshift(viewerId);
    await env.DB.put(subscribersKey(ownerId), JSON.stringify(subscribers));
  }
}

export async function removeSubscriber(env, viewerId, ownerId) {
  const current = await loadSubscriptions(env, viewerId);
  const next = current.filter(id => id !== ownerId);
  if (next.length !== current.length) {
    await env.DB.put(subscriptionsKey(viewerId), JSON.stringify(next));
  }

  const subscribers = await loadSubscribers(env, ownerId);
  const nextSubscribers = subscribers.filter(id => id !== viewerId);
  if (nextSubscribers.length !== subscribers.length) {
    await env.DB.put(subscribersKey(ownerId), JSON.stringify(nextSubscribers));
  }
}

// ==========================================================================
// 4. КАСТОМНЫЕ ГРУППЫ ДОСТУПА И ПРАВА ВИДИМОСТИ
// ==========================================================================
function buildDefaultGroups() {
  return DEFAULT_GROUPS.map(group => ({
    id: group.id,
    name: group.name,
    memberIds: []
  }));
}

export async function loadGroups(env, ownerId) {
  const raw = await env.DB.get(groupsKey(ownerId), "json");

  if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
    const items = [];
    const seenIds = new Set();
    for (const item of raw.items) {
      const id = normalizeGroupId(item?.id);
      if (!id || seenIds.has(id)) continue;
      const name = cleanPlainText(item?.name, 32) || LEGACY_GROUP_NAMES[id] || id;
      seenIds.add(id);
      items.push({
        id,
        name,
        memberIds: normalizeIdList(item?.memberIds)
      });
      if (items.length >= MAX_GROUPS) break;
    }
    return items;
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return DEFAULT_GROUPS.map(group => ({
      id: group.id,
      name: group.name,
      memberIds: normalizeIdList(raw[group.id])
    }));
  }

  return buildDefaultGroups();
}

export async function saveGroups(env, ownerId, items) {
  const normalized = [];
  const seenIds = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = normalizeGroupId(item?.id);
    if (!id || seenIds.has(id)) continue;
    const name = sanitizeGroupName(item?.name || LEGACY_GROUP_NAMES[id] || id);
    seenIds.add(id);
    normalized.push({
      id,
      name,
      memberIds: normalizeIdList(item?.memberIds)
    });
    if (normalized.length >= MAX_GROUPS) break;
  }
  await env.DB.put(groupsKey(ownerId), JSON.stringify({ items: normalized }));
  return normalized;
}

export function getGroup(groups, groupId) {
  const id = normalizeGroupId(groupId);
  if (!id) {
    throw new ApiError(400, "Invalid group");
  }
  const found = groups.find(group => group.id === id);
  if (!found) {
    throw new ApiError(404, "Group not found");
  }
  return found;
}

export async function buildSocialPayload(env, viewerId) {
  const [subscriptionIds, groups] = await Promise.all([
    loadSubscriptions(env, viewerId),
    loadGroups(env, viewerId)
  ]);
  const subscriptions = await loadProfiles(env, subscriptionIds);
  const serializedGroups = await Promise.all(
    groups.map(async group => ({
      id: group.id,
      name: group.name,
      members: await loadProfiles(env, group.memberIds)
    }))
  );

  return {
    subscriptions,
    groups: serializedGroups
  };
}

export async function requestTelegramUserSelection(env, viewerId, { purpose, groupId = "" }) {
  if (!env.BOT_TOKEN) {
    throw new ApiError(500, "BOT_TOKEN is not configured");
  }
  const requestId = createShortId("sel");
  const numericRequestId = Number(BigInt(`0x${requestId.slice(4, 11)}`) % 2000000000n) + 1;

  await env.DB.put(selectionKey(requestId), JSON.stringify({
    viewerId,
    numericRequestId,
    purpose,
    groupId,
    createdAt: new Date().toISOString()
  }), { expirationTtl: SELECTION_TTL_SEC });

  const promptText = purpose === "group"
    ? "Этот @username ещё не открывал приложение. Выберите человека кнопкой ниже, чтобы добавить его в группу:"
    : "Этот @username ещё не открывал приложение. Выберите человека кнопкой ниже, чтобы подписаться на его вишлист:";

  await sendTelegramBotMessage(env, viewerId, promptText, {
    keyboard: [[{
      text: "👤 Выбрать человека в Telegram",
      request_users: {
        request_id: numericRequestId,
        user_is_bot: false,
        max_quantity: 1,
        request_name: true,
        request_username: true
      }
    }]],
    resize_keyboard: true,
    one_time_keyboard: true
  });

  const botUsername = await getBotUsername(env);
  return {
    status: "selection_required",
    requestId,
    botUsername
  };
}

export function collectGiftViewerIds(gift) {
  const ids = new Set();
  if (Number.isSafeInteger(gift.booked_by) && gift.booked_by > 0) ids.add(gift.booked_by);
  if (Array.isArray(gift.participants)) {
    for (const id of gift.participants) {
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  if (Array.isArray(gift.reusable_givers)) {
    for (const id of gift.reusable_givers) {
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

export function canViewerAccessGift(gift, ownerId, viewerId, groups) {
  if (viewerId === ownerId) return true;
  const groupIds = sanitizeGiftGroupIds(gift.group_ids);
  if (groupIds.length === 0) return true;
  if (!Number.isSafeInteger(viewerId) || viewerId <= 0) return false;
  return groupIds.some(groupId => {
    const group = groups.find(item => item.id === groupId);
    return Array.isArray(group?.memberIds) && group.memberIds.includes(viewerId);
  });
}

export function assertGiftVisible(gift, ownerId, viewerId, groups) {
  if (!canViewerAccessGift(gift, ownerId, viewerId, groups)) {
    throw new ApiError(404, "Gift not found");
  }
}

export async function cleanupGiftAudience(env, ownerId, gift, groups, ctx) {
  const affectedUsers = [];
  if (Number.isSafeInteger(gift.booked_by) && gift.booked_by > 0) {
    if (!canViewerAccessGift(gift, ownerId, gift.booked_by, groups)) {
      affectedUsers.push({ userId: gift.booked_by, type: "book" });
      gift.booked_by = null;
    }
  }
  if (Array.isArray(gift.participants)) {
    gift.participants = gift.participants.filter(participantId => {
      const keep = canViewerAccessGift(gift, ownerId, participantId, groups);
      if (!keep) affectedUsers.push({ userId: participantId, type: "crowdfund" });
      return keep;
    });
  }
  if (Array.isArray(gift.reusable_givers)) {
    gift.reusable_givers = gift.reusable_givers.filter(giverId => {
      const keep = canViewerAccessGift(gift, ownerId, giverId, groups);
      if (!keep) affectedUsers.push({ userId: giverId, type: "reusable" });
      return keep;
    });
  }

  for (const item of affectedUsers) {
    await syncWishlistParticipation(env, item.userId, ownerId, gift, null);
    dispatchBackground(ctx, notifyGuestAboutGiftChange(env, item.userId, ownerId, gift, {
      reason: "access_revoked",
      participationType: item.type
    }));
  }
}

export async function cleanupRecordAudience(env, ownerId, record, groups, ctx) {
  let changed = false;
  for (const gift of record.gifts) {
    const beforeBook = gift.booked_by;
    const beforeParticipants = Array.isArray(gift.participants) ? gift.participants.length : 0;
    const beforeReusable = Array.isArray(gift.reusable_givers) ? gift.reusable_givers.length : 0;
    await cleanupGiftAudience(env, ownerId, gift, groups, ctx);
    if (
      gift.booked_by !== beforeBook ||
      (Array.isArray(gift.participants) ? gift.participants.length : 0) !== beforeParticipants ||
      (Array.isArray(gift.reusable_givers) ? gift.reusable_givers.length : 0) !== beforeReusable
    ) {
      changed = true;
    }
  }
  if (changed) {
    await saveWishlist(env, ownerId, record);
  }
}

// ==========================================================================
// 5. УВЕДОМЛЕНИЯ В TELEGRAM И НАСТРОЙКИ УВЕДОМЛЕНИЙ
// ==========================================================================
function notifyPrefsKey(userId) {
  return `notify_prefs:${userId}`;
}

export async function loadNotificationPrefs(env, userId) {
  const id = parseId(userId, "user_id");
  const raw = await env.DB.get(notifyPrefsKey(id), "json");
  return {
    bookings: raw?.bookings !== false,
    new_gifts: raw?.new_gifts !== false
  };
}

export async function saveNotificationPrefs(env, userId, prefs) {
  const id = parseId(userId, "user_id");
  const current = await loadNotificationPrefs(env, id);
  const next = {
    bookings: prefs.bookings !== undefined ? Boolean(prefs.bookings) : current.bookings,
    new_gifts: prefs.new_gifts !== undefined ? Boolean(prefs.new_gifts) : current.new_gifts
  };
  await env.DB.put(notifyPrefsKey(id), JSON.stringify(next));
  return next;
}

function buildNotificationsKeyboard(prefs) {
  return {
    inline_keyboard: [
      [{
        text: `${prefs.bookings ? "✅" : "🔕"} Изменения по броням и сборам`,
        callback_data: "notif_toggle:bookings"
      }],
      [{
        text: `${prefs.new_gifts ? "✅" : "🔕"} Новые желания в подписках`,
        callback_data: "notif_toggle:new_gifts"
      }]
    ]
  };
}

function formatNotificationsSettingsText(prefs) {
  return [
    "Настройки уведомлений вишлиста:",
    "",
    `• Изменения по броням и сборам: ${prefs.bookings ? "включены" : "выключены"}`,
    `• Новые желания в подписках: ${prefs.new_gifts ? "включены" : "выключены"}`,
    "",
    "Нажмите на кнопку ниже, чтобы переключить:"
  ].join("\n");
}

function buildMiniAppButton(env, startParamValue, label = "Открыть вишлист") {
  const baseUrl = String(env.WEBAPP_URL || "").trim();
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (startParamValue) {
      url.searchParams.set("tgWebAppStartParam", startParamValue);
    }
    return {
      inline_keyboard: [[{ text: label, web_app: { url: url.toString() } }]]
    };
  } catch {
    return undefined;
  }
}

async function callTelegramApi(env, method, payload) {
  if (!env.BOT_TOKEN) return null;
  const tgUrl = ["https://api.", "telegram.org/bot", env.BOT_TOKEN, "/", method].join("");
  try {
    const response = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      console.warn(`Telegram API ${method} failed:`, response.status, data?.description || "");
      return null;
    }
    return data;
  } catch (error) {
    console.warn(`Telegram API ${method} network error:`, error?.message || error);
    return null;
  }
}

async function sendTelegramBotMessage(env, chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  return await callTelegramApi(env, "sendMessage", payload);
}

function formatOwnerLabel(ownerProfile) {
  const firstName = cleanPlainText(ownerProfile?.first_name, 64);
  const username = ownerProfile?.username ? `@${ownerProfile.username}` : "";
  if (firstName && firstName !== "Пользователь" && username) {
    return `${firstName} (${username})`;
  }
  if (firstName && firstName !== "Пользователь") return firstName;
  if (username) return username;
  return "владельца вишлиста";
}

function formatParticipationType(type) {
  if (type === "crowdfund") return "совместном сборе";
  if (type === "reusable") return "многоразовом подарке";
  return "бронировании подарка";
}

export async function notifyGuestAboutGiftChange(env, guestId, ownerId, gift, options = {}) {
  if (!env.BOT_TOKEN || !guestId || guestId === ownerId) return;
  const prefs = await loadNotificationPrefs(env, guestId);
  if (!prefs.bookings) return;

  const ownerProfile = await loadProfile(env, ownerId);
  const ownerLabel = formatOwnerLabel(ownerProfile);
  const giftTitle = cleanPlainText(gift?.title, 120) || "Подарок";
  const reason = options.reason || "updated";

  let text = "";
  if (reason === "deleted") {
    text = `В вишлисте ${ownerLabel} удалён подарок «${giftTitle}», в котором вы участвовали. Отметка участия снята.`;
  } else if (reason === "gifted") {
    text = `В вишлисте ${ownerLabel} подарок «${giftTitle}» отмечен как уже подаренный.`;
  } else if (reason === "format_changed") {
    text = `В вишлисте ${ownerLabel} изменился формат подарка «${giftTitle}» (${options.detail || "обновлены условия участия"}). Проверьте актуальный статус в приложении.`;
  } else if (reason === "access_revoked") {
    text = `Изменились настройки видимости вишлиста ${ownerLabel}: ваше участие в ${formatParticipationType(options.participationType)} «${giftTitle}» автоматически отменено.`;
  } else {
    const changes = Array.isArray(options.changes) && options.changes.length
      ? ` (${options.changes.join(", ")})`
      : "";
    text = `В вишлисте ${ownerLabel} обновились детали подарка «${giftTitle}»${changes}.`;
  }

  const replyMarkup = buildMiniAppButton(env, `list_${ownerId}`, "Открыть вишлист");
  await sendTelegramBotMessage(env, guestId, text, replyMarkup);
}

export async function notifyGuestsBatch(env, notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return;

  // Группируем множественные отмены при исключении из группы в одно сообщение на получателя
  const revokedByGuest = new Map();
  const directItems = [];

  for (const item of notifications) {
    if (item.reason === "access_revoked" && item.groupBatch) {
      const key = `${item.guestId}:${item.ownerId}`;
      if (!revokedByGuest.has(key)) revokedByGuest.set(key, []);
      revokedByGuest.get(key).push(item);
    } else {
      directItems.push(item);
    }
  }

  const tasks = [];
  for (const item of directItems) {
    tasks.push(() => notifyGuestAboutGiftChange(env, item.guestId, item.ownerId, item.gift, item));
  }

  for (const items of revokedByGuest.values()) {
    if (items.length === 1) {
      const single = items[0];
      tasks.push(() => notifyGuestAboutGiftChange(env, single.guestId, single.ownerId, single.gift, single));
    } else {
      const first = items[0];
      tasks.push(async () => {
        const prefs = await loadNotificationPrefs(env, first.guestId);
        if (!prefs.bookings) return;
        const ownerProfile = await loadProfile(env, first.ownerId);
        const ownerLabel = formatOwnerLabel(ownerProfile);
        const titles = items.map(i => `«${cleanPlainText(i.gift?.title, 80) || "Подарок"}»`).join(", ");
        const text = `Изменились настройки видимости вишлиста ${ownerLabel}: автоматически отменено участие по подаркам: ${titles}.`;
        const replyMarkup = buildMiniAppButton(env, `list_${first.ownerId}`, "Открыть вишлист");
        await sendTelegramBotMessage(env, first.guestId, text, replyMarkup);
      });
    }
  }

  for (let i = 0; i < tasks.length; i += NOTIFICATION_BATCH_SIZE) {
    const slice = tasks.slice(i, i + NOTIFICATION_BATCH_SIZE);
    await Promise.allSettled(slice.map(fn => fn()));
  }
}

export async function notifySubscribersAboutNewGift(env, ownerId, gift, groups) {
  if (!env.BOT_TOKEN) return;
  const subscriberIds = await loadSubscribers(env, ownerId);
  if (subscriberIds.length === 0) return;

  const visibleSubscribers = subscriberIds.filter(
    subId => subId !== ownerId && canViewerAccessGift(gift, ownerId, subId, groups)
  );
  if (visibleSubscribers.length === 0) return;

  const ownerProfile = await loadProfile(env, ownerId);
  const ownerLabel = formatOwnerLabel(ownerProfile);
  const giftTitle = cleanPlainText(gift?.title, 120) || "Новый подарок";
  const priceLine = gift?.price !== null && gift?.price !== undefined && Number(gift.price) > 0
    ? ` — ${new Intl.NumberFormat("ru-RU").format(Number(gift.price))} ₽`
    : "";
  const text = `В вишлисте ${ownerLabel} появилось новое желание: «${giftTitle}»${priceLine}.`;
  const replyMarkup = buildMiniAppButton(env, `list_${ownerId}`, "Посмотреть в вишлисте");

  const targets = visibleSubscribers.slice(0, MAX_NEW_GIFT_NOTIFICATIONS);
  for (let i = 0; i < targets.length; i += NOTIFICATION_BATCH_SIZE) {
    const batch = targets.slice(i, i + NOTIFICATION_BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async subscriberId => {
        const prefs = await loadNotificationPrefs(env, subscriberId);
        if (!prefs.new_gifts) return;
        await sendTelegramBotMessage(env, subscriberId, text, replyMarkup);
      })
    );
  }
}

// ==========================================================================
// 6. УЧАСТИЕ В ПОДАРКАХ ДРУЗЕЙ И СЕРИАЛИЗАЦИЯ
// ==========================================================================
function participationsKey(viewerId) {
  return `participations:${viewerId}`;
}

export async function syncWishlistParticipation(env, viewerId, ownerId, gift, type) {
  const id = parseId(viewerId, "viewer_id");
  const key = participationsKey(id);
  const raw = await env.DB.get(key, "json");
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const giftId = String(gift.id);
  const filtered = items.filter(
    item => !(Number(item.ownerId) === ownerId && String(item.giftId) === giftId)
  );

  if (type) {
    filtered.unshift({
      ownerId,
      giftId: gift.id,
      type,
      updatedAt: new Date().toISOString()
    });
  }

  await env.DB.put(key, JSON.stringify({ items: filtered.slice(0, 200) }));
}

export async function handleParticipationsGet(env, viewer) {
  const key = participationsKey(viewer.id);
  const raw = await env.DB.get(key, "json");
  const stored = Array.isArray(raw?.items) ? raw.items : [];
  const byOwner = new Map();

  for (const item of stored) {
    const ownerId = Number(item.ownerId);
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) continue;
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push(item);
  }

  const activeItems = [];
  const cleanedIndex = [];

  for (const [ownerId, ownerEntries] of byOwner.entries()) {
    const [record, groups] = await Promise.all([
      loadWishlist(env, ownerId),
      loadGroups(env, ownerId)
    ]);
    for (const entry of ownerEntries) {
      const idx = findGiftIndex(record.gifts, entry.giftId);
      if (idx === -1) continue;
      const gift = record.gifts[idx];
      if (!canViewerAccessGift(gift, ownerId, viewer.id, groups)) continue;

      let type = null;
      if (gift.is_reusable && Array.isArray(gift.reusable_givers) && gift.reusable_givers.includes(viewer.id)) {
        type = "reusable";
      } else if (gift.is_crowdfund && Array.isArray(gift.participants) && gift.participants.includes(viewer.id)) {
        type = "crowdfund";
      } else if (!gift.is_crowdfund && !gift.is_reusable && gift.booked_by === viewer.id) {
        type = "book";
      }

      if (!type) continue;
      cleanedIndex.push({
        ownerId,
        giftId: gift.id,
        type,
        updatedAt: entry.updatedAt || new Date().toISOString()
      });
      activeItems.push({
        type,
        updatedAt: entry.updatedAt || new Date().toISOString(),
        owner: {
          id: ownerId,
          first_name: record.owner.first_name,
          username: record.owner.username || ""
        },
        gift: serializeGiftForViewer(gift, ownerId, viewer.id)
      });
    }
  }

  if (cleanedIndex.length !== stored.length) {
    await env.DB.put(key, JSON.stringify({ items: cleanedIndex }));
  }

  return json({ items: activeItems });
}

function serializeGiftForViewer(gift, ownerId, viewerId) {
  const isOwner = viewerId === ownerId;
  const participants = Array.isArray(gift.participants) ? gift.participants : [];
  const reusableGivers = Array.isArray(gift.reusable_givers) ? gift.reusable_givers : [];
  const isReusable = Boolean(gift.is_reusable) && !gift.is_crowdfund;
  const bookedBy = isOwner
    ? (gift.booked_by ? -1 : null)
    : gift.booked_by === viewerId
      ? viewerId
      : gift.booked_by
        ? -1
        : null;

  const serializedParticipants = isOwner
    ? participants.map(() => -1)
    : participants.map(id => (id === viewerId ? viewerId : -1));

  const serializedReusableGivers = isOwner
    ? reusableGivers.map(() => -1)
    : reusableGivers.map(id => (id === viewerId ? viewerId : -1));

  const serialized = {
    id: gift.id,
    title: gift.title,
    link: gift.link || "",
    image: gift.image || "",
    price: gift.price ?? null,
    category: gift.category || "",
    comment: gift.comment || "",
    priority: Boolean(gift.priority),
    desire: sanitizeDesire(gift.desire, Boolean(gift.priority)),
    tags: sanitizeTags(gift.tags),
    occasion_ids: sanitizeGiftOccasionIds(gift.occasion_ids),
    is_crowdfund: Boolean(gift.is_crowdfund),
    is_reusable: isReusable,
    booked_by: bookedBy,
    participants: serializedParticipants,
    reusable_givers: serializedReusableGivers,
    reusableCount: isReusable ? reusableGivers.length : 0,
    is_gifted: Boolean(gift.is_gifted)
  };

  if (isOwner) {
    serialized.group_ids = sanitizeGiftGroupIds(gift.group_ids);
  }

  return serialized;
}

export function serializeWishlist(record, ownerId, viewerId, { groups = [], isSubscribed = false } = {}) {
  const isOwner = viewerId === ownerId;
  const visibleGifts = record.gifts.filter(gift => canViewerAccessGift(gift, ownerId, viewerId, groups));
  const allowedOccasionIds = new Set(record.occasions.map(item => item.id));

  const normalizedVisibleGifts = visibleGifts.map(gift => ({
    ...gift,
    occasion_ids: sanitizeGiftOccasionIds(gift.occasion_ids, allowedOccasionIds)
  }));

  const visibleOccasions = isOwner
    ? record.occasions
    : record.occasions.filter(occ =>
        normalizedVisibleGifts.some(gift => gift.occasion_ids.includes(occ.id))
      );

  const payload = {
    owner: {
      id: ownerId,
      first_name: record.owner.first_name,
      username: record.owner.username || ""
    },
    occasions: visibleOccasions,
    gifts: normalizedVisibleGifts.map(gift => serializeGiftForViewer(gift, ownerId, viewerId))
  };

  if (isOwner) {
    payload.groups = groups.map(group => ({
      id: group.id,
      name: group.name,
      memberIds: group.memberIds
    }));
  } else {
    payload.is_subscribed = Boolean(isSubscribed);
  }

  return payload;
}

// ==========================================================================
// 7. ОБРАБОТЧИКИ HTTP API И TELEGRAM WEBHOOK
// ==========================================================================
async function getBotUsername(env) {
  const cached = await env.DB.get("config:bot", "json");
  if (cached?.username) return cached.username;

  if (!env.BOT_TOKEN) return "";
  const data = await callTelegramApi(env, "getMe", {});
  const username = data?.result?.username || "";
  if (username) {
    await env.DB.put("config:bot", JSON.stringify({ username }), { expirationTtl: 3600 });
  }
  return username;
}

async function handleImageUpload(request, env, viewer) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new ApiError(400, "Missing image file");
  }

  const contentType = String(file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new ApiError(415, "Only WebP and JPEG images are supported");
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(413, "Image must be between 1 byte and 512 KB");
  }

  const imageId = crypto.randomUUID().replaceAll("-", "");
  await env.DB.put(`img:${imageId}`, buffer, {
    metadata: {
      ownerId: viewer.id,
      contentType,
      uploadedAt: new Date().toISOString()
    }
  });

  return json({ url: `/api/img/${imageId}` }, 201);
}

async function handleImageGet(env, viewer, imageId) {
  if (!/^[a-z0-9_-]{8,64}$/i.test(imageId)) {
    throw new ApiError(400, "Invalid image ID");
  }
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, "arrayBuffer");
  if (!value) {
    throw new ApiError(404, "Image not found");
  }

  const ownerId = Number(metadata?.ownerId);
  if (Number.isSafeInteger(ownerId) && ownerId > 0 && ownerId !== viewer.id) {
    const [record, groups] = await Promise.all([
      loadWishlist(env, ownerId),
      loadGroups(env, ownerId)
    ]);
    const imagePath = `/api/img/${imageId}`;
    const hasAccess = record.gifts.some(
      gift => gift.image === imagePath && canViewerAccessGift(gift, ownerId, viewer.id, groups)
    );
    if (!hasAccess) {
      throw new ApiError(404, "Image not found");
    }
  }

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": metadata?.contentType || "image/webp",
      "Cache-Control": "private, max-age=3600"
    }
  });
}

async function handleGiftsGet(env, viewer, url) {
  const ownerParam = url.searchParams.get("owner_id");
  const ownerId = ownerParam ? parseId(ownerParam, "owner_id") : viewer.id;
  const [record, groups, subscriptions] = await Promise.all([
    loadWishlist(env, ownerId),
    loadGroups(env, ownerId),
    ownerId === viewer.id ? Promise.resolve([]) : loadSubscriptions(env, viewer.id)
  ]);

  if (ownerId === viewer.id) {
    record.owner = {
      id: viewer.id,
      first_name: viewer.first_name,
      username: viewer.username || record.owner.username || ""
    };
  }

  return json(
    serializeWishlist(record, ownerId, viewer.id, {
      groups,
      isSubscribed: subscriptions.includes(ownerId)
    })
  );
}

async function handleGiftsPost(request, env, viewer, ctx) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "Invalid JSON payload");
  }

  const action = String(body.action || "");
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  const ownerId = body.owner_id ? parseId(body.owner_id, "owner_id") : viewer.id;
  const isOwner = ownerId === viewer.id;

  const ownerActions = new Set([
    "add",
    "update",
    "delete",
    "toggle_gifted",
    "save_occasion",
    "delete_occasion"
  ]);
  const guestActions = new Set(["toggle_book", "toggle_crowdfund", "copy_gift"]);

  if (ownerActions.has(action) && !isOwner) {
    throw new ApiError(403, "Only the wishlist owner can modify gifts");
  }
  if (guestActions.has(action) && isOwner) {
    throw new ApiError(403, "Owner cannot book or copy own gifts");
  }
  if (!ownerActions.has(action) && !guestActions.has(action)) {
    throw new ApiError(400, "Unsupported action");
  }

  const [record, groups] = await Promise.all([
    loadWishlist(env, ownerId),
    loadGroups(env, ownerId)
  ]);
  const allowedGroupIds = new Set(groups.map(group => group.id));
  const allowedOccasionIds = new Set(record.occasions.map(item => item.id));

  if (isOwner) {
    record.owner = {
      id: viewer.id,
      first_name: viewer.first_name,
      username: viewer.username || record.owner.username || ""
    };
  }

  // --- Действия владельца ---
  if (action === "save_occasion") {
    const title = sanitizeOccasionTitle(payload.title);
    const requestedId = normalizeOccasionId(payload.id);
    const titleKey = title.toLocaleLowerCase("ru-RU");

    if (requestedId) {
      const existing = record.occasions.find(item => item.id === requestedId);
      if (!existing) {
        throw new ApiError(404, "Occasion not found");
      }
      const duplicate = record.occasions.find(
        item => item.id !== requestedId && item.title.toLocaleLowerCase("ru-RU") === titleKey
      );
      if (duplicate) {
        throw new ApiError(400, "Occasion with this title already exists");
      }
      existing.title = title;
      await saveWishlist(env, ownerId, record);
      return json({
        ...serializeWishlist(record, ownerId, viewer.id, { groups }),
        savedOccasionId: existing.id
      });
    }

    const existingByTitle = record.occasions.find(
      item => item.title.toLocaleLowerCase("ru-RU") === titleKey
    );
    if (existingByTitle) {
      return json({
        ...serializeWishlist(record, ownerId, viewer.id, { groups }),
        savedOccasionId: existingByTitle.id
      });
    }

    if (record.occasions.length >= MAX_OCCASIONS) {
      throw new ApiError(400, `Maximum ${MAX_OCCASIONS} occasions allowed`);
    }

    const newOccasion = {
      id: createShortId("occ"),
      title
    };
    record.occasions.push(newOccasion);
    await saveWishlist(env, ownerId, record);
    return json({
      ...serializeWishlist(record, ownerId, viewer.id, { groups }),
      savedOccasionId: newOccasion.id
    });
  }

  if (action === "delete_occasion") {
    const occasionId = normalizeOccasionId(payload.id);
    if (!occasionId) {
      throw new ApiError(400, "Invalid occasion ID");
    }
    const index = record.occasions.findIndex(item => item.id === occasionId);
    if (index === -1) {
      throw new ApiError(404, "Occasion not found");
    }
    record.occasions.splice(index, 1);
    for (const gift of record.gifts) {
      gift.occasion_ids = sanitizeGiftOccasionIds(gift.occasion_ids).filter(id => id !== occasionId);
    }
    await saveWishlist(env, ownerId, record);
    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "add") {
    const title = cleanPlainText(payload.title, 120);
    if (!title) {
      throw new ApiError(400, "Gift title is required");
    }
    const image = sanitizeImage(payload.image);
    await assertInternalImageOwnership(env, ownerId, image);
    const desire = sanitizeDesire(payload.desire, Boolean(payload.priority));
    const isCrowdfund = Boolean(payload.is_crowdfund);
    const isReusable = !isCrowdfund && Boolean(payload.is_reusable);

    const newGift = {
      id: createGiftId(record.gifts),
      title,
      link: sanitizeHttpUrl(payload.link),
      image,
      price: sanitizePrice(payload.price),
      category: cleanPlainText(payload.category, 40),
      comment: cleanPlainText(payload.comment, 300),
      priority: desire === "high",
      desire,
      tags: sanitizeTags(payload.tags),
      group_ids: sanitizeGiftGroupIds(payload.group_ids, allowedGroupIds),
      occasion_ids: sanitizeGiftOccasionIds(payload.occasion_ids, allowedOccasionIds),
      is_crowdfund: isCrowdfund,
      is_reusable: isReusable,
      booked_by: null,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    };

    record.gifts.unshift(newGift);
    await saveWishlist(env, ownerId, record);
    dispatchBackground(ctx, notifySubscribersAboutNewGift(env, ownerId, newGift, groups));
    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "update") {
    const idx = findGiftIndex(record.gifts, payload.id);
    if (idx === -1) throw new ApiError(404, "Gift not found");

    const title = cleanPlainText(payload.title, 120);
    if (!title) throw new ApiError(400, "Gift title is required");

    const existing = record.gifts[idx];
    const previousSnapshot = {
      title: existing.title,
      price: existing.price ?? null,
      comment: existing.comment || "",
      link: existing.link || "",
      is_crowdfund: Boolean(existing.is_crowdfund),
      is_reusable: Boolean(existing.is_reusable) && !existing.is_crowdfund
    };

    const image = sanitizeImage(payload.image);
    await assertInternalImageOwnership(env, ownerId, image);
    const desire = payload.desire !== undefined
      ? sanitizeDesire(payload.desire, Boolean(payload.priority))
      : sanitizeDesire(existing.desire, Boolean(payload.priority ?? existing.priority));

    const nextCrowdfund = payload.is_crowdfund !== undefined
      ? Boolean(payload.is_crowdfund)
      : Boolean(existing.is_crowdfund);
    const nextReusable = !nextCrowdfund && (
      payload.is_reusable !== undefined
        ? Boolean(payload.is_reusable)
        : Boolean(existing.is_reusable)
    );

    const updated = {
      ...existing,
      title,
      link: sanitizeHttpUrl(payload.link),
      image,
      price: sanitizePrice(payload.price),
      category: cleanPlainText(payload.category, 40),
      comment: cleanPlainText(payload.comment, 300),
      priority: desire === "high",
      desire,
      tags: payload.tags !== undefined ? sanitizeTags(payload.tags) : sanitizeTags(existing.tags),
      group_ids: payload.group_ids !== undefined
        ? sanitizeGiftGroupIds(payload.group_ids, allowedGroupIds)
        : sanitizeGiftGroupIds(existing.group_ids, allowedGroupIds),
      occasion_ids: payload.occasion_ids !== undefined
        ? sanitizeGiftOccasionIds(payload.occasion_ids, allowedOccasionIds)
        : sanitizeGiftOccasionIds(existing.occasion_ids, allowedOccasionIds),
      is_crowdfund: nextCrowdfund,
      is_reusable: nextReusable,
      reusable_givers: Array.isArray(existing.reusable_givers) ? existing.reusable_givers : []
    };

    const notifications = [];

    // Обработка смены формата участия (одиночная бронь / сбор / многоразовый подарок)
    if (previousSnapshot.is_crowdfund && !updated.is_crowdfund) {
      const oldParticipants = Array.isArray(updated.participants) ? [...updated.participants] : [];
      updated.participants = [];
      for (const participantId of oldParticipants) {
        await syncWishlistParticipation(env, participantId, ownerId, updated, null);
        notifications.push({
          guestId: participantId,
          ownerId,
          gift: updated,
          reason: "format_changed",
          detail: "совместный сбор закрыт"
        });
      }
    }

    if (!previousSnapshot.is_crowdfund && updated.is_crowdfund && updated.booked_by) {
      const prevBooker = updated.booked_by;
      updated.booked_by = null;
      updated.participants = [prevBooker];
      await syncWishlistParticipation(env, prevBooker, ownerId, updated, "crowdfund");
      notifications.push({
        guestId: prevBooker,
        ownerId,
        gift: updated,
        reason: "format_changed",
        detail: "подарок переведён в совместный сбор (ваша отметка сохранена)"
      });
    }

    if (previousSnapshot.is_reusable && !updated.is_reusable) {
      const oldGivers = [...updated.reusable_givers];
      updated.reusable_givers = [];
      for (const giverId of oldGivers) {
        await syncWishlistParticipation(env, giverId, ownerId, updated, null);
        notifications.push({
          guestId: giverId,
          ownerId,
          gift: updated,
          reason: "format_changed",
          detail: "отключён режим многократного подарка, отметка участия снята"
        });
      }
    }

    if (!previousSnapshot.is_reusable && updated.is_reusable && updated.booked_by) {
      const prevBooker = updated.booked_by;
      updated.booked_by = null;
      updated.reusable_givers = [prevBooker];
      await syncWishlistParticipation(env, prevBooker, ownerId, updated, "reusable");
      notifications.push({
        guestId: prevBooker,
        ownerId,
        gift: updated,
        reason: "format_changed",
        detail: "подарок теперь можно дарить несколько раз (ваша отметка сохранена)"
      });
    }

    // Проверка изменения важных деталей для оставшихся активных участников
    const detailChanges = [];
    if (previousSnapshot.title !== updated.title) detailChanges.push("название");
    if (previousSnapshot.price !== updated.price) detailChanges.push("цена");
    if (previousSnapshot.comment !== updated.comment) detailChanges.push("комментарий");
    if (previousSnapshot.link !== updated.link) detailChanges.push("ссылка");

    if (detailChanges.length > 0 && !updated.is_gifted) {
      const alreadyNotified = new Set(notifications.map(n => n.guestId));
      for (const guestId of collectGiftViewerIds(updated)) {
        if (alreadyNotified.has(guestId)) continue;
        notifications.push({
          guestId,
          ownerId,
          gift: updated,
          reason: "updated",
          changes: detailChanges
        });
      }
    }

    record.gifts[idx] = updated;
    await cleanupGiftAudience(env, ownerId, updated, groups, ctx);
    await saveWishlist(env, ownerId, record);

    if (notifications.length > 0) {
      dispatchBackground(ctx, notifyGuestsBatch(env, notifications));
    }

    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "delete") {
    const idx = findGiftIndex(record.gifts, payload.id);
    if (idx === -1) throw new ApiError(404, "Gift not found");
    const [removed] = record.gifts.splice(idx, 1);

    const affectedGuestIds = collectGiftViewerIds(removed);
    for (const guestId of affectedGuestIds) {
      await syncWishlistParticipation(env, guestId, ownerId, removed, null);
    }

    await saveWishlist(env, ownerId, record);

    if (!removed.is_gifted && affectedGuestIds.length > 0) {
      dispatchBackground(
        ctx,
        notifyGuestsBatch(
          env,
          affectedGuestIds.map(guestId => ({
            guestId,
            ownerId,
            gift: removed,
            reason: "deleted"
          }))
        )
      );
    }

    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "toggle_gifted") {
    const idx = findGiftIndex(record.gifts, payload.id);
    if (idx === -1) throw new ApiError(404, "Gift not found");
    const targetGift = record.gifts[idx];
    const nextGifted = !targetGift.is_gifted;
    targetGift.is_gifted = nextGifted;

    await saveWishlist(env, ownerId, record);

    if (nextGifted) {
      const guestIds = collectGiftViewerIds(targetGift);
      if (guestIds.length > 0) {
        dispatchBackground(
          ctx,
          notifyGuestsBatch(
            env,
            guestIds.map(guestId => ({
              guestId,
              ownerId,
              gift: targetGift,
              reason: "gifted"
            }))
          )
        );
      }
    }

    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  // --- Действия гостя ---
  const idx = findGiftIndex(record.gifts, payload.id);
  if (idx === -1) throw new ApiError(404, "Gift not found");
  const gift = record.gifts[idx];
  assertGiftVisible(gift, ownerId, viewer.id, groups);

  if (action === "copy_gift") {
    const viewerRecord = await loadWishlist(env, viewer.id);
    viewerRecord.owner = {
      id: viewer.id,
      first_name: viewer.first_name,
      username: viewer.username || viewerRecord.owner.username || ""
    };

    const copiedImage = gift.image && gift.image.startsWith("/api/img/")
      ? await cloneInternalImage(env, gift.image, viewer.id)
      : sanitizeImage(gift.image);

    const desire = sanitizeDesire(gift.desire, Boolean(gift.priority));
    const isCrowdfund = Boolean(gift.is_crowdfund);
    const isReusable = !isCrowdfund && Boolean(gift.is_reusable);

    const copiedGift = {
      id: createGiftId(viewerRecord.gifts),
      title: cleanPlainText(gift.title, 120) || "Подарок",
      link: sanitizeHttpUrl(gift.link),
      image: copiedImage,
      price: sanitizePrice(gift.price),
      category: cleanPlainText(gift.category, 40),
      comment: cleanPlainText(gift.comment, 300),
      priority: desire === "high",
      desire,
      tags: sanitizeTags(gift.tags),
      group_ids: [],
      occasion_ids: [],
      is_crowdfund: isCrowdfund,
      is_reusable: isReusable,
      booked_by: null,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    };

    viewerRecord.gifts.unshift(copiedGift);
    await saveWishlist(env, viewer.id, viewerRecord);
    dispatchBackground(ctx, notifySubscribersAboutNewGift(env, viewer.id, copiedGift, await loadGroups(env, viewer.id)));

    return json({
      ok: true,
      gift: serializeGiftForViewer(copiedGift, viewer.id, viewer.id)
    }, 201);
  }

  if (gift.is_gifted) {
    throw new ApiError(409, "Gift is already marked as gifted");
  }

  if (action === "toggle_book") {
    if (gift.is_crowdfund) {
      throw new ApiError(400, "This gift uses crowdfund mode");
    }

    if (gift.is_reusable) {
      if (!Array.isArray(gift.reusable_givers)) gift.reusable_givers = [];
      const existingPos = gift.reusable_givers.indexOf(viewer.id);
      if (existingPos === -1) {
        gift.reusable_givers.push(viewer.id);
        await syncWishlistParticipation(env, viewer.id, ownerId, gift, "reusable");
      } else {
        gift.reusable_givers.splice(existingPos, 1);
        await syncWishlistParticipation(env, viewer.id, ownerId, gift, null);
      }
      await saveWishlist(env, ownerId, record);
      const subscriptions = await loadSubscriptions(env, viewer.id);
      return json(
        serializeWishlist(record, ownerId, viewer.id, {
          groups,
          isSubscribed: subscriptions.includes(ownerId)
        })
      );
    }

    if (gift.booked_by && gift.booked_by !== viewer.id) {
      throw new ApiError(409, "Gift is already booked by someone else");
    }
    const nextBookedBy = gift.booked_by === viewer.id ? null : viewer.id;
    gift.booked_by = nextBookedBy;
    await syncWishlistParticipation(env, viewer.id, ownerId, gift, nextBookedBy ? "book" : null);
  }

  if (action === "toggle_crowdfund") {
    if (!gift.is_crowdfund) {
      throw new ApiError(400, "This gift does not use crowdfund mode");
    }
    if (!Array.isArray(gift.participants)) gift.participants = [];
    const pos = gift.participants.indexOf(viewer.id);
    if (pos === -1) {
      gift.participants.push(viewer.id);
      await syncWishlistParticipation(env, viewer.id, ownerId, gift, "crowdfund");
    } else {
      gift.participants.splice(pos, 1);
      await syncWishlistParticipation(env, viewer.id, ownerId, gift, null);
    }
  }

  await saveWishlist(env, ownerId, record);
  const subscriptions = await loadSubscriptions(env, viewer.id);
  return json(
    serializeWishlist(record, ownerId, viewer.id, {
      groups,
      isSubscribed: subscriptions.includes(ownerId)
    })
  );
}

async function handleSocialGet(env, viewer) {
  return json(await buildSocialPayload(env, viewer.id));
}

async function handleSocialPost(request, env, viewer, ctx) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "Invalid JSON payload");
  }

  const action = String(body.action || "");
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  if (action === "subscribe") {
    if (payload.user_id !== undefined && payload.user_id !== null && payload.user_id !== "") {
      const targetId = parseId(payload.user_id, "user_id");
      await addSubscriber(env, viewer.id, targetId);
      return json(await buildSocialPayload(env, viewer.id));
    }

    const username = normalizeUsername(payload.username, true);
    if (viewer.username && viewer.username === username) {
      throw new ApiError(400, "Cannot subscribe to your own wishlist");
    }
    const resolved = await resolveUserByUsername(env, username);
    if (!resolved) {
      return json(await requestTelegramUserSelection(env, viewer.id, { purpose: "subscribe" }), 202);
    }
    await addSubscriber(env, viewer.id, resolved.id);
    return json(await buildSocialPayload(env, viewer.id));
  }

  if (action === "unsubscribe") {
    const targetId = parseId(payload.user_id, "user_id");
    await removeSubscriber(env, viewer.id, targetId);
    return json(await buildSocialPayload(env, viewer.id));
  }

  if (action === "create_group") {
    const groups = await loadGroups(env, viewer.id);
    if (groups.length >= MAX_GROUPS) {
      throw new ApiError(400, `Maximum ${MAX_GROUPS} groups allowed`);
    }
    const name = sanitizeGroupName(payload.name);
    const duplicate = groups.find(
      item => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")
    );
    if (duplicate) {
      throw new ApiError(400, "Group with this name already exists");
    }
    groups.push({
      id: createShortId("grp"),
      name,
      memberIds: []
    });
    await saveGroups(env, viewer.id, groups);
    return json(await buildSocialPayload(env, viewer.id));
  }

  if (action === "rename_group") {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    const name = sanitizeGroupName(payload.name);
    const duplicate = groups.find(
      item => item.id !== group.id && item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")
    );
    if (duplicate) {
      throw new ApiError(400, "Group with this name already exists");
    }
    group.name = name;
    await saveGroups(env, viewer.id, groups);
    return json(await buildSocialPayload(env, viewer.id));
  }

  if (action === "delete_group") {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    const nextGroups = groups.filter(item => item.id !== group.id);
    await saveGroups(env, viewer.id, nextGroups);

    const record = await loadWishlist(env, viewer.id);
    let giftsModified = false;
    for (const gift of record.gifts) {
      const currentIds = sanitizeGiftGroupIds(gift.group_ids);
      if (currentIds.includes(group.id)) {
        gift.group_ids = currentIds.filter(id => id !== group.id);
        giftsModified = true;
      }
    }
    if (giftsModified) {
      await saveWishlist(env, viewer.id, record);
    }
    await cleanupRecordAudience(env, viewer.id, record, nextGroups, ctx);

    return json(await buildSocialPayload(env, viewer.id));
  }

  if (action === "add_group_member") {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);

    if (payload.user_id !== undefined && payload.user_id !== null && payload.user_id !== "") {
      const memberId = parseId(payload.user_id, "user_id");
      if (memberId === viewer.id) {
        throw new ApiError(400, "Cannot add yourself to a group");
      }
      if (!group.memberIds.includes(memberId)) {
        if (group.memberIds.length >= MAX_SOCIAL_ITEMS) {
          throw new ApiError(400, `Maximum ${MAX_SOCIAL_ITEMS} members per group`);
        }
        group.memberIds.unshift(memberId);
        await saveGroups(env, viewer.id, groups);
      }
      return json(await buildSocialPayload(env, viewer.id));
    }

    const username = normalizeUsername(payload.username, true);
    if (viewer.username && viewer.username === username) {
      throw new ApiError(400, "Cannot add yourself to a group");
    }
    const resolved = await resolveUserByUsername(env, username);
    if (!resolved) {
      return json(await requestTelegramUserSelection(env, viewer.id, {
        purpose: "group",
        groupId: group.id
      }), 202);
    }
    if (!group.memberIds.includes(resolved.id)) {
      if (group.memberIds.length >= MAX_SOCIAL_ITEMS) {
        throw new ApiError(400, `Maximum ${MAX_SOCIAL_ITEMS} members per group`);
      }
      group.memberIds.unshift(resolved.id);
      await saveGroups(env, viewer.id, groups);
    }
    return json(await buildSocialPayload(env, viewer.id));
  }

  if (action === "remove_group_member") {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    const memberId = parseId(payload.user_id, "user_id");
    group.memberIds = group.memberIds.filter(id => id !== memberId);
    await saveGroups(env, viewer.id, groups);

    const record = await loadWishlist(env, viewer.id);
    const notifications = [];
    let modified = false;

    for (const gift of record.gifts) {
      if (canViewerAccessGift(gift, viewer.id, memberId, groups)) continue;

      if (gift.booked_by === memberId) {
        gift.booked_by = null;
        modified = true;
        await syncWishlistParticipation(env, memberId, viewer.id, gift, null);
        if (!gift.is_gifted) {
          notifications.push({
            guestId: memberId,
            ownerId: viewer.id,
            gift,
            reason: "access_revoked",
            participationType: "book",
            groupBatch: true
          });
        }
      }

      if (Array.isArray(gift.participants) && gift.participants.includes(memberId)) {
        gift.participants = gift.participants.filter(id => id !== memberId);
        modified = true;
        await syncWishlistParticipation(env, memberId, viewer.id, gift, null);
        if (!gift.is_gifted) {
          notifications.push({
            guestId: memberId,
            ownerId: viewer.id,
            gift,
            reason: "access_revoked",
            participationType: "crowdfund",
            groupBatch: true
          });
        }
      }

      if (Array.isArray(gift.reusable_givers) && gift.reusable_givers.includes(memberId)) {
        gift.reusable_givers = gift.reusable_givers.filter(id => id !== memberId);
        modified = true;
        await syncWishlistParticipation(env, memberId, viewer.id, gift, null);
        if (!gift.is_gifted) {
          notifications.push({
            guestId: memberId,
            ownerId: viewer.id,
            gift,
            reason: "access_revoked",
            participationType: "reusable",
            groupBatch: true
          });
        }
      }
    }

    if (modified) {
      await saveWishlist(env, viewer.id, record);
    }
    if (notifications.length > 0) {
      dispatchBackground(ctx, notifyGuestsBatch(env, notifications));
    }

    return json(await buildSocialPayload(env, viewer.id));
  }

  throw new ApiError(400, "Unsupported social action");
}

function buildSuperappStartMenuKeyboard(webAppBaseUrl) {
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

export async function handleTelegramWebhook(request, env) {
  const secretHeader = env.WEBHOOK_SECRET || "";
  if (secretHeader && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secretHeader) {
    throw new ApiError(401, "Invalid webhook secret");
  }

  const update = await request.json().catch(() => null);
  if (!update) return json({ ok: true });

  // Обработка inline-кнопок настройки уведомлений (/notifications)
  if (update.callback_query) {
    const query = update.callback_query;
    const fromUser = query.from;
    const data = String(query.data || "");

    if (fromUser?.id) {
      await upsertUserDirectory(env, {
        id: fromUser.id,
        first_name: fromUser.first_name || "Пользователь",
        username: fromUser.username || ""
      });
    }

    if (data.startsWith("notif_toggle:") && fromUser?.id) {
      const field = data.slice("notif_toggle:".length);
      if (field === "bookings" || field === "new_gifts") {
        const current = await loadNotificationPrefs(env, fromUser.id);
        const updated = await saveNotificationPrefs(env, fromUser.id, {
          [field]: !current[field]
        });

        await callTelegramApi(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: "Настройка сохранена"
        });

        if (query.message?.chat?.id && query.message?.message_id) {
          await callTelegramApi(env, "editMessageText", {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            text: formatNotificationsSettingsText(updated),
            reply_markup: buildNotificationsKeyboard(updated)
          });
        }
      }
    } else if (query.id) {
      await callTelegramApi(env, "answerCallbackQuery", {
        callback_query_id: query.id
      });
    }

    return json({ ok: true });
  }

  const message = update.message;
  if (!message) return json({ ok: true });

  if (message.from?.id) {
    await upsertUserDirectory(env, {
      id: message.from.id,
      first_name: message.from.first_name || "Пользователь",
      username: message.from.username || ""
    });
  }

  const chatId = message.chat?.id;
  if (!chatId) return json({ ok: true });

  if (message.users_shared && message.from?.id) {
    await handleSharedUserSelection(env, message.from.id, chatId, message.users_shared);
    return json({ ok: true });
  }

  const text = String(message.text || "").trim();

  if (text.startsWith("/notifications")) {
    const prefs = await loadNotificationPrefs(env, message.from.id);
    await sendTelegramBotMessage(
      env,
      chatId,
      formatNotificationsSettingsText(prefs),
      buildNotificationsKeyboard(prefs)
    );
    return json({ ok: true });
  }

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const rawParam = parts[1] || "";

    if (!env.WEBAPP_URL) {
      return json({ ok: true });
    }
    const baseAppUrl = env.WEBAPP_URL.endsWith("/") ? env.WEBAPP_URL : `${env.WEBAPP_URL}/`;
    const webAppUrl = new URL(baseAppUrl);

    if (rawParam.startsWith("exp_")) {
      webAppUrl.searchParams.set("module", "expenses");
      webAppUrl.searchParams.set("invite", rawParam);
      await sendTelegramBotMessage(
        env,
        chatId,
        "Вас пригласили в событие модуля «Совместные расходы». Нажмите кнопку ниже, чтобы открыть событие:",
        {
          inline_keyboard: [[
            { text: "💰 Открыть событие расходов", web_app: { url: webAppUrl.toString() } }
          ]]
        }
      );
      return json({ ok: true });
    }

    if (rawParam === "module_wishlist" || rawParam === "module_expenses") {
      const mod = rawParam === "module_wishlist" ? "wishlist" : "expenses";
      webAppUrl.searchParams.set("module", mod);
      await sendTelegramBotMessage(
        env,
        chatId,
        mod === "wishlist"
          ? "Нажмите кнопку ниже, чтобы открыть вишлисты:"
          : "Нажмите кнопку ниже, чтобы открыть совместные расходы:",
        {
          inline_keyboard: [[
            {
              text: mod === "wishlist" ? "🎁 Открыть вишлисты" : "💰 Открыть совместные расходы",
              web_app: { url: webAppUrl.toString() }
            }
          ]]
        }
      );
      return json({ ok: true });
    }

    const startMatch = rawParam.match(/^list_(\d+)(?:_(occ_[a-zA-Z0-9_-]+))?$/);
    if (startMatch) {
      webAppUrl.searchParams.set("module", "wishlist");
      webAppUrl.searchParams.set("list", startMatch[1]);
      if (startMatch[2]) {
        webAppUrl.searchParams.set("occasion", startMatch[2]);
      }
      webAppUrl.searchParams.set("tgWebAppStartParam", rawParam);
      const replyText = startMatch[2]
        ? "Нажмите кнопку ниже, чтобы открыть подборку подарков:"
        : "Нажмите кнопку ниже, чтобы открыть вишлист друга:";
      const buttonLabel = startMatch[2] ? "Открыть подборку" : "Открыть вишлист";
      await sendTelegramBotMessage(env, chatId, replyText, {
        inline_keyboard: [[
          { text: buttonLabel, web_app: { url: webAppUrl.toString() } }
        ]]
      });
      return json({ ok: true });
    }

    await sendTelegramBotMessage(
      env,
      chatId,
      "Привет! Выберите раздел Mini App, который нужно открыть:",
      buildSuperappStartMenuKeyboard(baseAppUrl)
    );
  }

  return json({ ok: true });
}

export async function handleSharedUserSelection(env, viewerId, chatId, usersShared) {
  const numericRequestId = Number(usersShared.request_id);
  const sharedUsers = Array.isArray(usersShared.users) ? usersShared.users : [];
  const selected = sharedUsers[0];

  const listed = await env.DB.list({ prefix: "selection:" });
  let matchedKey = "";
  let pending = null;
  for (const keyInfo of listed.keys) {
    const candidate = await env.DB.get(keyInfo.name, "json");
    if (
      candidate &&
      Number(candidate.viewerId) === viewerId &&
      Number(candidate.numericRequestId) === numericRequestId
    ) {
      matchedKey = keyInfo.name;
      pending = candidate;
      break;
    }
  }

  if (!pending || !selected) {
    await sendTelegramBotMessage(
      env,
      chatId,
      "Запрос выбора устарел. Повторите действие в приложении.",
      { remove_keyboard: true }
    );
    return;
  }

  await env.DB.delete(matchedKey);
  const selectedId = parseId(selected.user_id, "selected_user_id");
  const firstName = [selected.first_name, selected.last_name].filter(Boolean).join(" ").trim() || "Пользователь";
  await upsertUserDirectory(env, {
    id: selectedId,
    first_name: firstName,
    username: selected.username ? normalizeUsername(selected.username, false) : ""
  });

  if (selectedId === viewerId) {
    await sendTelegramBotMessage(
      env,
      chatId,
      "Нельзя выбрать самого себя.",
      { remove_keyboard: true }
    );
    return;
  }

  let messageText = "Готово.";
  if (pending.purpose === "subscribe") {
    await addSubscriber(env, viewerId, selectedId);
    messageText = `Подписка на ${cleanPlainText(firstName, 64)} сохранена. Вернитесь в Mini App.`;
  } else if (pending.purpose === "group") {
    const groups = await loadGroups(env, viewerId);
    const group = getGroup(groups, pending.groupId);
    if (!group.memberIds.includes(selectedId)) {
      group.memberIds.unshift(selectedId);
      await saveGroups(env, viewerId, groups);
    }
    messageText = `${cleanPlainText(firstName, 64)} добавлен в группу «${group.name}». Вернитесь в Mini App.`;
  }

  await sendTelegramBotMessage(env, chatId, messageText, { remove_keyboard: true });
}

// ==========================================================================
// 8. ГЛАВНЫЙ РОУТЕР CLOUDFLARE WORKER
// ==========================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = getCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname.startsWith("/api/core/") || url.pathname.startsWith("/api/expenses/")) {
        const { handleCoreApi, handleExpensesApi, getExpensesErrorResponse } = await import("./expenses-worker.js");
        const viewer = await verifyTelegramInitData(
          request.headers.get("X-Telegram-Init-Data") || "",
          env.BOT_TOKEN
        );
        await upsertUserDirectory(env, viewer);
        try {
          const innerResponse = url.pathname.startsWith("/api/core/")
            ? await handleCoreApi(request, env, viewer, url)
            : await handleExpensesApi(request, env, viewer, url);
          const headers = new Headers(innerResponse.headers);
          for (const [k, v] of Object.entries(cors)) headers.set(k, v);
          return new Response(innerResponse.body, {
            status: innerResponse.status,
            headers
          });
        } catch (expError) {
          const mapped = getExpensesErrorResponse(expError);
          if (mapped) {
            const headers = new Headers(mapped.headers);
            for (const [k, v] of Object.entries(cors)) headers.set(k, v);
            return new Response(mapped.body, { status: mapped.status, headers });
          }
          throw expError;
        }
      }

      if (url.pathname === "/" && request.method === "GET") {
        return json({ ok: true, service: "wishlist-and-expenses-worker" }, 200, cors);
      }

      if ((url.pathname === "/" || url.pathname === "/webhook") && request.method === "POST") {
        const res = await handleTelegramWebhook(request, env);
        return json(await res.json(), res.status, cors);
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === "/api/config" && request.method === "GET") {
        const botUsername = await getBotUsername(env);
        return json({ botUsername }, 200, cors);
      }

      const viewer = await verifyTelegramInitData(
        request.headers.get("X-Telegram-Init-Data") || "",
        env.BOT_TOKEN
      );
      await upsertUserDirectory(env, viewer);

      let response;
      if (url.pathname === "/api/upload" && request.method === "POST") {
        response = await handleImageUpload(request, env, viewer);
      } else if (url.pathname.startsWith("/api/img/") && request.method === "GET") {
        const imageId = url.pathname.slice("/api/img/".length);
        response = await handleImageGet(env, viewer, imageId);
      } else if (url.pathname === "/api/participations" && request.method === "GET") {
        response = await handleParticipationsGet(env, viewer);
      } else if (url.pathname === "/api/social" && request.method === "GET") {
        response = await handleSocialGet(env, viewer);
      } else if (url.pathname === "/api/social" && request.method === "POST") {
        response = await handleSocialPost(request, env, viewer, ctx);
      } else if ((url.pathname === "/api/gifts" || url.pathname === "/api/data") && request.method === "GET") {
        response = await handleGiftsGet(env, viewer, url);
      } else if ((url.pathname === "/api/gifts" || url.pathname === "/api/data") && request.method === "POST") {
        response = await handleGiftsPost(request, env, viewer, ctx);
      } else {
        throw new ApiError(404, "Not found");
      }

      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) {
        headers.set(k, v);
      }
      return new Response(response.body, {
        status: response.status,
        headers
      });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const message = error instanceof ApiError ? error.message : "Internal server error";
      return json({ error: message }, status, cors);
    }
  }
};
