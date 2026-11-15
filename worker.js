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

      const imageMatch = path.match(/^\/api\/img\/([A-Za-z0-9_-]{16,64})$/);
      if (imageMatch && method === "GET") {
        return await handleImageRequest(env, imageMatch[1]);
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

  return {
    id: userId,
    first_name: cleanPlainText(user.first_name || "Пользователь", 64) || "Пользователь"
  };
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
  if (ownerId === viewer.id && !record.owner.first_name) {
    record.owner.first_name = viewer.first_name;
  } else {
    await syncWishlistParticipation(env, ownerId, viewer, record);
  }
  return json(serializeWishlist(record, viewer.id));
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
  let imageToDelete = "";

  if (action === "add") {
    const gift = sanitizeGift(payload);
    await assertInternalImageOwnership(env, gift.image, viewer.id);
    gift.id = createGiftId();
    gift.booked_by = null;
    gift.participants = [];
    gift.is_gifted = false;
    record.gifts.unshift(gift);
    record.owner = { id: ownerId, first_name: viewer.first_name };
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
    record.gifts[index] = next;
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
    if (gift.is_gifted || !gift.is_crowdfund) throw new HttpError(409, "This gift is not a crowdfund");
    const participants = Array.isArray(gift.participants) ? gift.participants : [];
    const index = participants.indexOf(viewer.id);
    if (index >= 0) participants.splice(index, 1);
    else participants.push(viewer.id);
    gift.participants = participants;
  }

  await saveWishlist(env, ownerId, record);
  if (!isOwner) {
    await syncWishlistParticipation(env, ownerId, viewer, record);
  }
  const imageIsStillUsed = imageToDelete
    && record.gifts.some(gift => gift.image === imageToDelete);
  if (imageToDelete && !imageIsStillUsed) {
    await deleteInternalImage(env, imageToDelete, ownerId);
  }
  return json(serializeWishlist(record, viewer.id));
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
  const ownerName = ownerId === viewer.id ? viewer.first_name : "";
  return {
    owner: {
      id: ownerId,
      first_name: cleanPlainText(stored?.owner?.first_name || ownerName, 64)
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

function participationKey(userId) {
  return `participations:${userId}`;
}

async function readParticipationIndex(env, userId) {
  const stored = await env.DB.get(participationKey(userId), { type: "json" });
  return Array.isArray(stored) ? stored : [];
}

async function syncWishlistParticipation(env, ownerId, viewer, record) {
  if (ownerId === viewer.id) return;

  const existing = await readParticipationIndex(env, viewer.id);
  const previous = existing.filter(entry => Number(entry?.ownerId) === ownerId);
  const next = existing.filter(entry => Number(entry?.ownerId) !== ownerId);
  const now = new Date().toISOString();

  for (const gift of record.gifts) {
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
    }
    const record = records.get(ownerId);
    const gift = record.gifts.find(item => Number(item.id) === giftId);
    if (!gift) continue;

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

function serializeWishlist(record, viewerId) {
  return {
    owner: {
      id: record.owner.id,
      first_name: record.owner.first_name || "Пользователь"
    },
    gifts: record.gifts.map(gift => ({
      ...gift,
      booked_by: gift.booked_by === null || gift.booked_by === undefined
        ? null
        : gift.booked_by === viewerId ? viewerId : -1,
      participants: (Array.isArray(gift.participants) ? gift.participants : [])
        .map(participantId => participantId === viewerId ? viewerId : -1)
    }))
  };
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

async function handleImageRequest(env, imageId) {
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, {
    type: "arrayBuffer"
  });
  if (!value) return json({ error: "Image not found" }, 404);

  return new Response(value, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": metadata?.contentType || "application/octet-stream",
      "Content-Length": String(value.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
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
