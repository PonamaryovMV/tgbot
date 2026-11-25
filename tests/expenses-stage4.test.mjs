import test from "node:test";
import assert from "node:assert/strict";
import {
  computeEventSettlementPlan,
  handleExpensesApi
} from "../expenses-worker.js";

function createStage4MockD1() {
  const usersByTelegramId = new Map();
  const usersById = new Map();
  const eventsById = new Map();
  const membersById = new Map();
  const expensesById = new Map();
  const splitsById = new Map();
  const settlementsById = new Map();
  const allocationsById = new Map();
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
        if (q.includes("from settlements where id")) {
          const st = settlementsById.get(String(this._params[0] || ""));
          return st ? { ...st } : null;
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
        if (q.includes("from expenses") && q.includes("where event_id = ? and is_deleted = 0")) {
          const eventId = String(this._params[0] || "");
          const rows = [...expensesById.values()]
            .filter(e => e.event_id === eventId && Number(e.is_deleted) === 0);
          return { results: rows };
        }
        if (q.includes("from expense_splits es")) {
          const eventId = String(this._params[0] || "");
          const activeExpenseIds = new Set(
            [...expensesById.values()]
              .filter(e => e.event_id === eventId && Number(e.is_deleted) === 0)
              .map(e => e.id)
          );
          const rows = [...splitsById.values()].filter(s => activeExpenseIds.has(s.expense_id));
          return { results: rows };
        }
        if (q.includes("from settlements s") && q.includes("where sa.event_id = ?")) {
          const eventId = String(this._params[0] || "");
          const rows = [];
          for (const alloc of allocationsById.values()) {
            if (alloc.event_id !== eventId) continue;
            const st = settlementsById.get(alloc.settlement_id);
            if (!st) continue;
            rows.push({
              ...st,
              allocated_amount_minor: alloc.allocated_amount_minor
            });
          }
          return { results: rows };
        }
        if (q.includes("from settlement_allocations where settlement_id = ?")) {
          const settlementId = String(this._params[0] || "");
          const rows = [...allocationsById.values()].filter(a => a.settlement_id === settlementId);
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
        if (q.startsWith("insert into expenses")) {
          const [
            id, eventId, createdByMemberId, operationType, title, category,
            originalAmountMinor, originalCurrency, exchangeRate, baseAmountMinor,
            splitType, itemsJson, splitMetaJson, comment, expenseDate, createdAt
          ] = this._params;
          expensesById.set(String(id), {
            id: String(id),
            event_id: String(eventId),
            created_by_member_id: String(createdByMemberId),
            operation_type: String(operationType),
            title: String(title),
            category: String(category),
            original_amount_minor: Number(originalAmountMinor),
            original_currency: String(originalCurrency),
            exchange_rate: Number(exchangeRate),
            base_amount_minor: Number(baseAmountMinor),
            split_type: String(splitType),
            items_json: String(itemsJson || "[]"),
            split_meta_json: String(splitMetaJson || "{}"),
            comment: String(comment || ""),
            expense_date: String(expenseDate || ""),
            is_deleted: 0,
            created_at: String(createdAt)
          });
          return { success: true };
        }
        if (q.startsWith("insert into expense_splits")) {
          const [id, expenseId, memberId, paidAmountMinor, owedAmountMinor, shareValue] = this._params;
          splitsById.set(String(id), {
            id: String(id),
            expense_id: String(expenseId),
            member_id: String(memberId),
            paid_amount_minor: Number(paidAmountMinor),
            owed_amount_minor: Number(owedAmountMinor),
            share_value: Number(shareValue)
          });
          return { success: true };
        }
        if (q.startsWith("insert into settlements")) {
          const [
            id, fromUserId, toUserId, fromMemberId, toMemberId,
            totalAmountMinor, currency, paymentMethod, comment, createdAt
          ] = this._params;
          const status = "PENDING";
          settlementsById.set(String(id), {
            id: String(id),
            from_user_id: fromUserId ? String(fromUserId) : null,
            to_user_id: toUserId ? String(toUserId) : null,
            from_member_id: String(fromMemberId),
            to_member_id: String(toMemberId),
            total_amount_minor: Number(totalAmountMinor),
            currency: String(currency),
            payment_method: String(paymentMethod || "СБП"),
            comment: String(comment || ""),
            status: String(status || "PENDING"),
            created_at: String(createdAt),
            confirmed_at: null
          });
          return { success: true };
        }
        if (q.startsWith("update settlements set status = 'confirmed'")) {
          const [confirmedAt, settlementId] = this._params;
          const st = settlementsById.get(String(settlementId));
          if (st) {
            st.status = "CONFIRMED";
            st.confirmed_at = String(confirmedAt);
          }
          return { success: true };
        }
        if (q.startsWith("update settlements set status = 'rejected'")) {
          const [settlementId] = this._params;
          const st = settlementsById.get(String(settlementId));
          if (st) st.status = "REJECTED";
          return { success: true };
        }
        if (q.startsWith("update settlements set status = 'cancelled'")) {
          const [settlementId] = this._params;
          const st = settlementsById.get(String(settlementId));
          if (st) st.status = "CANCELLED";
          return { success: true };
        }
        if (q.startsWith("insert into settlement_allocations")) {
          const [id, settlementId, eventId, allocatedAmountMinor] = this._params;
          allocationsById.set(String(id), {
            id: String(id),
            settlement_id: String(settlementId),
            event_id: String(eventId),
            allocated_amount_minor: Number(allocatedAmountMinor)
          });
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

test("Stage 4 Simplify Debts collapses transitive debt chains", () => {
  const members = [
    { id: "m1", member_name: "Алиса" },
    { id: "m2", member_name: "Боб" },
    { id: "m3", member_name: "Чарли" }
  ];
  // Боб должен Алисе 1000, Чарли должен Бобу 1000 -> при упрощении Чарли платит напрямую Алисе 1000
  const ops = [
    {
      splits: [
        { member_id: "m1", paid_amount_minor: 1000, owed_amount_minor: 0 },
        { member_id: "m2", paid_amount_minor: 0, owed_amount_minor: 1000 }
      ]
    },
    {
      splits: [
        { member_id: "m2", paid_amount_minor: 1000, owed_amount_minor: 0 },
        { member_id: "m3", paid_amount_minor: 0, owed_amount_minor: 1000 }
      ]
    }
  ];

  const directPlan = computeEventSettlementPlan(members, ops, [], [], false);
  assert.equal(directPlan.edges.length, 2);

  const simplifiedPlan = computeEventSettlementPlan(members, ops, [], [], true);
  assert.equal(simplifiedPlan.edges.length, 1);
  assert.equal(simplifiedPlan.edges[0].from_unit_id, "m3");
  assert.equal(simplifiedPlan.edges[0].to_unit_id, "m1");
  assert.equal(simplifiedPlan.edges[0].amount_minor, 1000);
});

test("Stage 4 2-step SBP settlement flow: send -> reject -> resend -> confirm", async () => {
  const db = createStage4MockD1();
  const env = { EXPENSES_DB: db };
  const owner = { id: 1001, first_name: "Максим", username: "maxim" };
  const guest = { id: 2002, first_name: "Анна", username: "anna1" };
  const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

  // 1. Создаём событие и приглашаем Анну
  const createRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Поездка", base_currency: "RUB" })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events`)
  );
  const ev = (await createRes.json()).event;

  const claimRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/invite/${ev.invite_token}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: "__new" })
    }),
    env,
    guest,
    new URL(`${baseOrigin}/api/expenses/invite/${ev.invite_token}/claim`)
  );
  const joinedEv = (await claimRes.json()).event;
  const maxMem = joinedEv.members.find(m => m.role === "OWNER");
  const annaMem = joinedEv.members.find(m => m.role === "MEMBER");

  // 2. Максим платит 10 000 ₽ на двоих -> Анна должна 5 000 ₽ (500000 коп.)
  await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/operations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Отель",
        original_amount_minor: 1000000,
        payers: [maxMem.id],
        included_member_ids: [maxMem.id, annaMem.id]
      })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/operations`)
  );

  // Проверяем кросс-событийную сводку у Анны
  const annaDash1 = await (await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/dashboard`, { method: "GET" }),
    env,
    guest,
    new URL(`${baseOrigin}/api/expenses/dashboard`)
  )).json();
  assert.equal(annaDash1.cross_event_debts.length, 1);
  assert.equal(annaDash1.cross_event_debts[0].net_minor, -500000);

  // 3. Анна отправляет перевод 5 000 ₽ -> статус PENDING
  const sendRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: "RUB",
        payment_method: "СБП",
        allocations: [{ event_id: ev.id, to_member_id: maxMem.id, amount_minor: 500000 }]
      })
    }),
    env,
    guest,
    new URL(`${baseOrigin}/api/expenses/settlements`)
  );
  assert.equal(sendRes.status, 201);
  const stId1 = (await sendRes.json()).settlement_id;

  // 4. Максим отклоняет ("Деньги не пришли") -> долг остаётся 5 000 ₽
  const rejectRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements/${stId1}/reject`, { method: "POST" }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/settlements/${stId1}/reject`)
  );
  assert.equal(rejectRes.status, 200);
  assert.equal((await rejectRes.json()).dashboard.summary_by_currency.RUB.owed_to_you_minor, 500000);

  // 5. Анна отправляет повторно, затем отзывает (cancel) -> статус CANCELLED, долг остаётся 5 000 ₽
  const sendResCancel = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: "RUB",
        payment_method: "СБП",
        allocations: [{ event_id: ev.id, to_member_id: maxMem.id, amount_minor: 500000 }]
      })
    }),
    env,
    guest,
    new URL(`${baseOrigin}/api/expenses/settlements`)
  );
  assert.equal(sendResCancel.status, 201);
  const stIdCancel = (await sendResCancel.json()).settlement_id;

  // Максим (получатель) не может вызвать /cancel (только отправитель)
  const failCancelRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements/${stIdCancel}/cancel`, { method: "POST" }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/settlements/${stIdCancel}/cancel`)
  );
  assert.equal(failCancelRes.status, 403);

  // Анна (отправитель) успешно отзывает перевод через /cancel
  const cancelRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements/${stIdCancel}/cancel`, { method: "POST" }),
    env,
    guest,
    new URL(`${baseOrigin}/api/expenses/settlements/${stIdCancel}/cancel`)
  );
  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.ok, true);
  assert.equal(cancelData.status, "CANCELLED");

  // 6. Анна отправляет повторно, Максим подтверждает -> баланс 0
  const sendRes2 = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: "RUB",
        payment_method: "СБП",
        allocations: [{ event_id: ev.id, to_member_id: maxMem.id, amount_minor: 500000 }]
      })
    }),
    env,
    guest,
    new URL(`${baseOrigin}/api/expenses/settlements`)
  );
  const stId2 = (await sendRes2.json()).settlement_id;

  const confirmRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/settlements/${stId2}/confirm`, { method: "POST" }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/settlements/${stId2}/confirm`)
  );
  assert.equal(confirmRes.status, 200);
  const ownerDashFinal = (await confirmRes.json()).dashboard;
  assert.equal(ownerDashFinal.summary_by_currency.RUB.owed_to_you_minor, 0);
  assert.equal(ownerDashFinal.cross_event_debts.length, 0);
});
