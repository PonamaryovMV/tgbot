import {
  cleanPlainText,
  json,
  normalizeUsername,
  addExpenseContact,
  requestTelegramUserSelection
} from "../../worker.js";
import {
  EVENT_STATUSES,
  CONTRIBUTION_STATUSES,
  ExpensesApiError,
  sanitizeCurrency,
  sanitizeEventIcon,
  sanitizeOptionalDateISO,
  sanitizeWeight,
  generateInviteToken
} from "./schema.js";
import {
  appendAuditLog,
  persistEventDate,
  loadEventMembers,
  loadEventOperations,
  loadEventSettlements,
  requireEventAccess,
  serializeEventDetail,
  loadFullEventDetail,
  listUserEventsSummary,
  buildEventCsvExport,
  resolveRealUserForExpenses,
  listExpensesContacts
} from "./queries.js";

export async function handleEventsRoute(request, db, user, path, method, env = null) {
  if (path === "/api/expenses/health" && method === "GET") {
    return json({
      ok: true,
      module: "expenses",
      stage: 5,
      tables_count: 9
    });
  }

  if (path === "/api/expenses/dashboard" && method === "GET") {
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({ ok: true, stage: 5, user, ...dashboard });
  }

  if (path === "/api/expenses/contacts" && method === "GET") {
    const contacts = await listExpensesContacts(db, env, user);
    return json({ ok: true, contacts });
  }

  if (path === "/api/expenses/contacts/resolve" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const rawUsername = String(body.username || "").trim();
    const rawTelegramId = body.telegram_id;
    if (!rawUsername && !rawTelegramId) {
      throw new ExpensesApiError(400, "Specify @username or telegram_id");
    }
    const normalizedUsername = rawUsername ? normalizeUsername(rawUsername, true) : "";
    const resolved = await resolveRealUserForExpenses(db, env, {
      telegramId: rawTelegramId,
      username: normalizedUsername
    });

    if (resolved) {
      if (Number(resolved.telegram_id) === Number(user.telegram_id)) {
        throw new ExpensesApiError(400, "You cannot add yourself");
      }
      if (env?.DB) {
        await addExpenseContact(env, user.telegram_id, resolved.telegram_id);
      }
      return json({
        ok: true,
        status: "ok",
        user: {
          id: resolved.id,
          telegram_id: resolved.telegram_id,
          username: resolved.username || "",
          display_name: resolved.display_name
        }
      });
    }

    if (env?.BOT_TOKEN && env?.DB) {
      const selection = await requestTelegramUserSelection(env, user.telegram_id, {
        purpose: "expense_contact",
        requestedUsername: normalizedUsername
      });
      return json(selection, 202);
    }

    throw new ExpensesApiError(404, "User not found");
  }

  if (path === "/api/expenses/contacts/request" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!env?.BOT_TOKEN || !env?.DB) {
      throw new ExpensesApiError(503, "Telegram user selection is unavailable");
    }
    const eventId = cleanPlainText(body?.event_id, 64);
    if (eventId) {
      await requireEventAccess(db, eventId, user.id);
      const selection = await requestTelegramUserSelection(env, user.telegram_id, {
        purpose: "expense_member",
        eventId
      });
      return json(selection, 202);
    }
    const selection = await requestTelegramUserSelection(env, user.telegram_id, {
      purpose: "expense_contact"
    });
    return json(selection, 202);
  }

  if (path === "/api/expenses/events" && method === "GET") {
    const dashboard = await listUserEventsSummary(db, user.id);
    return json({
      ok: true,
      active_events: dashboard.active_events,
      archived_events: dashboard.archived_events
    });
  }

  if (path === "/api/expenses/events" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const title = cleanPlainText(body.title, 80);
    if (!title) {
      throw new ExpensesApiError(400, "Event title is required");
    }
    const hasGhosts = Array.isArray(body.ghost_names)
      ? body.ghost_names.some(v => String(v || "").trim() !== "")
      : Boolean(String(body.ghost_names || "").trim());
    if (hasGhosts) {
      throw new ExpensesApiError(400, "Unregistered members are not supported. Add real Telegram users.");
    }

    const description = cleanPlainText(body.description, 240);
    const icon = sanitizeEventIcon(body.icon);
    const eventDate = sanitizeOptionalDateISO(body.event_date);
    const baseCurrency = sanitizeCurrency(body.base_currency, user.default_currency || "RUB");
    const simplifyDebts = body.simplify_debts === false || body.simplify_debts === 0 ? 0 : 1;

    const requestedInputs = [];
    if (Array.isArray(body.member_telegram_ids)) {
      for (const tgId of body.member_telegram_ids) requestedInputs.push({ telegramId: tgId });
    }
    if (Array.isArray(body.usernames)) {
      for (const uname of body.usernames) requestedInputs.push({ username: uname });
    }
    if (Array.isArray(body.members)) {
      for (const item of body.members) {
        if (item && typeof item === "object") {
          requestedInputs.push({ telegramId: item.telegram_id, username: item.username });
        }
      }
    }

    const resolvedInitialMembers = [];
    const seenRequestedUserIds = new Set([user.id]);
    for (const reqItem of requestedInputs) {
      const resolved = await resolveRealUserForExpenses(db, env, reqItem);
      if (!resolved) {
        throw new ExpensesApiError(404, "One or more selected Telegram users were not found");
      }
      if (seenRequestedUserIds.has(resolved.id)) continue;
      seenRequestedUserIds.add(resolved.id);
      resolvedInitialMembers.push(resolved);
    }

    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const inviteToken = generateInviteToken();

    await db
      .prepare(
        `INSERT INTO events (
          id, title, description, icon, base_currency, creator_id,
          simplify_debts, status, invite_token, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
      )
      .bind(eventId, title, description, icon, baseCurrency, user.id, simplifyDebts, inviteToken, now, now)
      .run();

    if (eventDate) {
      await persistEventDate(db, eventId, eventDate);
    }

    const ownerMemberId = crypto.randomUUID();
    const ownerName = cleanPlainText(body.owner_name, 64) || user.display_name || "Участник";
    await db
      .prepare(
        `INSERT INTO event_members (
          id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
        ) VALUES (?, ?, ?, ?, 'OWNER', 1.0, NULL, ?)`
      )
      .bind(ownerMemberId, eventId, user.id, ownerName, now)
      .run();

    const seenUserIds = new Set([user.id]);

    const copyFromEventId = cleanPlainText(body.copy_from_event_id, 64);
    if (copyFromEventId) {
      const sourceAccess = await requireEventAccess(db, copyFromEventId, user.id).catch(() => null);
      if (sourceAccess) {
        for (const srcMember of sourceAccess.members) {
          if (!srcMember.user_id || seenUserIds.has(srcMember.user_id)) continue;
          seenUserIds.add(srcMember.user_id);

          await db
            .prepare(
              `INSERT INTO event_members (
                id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
              ) VALUES (?, ?, ?, ?, 'MEMBER', ?, NULL, ?)`
            )
            .bind(
              crypto.randomUUID(),
              eventId,
              srcMember.user_id,
              srcMember.member_name,
              sanitizeWeight(srcMember.default_weight, 1.0),
              now
            )
            .run();
        }
      }
    }

    for (const memberUser of resolvedInitialMembers) {
      if (seenUserIds.has(memberUser.id)) continue;
      seenUserIds.add(memberUser.id);

      await db
        .prepare(
          `INSERT INTO event_members (
            id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
          ) VALUES (?, ?, ?, ?, 'MEMBER', 1.0, NULL, ?)`
        )
        .bind(crypto.randomUUID(), eventId, memberUser.id, memberUser.display_name || "Участник", now)
        .run();

      if (env?.DB) {
        await addExpenseContact(env, user.telegram_id, memberUser.telegram_id);
      }
    }

    await appendAuditLog(db, eventId, user.id, "EVENT_CREATED", {
      text: `${ownerName} создал(а) событие «${title}»`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail }, 201);
  }

  const inviteGetMatch = path.match(/^\/api\/expenses\/invite\/([A-Za-z0-9_-]+)$/);
  if (inviteGetMatch && method === "GET") {
    const token = inviteGetMatch[1];
    const eventRow = await db
      .prepare("SELECT * FROM events WHERE invite_token = ?")
      .bind(token)
      .first();
    if (!eventRow) {
      throw new ExpensesApiError(404, "Invite link is invalid or expired");
    }
    const members = await loadEventMembers(db, eventRow.id);
    const existingMember = members.find(m => m.user_id === user.id) || null;

    return json({
      ok: true,
      event: {
        id: eventRow.id,
        title: eventRow.title,
        description: eventRow.description || "",
        icon: eventRow.icon || "🎉",
        event_date: eventRow.event_date || "",
        base_currency: eventRow.base_currency || "RUB",
        status: eventRow.status || "ACTIVE",
        invite_token: eventRow.invite_token,
        members_count: members.length
      },
      already_joined: Boolean(existingMember),
      viewer_member: existingMember
    });
  }

  const inviteClaimMatch = path.match(/^\/api\/expenses\/invite\/([A-Za-z0-9_-]+)\/claim$/);
  if (inviteClaimMatch && method === "POST") {
    const token = inviteClaimMatch[1];
    const body = await request.json().catch(() => ({}));
    const eventRow = await db
      .prepare("SELECT * FROM events WHERE invite_token = ?")
      .bind(token)
      .first();
    if (!eventRow) {
      throw new ExpensesApiError(404, "Invite link is invalid or expired");
    }

    const members = await loadEventMembers(db, eventRow.id);
    const alreadyMember = members.find(m => m.user_id === user.id);
    if (alreadyMember) {
      const eventDetail = await loadFullEventDetail(db, eventRow.id, user.id);
      return json({
        ok: true,
        already_joined: true,
        event: eventDetail
      });
    }

    const now = new Date().toISOString();
    const joinName = cleanPlainText(body?.member_name, 64) || user.display_name || "Участник";
    const newMemberId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO event_members (
          id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
        ) VALUES (?, ?, ?, ?, 'MEMBER', 1.0, NULL, ?)`
      )
      .bind(newMemberId, eventRow.id, user.id, joinName, now)
      .run();

    await appendAuditLog(db, eventRow.id, user.id, "MEMBER_JOINED", {
      member_id: newMemberId,
      text: `${joinName} присоединился(ась) к событию по инвайт-ссылке`
    });

    await db
      .prepare("UPDATE events SET updated_at = ? WHERE id = ?")
      .bind(now, eventRow.id)
      .run();

    const eventDetail = await loadFullEventDetail(db, eventRow.id, user.id);
    return json({
      ok: true,
      already_joined: false,
      event: eventDetail
    });
  }

  const exportCsvMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/export\.csv$/);
  if (exportCsvMatch && method === "GET") {
    const eventId = exportCsvMatch[1];
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    const operations = await loadEventOperations(db, eventId);
    const settlements = await loadEventSettlements(db, eventId);
    const detail = serializeEventDetail(eventRow, members, viewerMember, operations, [], settlements, null);
    const csv = buildEventCsvExport(detail);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="event_${eventId}.csv"`,
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  const eventMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)$/);
  if (eventMatch && method === "GET") {
    const eventDetail = await loadFullEventDetail(db, eventMatch[1], user.id);
    return json({ ok: true, event: eventDetail });
  }

  if (eventMatch && method === "PATCH") {
    const eventId = eventMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow } = await requireEventAccess(db, eventId, user.id, { requireAdmin: true });
    const now = new Date().toISOString();

    const title = body.title !== undefined ? (cleanPlainText(body.title, 80) || eventRow.title) : eventRow.title;
    const description = body.description !== undefined ? cleanPlainText(body.description, 240) : (eventRow.description || "");
    const icon = body.icon !== undefined ? sanitizeEventIcon(body.icon) : (eventRow.icon || "🎉");
    const eventDate = body.event_date !== undefined
      ? sanitizeOptionalDateISO(body.event_date)
      : (eventRow.event_date || "");
    const baseCurrency = body.base_currency !== undefined
      ? sanitizeCurrency(body.base_currency, eventRow.base_currency)
      : eventRow.base_currency;
    const simplifyDebts = body.simplify_debts !== undefined
      ? (body.simplify_debts ? 1 : 0)
      : Number(eventRow.simplify_debts ?? 1);
    let status = eventRow.status || "ACTIVE";
    if (body.status !== undefined) {
      const nextStatus = String(body.status).trim().toUpperCase();
      if (!EVENT_STATUSES.includes(nextStatus)) {
        throw new ExpensesApiError(400, "Invalid event status");
      }
      status = nextStatus;
    }

    await db
      .prepare(
        `UPDATE events
         SET title = ?, description = ?, icon = ?, base_currency = ?, simplify_debts = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(title, description, icon, baseCurrency, simplifyDebts, status, now, eventId)
      .run();

    if (body.event_date !== undefined && eventDate !== (eventRow.event_date || "")) {
      await persistEventDate(db, eventId, eventDate);
    }

    if (status !== eventRow.status) {
      const statusText = status === "ARCHIVED"
        ? "Событие перемещено в архив"
        : status === "SETTLING"
          ? "Траты заморожены — идут расчёты"
          : "Событие активно";
      await appendAuditLog(db, eventId, user.id, "STATUS_CHANGED", { status, text: statusText });
    } else if (body.simplify_debts !== undefined && simplifyDebts !== Number(eventRow.simplify_debts ?? 1)) {
      await appendAuditLog(db, eventId, user.id, "SIMPLIFY_TOGGLED", {
        simplify_debts: Boolean(simplifyDebts),
        text: simplifyDebts ? "Включено упрощение долгов" : "Включены прямые долги"
      });
    } else if (
      title !== eventRow.title ||
      icon !== (eventRow.icon || "🎉") ||
      eventDate !== (eventRow.event_date || "") ||
      baseCurrency !== eventRow.base_currency ||
      description !== (eventRow.description || "")
    ) {
      await appendAuditLog(db, eventId, user.id, "EVENT_UPDATED", {
        title,
        icon,
        event_date: eventDate,
        base_currency: baseCurrency,
        text: `Параметры события «${title}» обновлены`
      });
    }

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  const goalsMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/goals$/);
  if (goalsMatch && method === "POST") {
    const eventId = goalsMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, user.id);
    const title = cleanPlainText(body.title, 100);
    if (!title) throw new ExpensesApiError(400, "Goal title is required");
    const targetMinor = Math.round(Number(body.target_per_member_minor) || 0);
    if (targetMinor <= 0) throw new ExpensesApiError(400, "Target amount per member must be positive");
    const receiverMemberId = members.some(m => m.id === body.receiver_member_id)
      ? body.receiver_member_id
      : viewerMember.id;

    await db
      .prepare("UPDATE event_goals SET status = 'CANCELLED' WHERE event_id = ? AND status = 'ACTIVE'")
      .bind(eventId)
      .run();

    const goalId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO event_goals (id, event_id, title, target_per_member_minor, receiver_member_id, status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
      )
      .bind(goalId, eventId, title, targetMinor, receiverMemberId)
      .run();

    for (const m of members) {
      const initialStatus = m.id === receiverMemberId ? "PAID" : "UNPAID";
      await db
        .prepare(
          `INSERT INTO goal_contributions (id, goal_id, member_id, status, settlement_id)
           VALUES (?, ?, ?, ?, NULL)`
        )
        .bind(crypto.randomUUID(), goalId, m.id, initialStatus)
        .run();
    }

    const now = new Date().toISOString();
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "GOAL_CREATED", {
      goal_id: goalId,
      text: `${viewerMember.member_name} открыл(а) целевой сбор «${title}» по ${Math.round(targetMinor / 100)} ${eventRow.base_currency || "RUB"}`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail }, 201);
  }

  const goalContribMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/goals\/([A-Za-z0-9_-]+)\/contributions\/([A-Za-z0-9_-]+)$/);
  if (goalContribMatch && method === "PATCH") {
    const [, eventId, goalId, memberId] = goalContribMatch;
    const body = await request.json().catch(() => null);
    const nextStatus = String(body?.status || "").trim().toUpperCase();
    if (!CONTRIBUTION_STATUSES.includes(nextStatus)) {
      throw new ExpensesApiError(400, "Invalid contribution status");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const targetMember = members.find(m => m.id === memberId);
    if (!targetMember) throw new ExpensesApiError(404, "Member not found");

    await db
      .prepare("UPDATE goal_contributions SET status = ? WHERE goal_id = ? AND member_id = ?")
      .bind(nextStatus, goalId, memberId)
      .run();

    const now = new Date().toISOString();
    const labelMap = { UNPAID: "не сдал(а)", PENDING: "отметил(а) перевод", PAID: "сдал(а)" };
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "GOAL_CONTRIBUTION_UPDATED", {
      goal_id: goalId,
      member_id: memberId,
      status: nextStatus,
      text: `${targetMember.member_name}: статус сбора «${labelMap[nextStatus]}»`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  const membersCollectionMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/members$/);
  if (membersCollectionMatch && method === "POST") {
    const eventId = membersCollectionMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const now = new Date().toISOString();
    const weight = sanitizeWeight(body.default_weight, 1.0);

    const rawUsername = String(body.username || "").trim();
    const rawTelegramId = body.telegram_id;
    if (!rawUsername && (rawTelegramId === undefined || rawTelegramId === null || rawTelegramId === "")) {
      throw new ExpensesApiError(400, "Specify @username or select a registered Telegram user");
    }

    const normalizedUsername = rawUsername ? normalizeUsername(rawUsername, true) : "";
    const resolved = await resolveRealUserForExpenses(db, env, {
      telegramId: rawTelegramId,
      username: normalizedUsername
    });

    if (!resolved) {
      if (normalizedUsername && env?.BOT_TOKEN && env?.DB) {
        const selection = await requestTelegramUserSelection(env, user.telegram_id, {
          purpose: "expense_member",
          eventId,
          requestedUsername: normalizedUsername
        });
        return json(selection, 202);
      }
      throw new ExpensesApiError(404, "User not found");
    }

    if (members.some(m => m.user_id === resolved.id)) {
      throw new ExpensesApiError(409, "User is already a member of this event");
    }

    const memberName = cleanPlainText(resolved.display_name, 64) || "Участник";
    await db
      .prepare(
        `INSERT INTO event_members (
          id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
        ) VALUES (?, ?, ?, ?, 'MEMBER', ?, NULL, ?)`
      )
      .bind(crypto.randomUUID(), eventId, resolved.id, memberName, weight, now)
      .run();

    if (env?.DB) {
      await addExpenseContact(env, user.telegram_id, resolved.telegram_id);
    }

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "MEMBER_ADDED", {
      user_id: resolved.id,
      telegram_id: resolved.telegram_id,
      names: [memberName],
      text: `Добавлен(а) участник: ${memberName}`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail }, 201);
  }

  const memberItemMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/members\/([A-Za-z0-9_-]+)$/);
  if (memberItemMatch && method === "PATCH") {
    const [, eventId, memberId] = memberItemMatch;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const target = members.find(m => m.id === memberId);
    if (!target) {
      throw new ExpensesApiError(404, "Member not found");
    }

    const nextName = body.member_name !== undefined
      ? (cleanPlainText(body.member_name, 64) || target.member_name)
      : target.member_name;
    const nextWeight = body.default_weight !== undefined
      ? sanitizeWeight(body.default_weight, target.default_weight)
      : target.default_weight;
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE event_members SET member_name = ?, default_weight = ? WHERE id = ?")
      .bind(nextName, nextWeight, memberId)
      .run();

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    if (nextWeight !== target.default_weight) {
      await appendAuditLog(db, eventId, user.id, "MEMBER_WEIGHT_UPDATED", {
        member_id: memberId,
        weight: nextWeight,
        text: `Вес участника «${nextName}» изменён на ${nextWeight}x`
      });
    }

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  if (memberItemMatch && method === "DELETE") {
    const [, eventId, memberId] = memberItemMatch;
    const { members } = await requireEventAccess(db, eventId, user.id, { requireAdmin: true });
    const target = members.find(m => m.id === memberId);
    if (!target) {
      throw new ExpensesApiError(404, "Member not found");
    }
    if (target.role === "OWNER") {
      throw new ExpensesApiError(400, "Cannot remove event owner");
    }
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE event_members SET linked_payer_member_id = NULL WHERE event_id = ? AND linked_payer_member_id = ?")
      .bind(eventId, memberId)
      .run();
    await db
      .prepare("DELETE FROM event_members WHERE id = ? AND event_id = ?")
      .bind(memberId, eventId)
      .run();

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "MEMBER_REMOVED", {
      member_id: memberId,
      text: `Участник «${target.member_name}» удалён из события`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  const walletsCollectionMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/wallets$/);
  if (walletsCollectionMatch && method === "POST") {
    const eventId = walletsCollectionMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ExpensesApiError(400, "Invalid JSON payload");
    }
    const { members } = await requireEventAccess(db, eventId, user.id);
    const rawIds = Array.isArray(body.member_ids) ? body.member_ids.map(String) : [];
    const uniqueIds = [...new Set(rawIds)];
    if (uniqueIds.length < 2) {
      throw new ExpensesApiError(400, "Select at least 2 members to create a unified wallet");
    }

    const selectedMembers = uniqueIds.map(id => members.find(m => m.id === id)).filter(Boolean);
    if (selectedMembers.length !== uniqueIds.length) {
      throw new ExpensesApiError(404, "One or more selected members not found");
    }

    const headMember = selectedMembers.find(m => m.role === "OWNER")
      || selectedMembers.find(m => Boolean(m.user_id))
      || selectedMembers[0];

    const now = new Date().toISOString();
    await db
      .prepare("UPDATE event_members SET linked_payer_member_id = NULL WHERE id = ?")
      .bind(headMember.id)
      .run();

    for (const member of selectedMembers) {
      if (member.id === headMember.id) continue;
      await db
        .prepare("UPDATE event_members SET linked_payer_member_id = ? WHERE event_id = ? AND linked_payer_member_id = ?")
        .bind(headMember.id, eventId, member.id)
        .run();
      await db
        .prepare("UPDATE event_members SET linked_payer_member_id = ? WHERE id = ?")
        .bind(headMember.id, member.id)
        .run();
    }

    const walletLabel = selectedMembers.map(m => m.member_name).join(" + ");
    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "WALLET_MERGED", {
      head_member_id: headMember.id,
      member_ids: selectedMembers.map(m => m.id),
      text: `Создан единый кошелёк «${walletLabel}»`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  const walletItemMatch = path.match(/^\/api\/expenses\/events\/([A-Za-z0-9_-]+)\/wallets\/([A-Za-z0-9_-]+)$/);
  if (walletItemMatch && method === "DELETE") {
    const [, eventId, headMemberId] = walletItemMatch;
    const { members } = await requireEventAccess(db, eventId, user.id);
    const head = members.find(m => m.id === headMemberId);
    if (!head) {
      throw new ExpensesApiError(404, "Wallet not found");
    }
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE event_members SET linked_payer_member_id = NULL WHERE event_id = ? AND (id = ? OR linked_payer_member_id = ?)")
      .bind(eventId, headMemberId, headMemberId)
      .run();

    await db.prepare("UPDATE events SET updated_at = ? WHERE id = ?").bind(now, eventId).run();
    await appendAuditLog(db, eventId, user.id, "WALLET_UNMERGED", {
      head_member_id: headMemberId,
      text: `Единый кошелёк с главой «${head.member_name}» разъединён`
    });

    const eventDetail = await loadFullEventDetail(db, eventId, user.id);
    return json({ ok: true, event: eventDetail });
  }

  return null;
}
