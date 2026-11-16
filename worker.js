const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
  "Access-Control-Max-Age": "86400"
};

const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = 1100 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const INIT_DATA_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const MAX_SOCIAL_ITEMS = 200;
const GROUP_DEFINITIONS = Object.freeze([
  { id: "contacts", name: "Контакты" },
  { id: "family", name: "Семья" },
  { id: "girlfriend", name: "Девушка" },
  { id: "friends", name: "Друзья" }
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (!env.DB) throw new HttpError(500, "KV binding DB is not configured");

      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (path === "/" && method === "GET") {
        return json({ ok: true, service: "tg_podarki" });
      }
      if (path === "/" && method === "POST") {
        return await handleTelegramWebhook(request, env);
      }
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true });
      }
      if (path === "/api/config" && method === "GET") {
        const botUsername = await getBotUsername(env);
        return json({ botUsername });
      }
      if (path === "/api/participations" && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return await handleParticipationsGet(env, user);
      }
      if (path === "/api/social" && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return await handleSocialGet(env, user);
      }
      if (path === "/api/social" && method === "POST") {
        const user = await authenticateTelegram(request, env);
        return await handleSocialPost(request, env, user);
      }

      const imageMatch = path.match(/^\/api\/img\/([A-Za-z0-9_-]{16,64})$/);
      if (imageMatch && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return await handleImageRequest(env, imageMatch[1], user);
      }

      if ((path === "/api/gifts" || path === "/api/data") && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return await handleGiftsGet(url, env, user);
      }
      if ((path === "/api/gifts" || path === "/api/data") && method === "POST") {
        const user = await authenticateTelegram(request, env);
        return await handleGiftsPost(request, env, user);
      }
      if (path === "/api/upload" && method === "POST") {
        const user = await authenticateTelegram(request, env);
        return await handleImageUpload(request, env, user);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }
      console.error("Unhandled worker error:", error?.stack || error);
      return json({ error: "Internal server error" }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function getBotToken(env) {
  const binding = env.BOT_TOKEN;
  if (!binding) throw new HttpError(500, "BOT_TOKEN is not configured");

  let value = binding;
  if (typeof binding !== "string") {
    if (typeof binding.get !== "function") {
      throw new HttpError(500, "BOT_TOKEN binding is invalid");
    }
    value = await binding.get();
  }

  const token = String(value || "").trim();
  if (!token) throw new HttpError(500, "BOT_TOKEN is not configured");
  return token;
}

async function authenticateTelegram(request, env) {
  const botToken = await getBotToken(env);
  const initData = request.headers.get("X-Telegram-Init-Data") || "";
  if (!initData) throw new HttpError(401, "Telegram initData is required");

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") || "";
  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new HttpError(401, "Invalid Telegram hash");
  }

  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || age > INIT_DATA_MAX_AGE_SECONDS || age < -300) {
    throw new HttpError(401, "Telegram initData has expired");
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
    throw new HttpError(401, "Telegram signature validation failed");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    throw new HttpError(401, "Invalid Telegram user data");
  }
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new HttpError(401, "Telegram user is missing");
  }

  const telegramUser = {
    id: userId,
    first_name: cleanPlainText(user.first_name || "Пользователь", 64) || "Пользователь",
    username: normalizeUsername(user.username || "", false)
  };
  await rememberTelegramUser(env, telegramUser);
  return telegramUser;
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

async function handleGiftsGet(url, env, viewer) {
  const ownerId = parseId(url.searchParams.get("owner_id") || viewer.id, "owner_id");
  const record = await loadWishlist(env, ownerId, viewer);
  const groups = await loadGroups(env, ownerId);
  let isSubscribed = false;

  if (ownerId === viewer.id) {
    if (!record.owner.first_name) record.owner.first_name = viewer.first_name;
    record.owner.username = viewer.username || record.owner.username || "";
  } else {
    await syncWishlistParticipation(env, ownerId, viewer, record, groups);
    const subscriptions = await readSubscriptions(env, viewer.id);
    isSubscribed = subscriptions.includes(ownerId);
  }
  return json(serializeWishlist(record, viewer.id, groups, isSubscribed));
}

async function handleGiftsPost(request, env, viewer) {
  assertContentLength(request, MAX_JSON_BYTES);
  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_JSON_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON body");
  }

  const ownerId = parseId(body?.owner_id || viewer.id, "owner_id");
  const action = String(body?.action || "");
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  const isOwner = viewer.id === ownerId;
  const ownerActions = new Set(["add", "update", "delete", "toggle_gifted"]);
  const guestActions = new Set(["toggle_book", "toggle_crowdfund"]);

  if (ownerActions.has(action) && !isOwner) {
    throw new HttpError(403, "Only the wishlist owner can do this");
  }
  if (guestActions.has(action) && isOwner) {
    throw new HttpError(403, "The owner cannot book their own gift");
  }
  if (!ownerActions.has(action) && !guestActions.has(action)) {
    throw new HttpError(400, "Unknown action");
  }

  const record = await loadWishlist(env, ownerId, viewer);
  const groups = await loadGroups(env, ownerId);
  const affectedViewerIds = new Set();
  let imageToDelete = "";

  if (action === "add") {
    const gift = sanitizeGift(payload);
    await assertInternalImageOwnership(env, gift.image, viewer.id);
    gift.id = createGiftId();
    gift.booked_by = null;
    gift.participants = [];
    gift.is_gifted = false;
    record.gifts.unshift(gift);
    record.owner = {
      ...record.owner,
      id: ownerId,
      first_name: viewer.first_name,
      username: viewer.username || record.owner.username || ""
    };
  }

  if (action === "update") {
    const index = findGiftIndex(record.gifts, payload.id);
    const previous = record.gifts[index];
    const next = sanitizeGift(payload);
    await assertInternalImageOwnership(env, next.image, viewer.id);
    next.id = previous.id;
    next.is_gifted = Boolean(previous.is_gifted);
    next.booked_by = previous.booked_by ?? null;
    next.participants = Array.isArray(previous.participants) ? previous.participants : [];

    if (previous.is_crowdfund !== next.is_crowdfund) {
      next.booked_by = null;
      next.participants = [];
    }
    if (previous.image !== next.image) imageToDelete = previous.image;
    collectGiftViewerIds(previous).forEach(id => affectedViewerIds.add(id));
    record.gifts[index] = next;
    cleanupGiftAudience(next, groups, ownerId);
    collectGiftViewerIds(next).forEach(id => affectedViewerIds.add(id));
  }

  if (action === "delete") {
    const index = findGiftIndex(record.gifts, payload.id);
    imageToDelete = record.gifts[index].image || "";
    record.gifts.splice(index, 1);
  }

  if (action === "toggle_gifted") {
    const index = findGiftIndex(record.gifts, payload.id);
    record.gifts[index].is_gifted = !record.gifts[index].is_gifted;
  }

  if (action === "toggle_book") {
    const gift = record.gifts[findGiftIndex(record.gifts, payload.id)];
    assertGiftVisible(gift, groups, ownerId, viewer.id);
    if (gift.is_gifted || gift.is_crowdfund) throw new HttpError(409, "This gift cannot be booked");
    if (gift.booked_by === null || gift.booked_by === undefined) {
      gift.booked_by = viewer.id;
    } else if (gift.booked_by === viewer.id) {
      gift.booked_by = null;
    } else {
      throw new HttpError(409, "This gift is already booked");
    }
  }

  if (action === "toggle_crowdfund") {
    const gift = record.gifts[findGiftIndex(record.gifts, payload.id)];
    assertGiftVisible(gift, groups, ownerId, viewer.id);
    if (gift.is_gifted || !gift.is_crowdfund) throw new HttpError(409, "This gift is not a crowdfund");
    const participants = Array.isArray(gift.participants) ? gift.participants : [];
    const index = participants.indexOf(viewer.id);
    if (index >= 0) participants.splice(index, 1);
    else participants.push(viewer.id);
    gift.participants = participants;
  }

  await saveWishlist(env, ownerId, record);
  if (!isOwner) affectedViewerIds.add(viewer.id);
  for (const affectedViewerId of affectedViewerIds) {
    await syncWishlistParticipation(env, ownerId, { id: affectedViewerId }, record, groups);
  }
  const imageIsStillUsed = imageToDelete
    && record.gifts.some(gift => gift.image === imageToDelete);
  if (imageToDelete && !imageIsStillUsed) {
    await deleteInternalImage(env, imageToDelete, ownerId);
  }
  const isSubscribed = !isOwner && (await readSubscriptions(env, viewer.id)).includes(ownerId);
  return json(serializeWishlist(record, viewer.id, groups, isSubscribed));
}

function sanitizeGift(payload) {
  const title = cleanPlainText(payload.title, 120);
  if (!title) throw new HttpError(400, "Gift title is required");

  const category = cleanPlainText(payload.category || "Разное", 40) || "Разное";
  const comment = cleanPlainText(payload.comment || "", 300);
  const link = sanitizeHttpUrl(payload.link || "", "link");
  const image = sanitizeImage(payload.image || "");
  const desire = sanitizeDesire(payload.desire, payload.priority);
  const tags = sanitizeTags(payload.tags);
  const groupIds = sanitizeGiftGroupIds(payload.group_ids);
  let price = null;

  if (payload.price !== null && payload.price !== undefined && payload.price !== "") {
    const numericPrice = Number(payload.price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice > 1_000_000_000) {
      throw new HttpError(400, "Invalid gift price");
    }
    price = Math.round(numericPrice);
  }

  return {
    title,
    link,
    image,
    price,
    category,
    comment,
    desire,
    tags,
    group_ids: groupIds,
    priority: desire === "high",
    is_crowdfund: Boolean(payload.is_crowdfund)
  };
}

function sanitizeDesire(value, legacyPriority) {
  if (value === undefined || value === null || value === "") {
    return legacyPriority ? "high" : "medium";
  }
  if (!["high", "medium", "wait"].includes(value)) {
    throw new HttpError(400, "Invalid desire level");
  }
  return value;
}

function sanitizeTags(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Tags must be an array");
  if (value.length > 8) throw new HttpError(400, "No more than 8 tags are allowed");

  const tags = [];
  const seen = new Set();
  for (const rawTag of value) {
    const tag = cleanPlainText(rawTag, 30);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function sanitizeGiftGroupIds(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Gift groups must be an array");
  const allowed = new Set(GROUP_DEFINITIONS.map(group => group.id));
  const groupIds = [];
  for (const rawId of value) {
    const groupId = String(rawId || "");
    if (!allowed.has(groupId)) throw new HttpError(400, "Unknown gift group");
    if (!groupIds.includes(groupId)) groupIds.push(groupId);
  }
  return groupIds;
}

function cleanPlainText(value, maxLength) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new HttpError(400, "Invalid text field");
  }
  const text = String(value).trim();
  if (text.length > maxLength) throw new HttpError(400, "Text field is too long");
  return text;
}

function sanitizeHttpUrl(value, fieldName) {
  const text = cleanPlainText(value, 2048);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    return url.toString();
  } catch {
    throw new HttpError(400, `Invalid ${fieldName} URL`);
  }
}

function sanitizeImage(value) {
  const text = cleanPlainText(value, 2048);
  if (!text) return "";
  if (getInternalImageId(text)) return text;
  return sanitizeHttpUrl(text, "image");
}

function getInternalImageId(value) {
  const match = String(value || "").match(/^\/api\/img\/([A-Za-z0-9_-]{16,64})$/);
  return match?.[1] || "";
}

async function assertInternalImageOwnership(env, imageUrl, userId) {
  const imageId = getInternalImageId(imageUrl);
  if (!imageId) return;
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, {
    type: "arrayBuffer"
  });
  if (!value) throw new HttpError(400, "Image not found");
  if (String(metadata?.ownerId || "") !== String(userId)) {
    throw new HttpError(403, "This image belongs to another user");
  }
}

async function loadWishlist(env, ownerId, viewer) {
  const stored = await env.DB.get(`user:${ownerId}`, { type: "json" });
  const directory = await env.DB.get(directoryKey(ownerId), { type: "json" });
  const isOwner = ownerId === viewer.id;
  const ownerProfile = directory || stored?.owner || {};
  return {
    owner: {
      id: ownerId,
      first_name: cleanPlainText(isOwner ? viewer.first_name : ownerProfile.first_name || "", 64),
      username: normalizeUsername(isOwner ? viewer.username : ownerProfile.username || "", false)
    },
    gifts: Array.isArray(stored?.gifts) ? stored.gifts : []
  };
}

async function saveWishlist(env, ownerId, record) {
  await env.DB.put(`user:${ownerId}`, JSON.stringify({
    owner: record.owner,
    gifts: record.gifts,
    updatedAt: new Date().toISOString()
  }));
}

function directoryKey(userId) {
  return `directory:${userId}`;
}

function usernameKey(username) {
  return `username:${username}`;
}

function subscriptionsKey(userId) {
  return `subscriptions:${userId}`;
}

function groupsKey(ownerId) {
  return `groups:${ownerId}`;
}

function selectionKey(requestId) {
  return `selection:${requestId}`;
}

function normalizeUsername(value, strict = true) {
  const username = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  if (!username) return "";
  if (!/^[a-z0-9_]{5,32}$/.test(username)) {
    if (strict) throw new HttpError(400, "Invalid Telegram username");
    return "";
  }
  return username;
}

async function rememberTelegramUser(env, profile) {
  const userId = parseId(profile?.id, "user id");
  const username = normalizeUsername(profile?.username || "", false);
  const firstName = cleanPlainText(profile?.first_name || "Пользователь", 64) || "Пользователь";
  const key = directoryKey(userId);
  const previous = await env.DB.get(key, { type: "json" });
  if (previous && previous.first_name === firstName
    && normalizeUsername(previous.username || "", false) === username) return;

  await env.DB.put(key, JSON.stringify({
    id: userId,
    first_name: firstName,
    username,
    updatedAt: new Date().toISOString()
  }));

  const previousUsername = normalizeUsername(previous?.username || "", false);
  if (previousUsername && previousUsername !== username) {
    const oldMapping = await env.DB.get(usernameKey(previousUsername));
    if (Number(oldMapping) === userId) await env.DB.delete(usernameKey(previousUsername));
  }
  if (username) await env.DB.put(usernameKey(username), String(userId));
}

async function resolveUserByUsername(env, rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new HttpError(400, "Telegram username is required");
  const userId = Number(await env.DB.get(usernameKey(username)));
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return await readPublicProfile(env, userId);
}

async function readPublicProfile(env, userId) {
  const directory = await env.DB.get(directoryKey(userId), { type: "json" });
  if (directory) {
    return {
      id: userId,
      first_name: cleanPlainText(directory.first_name || "Пользователь", 64) || "Пользователь",
      username: normalizeUsername(directory.username || "", false)
    };
  }

  const stored = await env.DB.get(`user:${userId}`, { type: "json" });
  return {
    id: userId,
    first_name: cleanPlainText(stored?.owner?.first_name || "Пользователь", 64) || "Пользователь",
    username: normalizeUsername(stored?.owner?.username || "", false)
  };
}

async function readSubscriptions(env, userId) {
  const stored = await env.DB.get(subscriptionsKey(userId), { type: "json" });
  if (!Array.isArray(stored)) return [];
  const ids = [];
  for (const rawId of stored) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || id === userId || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_SOCIAL_ITEMS) break;
  }
  return ids;
}

async function addSubscription(env, viewerId, targetId) {
  if (viewerId === targetId) throw new HttpError(400, "You cannot subscribe to yourself");
  const subscriptions = await readSubscriptions(env, viewerId);
  if (!subscriptions.includes(targetId)) {
    if (subscriptions.length >= MAX_SOCIAL_ITEMS) {
      throw new HttpError(409, "Subscriptions limit reached");
    }
    subscriptions.unshift(targetId);
    await env.DB.put(subscriptionsKey(viewerId), JSON.stringify(subscriptions));
  }
}

async function loadGroups(env, ownerId) {
  const stored = await env.DB.get(groupsKey(ownerId), { type: "json" });
  const storedItems = Array.isArray(stored?.items) ? stored.items : [];
  return GROUP_DEFINITIONS.map(definition => {
    const saved = storedItems.find(group => group?.id === definition.id);
    const memberIds = [];
    for (const rawId of Array.isArray(saved?.memberIds) ? saved.memberIds : []) {
      const memberId = Number(rawId);
      if (!Number.isSafeInteger(memberId) || memberId <= 0
        || memberId === ownerId || memberIds.includes(memberId)) continue;
      memberIds.push(memberId);
      if (memberIds.length >= MAX_SOCIAL_ITEMS) break;
    }
    return { ...definition, memberIds };
  });
}

async function saveGroups(env, ownerId, groups) {
  await env.DB.put(groupsKey(ownerId), JSON.stringify({
    items: groups.map(group => ({ id: group.id, memberIds: group.memberIds })),
    updatedAt: new Date().toISOString()
  }));
}

function getGroup(groups, rawGroupId) {
  const groupId = String(rawGroupId || "");
  const group = groups.find(item => item.id === groupId);
  if (!group) throw new HttpError(400, "Unknown group");
  return group;
}

async function buildSocialPayload(env, viewerId) {
  const subscriptions = await readSubscriptions(env, viewerId);
  const groups = await loadGroups(env, viewerId);
  const profiles = new Map();
  const getProfile = async userId => {
    if (!profiles.has(userId)) profiles.set(userId, await readPublicProfile(env, userId));
    return profiles.get(userId);
  };

  const subscriptionItems = [];
  for (const ownerId of subscriptions) subscriptionItems.push(await getProfile(ownerId));
  const groupItems = [];
  for (const group of groups) {
    const members = [];
    for (const memberId of group.memberIds) members.push(await getProfile(memberId));
    groupItems.push({ id: group.id, name: group.name, members });
  }
  return { subscriptions: subscriptionItems, groups: groupItems };
}

async function readSocialBody(request) {
  assertContentLength(request, MAX_JSON_BYTES);
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_JSON_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }
    const body = JSON.parse(rawBody);
    return body && typeof body === "object" ? body : {};
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function handleSocialGet(env, viewer) {
  return json(await buildSocialPayload(env, viewer.id));
}

async function handleSocialPost(request, env, viewer) {
  const body = await readSocialBody(request);
  const action = String(body.action || "");
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  if (action === "unsubscribe") {
    const targetId = parseId(payload.user_id, "user id");
    const subscriptions = (await readSubscriptions(env, viewer.id)).filter(id => id !== targetId);
    await env.DB.put(subscriptionsKey(viewer.id), JSON.stringify(subscriptions));
    return json({ status: "ok", ...await buildSocialPayload(env, viewer.id) });
  }

  if (action === "remove_group_member") {
    const targetId = parseId(payload.user_id, "user id");
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    group.memberIds = group.memberIds.filter(id => id !== targetId);
    await saveGroups(env, viewer.id, groups);

    const record = await loadWishlist(env, viewer.id, viewer);
    const affectedViewerIds = cleanupRecordAudience(record, groups, viewer.id);
    if (affectedViewerIds.size) await saveWishlist(env, viewer.id, record);
    for (const affectedViewerId of affectedViewerIds) {
      await syncWishlistParticipation(env, viewer.id, { id: affectedViewerId }, record, groups);
    }
    return json({ status: "ok", ...await buildSocialPayload(env, viewer.id) });
  }

  if (!["subscribe", "add_group_member"].includes(action)) {
    throw new HttpError(400, "Unknown social action");
  }

  let targetId = 0;
  if (payload.user_id !== undefined && action === "subscribe") {
    targetId = parseId(payload.user_id, "user id");
  } else {
    const profile = await resolveUserByUsername(env, payload.username || "");
    if (!profile) {
      return await requestTelegramUserSelection(env, viewer, action, payload);
    }
    targetId = profile.id;
  }

  if (targetId === viewer.id) throw new HttpError(400, "You cannot add yourself");
  if (action === "subscribe") {
    await addSubscription(env, viewer.id, targetId);
  } else {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    if (!group.memberIds.includes(targetId)) {
      if (group.memberIds.length >= MAX_SOCIAL_ITEMS) {
        throw new HttpError(409, "Group members limit reached");
      }
      group.memberIds.push(targetId);
      await saveGroups(env, viewer.id, groups);
    }
  }
  return json({ status: "ok", ...await buildSocialPayload(env, viewer.id) });
}

async function requestTelegramUserSelection(env, viewer, action, payload) {
  const requestId = crypto.getRandomValues(new Uint32Array(1))[0] % 2_000_000_000 + 1;
  const pending = {
    requesterId: viewer.id,
    action,
    groupId: action === "add_group_member" ? String(payload.group_id || "") : "",
    requestedUsername: normalizeUsername(payload.username || "", false),
    createdAt: new Date().toISOString()
  };
  await env.DB.put(selectionKey(requestId), JSON.stringify(pending), { expirationTtl: 900 });

  const text = action === "subscribe"
    ? "Нажмите кнопку ниже и выберите в Telegram человека, на вишлист которого хотите подписаться."
    : "Нажмите кнопку ниже и выберите в Telegram человека, которого хотите добавить в группу.";
  try {
    await callTelegramApi(env, "sendMessage", {
      chat_id: viewer.id,
      text,
      reply_markup: {
        keyboard: [[{
          text: "Выбрать пользователя",
          request_users: { request_id: requestId, user_is_bot: false, max_quantity: 1 }
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  } catch (error) {
    await env.DB.delete(selectionKey(requestId));
    throw error;
  }

  const botUsername = await getBotUsername(env);
  return json({ status: "selection_required", requestId, botUsername }, 202);
}

function canViewerAccessGift(gift, groups, ownerId, viewerId) {
  if (ownerId === viewerId) return true;
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return true;
  return groupIds.some(groupId => {
    const group = groups.find(item => item.id === groupId);
    return group?.memberIds.includes(viewerId);
  });
}

function assertGiftVisible(gift, groups, ownerId, viewerId) {
  if (!canViewerAccessGift(gift, groups, ownerId, viewerId)) {
    throw new HttpError(404, "Gift not found");
  }
}

function collectGiftViewerIds(gift) {
  const ids = new Set();
  const bookedBy = Number(gift?.booked_by);
  if (Number.isSafeInteger(bookedBy) && bookedBy > 0) ids.add(bookedBy);
  for (const rawId of Array.isArray(gift?.participants) ? gift.participants : []) {
    const participantId = Number(rawId);
    if (Number.isSafeInteger(participantId) && participantId > 0) ids.add(participantId);
  }
  return ids;
}

function cleanupGiftAudience(gift, groups, ownerId) {
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return;
  const bookedBy = Number(gift.booked_by);
  if (Number.isSafeInteger(bookedBy) && bookedBy > 0
    && !canViewerAccessGift(gift, groups, ownerId, bookedBy)) {
    gift.booked_by = null;
  }
  if (Array.isArray(gift.participants)) {
    gift.participants = gift.participants.filter(rawId => {
      const participantId = Number(rawId);
      return Number.isSafeInteger(participantId) && participantId > 0
        && canViewerAccessGift(gift, groups, ownerId, participantId);
    });
  }
}

function cleanupRecordAudience(record, groups, ownerId) {
  const affectedViewerIds = new Set();
  for (const gift of record.gifts) {
    const before = collectGiftViewerIds(gift);
    cleanupGiftAudience(gift, groups, ownerId);
    const after = collectGiftViewerIds(gift);
    for (const id of [...before, ...after]) {
      if (!after.has(id) || !canViewerAccessGift(gift, groups, ownerId, id)) affectedViewerIds.add(id);
    }
  }
  return affectedViewerIds;
}

function participationKey(userId) {
  return `participations:${userId}`;
}

async function readParticipationIndex(env, userId) {
  const stored = await env.DB.get(participationKey(userId), { type: "json" });
  return Array.isArray(stored) ? stored : [];
}

async function syncWishlistParticipation(env, ownerId, viewer, record, providedGroups = null) {
  if (ownerId === viewer.id) return;
  const groups = providedGroups || await loadGroups(env, ownerId);

  const existing = await readParticipationIndex(env, viewer.id);
  const previous = existing.filter(entry => Number(entry?.ownerId) === ownerId);
  const next = existing.filter(entry => Number(entry?.ownerId) !== ownerId);
  const now = new Date().toISOString();

  for (const gift of record.gifts) {
    if (!canViewerAccessGift(gift, groups, ownerId, viewer.id)) continue;
    const type = gift.is_crowdfund
      ? (Array.isArray(gift.participants) && gift.participants.some(id => Number(id) === viewer.id) ? "crowdfund" : "")
      : (Number(gift.booked_by) === viewer.id ? "book" : "");
    if (!type) continue;

    const oldEntry = previous.find(entry =>
      Number(entry?.giftId) === Number(gift.id) && entry?.type === type
    );
    next.push({
      ownerId,
      giftId: Number(gift.id),
      type,
      updatedAt: oldEntry?.updatedAt || now
    });
  }

  next.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (JSON.stringify(existing) !== JSON.stringify(next)) {
    await env.DB.put(participationKey(viewer.id), JSON.stringify(next));
  }
}

async function handleParticipationsGet(env, viewer) {
  const existing = await readParticipationIndex(env, viewer.id);
  const records = new Map();
  const recordGroups = new Map();
  const validEntries = [];
  const items = [];

  for (const entry of existing) {
    const ownerId = Number(entry?.ownerId);
    const giftId = Number(entry?.giftId);
    const type = entry?.type;
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0
      || !Number.isSafeInteger(giftId) || giftId <= 0
      || !["book", "crowdfund"].includes(type)) continue;

    if (!records.has(ownerId)) {
      records.set(ownerId, await loadWishlist(env, ownerId, viewer));
      recordGroups.set(ownerId, await loadGroups(env, ownerId));
    }
    const record = records.get(ownerId);
    const groups = recordGroups.get(ownerId);
    const gift = record.gifts.find(item => Number(item.id) === giftId);
    if (!gift || !canViewerAccessGift(gift, groups, ownerId, viewer.id)) continue;

    const isActive = type === "book"
      ? !gift.is_crowdfund && Number(gift.booked_by) === viewer.id
      : gift.is_crowdfund && Array.isArray(gift.participants)
        && gift.participants.some(id => Number(id) === viewer.id);
    if (!isActive) continue;

    const normalizedEntry = {
      ownerId,
      giftId,
      type,
      updatedAt: String(entry.updatedAt || "")
    };
    validEntries.push(normalizedEntry);
    items.push({
      type,
      updatedAt: normalizedEntry.updatedAt,
      owner: {
        id: ownerId,
        first_name: record.owner.first_name || "Пользователь"
      },
      gift: {
        id: giftId,
        title: gift.title,
        link: gift.link || "",
        image: gift.image || "",
        price: gift.price ?? null,
        category: gift.category || "Разное",
        comment: gift.comment || "",
        desire: gift.desire || (gift.priority ? "high" : "medium"),
        tags: Array.isArray(gift.tags) ? gift.tags : [],
        group_ids: Array.isArray(gift.group_ids) ? gift.group_ids : [],
        priority: Boolean(gift.priority),
        is_crowdfund: Boolean(gift.is_crowdfund),
        is_gifted: Boolean(gift.is_gifted),
        participantsCount: Array.isArray(gift.participants) ? gift.participants.length : 0
      }
    });
  }

  if (JSON.stringify(existing) !== JSON.stringify(validEntries)) {
    await env.DB.put(participationKey(viewer.id), JSON.stringify(validEntries));
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return json({ items });
}

function serializeWishlist(record, viewerId, groups = [], isSubscribed = false) {
  const ownerId = Number(record.owner.id);
  const result = {
    owner: {
      id: ownerId,
      first_name: record.owner.first_name || "Пользователь",
      username: normalizeUsername(record.owner.username || "", false)
    },
    is_subscribed: Boolean(isSubscribed),
    gifts: record.gifts
      .filter(gift => canViewerAccessGift(gift, groups, ownerId, viewerId))
      .map(gift => ({
        ...gift,
        group_ids: Array.isArray(gift.group_ids) ? gift.group_ids : [],
        booked_by: gift.booked_by === null || gift.booked_by === undefined
          ? null
          : gift.booked_by === viewerId ? viewerId : -1,
        participants: (Array.isArray(gift.participants) ? gift.participants : [])
          .map(participantId => participantId === viewerId ? viewerId : -1)
      }))
  };
  if (ownerId === viewerId) {
    result.groups = groups.map(group => ({
      id: group.id,
      name: group.name,
      memberIds: [...group.memberIds]
    }));
  }
  return result;
}

function findGiftIndex(gifts, rawId) {
  const id = parseId(rawId, "gift id");
  const index = gifts.findIndex(gift => Number(gift.id) === id);
  if (index < 0) throw new HttpError(404, "Gift not found");
  return index;
}

function parseId(value, fieldName) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `Invalid ${fieldName}`);
  return id;
}

function createGiftId() {
  const random = crypto.getRandomValues(new Uint16Array(1))[0];
  return Date.now() * 1000 + random;
}

function assertContentLength(request, maximum) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maximum) throw new HttpError(413, "Request body is too large");
}

async function handleImageUpload(request, env, user) {
  assertContentLength(request, MAX_UPLOAD_REQUEST_BYTES);
  let formData;
  try {
    formData = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new HttpError(400, "Image file is required");
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "Image must be smaller than 512 KB");
  }

  const contentType = detectImageType(bytes);
  if (!contentType) throw new HttpError(415, "Only WebP and JPEG images are supported");

  const imageId = crypto.randomUUID().replaceAll("-", "");
  await env.DB.put(`img:${imageId}`, bytes, {
    metadata: {
      contentType,
      ownerId: String(user.id),
      createdAt: new Date().toISOString()
    }
  });

  return json({ url: `/api/img/${imageId}`, size: bytes.byteLength }, 201);
}

function detectImageType(buffer) {
  const bytes = new Uint8Array(buffer);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (isJpeg) return "image/jpeg";
  if (isWebp) return "image/webp";
  return "";
}

async function handleImageRequest(env, imageId, viewer) {
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, {
    type: "arrayBuffer"
  });
  if (!value) return json({ error: "Image not found" }, 404);

  const ownerId = Number(metadata?.ownerId);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    return json({ error: "Image not found" }, 404);
  }
  const record = await loadWishlist(env, ownerId, viewer);
  const imageUrl = `/api/img/${imageId}`;
  const linkedGifts = record.gifts.filter(gift => gift.image === imageUrl);
  if (viewer.id !== ownerId) {
    const groups = await loadGroups(env, ownerId);
    const canView = linkedGifts.length > 0 && linkedGifts.some(gift =>
      canViewerAccessGift(gift, groups, ownerId, viewer.id)
    );
    if (!canView) return json({ error: "Image not found" }, 404);
  }

  return new Response(value, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": metadata?.contentType || "application/octet-stream",
      "Content-Length": String(value.byteLength),
      "Cache-Control": "private, max-age=3600",
      "Vary": "X-Telegram-Init-Data",
      "ETag": `"${imageId}"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function deleteInternalImage(env, imageUrl, ownerId) {
  const imageId = getInternalImageId(imageUrl);
  if (!imageId) return;
  try {
    const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, {
      type: "arrayBuffer"
    });
    if (!value || String(metadata?.ownerId || "") !== String(ownerId)) return;
    await env.DB.delete(`img:${imageId}`);
  } catch (error) {
    console.error("Failed to delete unused image:", error?.message || error);
  }
}

async function handleTelegramWebhook(request, env) {
  await getBotToken(env);
  if (!env.WEBAPP_URL) {
    throw new HttpError(500, "WEBAPP_URL is not configured");
  }
  if (env.WEBHOOK_SECRET) {
    const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (receivedSecret !== env.WEBHOOK_SECRET) throw new HttpError(401, "Invalid webhook secret");
  }

  let update;
  try {
    update = await request.json();
  } catch {
    throw new HttpError(400, "Invalid Telegram update");
  }

  const message = update?.message;
  const sharedUsers = message?.users_shared || message?.user_shared;
  if (sharedUsers) {
    return await handleSharedUserSelection(env, message, sharedUsers);
  }

  const text = String(message?.text || "");
  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(list_\d+))?\s*$/);
  if (!message?.chat?.id || !startMatch) {
    return json({ ok: true });
  }

  const webAppUrl = new URL(env.WEBAPP_URL);
  if (startMatch[1]) {
    webAppUrl.searchParams.set("list", startMatch[1].replace("list_", ""));
  }

  await callTelegramApi(env, "sendMessage", {
    chat_id: message.chat.id,
    text: "Откройте вишлист, чтобы добавить желание или выбрать подарок для друга.",
    reply_markup: {
      inline_keyboard: [[
        {
          text: "Открыть вишлист",
          web_app: { url: webAppUrl.toString() }
        }
      ]]
    }
  });

  return json({ ok: true });
}

async function handleSharedUserSelection(env, message, shared) {
  const requestId = Number(shared?.request_id);
  const requesterId = Number(message?.from?.id);
  if (!Number.isSafeInteger(requestId) || requestId <= 0
    || !Number.isSafeInteger(requesterId) || requesterId <= 0) {
    return json({ ok: true });
  }

  const key = selectionKey(requestId);
  const pending = await env.DB.get(key, { type: "json" });
  if (!pending || Number(pending.requesterId) !== requesterId) {
    await callTelegramApi(env, "sendMessage", {
      chat_id: requesterId,
      text: "Этот запрос выбора уже использован или устарел. Вернитесь в приложение и попробуйте ещё раз.",
      reply_markup: { remove_keyboard: true }
    });
    return json({ ok: true });
  }

  const sharedProfile = Array.isArray(shared?.users) ? shared.users[0] : shared;
  const selectedId = Number(sharedProfile?.user_id);
  if (!Number.isSafeInteger(selectedId) || selectedId <= 0 || selectedId === requesterId) {
    await env.DB.delete(key);
    await callTelegramApi(env, "sendMessage", {
      chat_id: requesterId,
      text: "Нужно выбрать другого пользователя Telegram, не собственный аккаунт.",
      reply_markup: { remove_keyboard: true }
    });
    return json({ ok: true });
  }

  const previousProfile = await readPublicProfile(env, selectedId);
  const selectedProfile = {
    id: selectedId,
    first_name: cleanPlainText(sharedProfile?.first_name || previousProfile.first_name, 64) || "Пользователь",
    username: normalizeUsername(sharedProfile?.username || previousProfile.username || "", false)
  };
  await rememberTelegramUser(env, selectedProfile);

  let confirmation = "";
  if (pending.action === "subscribe") {
    await addSubscription(env, requesterId, selectedId);
    confirmation = `Вы подписались на вишлист: ${selectedProfile.first_name}.`;
  } else if (pending.action === "add_group_member") {
    const groups = await loadGroups(env, requesterId);
    const group = getGroup(groups, pending.groupId);
    if (!group.memberIds.includes(selectedId)) {
      if (group.memberIds.length >= MAX_SOCIAL_ITEMS) {
        throw new HttpError(409, "Group members limit reached");
      }
      group.memberIds.push(selectedId);
      await saveGroups(env, requesterId, groups);
    }
    confirmation = `${selectedProfile.first_name} добавлен(а) в группу «${group.name}».`;
  } else {
    await env.DB.delete(key);
    throw new HttpError(400, "Unknown selection action");
  }

  await env.DB.delete(key);
  const webAppUrl = new URL(env.WEBAPP_URL);
  await callTelegramApi(env, "sendMessage", {
    chat_id: requesterId,
    text: confirmation,
    reply_markup: {
      inline_keyboard: [[{ text: "Вернуться в приложение", web_app: { url: webAppUrl.toString() } }]]
    }
  });
  return json({ ok: true });
}

async function getBotUsername(env) {
  await getBotToken(env);
  const cached = await env.DB.get("config:bot", { type: "json" });
  if (cached?.username) return cached.username;

  const me = await callTelegramApi(env, "getMe", {});
  if (!me?.username) throw new HttpError(502, "Telegram bot username is unavailable");

  await env.DB.put("config:bot", JSON.stringify({ username: me.username }), {
    expirationTtl: 86400
  });
  return me.username;
}

async function callTelegramApi(env, method, payload) {
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
    throw new HttpError(502, "Invalid response from Telegram");
  }
  if (!response.ok || !result.ok) {
    console.error("Telegram API error:", result?.description || response.status);
    throw new HttpError(502, "Telegram API request failed");
  }
  return result.result;
}
