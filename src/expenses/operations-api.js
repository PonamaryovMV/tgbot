import { cleanPlainText, json } from "../../worker.js";
import {
  ExpensesApiError,
  sanitizeCurrency,
  sanitizeDateISO
} from "./schema.js";
import {
  getUnitHeadId,
  computeOperationSplits
} from "./splits.js";
import {
  appendAuditLog,
  requireEventAccess,
  loadFullEventDetail,
  listUserEventsSummary
} from "./queries.js";

export async function handleOperationsRoute(request, db, user, path, method) {
  const opsCollectionMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/operations$/);
  if (opsCollectionMatch && method === "POST") {
    const eventId = opsCollectionMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    if (eventRow.status === "SETTLING" || eventRow.status === "ARCHIVED") {
      throw new ExpensesApiError(409, "Event expenses are frozen during settlement or archive");
    }

    const title = cleanPlainText(body.title, 100);
    if (!title) {
      throw new ExpensesApiError(400, "Operation title is required");
    }
    const category = cleanPlainText(body.category, 40) || "Другое";
    const originalCurrency = sanitizeCurrency(body.original_currency, eventRow.base_currency || "RUB");
    const exchangeRate = originalCurrency === (eventRow.base_currency || "RUB")
      ? 1.0
      : Number(body.exchange_rate || 0);
    const comment = cleanPlainText(body.comment, 240);
    const expenseDate = sanitizeDateISO(body.expense_date);

    const computed = computeOperationSplits({
      operationType: body.operation_type || "EXPENSE",
      originalAmountMinor: body.original_amount_minor,
      exchangeRate,
      splitType: body.split_type || "EQUAL",
      payers: body.payers,
      transferFromId: body.transfer_from_id,
      transferToId: body.transfer_to_id,
      includedMemberIds: body.included_member_ids,
      weightsMap: body.weights_map,
      exactMinorMap: body.exact_minor_map,
      percentMap: body.percent_map,
      items: body.items,
      members
    });

    const opId = crypto.randomUUID();
    const now = new Date().toISOString();
    const splitMeta = {
      included_member_ids: Array.isArray(body.included_member_ids) ? body.included_member_ids : [],
      weights_map: body.weights_map || {},
      exact_minor_map: body.exact_minor_map || {},
      percent_map: body.percent_map || {},
      transfer_from_id: body.transfer_from_id || null,
      transfer_to_id: body.transfer_to_id || null
    };

    await db
      .prepare(
        `INSERT INTO expenses (
          id, event_id, created_by_member_id, operation_type, title, category,
          original_amount_minor, original_currency, exchange_rate, base_amount_minor,
          split_type, items_json, split_meta_json, comment, expense_date, is_deleted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(
        opId,
        eventId,
        viewerMember.id,
        computed.operation_type,
        title,
        category,
        computed.original_amount_minor,
        originalCurrency,
        computed.exchange_rate,
        computed.base_amount_minor,
        computed.split_type,
        JSON.stringify(computed.normalized_items),
        JSON.stringify(splitMeta),
        comment,
        expenseDate,
        now
      )
      .run();

    for (const s of computed.splits) {
      await db
        .prepare(
          `INSERT INTO expense_splits (
            id, expense_id, member_id, paid_amount_minor, owed_amount_minor, share_value
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          opId,
          s.member_id,
          s.paid_amount_minor,
          s.owed_amount_minor,
          s.share_value
        )
        .run();
    }

    const opLabel = computed.operation_type === "TRANSFER"
      ? "перевод"
      : computed.operation_type === "PREPAYMENT"
        ? "пополнение котла"
        : "трату";
    const humanAmt = `${Math.round(computed.original_amount_minor / 100)} ${originalCurrency}`;
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "OPERATION_ADDED", {
      expense_id: opId,
      operation_type: computed.operation_type,
      text: `${viewerMember.member_name} добавил(а) ${opLabel} «${title}» — ${humanAmt}`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({
      ok: true,
      operation_id: opId,
      event: eventDetail
    }, 201);
  }

  const opItemMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/operations\/([A-Za-z0-9_-]+)$/);
  if (opItemMatch && method === "PATCH") {
    const [, eventId, opId] = opItemMatch;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    if (eventRow.status === "SETTLING" || eventRow.status === "ARCHIVED") {
      throw new ExpensesApiError(409, "Event expenses are frozen during settlement or archive");
    }

    const existing = await db
      .prepare("SELECT * FROM expenses WHERE id = ? AND event_id = ? AND is_deleted = 0")
      .bind(opId, eventId)
      .first();
    if (!existing) {
      throw new ExpensesApiError(404, "Operation not found");
    }

    const title = body.title !== undefined ? cleanPlainText(body.title, 100) : existing.title;
    if (!title) {
      throw new ExpensesApiError(400, "Operation title is required");
    }
    const category = body.category !== undefined ? (cleanPlainText(body.category, 40) || "Другое") : existing.category;
    const originalCurrency = body.original_currency !== undefined
      ? sanitizeCurrency(body.original_currency, eventRow.base_currency || "RUB")
      : existing.original_currency;
    const exchangeRate = originalCurrency === (eventRow.base_currency || "RUB")
      ? 1.0
      : Number(body.exchange_rate !== undefined ? body.exchange_rate : existing.exchange_rate);
    const comment = body.comment !== undefined ? cleanPlainText(body.comment, 240) : (existing.comment || "");
    const expenseDate = body.expense_date !== undefined ? sanitizeDateISO(body.expense_date) : existing.expense_date;

    const computed = computeOperationSplits({
      operationType: body.operation_type || existing.operation_type || "EXPENSE",
      originalAmountMinor: body.original_amount_minor !== undefined ? body.original_amount_minor : existing.original_amount_minor,
      exchangeRate,
      splitType: body.split_type || existing.split_type || "EQUAL",
      payers: body.payers,
      transferFromId: body.transfer_from_id,
      transferToId: body.transfer_to_id,
      includedMemberIds: body.included_member_ids,
      weightsMap: body.weights_map,
      exactMinorMap: body.exact_minor_map,
      percentMap: body.percent_map,
      items: body.items,
      members
    });

    const now = new Date().toISOString();
    const splitMeta = {
      included_member_ids: Array.isArray(body.included_member_ids) ? body.included_member_ids : [],
      weights_map: body.weights_map || {},
      exact_minor_map: body.exact_minor_map || {},
      percent_map: body.percent_map || {},
      transfer_from_id: body.transfer_from_id || null,
      transfer_to_id: body.transfer_to_id || null
    };

    await db
      .prepare(
        `UPDATE expenses
         SET operation_type = ?, title = ?, category = ?, original_amount_minor = ?,
             original_currency = ?, exchange_rate = ?, base_amount_minor = ?,
             split_type = ?, items_json = ?, split_meta_json = ?, comment = ?, expense_date = ?
         WHERE id = ? AND event_id = ?`
      )
      .bind(
        computed.operation_type,
        title,
        category,
        computed.original_amount_minor,
        originalCurrency,
        computed.exchange_rate,
        computed.base_amount_minor,
        computed.split_type,
        JSON.stringify(computed.normalized_items),
        JSON.stringify(splitMeta),
        comment,
        expenseDate,
        opId,
        eventId
      )
      .run();

    await db.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(opId).run();
    for (const s of computed.splits) {
      await db
        .prepare(
          `INSERT INTO expense_splits (
            id, expense_id, member_id, paid_amount_minor, owed_amount_minor, share_value
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          opId,
          s.member_id,
          s.paid_amount_minor,
          s.owed_amount_minor,
          s.share_value
        )
        .run();
    }

    const humanAmt = `${Math.round(computed.original_amount_minor / 100)} ${originalCurrency}`;
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "OPERATION_UPDATED", {
      expense_id: opId,
      text: `${viewerMember.member_name} изменил(а) операцию «${title}» — ${humanAmt}`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  if (opItemMatch && method === "DELETE") {
    const [, eventId, opId] = opItemMatch;
    const { eventRow, viewerMember } = await requireEventAccess(db, eventId, user.id);
    if (eventRow.status === "SETTLING" || eventRow.status === "ARCHIVED") {
      throw new ExpensesApiError(409, "Event expenses are frozen during settlement or archive");
    }

    const existing = await db
      .prepare("SELECT * FROM expenses WHERE id = ? AND event_id = ? AND is_deleted = 0")
      .bind(opId, eventId)
      .first();
    if (!existing) {
      throw new ExpensesApiError(404, "Operation not found");
    }

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE expenses SET is_deleted = 1 WHERE id = ? AND event_id = ?")
      .bind(opId, eventId)
      .run();

    const humanAmt = `${Math.round((Number(existing.original_amount_minor) || 0) / 100)} ${existing.original_currency || "RUB"}`;
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "OPERATION_DELETED", {
      expense_id: opId,
      text: `${viewerMember.member_name} удалил(а) операцию «${existing.title}» — ${humanAmt}`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  if (path === "/api/expenses/settlements" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const currency = sanitizeCurrency(body.currency, user.default_currency || "RUB");
    const paymentMethod = cleanPlainText(body.payment_method, 32) || "СБП";
    const comment = cleanPlainText(body.comment, 240);
    const rawAllocations = Array.isArray(body.allocations) ? body.allocations : [];
    if (rawAllocations.length === 0) {
      throw new ExpensesApiError(400, "Select at least one event allocation");
    }

    const validAllocs = [];
    let totalMinor = 0;
    for (const raw of rawAllocations) {
      const evId = cleanPlainText(raw?.event_id, 64);
      const amtMinor = Math.round(Number(raw?.amount_minor) || 0);
      if (!evId || amtMinor <= 0) continue;
      const access = await requireEventAccess(db, evId, user.id);
      if (access.eventRow.base_currency !== currency) {
        throw new ExpensesApiError(400, "All allocated events must share the settlement currency");
      }
      const fromUnitId = getUnitHeadId(access.members, access.viewerMember.id);
      const toMemberId = cleanPlainText(raw?.to_member_id, 64);
      const toMember = access.members.find(m => m.id === toMemberId);
      if (!toMember) {
        throw new ExpensesApiError(404, "Recipient member not found in event");
      }
      const toUnitId = getUnitHeadId(access.members, toMember.id);
      if (fromUnitId === toUnitId) {
        throw new ExpensesApiError(400, "Cannot send settlement within the same unified wallet");
      }
      validAllocs.push({
        event_id: evId,
        from_member_id: fromUnitId,
        to_member_id: toUnitId,
        to_user_id: toMember.user_id || null,
        amount_minor: amtMinor
      });
      totalMinor += amtMinor;
    }

    if (validAllocs.length === 0 || totalMinor <= 0) {
      throw new ExpensesApiError(400, "Settlement amount must be positive");
    }

    const settlementId = crypto.randomUUID();
    const now = new Date().toISOString();
    const first = validAllocs[0];

    await db
      .prepare(
        `INSERT INTO settlements (
          id, from_user_id, to_user_id, from_member_id, to_member_id,
          total_amount_minor, currency, payment_method, comment, status, created_at, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, NULL)`
      )
      .bind(
        settlementId,
        user.id,
        first.to_user_id,
        first.from_member_id,
        first.to_member_id,
        totalMinor,
        currency,
        paymentMethod,
        comment,
        now
      )
      .run();

    for (const alloc of validAllocs) {
      await db
        .prepare(
          `INSERT INTO settlement_allocations (id, settlement_id, event_id, allocated_amount_minor)
           VALUES (?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), settlementId, alloc.event_id, alloc.amount_minor)
        .run();

      await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, alloc.event_id).run();
      await appendAuditLog(db, alloc.event_id, user.id, "SETTLEMENT_SENT", {
        settlement_id: settlementId,
        amount_minor: alloc.amount_minor,
        text: `${user.display_name} отправил(а) перевод ${Math.round(alloc.amount_minor / 100)} ${currency} (${paymentMethod}) — ожидает подтверждения`
      });
    }

    const dashboard = await listUserEventsSummary(db, user.id);
    return json({ ok: true, settlement_id: settlementId, dashboard }, 201);
  }

  const settleConfirmMatch = path.match(/^\/api\/expenses\/settlements\/([A-Za-z0-9_-]+)\/confirm$/);
  if (settleConfirmMatch && method === "POST") {
    const settlementId = settleConfirmMatch[1];
    const st = await db.prepare("SELECT * FROM settlements WHERE id = ?").bind(settlementId).first();
    if (!st) throw new ExpensesApiError(404, "Settlement not found");
    if (st.status !== "PENDING") throw new ExpensesApiError(409, "Settlement is already processed");

    const allocRes = await db
      .prepare("SELECT event_id, allocated_amount_minor FROM settlement_allocations WHERE settlement_id = ?")
      .bind(settlementId)
      .all();
    const allocs = Array.isArray(allocRes?.results) ? allocRes.results : [];
    for (const a of allocs) {
      const access = await requireEventAccess(db, a.event_id, user.id);
      const viewerUnitId = getUnitHeadId(access.members, access.viewerMember.id);
      const toUnitId = getUnitHeadId(access.members, st.to_member_id);
      if (viewerUnitId !== toUnitId && access.viewerMember.role !== "OWNER") {
        throw new ExpensesApiError(403, "Only recipient can confirm this settlement");
      }
    }

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE settlements SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?")
      .bind(now, settlementId)
      .run();

    for (const a of allocs) {
      await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, a.event_id).run();
      await appendAuditLog(db, a.event_id, user.id, "SETTLEMENT_CONFIRMED", {
        settlement_id: settlementId,
        text: `${user.display_name} подтвердил(а) получение перевода ${Math.round((Number(a.allocated_amount_minor) || 0) / 100)} ${st.currency}`
      });
    }

    const dashboard = await listUserEventsSummary(db, user.id);
    return json({ ok: true, status: "CONFIRMED", dashboard });
  }

  const settleRejectMatch = path.match(/^\/api\/expenses\/settlements\/([A-Za-z0-9_-]+)\/reject$/);
  if (settleRejectMatch && method === "POST") {
    const settlementId = settleRejectMatch[1];
    const st = await db.prepare("SELECT * FROM settlements WHERE id = ?").bind(settlementId).first();
    if (!st) throw new ExpensesApiError(404, "Settlement not found");
    if (st.status !== "PENDING") throw new ExpensesApiError(409, "Settlement is already processed");

    const allocRes = await db
      .prepare("SELECT event_id, allocated_amount_minor FROM settlement_allocations WHERE settlement_id = ?")
      .bind(settlementId)
      .all();
    const allocs = Array.isArray(allocRes?.results) ? allocRes.results : [];
    for (const a of allocs) {
      const access = await requireEventAccess(db, a.event_id, user.id);
      const viewerUnitId = getUnitHeadId(access.members, access.viewerMember.id);
      const toUnitId = getUnitHeadId(access.members, st.to_member_id);
      if (viewerUnitId !== toUnitId && access.viewerMember.role !== "OWNER") {
        throw new ExpensesApiError(403, "Only recipient can reject this settlement");
      }
    }

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE settlements SET status = 'REJECTED' WHERE id = ?")
      .bind(settlementId)
      .run();

    for (const a of allocs) {
      await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, a.event_id).run();
      await appendAuditLog(db, a.event_id, user.id, "SETTLEMENT_REJECTED", {
        settlement_id: settlementId,
        text: `${user.display_name} отклонил(а) перевод ${Math.round((Number(a.allocated_amount_minor) || 0) / 100)} ${st.currency} — деньги не пришли`
      });
    }

    const dashboard = await listUserEventsSummary(db, user.id);
    return json({ ok: true, status: "REJECTED", dashboard });
  }

  return null;
}
