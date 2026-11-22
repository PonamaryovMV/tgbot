import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { File } from "node:buffer";
import worker from "../worker.js";

const BOT_TOKEN = "test-only-bot-token";
const OWNER = { id: 1001, first_name: "Максим", username: "maxim" };
const GUEST_1 = { id: 2002, first_name: "Анна", username: "anna1" };
const GUEST_2 = { id: 3003, first_name: "Дима", username: "dima" };
const BASE = "https://worker.test";

const telegramCalls = [];
function defaultFetchStub(url, options = {}) {
  const parsed = new URL(String(url));
  if (parsed.hostname !== "api.telegram.org") {
    throw new Error(`Blocked unexpected network request in tests: ${parsed.href}`);
  }
  const method = parsed.pathname.split("/").pop();
  const payload = options.body ? JSON.parse(options.body) : {};
  telegramCalls.push({ method, payload });
  if (method === "getMe") {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { username: "wishlist_test_bot" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
  }
  return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: telegramCalls.length } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
}
globalThis.fetch = defaultFetchStub;

class MemoryKV {
  constructor() {
    this.entries = new Map();
  }

  async get(key, options = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return this.#readValue(entry, options.type);
  }

  async getWithMetadata(key, options = {}) {
    const entry = this.entries.get(key);
    if (!entry) return { value: null, metadata: null };
    return {
      value: this.#readValue(entry, options.type),
      metadata: entry.metadata
    };
  }

  async put(key, value, options = {}) {
    let stored = value;
    if (value instanceof ArrayBuffer) stored = value.slice(0);
    else if (ArrayBuffer.isView(value)) {
      stored = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    this.entries.set(key, {
      value: stored,
      metadata: options.metadata || null,
      expirationTtl: options.expirationTtl || null
    });
  }

  async delete(key) {
    this.entries.delete(key);
  }

  #readValue(entry, type) {
    if (type === "json") return JSON.parse(entry.value);
    if (type === "arrayBuffer") {
      if (entry.value instanceof ArrayBuffer) return entry.value.slice(0);
      return new TextEncoder().encode(entry.value).buffer;
    }
    return entry.value;
  }
}

function createEnv() {
  return {
    DB: new MemoryKV(),
    BOT_TOKEN,
    WEBAPP_URL: "https://ponamaryovmv.github.io/tgbot/"
  };
}

function makeInitData(user, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "test-query-id",
    user: JSON.stringify(user)
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

function requestApi(path, { method = "GET", user, body, initData, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (user) requestHeaders.set("X-Telegram-Init-Data", makeInitData(user));
  if (initData !== undefined) requestHeaders.set("X-Telegram-Init-Data", initData);
  let requestBody;
  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody
  });
}

async function json(response) {
  return await response.json();
}

function giftPayload(overrides = {}) {
  return {
    title: "Тестовый подарок",
    link: "https://example.com/product",
    image: "",
    price: 5000,
    category: "Техника",
    comment: "Комментарий",
    priority: false,
    is_crowdfund: false,
    ...overrides
  };
}

async function addGift(env, user = OWNER, overrides = {}) {
  const response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user,
    body: { owner_id: user.id, action: "add", payload: giftPayload(overrides) }
  }), env);
  assert.equal(response.status, 200);
  return await json(response);
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test("CORS, healthcheck and unknown routes", async () => {
  const options = await worker.fetch(new Request(`${BASE}/api/data`, { method: "OPTIONS" }), {});
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(options.headers.get("Access-Control-Allow-Headers"), /X-Telegram-Init-Data/);

  const env = createEnv();
  const health = await worker.fetch(new Request(`${BASE}/api/health`), env);
  assert.equal(health.status, 200);
  assert.deepEqual(await json(health), { ok: true });

  const missing = await worker.fetch(new Request(`${BASE}/missing`), env);
  assert.equal(missing.status, 404);
});

test("Telegram initData authentication", async () => {
  const env = createEnv();
  let response = await worker.fetch(requestApi("/api/data"), env);
  assert.equal(response.status, 401);

  response = await worker.fetch(requestApi("/api/data", { initData: "auth_date=1&hash=bad" }), env);
  assert.equal(response.status, 401);

  const valid = makeInitData(OWNER);
  const invalid = valid.replace(/hash=([a-f0-9]{64})/, (match, hash) => {
    const replacement = `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`;
    return `hash=${replacement}`;
  });
  response = await worker.fetch(requestApi("/api/data", { initData: invalid }), env);
  assert.equal(response.status, 401);

  const expired = makeInitData(OWNER, Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60);
  response = await worker.fetch(requestApi("/api/data", { initData: expired }), env);
  assert.equal(response.status, 401);

  response = await worker.fetch(requestApi("/api/data", { user: OWNER }), env);
  assert.equal(response.status, 200);
  const data = await json(response);
  assert.equal(data.owner.id, OWNER.id);
  assert.equal(data.owner.first_name, OWNER.first_name);
  assert.deepEqual(data.gifts, []);
});

test("Guest sees the saved Telegram profile of an empty wishlist owner", async () => {
  const env = createEnv();
  let response = await worker.fetch(requestApi("/api/gifts", { user: OWNER }), env);
  assert.equal(response.status, 200);

  await env.DB.put(`user:${OWNER.id}`, JSON.stringify({
    owner: { id: OWNER.id, first_name: "", username: "" },
    gifts: []
  }));

  response = await worker.fetch(requestApi(`/api/gifts?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  assert.equal(response.status, 200);
  const data = await json(response);
  assert.equal(data.owner.id, OWNER.id);
  assert.equal(data.owner.first_name, OWNER.first_name);
  assert.equal(data.owner.username, OWNER.username);
  assert.deepEqual(data.gifts, []);
});

test("Owner CRUD, validation and access control", async () => {
  const env = createEnv();
  let data = await addGift(env);
  assert.equal(data.gifts.length, 1);
  const giftId = data.gifts[0].id;
  assert.equal(data.gifts[0].title, "Тестовый подарок");

  let response = await worker.fetch(requestApi("/api/gifts?owner_id=1001", { user: OWNER }), env);
  assert.equal(response.status, 200);
  assert.equal((await json(response)).gifts[0].id, giftId);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({ id: giftId, title: "Обновлённый подарок", priority: true })
    }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  assert.equal(data.gifts[0].title, "Обновлённый подарок");
  assert.equal(data.gifts[0].priority, true);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "toggle_gifted", payload: { id: giftId } }
  }), env);
  assert.equal((await json(response)).gifts[0].is_gifted, true);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "update", payload: giftPayload({ id: giftId }) }
  }), env);
  assert.equal(response.status, 403);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: giftId } }
  }), env);
  assert.equal(response.status, 403);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "add", payload: giftPayload({ link: "javascript:alert(1)" }) }
  }), env);
  assert.equal(response.status, 400);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "unknown", payload: {} }
  }), env);
  assert.equal(response.status, 400);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: giftId } }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).gifts, []);
});

test("Guest booking, crowdfund and Telegram ID privacy", async () => {
  const env = createEnv();
  let data = await addGift(env);
  const singleId = data.gifts[0].id;
  data = await addGift(env, OWNER, { title: "Совместный подарок", is_crowdfund: true, price: 10000 });
  const crowdId = data.gifts[0].id;

  let response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: singleId } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  assert.equal(data.gifts.find(gift => gift.id === singleId).booked_by, GUEST_1.id);

  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: OWNER }), env);
  data = await json(response);
  assert.equal(data.gifts.find(gift => gift.id === singleId).booked_by, -1);

  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: GUEST_2 }), env);
  data = await json(response);
  assert.equal(data.gifts.find(gift => gift.id === singleId).booked_by, -1);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_2,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: singleId } }
  }), env);
  assert.equal(response.status, 409);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: singleId } }
  }), env);
  assert.equal((await json(response)).gifts.find(gift => gift.id === singleId).booked_by, null);

  for (const guest of [GUEST_1, GUEST_2]) {
    response = await worker.fetch(requestApi("/api/data", {
      method: "POST",
      user: guest,
      body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: crowdId } }
    }), env);
    assert.equal(response.status, 200);
    data = await json(response);
    const participants = data.gifts.find(gift => gift.id === crowdId).participants;
    assert.ok(participants.includes(guest.id));
    assert.ok(!participants.some(id => id !== guest.id && id !== -1));
  }

  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: OWNER }), env);
  data = await json(response);
  assert.deepEqual(data.gifts.find(gift => gift.id === crowdId).participants, [-1, -1]);
  const stored = JSON.parse(env.DB.entries.get(`user:${OWNER.id}`).value);
  assert.deepEqual(stored.gifts.find(gift => gift.id === crowdId).participants, [GUEST_1.id, GUEST_2.id]);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: crowdId } }
  }), env);
  data = await json(response);
  assert.deepEqual(data.gifts.find(gift => gift.id === crowdId).participants, [-1]);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: crowdId } }
  }), env);
  assert.equal(response.status, 409);
});

test("Desire levels, optional shop links and gift tags", async () => {
  const env = createEnv();

  for (const desire of ["high", "medium", "wait"]) {
    const data = await addGift(env, OWNER, {
      title: `Подарок ${desire}`,
      link: "",
      desire,
      tags: ["Новый год", "новый ГОД", " День рождения "]
    });
    const gift = data.gifts[0];
    assert.equal(gift.link, "");
    assert.equal(gift.desire, desire);
    assert.equal(gift.priority, desire === "high");
    assert.deepEqual(gift.tags, ["Новый год", "День рождения"]);
  }

  let data = await addGift(env, OWNER, { title: "Старый приоритет", priority: true });
  assert.equal(data.gifts[0].desire, "high");
  assert.equal(data.gifts[0].priority, true);
  data = await addGift(env, OWNER, { title: "Старый обычный", priority: false });
  assert.equal(data.gifts[0].desire, "medium");
  assert.equal(data.gifts[0].priority, false);

  const eightTags = Array.from({ length: 8 }, (_, index) => `Тег ${index + 1}`);
  data = await addGift(env, OWNER, { title: "Восемь тегов", tags: eightTags });
  assert.deepEqual(data.gifts[0].tags, eightTags);

  const invalidPayloads = [
    { desire: "urgent" },
    { tags: "Новый год" },
    { tags: [...eightTags, "Девятый"] },
    { tags: ["я".repeat(31)] },
    { link: "not-a-url" }
  ];
  for (const overrides of invalidPayloads) {
    const response = await worker.fetch(requestApi("/api/data", {
      method: "POST",
      user: OWNER,
      body: { owner_id: OWNER.id, action: "add", payload: giftPayload(overrides) }
    }), env);
    assert.equal(response.status, 400, JSON.stringify(overrides));
  }
});

test("Participation index follows booking, crowdfund, cancellation and deletion", async () => {
  const env = createEnv();
  let response = await worker.fetch(requestApi("/api/participations"), env);
  assert.equal(response.status, 401);

  let data = await addGift(env, OWNER, { title: "Книга", link: "" });
  const bookId = data.gifts[0].id;
  data = await addGift(env, OWNER, {
    title: "Большой подарок",
    is_crowdfund: true,
    desire: "wait",
    tags: ["День рождения"]
  });
  const crowdId = data.gifts[0].id;

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: bookId } }
  }), env);
  assert.equal(response.status, 200);

  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  data = await json(response);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].type, "book");
  assert.equal(data.items[0].owner.id, OWNER.id);
  assert.equal(data.items[0].owner.first_name, OWNER.first_name);
  assert.equal(data.items[0].gift.id, bookId);
  assert.equal(data.items[0].gift.title, "Книга");
  assert.equal("booked_by" in data.items[0].gift, false);
  assert.equal("participants" in data.items[0].gift, false);

  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_2 }), env);
  assert.deepEqual((await json(response)).items, []);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: bookId } }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  assert.deepEqual((await json(response)).items, []);
  assert.deepEqual(JSON.parse(env.DB.entries.get(`participations:${GUEST_1.id}`).value), []);

  for (const guest of [GUEST_1, GUEST_2]) {
    response = await worker.fetch(requestApi("/api/data", {
      method: "POST",
      user: guest,
      body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: crowdId } }
    }), env);
    assert.equal(response.status, 200);
  }

  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  data = await json(response);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].type, "crowdfund");
  assert.equal(data.items[0].gift.id, crowdId);
  assert.equal(data.items[0].gift.participantsCount, 2);
  assert.equal(data.items[0].gift.desire, "wait");
  assert.deepEqual(data.items[0].gift.tags, ["День рождения"]);
  assert.equal("participants" in data.items[0].gift, false);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: crowdId } }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  assert.deepEqual((await json(response)).items, []);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_2 }), env);
  data = await json(response);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].gift.participantsCount, 1);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: crowdId } }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: crowdId } }
  }), env);
  assert.equal(response.status, 200);

  for (const guest of [GUEST_1, GUEST_2]) {
    response = await worker.fetch(requestApi("/api/participations", { user: guest }), env);
    assert.deepEqual((await json(response)).items, []);
    assert.deepEqual(JSON.parse(env.DB.entries.get(`participations:${guest.id}`).value), []);
  }
});

test("Guest reads restore participation and stale index entries are removed", async () => {
  const env = createEnv();
  const bookId = 10001;
  const crowdId = 10002;
  await env.DB.put(`user:${OWNER.id}`, JSON.stringify({
    owner: OWNER,
    gifts: [
      {
        id: bookId,
        title: "Старая бронь",
        link: "",
        image: "",
        price: null,
        category: "Разное",
        comment: "",
        priority: true,
        is_crowdfund: false,
        booked_by: GUEST_1.id,
        participants: [],
        is_gifted: false
      },
      {
        id: crowdId,
        title: "Старый сбор",
        link: "",
        image: "",
        price: 9000,
        category: "Разное",
        comment: "",
        priority: false,
        is_crowdfund: true,
        booked_by: null,
        participants: [GUEST_1.id, GUEST_2.id],
        is_gifted: false
      }
    ]
  }));

  let response = await worker.fetch(requestApi(`/api/gifts?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  let data = await json(response);
  assert.equal(data.items.length, 2);
  assert.deepEqual(new Set(data.items.map(item => item.type)), new Set(["book", "crowdfund"]));
  assert.equal(data.items.find(item => item.type === "book").gift.desire, "high");
  assert.equal(data.items.find(item => item.type === "crowdfund").gift.desire, "medium");

  const storedIndex = JSON.parse(env.DB.entries.get(`participations:${GUEST_1.id}`).value);
  storedIndex.push(
    { ownerId: OWNER.id, giftId: 99999, type: "book", updatedAt: "stale" },
    { ownerId: 40404, giftId: 1, type: "crowdfund", updatedAt: "stale" },
    { ownerId: "bad", giftId: null, type: "unknown" }
  );
  await env.DB.put(`participations:${GUEST_1.id}`, JSON.stringify(storedIndex));

  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  data = await json(response);
  assert.equal(data.items.length, 2);
  const cleaned = JSON.parse(env.DB.entries.get(`participations:${GUEST_1.id}`).value);
  assert.equal(cleaned.length, 2);
  assert.ok(cleaned.every(entry => [bookId, crowdId].includes(entry.giftId)));
});

test("Subscriptions, groups and per-gift audience enforcement", async () => {
  const env = createEnv();
  let response = await worker.fetch(requestApi("/api/social"), env);
  assert.equal(response.status, 401);

  let data = await addGift(env, OWNER, { title: "Общий подарок" });
  const publicId = data.gifts[0].id;
  data = await addGift(env, OWNER, {
    title: "Только для близких",
    group_ids: ["close"]
  });
  const privateId = data.gifts[0].id;
  assert.deepEqual(data.gifts[0].group_ids, ["close"]);
  assert.ok(Array.isArray(data.groups));
  assert.equal(data.groups.length, 4);

  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  data = await json(response);
  assert.deepEqual(data.gifts.map(gift => gift.id), [publicId]);
  assert.equal("groups" in data, false);
  assert.equal(data.is_subscribed, false);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: privateId } }
  }), env);
  assert.equal(response.status, 404);

  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: {
      action: "add_group_member",
      payload: { group_id: "close", username: "@anna1" }
    }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  const closeGroup = data.groups.find(group => group.id === "close");
  assert.equal(closeGroup.members[0].id, GUEST_1.id);
  assert.equal(closeGroup.members[0].username, "anna1");

  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  data = await json(response);
  assert.equal(data.gifts.length, 2);
  assert.ok(data.gifts.some(gift => gift.id === privateId));

  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_1,
    body: { action: "subscribe", payload: { username: "maxim" } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  assert.equal(data.subscriptions[0].id, OWNER.id);
  assert.deepEqual(JSON.parse(env.DB.entries.get(`subscriptions:${GUEST_1.id}`).value), [OWNER.id]);

  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  assert.equal((await json(response)).is_subscribed, true);

  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_2,
    body: { action: "subscribe", payload: { user_id: OWNER.id } }
  }), env);
  assert.equal((await json(response)).subscriptions[0].id, OWNER.id);
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_2,
    body: { action: "unsubscribe", payload: { user_id: OWNER.id } }
  }), env);
  assert.deepEqual((await json(response)).subscriptions, []);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: privateId } }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  assert.equal((await json(response)).items.length, 1);

  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: {
      action: "remove_group_member",
      payload: { group_id: "close", user_id: GUEST_1.id }
    }
  }), env);
  assert.equal(response.status, 200);
  const stored = JSON.parse(env.DB.entries.get(`user:${OWNER.id}`).value);
  assert.equal(stored.gifts.find(gift => gift.id === privateId).booked_by, null);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  assert.deepEqual((await json(response)).items, []);
  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  assert.deepEqual((await json(response)).gifts.map(gift => gift.id), [publicId]);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_2,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: publicId } }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_2 }), env);
  assert.equal((await json(response)).items.length, 1);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({ id: publicId, title: "Общий подарок", group_ids: ["close"] })
    }
  }), env);
  assert.equal(response.status, 200);
  const restrictedPublic = JSON.parse(env.DB.entries.get(`user:${OWNER.id}`).value)
    .gifts.find(gift => gift.id === publicId);
  assert.equal(restrictedPublic.booked_by, null);
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_2 }), env);
  assert.deepEqual((await json(response)).items, []);
  response = await worker.fetch(requestApi(`/api/data?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  assert.deepEqual((await json(response)).gifts, []);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "add",
      payload: giftPayload({ title: "Неверная группа", group_ids: ["unknown"] })
    }
  }), env);
  assert.equal(response.status, 400);
});

test("Telegram user selection stores IDs and completes social actions", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  let response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "subscribe", payload: { username: "olga1" } }
  }), env);
  assert.equal(response.status, 202);
  let data = await json(response);
  assert.equal(data.status, "selection_required");
  assert.equal(data.botUsername, "wishlist_test_bot");

  const pickerRequest = telegramCalls.findLast(call => call.method === "sendMessage");
  const picker = pickerRequest.payload.reply_markup.keyboard[0][0];
  assert.equal(picker.request_users.max_quantity, 1);
  assert.equal(picker.request_users.request_name, true);
  assert.equal(picker.request_users.request_username, true);
  const requestId = picker.request_users.request_id;
  assert.ok(env.DB.entries.has(`selection:${requestId}`));

  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: OWNER.id },
        from: { id: OWNER.id },
        users_shared: {
          request_id: requestId,
          users: [{ user_id: 4004, first_name: "Ольга", username: "olga1" }]
        }
      }
    })
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(env.DB.entries.get(`subscriptions:${OWNER.id}`).value), [4004]);
  assert.equal(Number(env.DB.entries.get("username:olga1").value), 4004);
  assert.equal(JSON.parse(env.DB.entries.get("directory:4004").value).first_name, "Ольга");
  assert.equal(env.DB.entries.has(`selection:${requestId}`), false);

  response = await worker.fetch(requestApi("/api/social", { user: OWNER }), env);
  data = await json(response);
  assert.deepEqual(data.subscriptions[0], { id: 4004, first_name: "Ольга", username: "olga1" });

  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: {
      action: "add_group_member",
      payload: { group_id: "family", username: "new_person" }
    }
  }), env);
  assert.equal(response.status, 202);
  const groupPickerRequest = telegramCalls.findLast(call => call.method === "sendMessage");
  const groupRequestId = groupPickerRequest.payload.reply_markup.keyboard[0][0].request_users.request_id;

  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: OWNER.id },
        from: { id: OWNER.id },
        user_shared: { request_id: groupRequestId, user_id: 4004 }
      }
    })
  }), env);
  assert.equal(response.status, 200);
  const storedGroups = JSON.parse(env.DB.entries.get(`groups:${OWNER.id}`).value);
  assert.deepEqual(storedGroups.items.find(group => group.id === "family").memberIds, [4004]);
  assert.equal(JSON.parse(env.DB.entries.get("directory:4004").value).username, "olga1");

  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: OWNER.id },
        from: { id: OWNER.id },
        users_shared: {
          request_id: requestId,
          users: [{ user_id: 5005, first_name: "Другой" }]
        }
      }
    })
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(env.DB.entries.get(`subscriptions:${OWNER.id}`).value), [4004]);
});

async function uploadImage(env, user, bytes, mime = "image/jpeg") {
  const form = new FormData();
  form.append("file", new File([bytes], "photo", { type: mime }));
  const request = new Request(`${BASE}/api/upload`, {
    method: "POST",
    headers: { "X-Telegram-Init-Data": makeInitData(user) },
    body: form
  });
  return await worker.fetch(request, env);
}

test("KV image upload, validation, ownership, caching and deletion", async () => {
  const env = createEnv();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

  let response = await uploadImage(env, OWNER, jpeg);
  assert.equal(response.status, 201);
  const uploaded = await json(response);
  assert.match(uploaded.url, /^\/api\/img\/[a-f0-9]{32}$/);
  const imageId = uploaded.url.split("/").pop();

  response = await worker.fetch(requestApi(uploaded.url, { user: OWNER }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=3600");
  assert.equal((await response.arrayBuffer()).byteLength, jpeg.byteLength);

  response = await worker.fetch(requestApi(uploaded.url, { user: GUEST_1 }), env);
  assert.equal(response.status, 404);

  response = await uploadImage(env, OWNER, new Uint8Array(32));
  assert.equal(response.status, 415);

  const oversized = new Uint8Array(512 * 1024 + 1);
  oversized.set(jpeg.slice(0, 3));
  response = await uploadImage(env, OWNER, oversized);
  assert.equal(response.status, 413);

  const webp = new Uint8Array(16);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  response = await uploadImage(env, OWNER, webp, "image/webp");
  assert.equal(response.status, 201);

  let data = await addGift(env, OWNER, { image: uploaded.url });
  const giftId = data.gifts[0].id;
  assert.equal(data.gifts[0].image, uploaded.url);

  response = await worker.fetch(requestApi(uploaded.url, { user: GUEST_1 }), env);
  assert.equal(response.status, 200);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({ id: giftId, image: uploaded.url, group_ids: ["close"] })
    }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi(uploaded.url, { user: GUEST_1 }), env);
  assert.equal(response.status, 404);

  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: {
      action: "add_group_member",
      payload: { group_id: "close", username: "anna1" }
    }
  }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi(uploaded.url, { user: GUEST_1 }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(requestApi(uploaded.url, { user: GUEST_2 }), env);
  assert.equal(response.status, 404);

  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: giftId } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(env.DB.entries.has(`img:${imageId}`), false);

  response = await worker.fetch(requestApi(uploaded.url, { user: OWNER }), env);
  assert.equal(response.status, 404);

  response = await uploadImage(env, GUEST_1, jpeg);
  const guestImage = await json(response);
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "add", payload: giftPayload({ image: guestImage.url }) }
  }), env);
  assert.equal(response.status, 403);
  assert.equal(env.DB.entries.has(`img:${guestImage.url.split("/").pop()}`), true);
});

test("Telegram bot config cache and /start webhook deep link", async () => {
  const env = createEnv();
  env.WEBHOOK_SECRET = "test-webhook-secret";
  telegramCalls.length = 0;

  let response = await worker.fetch(new Request(`${BASE}/api/config`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { botUsername: "wishlist_test_bot" });

  response = await worker.fetch(new Request(`${BASE}/api/config`), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.filter(call => call.method === "getMe").length, 1);

  const botToken = env.BOT_TOKEN;
  delete env.BOT_TOKEN;
  response = await worker.fetch(new Request(`${BASE}/api/config`), env);
  assert.equal(response.status, 500);
  assert.deepEqual(await json(response), { error: "BOT_TOKEN is not configured" });
  env.BOT_TOKEN = botToken;

  const update = {
    message: {
      chat: { id: 777 },
      text: "/start list_1001"
    }
  };
  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"
    },
    body: JSON.stringify(update)
  }), env);
  assert.equal(response.status, 200);

  const send = telegramCalls.find(call => call.method === "sendMessage");
  assert.equal(send.payload.chat_id, 777);
  const button = send.payload.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, "Открыть вишлист");
  const webAppUrl = new URL(button.web_app.url);
  assert.equal(webAppUrl.searchParams.get("list"), "1001");

  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "wrong"
    },
    body: JSON.stringify(update)
  }), env);
  assert.equal(response.status, 401);
});

test("Bot notifications on gift deletion, archive toggle and gift updates", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  let data = await addGift(env, OWNER, { title: "Наушники *Pro* [2026]", price: 15000 });
  const singleId = data.gifts[0].id;
  data = await addGift(env, OWNER, { title: "Кофемашина", is_crowdfund: true, price: 30000 });
  const crowdId = data.gifts[0].id;
  data = await addGift(env, OWNER, { title: "Архивный плед", price: 3000 });
  const archivedId = data.gifts[0].id;

  await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: singleId } }
  }), env);
  for (const guest of [GUEST_1, GUEST_2]) {
    await worker.fetch(requestApi("/api/data", {
      method: "POST",
      user: guest,
      body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: crowdId } }
    }), env);
  }
  await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: archivedId } }
  }), env);

  telegramCalls.length = 0;
  let response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "toggle_gifted", payload: { id: archivedId } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);
  assert.equal("parse_mode" in telegramCalls[0].payload, false);
  assert.match(telegramCalls[0].payload.text, /Максим \(@maxim\) отметил\(а\) подарок «Архивный плед» как уже подаренный\./);

  telegramCalls.length = 0;
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "toggle_gifted", payload: { id: archivedId } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 0);

  await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "toggle_gifted", payload: { id: archivedId } }
  }), env);
  telegramCalls.length = 0;
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: archivedId } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 0);

  telegramCalls.length = 0;
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: singleId } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);
  assert.equal("parse_mode" in telegramCalls[0].payload, false);
  assert.match(telegramCalls[0].payload.text, /Максим \(@maxim\) удалил\(а\) подарок «Наушники \*Pro\* \[2026\]»\. Ваша бронь отменена\./);
  assert.equal(
    new URL(telegramCalls[0].payload.reply_markup.inline_keyboard[0][0].web_app.url).searchParams.get("list"),
    String(OWNER.id)
  );
  const guest1PartsAfterDelete = JSON.parse(env.DB.entries.get(`participations:${GUEST_1.id}`).value);
  assert.equal(guest1PartsAfterDelete.some(entry => entry.giftId === singleId), false);

  await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "add_group_member", payload: { group_id: "close", username: "anna1" } }
  }), env);

  telegramCalls.length = 0;
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({
        id: crowdId,
        title: "Кофемашина",
        is_crowdfund: true,
        price: 30000,
        group_ids: ["close"]
      })
    }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_2.id);
  assert.match(telegramCalls[0].payload.text, /Подарок «Кофемашина» в вишлисте Максим \(@maxim\) стал недоступен\. Ваша бронь\/участие отменены\./);
  assert.doesNotMatch(telegramCalls[0].payload.text, /close|Близкие|Анна/i);

  telegramCalls.length = 0;
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({
        id: crowdId,
        title: "Кофемашина",
        is_crowdfund: true,
        price: 35000,
        comment: "Обновлённый комментарий",
        group_ids: ["close"]
      })
    }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);
  assert.match(telegramCalls[0].payload.text, /Максим \(@maxim\) обновил\(а\) забронированный подарок «Кофемашина» \(изменено: цена, комментарий\)\./);

  telegramCalls.length = 0;
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({
        id: crowdId,
        title: "Кофемашина",
        is_crowdfund: false,
        price: 35000,
        comment: "Обновлённый комментарий",
        group_ids: ["close"]
      })
    }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);
  assert.match(telegramCalls[0].payload.text, /Максим \(@maxim\) изменил\(а\) формат подарка «Кофемашина»\. Ваша бронь\/участие в сборе сброшены/);
});

test("Grouped notification when removing a guest from a group", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  assert.equal((await worker.fetch(requestApi("/api/social", { user: GUEST_1 }), env)).status, 200);

  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "add_group_member", payload: { group_id: "family", username: "anna1" } }
  }), env)).status, 200);

  const g1 = (await addGift(env, OWNER, { title: "Подарок А", group_ids: ["family"] })).gifts[0].id;
  const g2 = (await addGift(env, OWNER, { title: "Подарок Б", is_crowdfund: true, group_ids: ["family"] })).gifts[0].id;
  const g3 = (await addGift(env, OWNER, { title: "Подарок В (архив)", group_ids: ["family"] })).gifts[0].id;

  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: g1 } }
  }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_crowdfund", payload: { id: g2 } }
  }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: g3 } }
  }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "toggle_gifted", payload: { id: g3 } }
  }), env)).status, 200);

  telegramCalls.length = 0;
  const response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "remove_group_member", payload: { group_id: "family", user_id: GUEST_1.id } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);
  const text = telegramCalls[0].payload.text;
  assert.match(text, /В вишлисте Максим \(@maxim\) стали недоступны несколько подарков, ваши брони\/участия отменены:/);
  assert.match(text, /«Подарок А»/);
  assert.match(text, /«Подарок Б»/);
  assert.doesNotMatch(text, /Подарок В/);
  assert.doesNotMatch(text, /family|Семья/i);
});

test("New gift notifications respect subscribers index, group privacy and cap", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  assert.equal((await worker.fetch(requestApi("/api/social", { user: OWNER }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/social", { user: GUEST_1 }), env)).status, 200);

  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_1,
    body: { action: "subscribe", payload: { username: "maxim" } }
  }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_2,
    body: { action: "subscribe", payload: { username: "maxim" } }
  }), env)).status, 200);
  assert.deepEqual(
    new Set(JSON.parse(env.DB.entries.get(`subscribers:${OWNER.id}`).value)),
    new Set([GUEST_1.id, GUEST_2.id])
  );

  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "add_group_member", payload: { group_id: "close", username: "anna1" } }
  }), env)).status, 200);

  telegramCalls.length = 0;
  await addGift(env, OWNER, { title: "Секретный браслет", price: 7500, group_ids: ["close"] });
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);
  assert.match(telegramCalls[0].payload.text, /У Максим \(@maxim\) появилось новое желание: «Секретный браслет» \(7\s500 ₽\)/);

  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_2,
    body: { action: "unsubscribe", payload: { user_id: OWNER.id } }
  }), env)).status, 200);
  assert.deepEqual(JSON.parse(env.DB.entries.get(`subscribers:${OWNER.id}`).value), [GUEST_1.id]);

  const manySubscribers = Array.from({ length: 25 }, (_, i) => 9000 + i);
  await env.DB.put(`subscribers:${OWNER.id}`, JSON.stringify(manySubscribers));
  telegramCalls.length = 0;
  await addGift(env, OWNER, { title: "Массовый подарок", price: null });
  assert.equal(telegramCalls.length, 20);
});

test("Notification preferences via /notifications and callback_query, plus 403 resilience", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  let response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: GUEST_1.id },
        from: { id: GUEST_1.id },
        text: "/notifications@wishlist_test_bot"
      }
    })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(telegramCalls.length, 1);
  assert.match(telegramCalls[0].payload.text, /Брони и совместные сборы: включены/);
  assert.match(telegramCalls[0].payload.text, /Новые желания друзей: включены/);
  assert.equal(
    telegramCalls[0].payload.reply_markup.inline_keyboard[0][0].callback_data,
    "notify:toggle:bookings"
  );

  telegramCalls.length = 0;
  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query: {
        id: "cb-1",
        from: { id: GUEST_1.id },
        data: "notify:toggle:bookings",
        message: { message_id: 42, chat: { id: GUEST_1.id } }
      }
    })
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(env.DB.entries.get(`notify_prefs:${GUEST_1.id}`).value), {
    bookings: false,
    new_gifts: true
  });
  assert.equal(telegramCalls.some(call => call.method === "editMessageText"), true);
  assert.equal(telegramCalls.some(call => call.method === "answerCallbackQuery"), true);

  assert.equal((await worker.fetch(requestApi("/api/social", { user: OWNER }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_1,
    body: { action: "subscribe", payload: { username: "maxim" } }
  }), env)).status, 200);
  const giftId = (await addGift(env, OWNER, { title: "Книга" })).gifts[0].id;
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: giftId } }
  }), env)).status, 200);

  telegramCalls.length = 0;
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: giftId } }
  }), env)).status, 200);
  assert.equal(telegramCalls.length, 0);

  telegramCalls.length = 0;
  await addGift(env, OWNER, { title: "Настольная игра" });
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].payload.chat_id, GUEST_1.id);

  await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query: {
        id: "cb-2",
        from: { id: GUEST_1.id },
        data: "notify:toggle:new_gifts",
        message: { message_id: 42, chat: { id: GUEST_1.id } }
      }
    })
  }), env);
  telegramCalls.length = 0;
  await addGift(env, OWNER, { title: "Ещё один подарок" });
  assert.equal(telegramCalls.length, 0);

  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: GUEST_2,
    body: { action: "subscribe", payload: { username: "maxim" } }
  }), env)).status, 200);

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    error_code: 403,
    description: "Forbidden: bot was blocked by the user"
  }), {
    status: 403,
    headers: { "Content-Type": "application/json" }
  });

  try {
    const blockedRes = await worker.fetch(requestApi("/api/data", {
      method: "POST",
      user: OWNER,
      body: { owner_id: OWNER.id, action: "add", payload: giftPayload({ title: "Подарок при 403" }) }
    }), env);
    assert.equal(blockedRes.status, 200);
    const body = await json(blockedRes);
    assert.equal(body.gifts[0].title, "Подарок при 403");
  } finally {
    globalThis.fetch = defaultFetchStub;
  }
});

test("Custom privacy groups CRUD, limits, legacy compatibility and deleted group selection", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  // Register guests
  assert.equal((await worker.fetch(requestApi("/api/social", { user: GUEST_1 }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/social", { user: GUEST_2 }), env)).status, 200);

  // Default groups for a new user
  let response = await worker.fetch(requestApi("/api/social", { user: OWNER }), env);
  assert.equal(response.status, 200);
  let data = await json(response);
  assert.deepEqual(
    data.groups.map(group => [group.id, group.name]),
    [
      ["family", "Семья"],
      ["close", "Близкие"],
      ["friends", "Друзья"],
      ["colleagues", "Коллеги"]
    ]
  );

  // Create custom group
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "create_group", payload: { name: "Универ" } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  const customGroup = data.groups.find(group => group.name === "Универ");
  assert.ok(customGroup);
  assert.match(customGroup.id, /^grp_[a-f0-9]{8}$/);

  // Case-insensitive duplicate rejected
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "create_group", payload: { name: "универ" } }
  }), env);
  assert.equal(response.status, 409);

  // Rename custom group
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "rename_group", payload: { group_id: customGroup.id, name: "Однокурсники" } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  assert.equal(data.groups.find(group => group.id === customGroup.id).name, "Однокурсники");

  // Add GUEST_1 to customGroup, GUEST_2 to friends; create gift restricted to both groups
  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "add_group_member", payload: { group_id: customGroup.id, username: "anna1" } }
  }), env)).status, 200);
  assert.equal((await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "add_group_member", payload: { group_id: "friends", username: "dima" } }
  }), env)).status, 200);

  const giftData = await addGift(env, OWNER, {
    title: "Книга для двух групп",
    group_ids: [customGroup.id, "friends"]
  });
  const giftId = giftData.gifts[0].id;

  // GUEST_1 books the gift
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: giftId } }
  }), env)).status, 200);
  assert.equal(
    (await json(await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env))).items.length,
    1
  );

  // Start a Telegram selection for customGroup, then delete customGroup before webhook arrives
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "add_group_member", payload: { group_id: customGroup.id, username: "ghost_user" } }
  }), env);
  assert.equal(response.status, 202);
  const selectionRequestId = (await json(response)).requestId;

  // Delete customGroup -> removes customGroup.id from gift.group_ids and cancels GUEST_1's booking
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "delete_group", payload: { group_id: customGroup.id } }
  }), env);
  assert.equal(response.status, 200);
  const storedAfterDelete = JSON.parse(env.DB.entries.get(`user:${OWNER.id}`).value);
  const updatedGift = storedAfterDelete.gifts.find(item => item.id === giftId);
  assert.deepEqual(updatedGift.group_ids, ["friends"]);
  assert.equal(updatedGift.booked_by, null);
  assert.deepEqual(
    (await json(await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env))).items,
    []
  );

  // Now finish the pending Telegram selection for the deleted group -> 200 OK with message
  telegramCalls.length = 0;
  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: OWNER.id },
        from: { id: OWNER.id },
        users_shared: {
          request_id: selectionRequestId,
          users: [{ user_id: 5555, first_name: "Иван", username: "ghost_user" }]
        }
      }
    })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(env.DB.entries.has(`selection:${selectionRequestId}`), false);
  assert.match(telegramCalls.at(-1).payload.text, /Выбранная группа больше не существует/);

  // Test MAX_GROUPS = 20 limit
  for (let i = 1; i <= 16; i += 1) {
    const res = await worker.fetch(requestApi("/api/social", {
      method: "POST",
      user: OWNER,
      body: { action: "create_group", payload: { name: `Группа ${i}` } }
    }), env);
    assert.equal(res.status, 200);
  }
  response = await worker.fetch(requestApi("/api/social", {
    method: "POST",
    user: OWNER,
    body: { action: "create_group", payload: { name: "Лишняя группа" } }
  }), env);
  assert.equal(response.status, 409);

  // Backward compatibility: legacy KV record without `name` fields
  const legacyEnv = createEnv();
  await legacyEnv.DB.put(`groups:${OWNER.id}`, JSON.stringify({
    items: [
      { id: "contacts", memberIds: [GUEST_1.id] },
      { id: "family", memberIds: [] },
      { id: "girlfriend", memberIds: [GUEST_1.id] },
      { id: "friends", memberIds: [] }
    ]
  }));
  response = await worker.fetch(requestApi("/api/social", { user: OWNER }), legacyEnv);
  assert.equal(response.status, 200);
  const legacySocial = await json(response);
  assert.deepEqual(
    legacySocial.groups.map(group => [group.id, group.name]),
    [
      ["contacts", "Контакты"],
      ["family", "Семья"],
      ["girlfriend", "Девушка"],
      ["friends", "Друзья"]
    ]
  );
  // Adding a gift with legacy group id works without migration
  const legacyGiftRes = await addGift(legacyEnv, OWNER, { title: "Старый приватный", group_ids: ["girlfriend"] });
  assert.deepEqual(legacyGiftRes.gifts[0].group_ids, ["girlfriend"]);
});

test("Occasions CRUD, private occasion filtering and /start occasion deep links", async () => {
  const env = createEnv();
  telegramCalls.length = 0;

  // Create two occasions
  let response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "save_occasion", payload: { title: "Новый год" } }
  }), env);
  assert.equal(response.status, 200);
  let data = await json(response);
  assert.equal(data.occasions.length, 1);
  const nyOcc = data.occasions[0];
  assert.match(nyOcc.id, /^occ_[a-f0-9]{8}$/);
  assert.equal(nyOcc.title, "Новый год");

  // Duplicate title rejected (case-insensitive)
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "save_occasion", payload: { title: "новый год" } }
  }), env);
  assert.equal(response.status, 409);

  // Rename occasion
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "save_occasion", payload: { id: nyOcc.id, title: "Новый год 2027" } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  assert.equal(data.occasions[0].title, "Новый год 2027");

  // Create private occasion
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "save_occasion", payload: { title: "Секретная годовщина" } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  const secretOcc = data.occasions.find(item => item.title === "Секретная годовщина");

  // Unknown occasion id rejected when adding gift
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "add",
      payload: giftPayload({ title: "Невалидный повод", occasion_ids: ["occ_missing1"] })
    }
  }), env);
  assert.equal(response.status, 400);

  // Add public gift in nyOcc, private gift (close group) in secretOcc
  await addGift(env, OWNER, { title: "Гирлянда", occasion_ids: [nyOcc.id] });
  await addGift(env, OWNER, { title: "Кольцо", group_ids: ["close"], occasion_ids: [secretOcc.id] });

  // Owner sees both occasions
  response = await worker.fetch(requestApi("/api/gifts", { user: OWNER }), env);
  assert.equal((await json(response)).occasions.length, 2);

  // GUEST_1 (not in close) sees ONLY nyOcc; secret occasion title must not leak
  response = await worker.fetch(requestApi(`/api/gifts?owner_id=${OWNER.id}`, { user: GUEST_1 }), env);
  const guestView = await json(response);
  assert.deepEqual(guestView.occasions, [{ id: nyOcc.id, title: "Новый год 2027" }]);

  // Delete nyOcc -> removed from record.occasions and gift.occasion_ids
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete_occasion", payload: { id: nyOcc.id } }
  }), env);
  assert.equal(response.status, 200);
  data = await json(response);
  assert.equal(data.occasions.some(item => item.id === nyOcc.id), false);
  assert.deepEqual(data.gifts.find(item => item.title === "Гирлянда").occasion_ids, []);

  // Webhook deep link /start list_<ownerId>_occ_<occId>
  telegramCalls.length = 0;
  response = await worker.fetch(new Request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: 888 },
        text: `/start list_${OWNER.id}_${secretOcc.id}`
      }
    })
  }), env);
  assert.equal(response.status, 200);
  const deepUrl = new URL(telegramCalls[0].payload.reply_markup.inline_keyboard[0][0].web_app.url);
  assert.equal(deepUrl.searchParams.get("list"), String(OWNER.id));
  assert.equal(deepUrl.searchParams.get("occasion"), secretOcc.id);
});

test("Reusable gifts allow multiple givers, mask IDs and sync participations", async () => {
  const env = createEnv();

  // Mutually exclusive with is_crowdfund
  let response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "add",
      payload: giftPayload({ title: "Конфликт", is_crowdfund: true, is_reusable: true })
    }
  }), env);
  assert.equal(response.status, 400);

  let data = await addGift(env, OWNER, { title: "Сертификат в книжный", is_reusable: true });
  const giftId = data.gifts[0].id;
  assert.equal(data.gifts[0].is_reusable, true);
  assert.deepEqual(data.gifts[0].reusable_givers, []);

  // Both GUEST_1 and GUEST_2 can mark the gift independently
  for (const guest of [GUEST_1, GUEST_2]) {
    response = await worker.fetch(requestApi("/api/data", {
      method: "POST",
      user: guest,
      body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: giftId } }
    }), env);
    assert.equal(response.status, 200);
    data = await json(response);
    const givers = data.gifts[0].reusable_givers;
    assert.ok(givers.includes(guest.id));
    assert.ok(!givers.some(id => id !== guest.id && id !== -1));
  }

  // Owner sees only masked IDs [-1, -1]
  response = await worker.fetch(requestApi("/api/data", { user: OWNER }), env);
  assert.deepEqual((await json(response)).gifts[0].reusable_givers, [-1, -1]);

  // Participations list shows type "reusable" and does not expose reusable_givers
  response = await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env);
  const parts = await json(response);
  assert.equal(parts.items.length, 1);
  assert.equal(parts.items[0].type, "reusable");
  assert.equal(parts.items[0].gift.is_reusable, true);
  assert.equal(parts.items[0].gift.reusableCount, 2);
  assert.equal("reusable_givers" in parts.items[0].gift, false);

  // GUEST_1 cancels own mark; GUEST_2 remains
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: giftId } }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).gifts[0].reusable_givers, [-1]);
  assert.deepEqual(
    (await json(await worker.fetch(requestApi("/api/participations", { user: GUEST_1 }), env))).items,
    []
  );

  // Switching mode is_reusable -> false resets reusable_givers and clears GUEST_2 participation
  response = await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: OWNER,
    body: {
      owner_id: OWNER.id,
      action: "update",
      payload: giftPayload({ id: giftId, title: "Сертификат в книжный", is_reusable: false })
    }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await json(response)).gifts[0].reusable_givers, []);
  assert.deepEqual(
    (await json(await worker.fetch(requestApi("/api/participations", { user: GUEST_2 }), env))).items,
    []
  );
});

test("Copying another user's gift respects privacy and clones KV image independently", async () => {
  const env = createEnv();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

  // Upload image as OWNER and create occasion + public and private gifts
  const uploadRes = await uploadImage(env, OWNER, jpeg);
  assert.equal(uploadRes.status, 201);
  const sourceImageUrl = (await json(uploadRes)).url;
  const sourceImageId = sourceImageUrl.split("/").pop();

  const occRes = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "save_occasion", payload: { title: "День рождения" } }
  }), env);
  const occId = (await json(occRes)).occasions[0].id;

  const publicGift = (await addGift(env, OWNER, {
    title: "Механическая клавиатура",
    image: sourceImageUrl,
    price: 12000,
    tags: ["Техника"],
    occasion_ids: [occId],
    is_reusable: true
  })).gifts[0];
  const privateGift = (await addGift(env, OWNER, {
    title: "Секретный подарок",
    group_ids: ["close"]
  })).gifts[0];

  // GUEST_2 marks the public reusable gift
  assert.equal((await worker.fetch(requestApi("/api/data", {
    method: "POST",
    user: GUEST_2,
    body: { owner_id: OWNER.id, action: "toggle_book", payload: { id: publicGift.id } }
  }), env)).status, 200);

  // Owner cannot copy their own gift (400)
  let response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "copy_gift", payload: { id: publicGift.id } }
  }), env);
  assert.equal(response.status, 400);

  // Guest cannot copy a hidden private gift by ID (404)
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "copy_gift", payload: { id: privateGift.id } }
  }), env);
  assert.equal(response.status, 404);

  // Guest copies visible public gift (201)
  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: GUEST_1,
    body: { owner_id: OWNER.id, action: "copy_gift", payload: { id: publicGift.id } }
  }), env);
  assert.equal(response.status, 201);
  const copied = (await json(response)).gift;
  assert.notEqual(copied.id, publicGift.id);
  assert.equal(copied.title, "Механическая клавиатура");
  assert.equal(copied.price, 12000);
  assert.equal(copied.is_reusable, true);
  assert.deepEqual(copied.group_ids, []);
  assert.deepEqual(copied.occasion_ids, []);
  assert.equal(copied.booked_by, null);
  assert.deepEqual(copied.participants, []);
  assert.deepEqual(copied.reusable_givers, []);
  assert.equal(copied.is_gifted, false);
  assert.match(copied.image, /^\/api\/img\/[a-f0-9]{32}$/);
  assert.notEqual(copied.image, sourceImageUrl);

  // Verify cloned KV image has GUEST_1 as owner and survives deletion of OWNER's gift
  const clonedImageId = copied.image.split("/").pop();
  assert.equal(env.DB.entries.get(`img:${clonedImageId}`).metadata.ownerId, String(GUEST_1.id));

  response = await worker.fetch(requestApi("/api/gifts", {
    method: "POST",
    user: OWNER,
    body: { owner_id: OWNER.id, action: "delete", payload: { id: publicGift.id } }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(env.DB.entries.has(`img:${sourceImageId}`), false);
  assert.equal(env.DB.entries.has(`img:${clonedImageId}`), true);

  // GUEST_1 can still load their cloned image and see the copied gift in their own wishlist
  const imgRes = await worker.fetch(requestApi(copied.image, { user: GUEST_1 }), env);
  assert.equal(imgRes.status, 200);
  const guestWishlist = await json(await worker.fetch(requestApi("/api/gifts", { user: GUEST_1 }), env));
  assert.equal(guestWishlist.gifts.length, 1);
  assert.equal(guestWishlist.gifts[0].id, copied.id);
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} test groups passed.`);
