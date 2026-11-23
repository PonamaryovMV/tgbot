import test from "node:test";
import assert from "node:assert/strict";
import {
  handleExpensesApi,
  getExpensesErrorResponse
} from "../expenses-worker.js";

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
        if (q.includes("from users where id")) {
          const row = usersById.get(String(this._params[0] || ""));
          return row ? { ...row } : null;
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

test("Stage 2 event creation, ghost members, weights, unified wallet and invite claim", async () => {
  const db = createStage2MockD1();
  const env = { EXPENSES_DB: db };
  const owner = { id: 1001, first_name: "Максим", username: "maxim" };
  const guest = { id: 2002, first_name: "Анна", username: "anna1" };
  const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

  // 1. Создаём событие с виртуальным участником «Гоша»
  const createReq = new Request(`${baseOrigin}/api/expenses/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Поездка на Байкал",
      icon: "🏕",
      base_currency: "RUB",
      ghost_names: ["Гоша"]
    })
  });
  const createRes = await handleExpensesApi(createReq, env, owner, new URL(createReq.url));
  assert.equal(createRes.status, 201);
  const createdData = await createRes.json();
  const ev = createdData.event;
  assert.equal(ev.title, "Поездка на Байкал");
  assert.equal(ev.members.length, 2);
  const ownerMem = ev.members.find(m => m.role === "OWNER");
  const ghostMem = ev.members.find(m => m.member_name === "Гоша");
  assert.equal(ghostMem.is_ghost, true);

  // 2. Меняем вес Гоши на 2x и добавляем ещё одного участника «Лена»
  const addMemberReq = new Request(`${baseOrigin}/api/expenses/events/${ev.id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_name: "Лена" })
  });
  const afterAddMember = await (await handleExpensesApi(addMemberReq, env, owner, new URL(addMemberReq.url))).json();
  const lenaMem = afterAddMember.event.members.find(m => m.member_name === "Лена");
  assert.ok(lenaMem);

  const weightReq = new Request(`${baseOrigin}/api/expenses/events/${ev.id}/members/${ghostMem.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ default_weight: 2 })
  });
  const afterWeight = await (await handleExpensesApi(weightReq, env, owner, new URL(weightReq.url))).json();
  assert.equal(afterWeight.event.members.find(m => m.id === ghostMem.id).default_weight, 2);

  // 3. Объединяем Гошу и Лену в «Единый кошелёк» и разъединяем обратно
  const mergeReq = new Request(`${baseOrigin}/api/expenses/events/${ev.id}/wallets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_ids: [ghostMem.id, lenaMem.id] })
  });
  const afterMerge = await (await handleExpensesApi(mergeReq, env, owner, new URL(mergeReq.url))).json();
  assert.equal(afterMerge.event.wallets.length, 1);
  assert.equal(afterMerge.event.wallets[0].member_ids.length, 2);

  // 4. Гость открывает инвайт-ссылку и забирает виртуальный профиль «Гоша» (Claim Profile)
  const inviteGetReq = new Request(`${baseOrigin}/api/expenses/invite/${ev.invite_token}`, { method: "GET" });
  const inviteInfo = await (await handleExpensesApi(inviteGetReq, env, guest, new URL(inviteGetReq.url))).json();
  assert.equal(inviteInfo.ghost_profiles.length, 1);
  assert.equal(inviteInfo.ghost_profiles[0].id, ghostMem.id);

  const claimReq = new Request(`${baseOrigin}/api/expenses/invite/${ev.invite_token}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_id: ghostMem.id })
  });
  const claimRes = await handleExpensesApi(claimReq, env, guest, new URL(claimReq.url));
  assert.equal(claimRes.status, 200);
  const claimedEvent = (await claimRes.json()).event;
  assert.equal(claimedEvent.members.find(m => m.id === ghostMem.id).is_ghost, false);

  // 5. Копируем участников из первого события в новое событие
  const copyReq = new Request(`${baseOrigin}/api/expenses/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Весенний выезд",
      copy_from_event_id: ev.id
    })
  });
  const copyData = await (await handleExpensesApi(copyReq, env, owner, new URL(copyReq.url))).json();
  assert.equal(copyData.event.members.length, 3);
  assert.equal(getExpensesErrorResponse(new Error("other")), null);
});
