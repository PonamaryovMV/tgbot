import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOperationSplits,
  distributeExactMinor,
  handleCoreApi,
  handleExpensesApi
} from "../expenses-worker.js";

function createStage3MockD1() {
  const usersByTelegramId = new Map();
  const usersById = new Map();
  const eventsById = new Map();
  const membersById = new Map();
  const expensesById = new Map();
  const splitsById = new Map();
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
        if (q.includes("from expenses where id = ? and event_id = ?")) {
          const [opId, eventId] = this._params;
          const row = expensesById.get(String(opId || ""));
          if (row && row.event_id === String(eventId || "") && Number(row.is_deleted) === 0) {
            return { ...row };
          }
          return null;
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
        if (q.startsWith("update expenses set operation_type")) {
          const [
            operationType, title, category, originalAmountMinor,
            originalCurrency, exchangeRate, baseAmountMinor,
            splitType, itemsJson, splitMetaJson, comment, expenseDate,
            opId, eventId
          ] = this._params;
          const existing = expensesById.get(String(opId));
          if (existing && existing.event_id === String(eventId)) {
            Object.assign(existing, {
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
              expense_date: String(expenseDate || "")
            });
          }
          return { success: true };
        }
        if (q.startsWith("update expenses set is_deleted = 1")) {
          const [opId, eventId] = this._params;
          const existing = expensesById.get(String(opId));
          if (existing && existing.event_id === String(eventId)) {
            existing.is_deleted = 1;
          }
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
        if (q.startsWith("delete from expense_splits")) {
          const [expenseId] = this._params;
          for (const [id, row] of splitsById.entries()) {
            if (row.expense_id === String(expenseId)) splitsById.delete(id);
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

test("Stage 3 distributeExactMinor distributes remainder cents accurately", () => {
  const res = distributeExactMinor(1000, [
    { member_id: "m1", weight: 1 },
    { member_id: "m2", weight: 1 },
    { member_id: "m3", weight: 1 }
  ]);
  assert.deepEqual(res.map(r => r.amount_minor), [334, 333, 333]);
});

test("Stage 3 computeOperationSplits covers all 5 split modes and transfers", () => {
  const members = [
    { id: "m1", member_name: "Алексей", default_weight: 1 },
    { id: "m2", member_name: "Максим", default_weight: 2 },
    { id: "m3", member_name: "Гоша", default_weight: 1 }
  ];

  // 1. SHARES (веса 1:2:1 на 10000 коп.)
  const sharesRes = computeOperationSplits({
    operationType: "EXPENSE",
    originalAmountMinor: 10000,
    exchangeRate: 1,
    splitType: "SHARES",
    payers: ["m1"],
    includedMemberIds: ["m1", "m2", "m3"],
    weightsMap: { m1: 1, m2: 2, m3: 1 },
    members
  });
  assert.equal(sharesRes.splits.find(s => s.member_id === "m2").owed_amount_minor, 5000);

  // 2. PERCENT (50% / 30% / 20%)
  const pctRes = computeOperationSplits({
    operationType: "EXPENSE",
    originalAmountMinor: 20000,
    exchangeRate: 1,
    splitType: "PERCENT",
    payers: ["m1"],
    percentMap: { m1: 50, m2: 30, m3: 20 },
    members
  });
  assert.equal(pctRes.splits.find(s => s.member_id === "m2").owed_amount_minor, 6000);

  // 3. MANUAL_ITEMS (позиции чека с курсом 2.0)
  const itemsRes = computeOperationSplits({
    operationType: "EXPENSE",
    originalAmountMinor: 0,
    exchangeRate: 2.0,
    splitType: "MANUAL_ITEMS",
    payers: ["m1"],
    items: [
      { title: "Стейк", amount_minor: 3000, member_ids: ["m1", "m2"] },
      { title: "Лимонад", amount_minor: 1000, member_ids: ["m3"] }
    ],
    members
  });
  assert.equal(itemsRes.base_amount_minor, 8000);
  assert.equal(itemsRes.splits.find(s => s.member_id === "m1").owed_amount_minor, 3000);
  assert.equal(itemsRes.splits.find(s => s.member_id === "m3").owed_amount_minor, 2000);

  // 4. TRANSFER
  const trRes = computeOperationSplits({
    operationType: "TRANSFER",
    originalAmountMinor: 5000,
    exchangeRate: 1,
    transferFromId: "m3",
    transferToId: "m1",
    members
  });
  assert.equal(trRes.splits.find(s => s.member_id === "m3").paid_amount_minor, 5000);
  assert.equal(trRes.splits.find(s => s.member_id === "m1").owed_amount_minor, 5000);
});

test("Stage 3 HTTP API creates, updates, deletes operations and enforces SETTLING freeze", async () => {
  const db = createStage3MockD1();
  const env = { EXPENSES_DB: db };
  const owner = { id: 1001, first_name: "Максим", username: "maxim" };
  const anna = { id: 2002, first_name: "Анна", username: "anna1" };
  const baseOrigin = ["https://", "tgbot.ax1ksg94.workers.dev"].join("");

  await handleCoreApi(
    new Request(`${baseOrigin}/api/core/bootstrap`, { method: "GET" }),
    env,
    anna,
    new URL(`${baseOrigin}/api/core/bootstrap`)
  );

  const createEvRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Ужин", base_currency: "RUB", member_telegram_ids: [2002] })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events`)
  );
  const ev = (await createEvRes.json()).event;
  const ownerMem = ev.members.find(m => m.role === "OWNER");
  const goshaMem = ev.members.find(m => m.telegram_id === 2002);

  // Добавляем мультивалютную операцию (100 USD по курсу 90 = 9000 RUB = 900000 коп.)
  const addOpRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/operations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation_type: "EXPENSE",
        title: "Билеты",
        category: "Транспорт",
        original_amount_minor: 10000,
        original_currency: "USD",
        exchange_rate: 90,
        split_type: "EQUAL",
        payers: [ownerMem.id],
        included_member_ids: [ownerMem.id, goshaMem.id]
      })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/operations`)
  );
  assert.equal(addOpRes.status, 201);
  const addOpData = await addOpRes.json();
  assert.equal(addOpData.event.total_spent_minor, 900000);
  assert.equal(addOpData.event.net_balance_minor, 450000);

  // Редактируем операцию
  const opId = addOpData.operation_id;
  const patchOpRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/operations/${opId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Билеты (обновлено)",
        original_amount_minor: 12000,
        original_currency: "USD",
        exchange_rate: 90,
        split_type: "EQUAL",
        payers: [ownerMem.id],
        included_member_ids: [ownerMem.id, goshaMem.id]
      })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/operations/${opId}`)
  );
  assert.equal(patchOpRes.status, 200);
  assert.equal((await patchOpRes.json()).event.total_spent_minor, 1080000);

  // Замораживаем траты (SETTLING) -> добавление новой операции блокируется с 409
  await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SETTLING" })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}`)
  );

  const blockedRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/operations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Лишняя трата",
        original_amount_minor: 1000,
        payers: [ownerMem.id],
        included_member_ids: [ownerMem.id]
      })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/operations`)
  );
  assert.equal(blockedRes.status, 409);

  // Размораживаем и удаляем операцию
  await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" })
    }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}`)
  );

  const delRes = await handleExpensesApi(
    new Request(`${baseOrigin}/api/expenses/events/${ev.id}/operations/${opId}`, { method: "DELETE" }),
    env,
    owner,
    new URL(`${baseOrigin}/api/expenses/events/${ev.id}/operations/${opId}`)
  );
  assert.equal(delRes.status, 200);
  const afterDel = await delRes.json();
  assert.equal(afterDel.event.operations.length, 0);
  assert.equal(afterDel.event.total_spent_minor, 0);
});
