import test from "node:test";
import assert from "node:assert/strict";
import {
  handleCoreApi,
  handleExpensesApi,
  handleTelegramWebhook,
  getExpensesErrorResponse
} from "../expenses-worker.js";

function createMemoryKV() {
  const map = new Map();
  return {
    async get(key, opt) {
      const val = map.get(key);
      if (val === undefined) return null;
      return opt === "json" ? JSON.parse(val) : val;
    },
    async put(key, value) {
      map.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    async delete(key) {
      map.delete(key);
    },
    _map: map
  };
}

function createStage2MockD1() {
  const usersByTelegramId = new Map();
  const usersById = new Map();
  const eventsById = new Map();
  const membersById = new Map();
  const auditLogs = [];

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
          const row = usersByTelegramId.get(Number(this._params[0]));
          return row ? { ...row } : null;
        }
        if (q.includes("from users where lower(username)")) {
          const uname = String(this._params[0] || "").toLowerCase();
          for (const row of usersById.values()) {
            if (String(row.username || "").toLowerCase() === uname) return { ...row };
          }
          return null;
        }
        if (q.includes("from users where id")) {
          const row = usersById.get(String(this._params[0] || ""));
          return row ? { ...row } : null;
        }
        if (q.includes("from event_members where event_id = ? and user_id = ?")) {
          const [eventId, userId] = this._params;
          for (const m of membersById.values()) {
            if (m.event_id === String(eventId) && m.user_id === String(userId)) return { ...m };
          }
          return null;
        }
        if (q.includes("from events where invite_token")) {
          const token = String(this._params[0] || "");
          for (const ev of eventsById.values()) {
            if (ev.invite_token === token) return { ...ev };
          }
          return null;
        }
        if (q.includes("from events where id")) {
          const ev = eventsById.get(String(this._params[0] || ""));
          return ev ? { ...ev } : null;
        }
        return null;
      },
      async all() {
        const q = this._sql.toLowerCase();
        if (q.includes("from event_members em_me")) {
          const myId = String(this._params[0] || "");
          const myEvents = new Set(
            [...membersById.values()].filter(m => m.user_id === myId).map(m => m.event_id)
          );
          const seen = new Set();
          const rows = [];
          for (const m of membersById.values()) {
            if (!myEvents.has(m.event_id) || !m.user_id || m.user_id === myId) continue;
            if (seen.has(m.user_id)) continue;
            seen.add(m.user_id);
            const u = usersById.get(m.user_id);
            if (u) rows.push({ id: u.id, telegram_id: u.telegram_id, username: u.username, display_name: u.display_name });
          }
          return { results: rows };
        }
        if (q.includes("from events e") && q.includes("where em.user_id = ?")) {
          const userId = String(this._params[0] || "");
          const rows = [];
          for (const ev of eventsById.values()) {
            const evMembers = [...membersById.values()].filter(m => m.event_id === ev.id);
            const me = evMembers.find(m => m.user_id === userId);
            if (me) {
              rows.push({
                ...ev,
                member_id: me.id,
                member_role: me.role,
                default_weight: me.default_weight,
                members_count: evMembers.length
              });
            }
          }
          return { results: rows };
        }
        if (q.includes("from event_members em") && q.includes("where em.event_id = ?")) {
          const eventId = String(this._params[0] || "");
          const rows = [...membersById.values()]
            .filter(m => m.event_id === eventId)
            .map(m => {
              const u = m.user_id ? usersById.get(m.user_id) : null;
              return {
                ...m,
                telegram_id: u ? u.telegram_id : null,
                username: u ? u.username : "",
                display_name: u ? u.display_name : m.member_name,
                payment_phone: u ? u.payment_phone : "",
                preferred_banks_json: u ? u.preferred_banks_json : "[]"
              };
            });
          return { results: rows };
        }
        if (q.includes("from event_audit_log")) {
          const eventId = String(this._params[0] || "");
          const rows = auditLogs.filter(item => item.event_id === eventId);
          return { results: rows };
        }
        return { results: [] };
      },
      async run() {
        const q = this._sql.trim().toLowerCase().replace(/\s+/g, " ");
        if (q.startsWith("insert into users")) {
          const [id, telegramId, username, displayName, createdAt, updatedAt] = this._params;
          const record = {
            id: String(id),
            telegram_id: Number(telegramId),
            username: String(username || ""),
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
          }
          return { success: true };
        }
        if (q.startsWith("insert into events")) {
          const [id, title, description, icon, baseCurrency, creatorId, simplifyDebts, inviteToken, createdAt, updatedAt] = this._params;
          const status = "ACTIVE";
          const ev = {
            id: String(id),
            title: String(title),
            description: String(description || ""),
            icon: String(icon || "🎉"),
            base_currency: String(baseCurrency || "RUB"),
            creator_id: String(creatorId),
            simplify_debts: Number(simplifyDebts ?? 1),
            status: String(status || "ACTIVE"),
            invite_token: String(inviteToken),
            created_at: String(createdAt),
            updated_at: String(updatedAt)
          };
          eventsById.set(ev.id, ev);
          return { success: true };
        }
        if (q.startsWith("update events set title")) {
          const [title, description, icon, baseCurrency, simplifyDebts, status, updatedAt, eventId] = this._params;
          const ev = eventsById.get(String(eventId));
          if (ev) {
            Object.assign(ev, {
              title: String(title),
              description: String(description || ""),
              icon: String(icon || "🎉"),
              base_currency: String(baseCurrency || "RUB"),
              simplify_debts: Number(simplifyDebts ?? 1),
              status: String(status || "ACTIVE"),
              updated_at: String(updatedAt)
            });
          }
          return { success: true };
        }
        if (q.startsWith("update events set updated_at")) {
          const [updatedAt, eventId] = this._params;
          const ev = eventsById.get(String(eventId));
          if (ev) ev.updated_at = String(updatedAt);
          return { success: true };
        }
        if (q.startsWith("insert into event_members")) {
          const role = q.includes("'owner'") ? "OWNER" : "MEMBER";
          const thirdValueNull = /values \(\?, \?, null/i.test(q);
          let id, eventId, userId, memberName, defaultWeight = 1.0, linkedPayerMemberId = null, joinedAt;
          if (thirdValueNull && this._params.length === 4) {
            [id, eventId, memberName, joinedAt] = this._params;
            userId = null;
          } else if (thirdValueNull) {
            [id, eventId, memberName, defaultWeight, joinedAt] = this._params;
            userId = null;
          } else if (this._params.length === 6) {
            [id, eventId, userId, memberName, defaultWeight, joinedAt] = this._params;
          } else {
            [id, eventId, userId, memberName, joinedAt] = this._params;
          }
          const m = {
            id: String(id),
            event_id: String(eventId),
            user_id: userId ? String(userId) : null,
            member_name: String(memberName),
            role: String(role || "MEMBER"),
            default_weight: Number(defaultWeight ?? 1.0),
            linked_payer_member_id: linkedPayerMemberId ? String(linkedPayerMemberId) : null,
            joined_at: String(joinedAt)
          };
          membersById.set(m.id, m);
          return { success: true };
        }
        if (q.startsWith("update event_members set user_id = ?, member_name = ?")) {
          const [userId, memberName, memberId] = this._params;
          const m = membersById.get(String(memberId));
          if (m) {
            m.user_id = userId ? String(userId) : null;
            m.member_name = String(memberName);
          }
          return { success: true };
        }
        if (q.startsWith("update event_members set member_name = ?, default_weight = ?")) {
          const [memberName, defaultWeight, memberId] = this._params;
          const m = membersById.get(String(memberId));
          if (m) {
            m.member_name = String(memberName);
            m.default_weight = Number(defaultWeight ?? 1.0);
          }
          return { success: true };
        }
        if (q.startsWith("update event_members set linked_payer_member_id = null where id = ?")) {
          const [memberId] = this._params;
          const m = membersById.get(String(memberId));
          if (m) m.linked_payer_member_id = null;
          return { success: true };
        }
        if (q.startsWith("update event_members set linked_payer_member_id = ? where event_id = ? and linked_payer_member_id = ?")) {
          const [headId, eventId, oldHeadId] = this._params;
          for (const m of membersById.values()) {
            if (m.event_id === String(eventId) && m.linked_payer_member_id === String(oldHeadId)) {
              m.linked_payer_member_id = String(headId);
            }
          }
          return { success: true };
        }
        if (q.startsWith("update event_members set linked_payer_member_id = ? where id = ?")) {
          const [headId, memberId] = this._params;
          const m = membersById.get(String(memberId));
          if (m) m.linked_payer_member_id = headId ? String(headId) : null;
          return { success: true };
        }
        if (q.startsWith("update event_members set linked_payer_member_id = null where event_id = ? and linked_payer_member_id = ?")) {
          const [eventId, memberId] = this._params;
          for (const m of membersById.values()) {
            if (m.event_id === String(eventId) && m.linked_payer_member_id === String(memberId)) {
              m.linked_payer_member_id = null;
            }
          }
          return { success: true };
        }
        if (q.startsWith("update event_members set linked_payer_member_id = null where event_id = ?")) {
          const [eventId, headId] = this._params;
          for (const m of membersById.values()) {
            if (m.event_id === String(eventId) && (m.id === String(headId) || m.linked_payer_member_id === String(headId))) {
              m.linked_payer_member_id = null;
            }
          }
          return { success: true };
        }
        if (q.startsWith("delete from event_members")) {
          const [memberId, eventId] = this._params;
          const m = membersById.get(String(memberId));
          if (m && m.event_id === String(eventId)) {
            membersById.delete(String(memberId));
          }
          return { success: true };
        }
        if (q.startsWith("insert into event_audit_log")) {
          const [id, eventId, actorUserId, action, detailsJson, createdAt] = this._params;
          auditLogs.unshift({
            id: String(id),
            event_id: String(eventId),
            actor_user_id: actorUserId ? String(actorUserId) : null,
            action: String(action),
            details_json: String(detailsJson || "{}"),
            created_at: String(createdAt)
          });
          return { success: true };
        }
        return { success: true };
      }
    };
  }

  return { prepare };
}

test("Stage 2 event creation with real users, rejects ghosts, bot selection, edit event, weights, wallet and invite", async () => {
  const db = createStage2MockD1();
  const kv = createMemoryKV();
  const botCalls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = new URL(String(url)).pathname.split("/").pop();
    const payload = opts.body ? JSON.parse(opts.body) : {};
    botCalls.push({ method, payload });
    if (method === "getMe") {
      return new Response(JSON.stringify({ ok: true, result: { username: "test_exp_bot" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: botCalls.length } }), { status: 200 });
  };

  try {
    const env = { EXPENSES_DB: db, DB: kv, BOT_TOKEN: "test-bot-token" };
    const owner = { id: 1001, first_name: "Максим", username: "maxim" };
    const anna = { id: 2002, first_name: "Анна", username: "anna1" };
    const bob = { id: 4004, first_name: "Борис", username: "boris4" };
    const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

    // Регистрируем Анну в приложении
    await handleCoreApi(
      new Request(`${baseOrigin}/api/core/bootstrap`, { method: "GET" }),
      env,
      anna,
      new URL(`${baseOrigin}/api/core/bootstrap`)
    );

    // 1. Попытка создать событие с незарегистрированным пользователем (ghost_names) отклоняется
    const ghostRejectRes = await handleExpensesApi(
      new Request(`${baseOrigin}/api/expenses/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Поездка", ghost_names: ["Гоша"] })
      }),
      env,
      owner,
      new URL(`${baseOrigin}/api/expenses/events`)
    );
    assert.equal(ghostRejectRes.status, 400);

    // 2. Создаём событие с реальным пользователем Анна по её telegram_id
    const createReq = new Request(`${baseOrigin}/api/expenses/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Поездка на Байкал",
        icon: "🏕",
        base_currency: "RUB",
        member_telegram_ids: [2002]
      })
    });
    const createRes = await handleExpensesApi(createReq, env, owner, new URL(createReq.url));
    assert.equal(createRes.status, 201);
    const ev = (await createRes.json()).event;
    assert.equal(ev.title, "Поездка на Байкал");
    assert.equal(ev.members.length, 2);
    const annaMem = ev.members.find(m => m.telegram_id === 2002);
    assert.ok(annaMem?.user_id);

    // 3. Попытка добавить участника только по имени без Telegram отклоняется
    const badMemberRes = await handleExpensesApi(
      new Request(`${baseOrigin}/api/expenses/events/${ev.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_name: "Лена" })
      }),
      env,
      owner,
      new URL(`${baseOrigin}/api/expenses/events/${ev.id}/members`)
    );
    assert.equal(badMemberRes.status, 400);

    // 4. Добавление неизвестного @dima1 запускает selection_required (request_users) и после ответа бота добавляет в событие
    const selRes = await handleExpensesApi(
      new Request(`${baseOrigin}/api/expenses/events/${ev.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "@dima1" })
      }),
      env,
      owner,
      new URL(`${baseOrigin}/api/expenses/events/${ev.id}/members`)
    );
    assert.equal(selRes.status, 202);
    const selBody = await selRes.json();
    assert.equal(selBody.status, "selection_required");
    assert.ok(selBody.requestId);

    const webhookRes = await handleTelegramWebhook(
      new Request(`${baseOrigin}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            chat: { id: owner.id },
            from: { id: owner.id },
            users_shared: {
              request_id: selBody.requestId,
              users: [{ user_id: 3003, first_name: "Дима", username: "dima1" }]
            }
          }
        })
      }),
      env
    );
    assert.equal(webhookRes.status, 200);

    const refreshedEv = await (await handleExpensesApi(
      new Request(`${baseOrigin}/api/expenses/events/${ev.id}`, { method: "GET" }),
      env,
      owner,
      new URL(`${baseOrigin}/api/expenses/events/${ev.id}`)
    )).json();
    const dimaMem = refreshedEv.event.members.find(m => m.telegram_id === 3003);
    assert.ok(dimaMem?.user_id);

    // 5. Редактирование события (title, icon, base_currency) и изменение веса участника
    const editEvRes = await handleExpensesApi(
      new Request(`${baseOrigin}/api/expenses/events/${ev.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Байкал 2027", icon: "🚗", base_currency: "USD" })
      }),
      env,
      owner,
      new URL(`${baseOrigin}/api/expenses/events/${ev.id}`)
    );
    assert.equal(editEvRes.status, 200);
    const edited = (await editEvRes.json()).event;
    assert.equal(edited.title, "Байкал 2027");
    assert.equal(edited.icon, "🚗");
    assert.equal(edited.base_currency, "USD");

    const weightReq = new Request(`${baseOrigin}/api/expenses/events/${ev.id}/members/${annaMem.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_weight: 2 })
    });
    const afterWeight = await (await handleExpensesApi(weightReq, env, owner, new URL(weightReq.url))).json();
    assert.equal(afterWeight.event.members.find(m => m.id === annaMem.id).default_weight, 2);

    // 6. Объединяем Анну и Диму в «Единый кошелёк»
    const mergeReq = new Request(`${baseOrigin}/api/expenses/events/${ev.id}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_ids: [annaMem.id, dimaMem.id] })
    });
    const afterMerge = await (await handleExpensesApi(mergeReq, env, owner, new URL(mergeReq.url))).json();
    assert.equal(afterMerge.event.wallets.length, 1);
    assert.equal(afterMerge.event.wallets[0].member_ids.length, 2);

    // 7. Новый реальный пользователь Борис присоединяется по инвайт-ссылке (без ghost_profiles)
    const inviteGetReq = new Request(`${baseOrigin}/api/expenses/invite/${ev.invite_token}`, { method: "GET" });
    const inviteInfo = await (await handleExpensesApi(inviteGetReq, env, bob, new URL(inviteGetReq.url))).json();
    assert.equal("ghost_profiles" in inviteInfo, false);
    assert.equal(inviteInfo.already_joined, false);

    const claimReq = new Request(`${baseOrigin}/api/expenses/invite/${ev.invite_token}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const claimRes = await handleExpensesApi(claimReq, env, bob, new URL(claimReq.url));
    assert.equal(claimRes.status, 200);
    const joinedEvent = (await claimRes.json()).event;
    assert.ok(joinedEvent.members.some(m => m.telegram_id === 4004));

    // 8. Контакты и копирование реальных участников в новое событие
    const contactsRes = await (await handleExpensesApi(
      new Request(`${baseOrigin}/api/expenses/contacts`, { method: "GET" }),
      env,
      owner,
      new URL(`${baseOrigin}/api/expenses/contacts`)
    )).json();
    assert.ok(contactsRes.contacts.some(c => c.telegram_id === 2002));
    assert.ok(contactsRes.contacts.some(c => c.telegram_id === 3003));

    const copyReq = new Request(`${baseOrigin}/api/expenses/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Весенний выезд",
        copy_from_event_id: ev.id
      })
    });
    const copyData = await (await handleExpensesApi(copyReq, env, owner, new URL(copyReq.url))).json();
    assert.equal(copyData.event.members.length, 4);
    assert.equal(getExpensesErrorResponse(new Error("other")), null);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
