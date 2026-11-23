import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventCsvExport,
  handleExpensesApi
} from "../expenses-worker.js";

function createStage5MockD1() {
  const usersByTelegramId = new Map();
  const usersById = new Map();
  const eventsById = new Map();
  const membersById = new Map();
  const goalsById = new Map();
  const contributionsById = new Map();
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
        if (q.includes("from events where id")) {
          const ev = eventsById.get(String(this._params[0] || ""));
          return ev ? { ...ev } : null;
        }
        if (q.includes("from event_goals")) {
          const eventId = String(this._params[0] || "");
          const active = [...goalsById.values()]
            .filter(g => g.event_id === eventId && g.status !== "CANCELLED");
          return active.length ? { ...active.at(-1) } : null;
        }
        return null;
      },
      async all() {
        const q = this._sql.toLowerCase();
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
        if (q.includes("from goal_contributions")) {
          const goalId = String(this._params[0] || "");
          const rows = [...contributionsById.values()].filter(c => c.goal_id === goalId);
          return { results: rows };
        }
        if (q.includes("from event_audit_log")) {
          const eventId = String(this._params[0] || "");
          return { results: auditLogs.filter(a => a.event_id === eventId) };
        }
        return { results: [] };
      },
      async run() {
        const q = this._sql.trim().toLowerCase().replace(/\s+/g, " ");
        if (q.startsWith("insert into users")) {
          const [id, telegramId, username, displayName, createdAt, updatedAt] = this._params;
          const rec = {
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
          usersById.set(rec.id, rec);
          usersByTelegramId.set(rec.telegram_id, rec);
          return { success: true };
        }
        if (q.startsWith("insert into events")) {
          const [id, title, description, icon, baseCurrency, creatorId, simplifyDebts, inviteToken, createdAt, updatedAt] = this._params;
          const status = "ACTIVE";
          eventsById.set(String(id), {
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
          });
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
          membersById.set(String(id), {
            id: String(id),
            event_id: String(eventId),
            user_id: userId ? String(userId) : null,
            member_name: String(memberName),
            role: String(role || "MEMBER"),
            default_weight: Number(defaultWeight ?? 1.0),
            linked_payer_member_id: linkedPayerMemberId ? String(linkedPayerMemberId) : null,
            joined_at: String(joinedAt)
          });
          return { success: true };
        }
        if (q.startsWith("update event_goals set status = 'cancelled'")) {
          const [eventId] = this._params;
          for (const g of goalsById.values()) {
            if (g.event_id === String(eventId) && g.status === "ACTIVE") g.status = "CANCELLED";
          }
          return { success: true };
        }
        if (q.startsWith("insert into event_goals")) {
          const [id, eventId, title, targetPerMemberMinor, receiverMemberId, status] = this._params;
          goalsById.set(String(id), {
            id: String(id),
            event_id: String(eventId),
            title: String(title),
            target_per_member_minor: Number(targetPerMemberMinor),
            receiver_member_id: String(receiverMemberId),
            status: String(status || "ACTIVE")
          });
          return { success: true };
        }
        if (q.startsWith("insert into goal_contributions")) {
          const [id, goalId, memberId, status] = this._params;
          contributionsById.set(String(id), {
            id: String(id),
            goal_id: String(goalId),
            member_id: String(memberId),
            status: String(status || "UNPAID"),
            settlement_id: null
          });
          return { success: true };
        }
        if (q.startsWith("update goal_contributions set status = ?")) {
          const [status, goalId, memberId] = this._params;
          for (const c of contributionsById.values()) {
            if (c.goal_id === String(goalId) && c.member_id === String(memberId)) {
              c.status = String(status);
            }
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

test("Stage 5 buildEventCsvExport formats BOM, semicolons, balances and transfers", () => {
  const csv = buildEventCsvExport({
    title: "Новый год 2027",
    base_currency: "RUB",
    status: "ACTIVE",
    members: [
      { id: "m1", member_name: "Максим" },
      { id: "m2", member_name: "Анна" }
    ],
    units: [
      { id: "m1", name: "Максим", is_wallet: false },
      { id: "m2", name: "Анна", is_wallet: false }
    ],
    unit_balances_minor: { m1: 500000, m2: -500000 },
    operations: [
      {
        expense_date: "2026-12-31",
        operation_type: "EXPENSE",
        title: "Коттедж",
        category: "Жильё",
        original_amount_minor: 1000000,
        original_currency: "RUB",
        exchange_rate: 1,
        base_amount_minor: 1000000,
        payers: ["m1"],
        shares_minor: { m1: 500000, m2: 500000 }
      }
    ],
    settlement_edges: [
      { from_unit_id: "m2", to_unit_id: "m1", amount_minor: 500000, pending: false }
    ]
  });

  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("\"Новый год 2027\""));
  assert.ok(csv.includes("\"Коттедж\";\"Жильё\";\"10000.00\";\"RUB\""));
  assert.ok(csv.includes("\"Анна\";\"Максим\";\"5000.00\";\"К переводу\""));
});

test("Stage 5 target goals creation, contribution status updates and HTTP CSV endpoint", async () => {
  const db = createStage5MockD1();
  const env = { EXPENSES_DB: db };
  const owner = { id: 1001, first_name: "Максим", username: "maxim" };
  const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

  const createEvRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Подарок боссу", ghost_names: ["Гоша"] })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events`)
  );
  const ev = (await createEvRes.json()).event;
  const gosha = ev.members.find(m => m.member_name === "Гоша");

  const goalRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/goals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "На кофемашину", target_per_member_minor: 300000 })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/goals`)
  );
  assert.equal(goalRes.status, 201);
  const afterGoal = (await goalRes.json()).event;
  assert.equal(afterGoal.goal.paid_count, 1);
  assert.equal(afterGoal.goal.total_members, 2);

  const patchContribRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/goals/${afterGoal.goal.id}/contributions/${gosha.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAID" })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/goals/${afterGoal.goal.id}/contributions/${gosha.id}`)
  );
  assert.equal(patchContribRes.status, 200);
  const afterPaid = (await patchContribRes.json()).event;
  assert.equal(afterPaid.goal.paid_count, 2);
  assert.equal(afterPaid.goal.collected_minor, 600000);

  const csvRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/export.csv`, { method: "GET" }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/export.csv`)
  );
  assert.equal(csvRes.status, 200);
  assert.ok((csvRes.headers.get("Content-Type") || "").includes("text/csv"));
  const csvBody = await csvRes.text();
  assert.ok(csvBody.includes("Подарок боссу"));
});
