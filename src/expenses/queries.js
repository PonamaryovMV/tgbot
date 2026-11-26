import {
  cleanPlainText,
  normalizeUsername,
  resolveUserByUsername,
  loadProfile,
  readSubscriptions,
  loadExpenseContactsProfiles
} from "../../worker.js";
import { ExpensesApiError, parseBanksJson } from "./schema.js";
import {
  getUnitHeadId,
  buildUnifiedWalletsFromMembers,
  computeEventSettlementPlan
} from "./splits.js";

export function formatUserRow(row, viewer) {
  const preferredBanks = parseBanksJson(row?.preferred_banks_json);
  return {
    id: row?.id || `usr_${viewer.id}`,
    telegram_id: Number(row?.telegram_id || viewer.id),
    username: row?.username || normalizeUsername(viewer.username || "", false),
    display_name: row?.display_name || cleanPlainText(viewer.first_name, 64) || "Пользователь",
    payment_phone: row?.payment_phone || "",
    preferred_banks: preferredBanks,
    preferred_banks_json: JSON.stringify(preferredBanks),
    default_currency: row?.default_currency || "RUB",
    created_at: row?.created_at || "",
    updated_at: row?.updated_at || ""
  };
}

export async function ensureUserProfile(db, viewer) {
  const now = new Date().toISOString();
  const displayName = cleanPlainText(viewer.first_name, 64) || "Пользователь";
  const username = normalizeUsername(viewer.username || "", false);
  const existing = await db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(viewer.id)
    .first();

  if (!existing) {
    const userId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO users (
          id, telegram_id, username, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, viewer.id, username, displayName, now, now)
      .run();
    const created = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first();
    return formatUserRow(created, viewer);
  }

  const nextUsername = username || existing.username || "";
  const nextDisplayName = displayName || existing.display_name || "Пользователь";
  if (nextUsername !== (existing.username || "") || nextDisplayName !== existing.display_name) {
    await db
      .prepare("UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?")
      .bind(nextUsername, nextDisplayName, now, existing.id)
      .run();
  }
  const refreshed = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(existing.id)
    .first();
  return formatUserRow(refreshed || existing, viewer);
}

export async function resolveRealUserForExpenses(db, env, { telegramId, username } = {}) {
  if (telegramId !== undefined && telegramId !== null && telegramId !== "") {
    const numId = Number(telegramId);
    if (!Number.isSafeInteger(numId) || numId <= 0) {
      throw new ExpensesApiError(400, "Invalid telegram_id");
    }
    const existing = await db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .bind(numId)
      .first();
    if (existing) {
      return formatUserRow(existing, {
        id: numId,
        first_name: existing.display_name,
        username: existing.username
      });
    }
    if (env?.DB) {
      const dir = await env.DB.get(`directory:${numId}`, "json");
      if (dir && typeof dir === "object") {
        return await ensureUserProfile(db, {
          id: numId,
          first_name: dir.first_name || "Пользователь",
          username: dir.username || ""
        });
      }
    }
    return null;
  }

  if (username !== undefined && username !== null && String(username).trim() !== "") {
    const normalized = normalizeUsername(username, true);
    const existing = await db
      .prepare("SELECT * FROM users WHERE LOWER(username) = ?")
      .bind(normalized)
      .first();
    if (existing) {
      return formatUserRow(existing, {
        id: existing.telegram_id,
        first_name: existing.display_name,
        username: existing.username
      });
    }
    if (env?.DB) {
      const profile = await resolveUserByUsername(env, normalized);
      if (profile) {
        return await ensureUserProfile(db, {
          id: profile.id,
          first_name: profile.first_name,
          username: profile.username
        });
      }
    }
    return null;
  }

  return null;
}

export async function listExpensesContacts(db, env, currentUser) {
  const byTelegramId = new Map();
  const addEntry = item => {
    const tgId = Number(item?.telegram_id ?? item?.id);
    if (!Number.isSafeInteger(tgId) || tgId <= 0 || tgId === Number(currentUser.telegram_id)) return;
    if (byTelegramId.has(tgId)) return;
    byTelegramId.set(tgId, {
      telegram_id: tgId,
      username: normalizeUsername(item?.username || "", false),
      display_name: cleanPlainText(item?.display_name || item?.first_name || "Пользователь", 64) || "Пользователь"
    });
  };

  if (env?.DB) {
    const expContacts = await loadExpenseContactsProfiles(env, currentUser.telegram_id);
    for (const p of expContacts) addEntry(p);

    const subIds = await readSubscriptions(env, currentUser.telegram_id);
    for (const subId of subIds) {
      const profile = await loadProfile(env, subId);
      addEntry(profile);
    }
  }

  const coMembersRes = await db
    .prepare(
      `SELECT DISTINCT u.id, u.telegram_id, u.username, u.display_name
       FROM event_members em_me
       JOIN event_members em_other ON em_other.event_id = em_me.event_id
       JOIN users u ON u.id = em_other.user_id
       WHERE em_me.user_id = ? AND u.id != ?`
    )
    .bind(currentUser.id, currentUser.id)
    .all();

  for (const row of Array.isArray(coMembersRes?.results) ? coMembersRes.results : []) {
    addEntry(row);
  }

  return [...byTelegramId.values()];
}

export async function appendAuditLog(db, eventId, actorUserId, action, details = {}) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO event_audit_log (id, event_id, actor_user_id, action, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      eventId,
      actorUserId || null,
      action,
      JSON.stringify(details || {}),
      now
    )
    .run();
}

export async function loadEventMembers(db, eventId) {
  const res = await db
    .prepare(
      `SELECT em.id, em.event_id, em.user_id, em.member_name, em.role,
              em.default_weight, em.linked_payer_member_id, em.joined_at,
              u.telegram_id, u.username, u.display_name, u.payment_phone, u.preferred_banks_json
       FROM event_members em
       LEFT JOIN users u ON u.id = em.user_id
       WHERE em.event_id = ?
       ORDER BY em.joined_at ASC, em.member_name ASC`
    )
    .bind(eventId)
    .all();

  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map(row => ({
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id || null,
    telegram_id: row.telegram_id ? Number(row.telegram_id) : null,
    username: row.username || "",
    member_name: row.member_name,
    role: row.role || "MEMBER",
    default_weight: Number(row.default_weight ?? 1.0),
    linked_payer_member_id: row.linked_payer_member_id || null,
    payment_phone: row.payment_phone || "",
    preferred_banks: parseBanksJson(row.preferred_banks_json),
    joined_at: row.joined_at || ""
  }));
}

export async function loadEventOperations(db, eventId) {
  const expRes = await db
    .prepare(
      `SELECT id, event_id, created_by_member_id, operation_type, title, category,
              original_amount_minor, original_currency, exchange_rate, base_amount_minor,
              split_type, items_json, split_meta_json, comment, expense_date, is_deleted, created_at
       FROM expenses
       WHERE event_id = ? AND is_deleted = 0
       ORDER BY expense_date DESC, created_at DESC`
    )
    .bind(eventId)
    .all();

  const expenses = Array.isArray(expRes?.results) ? expRes.results : [];
  if (expenses.length === 0) return [];

  const splitsRes = await db
    .prepare(
      `SELECT es.id, es.expense_id, es.member_id, es.paid_amount_minor, es.owed_amount_minor, es.share_value
       FROM expense_splits es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.event_id = ? AND e.is_deleted = 0`
    )
    .bind(eventId)
    .all();

  const allSplits = Array.isArray(splitsRes?.results) ? splitsRes.results : [];
  const splitsByExpense = new Map();
  for (const s of allSplits) {
    if (!splitsByExpense.has(s.expense_id)) splitsByExpense.set(s.expense_id, []);
    splitsByExpense.get(s.expense_id).push({
      id: s.id,
      member_id: s.member_id,
      paid_amount_minor: Number(s.paid_amount_minor) || 0,
      owed_amount_minor: Number(s.owed_amount_minor) || 0,
      share_value: Number(s.share_value) || 0
    });
  }

  return expenses.map(row => {
    let items = [];
    let splitMeta = {};
    try {
      items = row.items_json ? JSON.parse(row.items_json) : [];
    } catch {
      items = [];
    }
    try {
      splitMeta = row.split_meta_json ? JSON.parse(row.split_meta_json) : {};
    } catch {
      splitMeta = {};
    }
    const opSplits = splitsByExpense.get(row.id) || [];
    const payers = opSplits.filter(s => s.paid_amount_minor > 0).map(s => s.member_id);
    const sharesMinor = {};
    for (const s of opSplits) {
      if (s.owed_amount_minor > 0) {
        sharesMinor[s.member_id] = s.owed_amount_minor;
      }
    }

    return {
      id: row.id,
      event_id: row.event_id,
      created_by_member_id: row.created_by_member_id,
      operation_type: row.operation_type || "EXPENSE",
      title: row.title,
      category: row.category || "Другое",
      original_amount_minor: Number(row.original_amount_minor) || 0,
      original_currency: row.original_currency || "RUB",
      exchange_rate: Number(row.exchange_rate ?? 1),
      base_amount_minor: Number(row.base_amount_minor) || 0,
      split_type: row.split_type || "EQUAL",
      items,
      split_meta: splitMeta,
      comment: row.comment || "",
      expense_date: row.expense_date || "",
      created_at: row.created_at || "",
      payers,
      shares_minor: sharesMinor,
      splits: opSplits
    };
  });
}

export async function loadEventSettlements(db, eventId) {
  const res = await db
    .prepare(
      `SELECT s.id, s.from_user_id, s.to_user_id, s.from_member_id, s.to_member_id,
              s.total_amount_minor, s.currency, s.payment_method, s.comment, s.status,
              s.created_at, s.confirmed_at, sa.allocated_amount_minor
       FROM settlements s
       JOIN settlement_allocations sa ON sa.settlement_id = s.id
       WHERE sa.event_id = ?
       ORDER BY s.created_at DESC`
    )
    .bind(eventId)
    .all();

  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map(r => ({
    id: r.id,
    from_user_id: r.from_user_id || null,
    to_user_id: r.to_user_id || null,
    from_member_id: r.from_member_id,
    to_member_id: r.to_member_id,
    total_amount_minor: Number(r.total_amount_minor) || 0,
    allocated_amount_minor: Number(r.allocated_amount_minor ?? r.total_amount_minor) || 0,
    currency: r.currency || "RUB",
    payment_method: r.payment_method || "СБП",
    comment: r.comment || "",
    status: r.status || "PENDING",
    created_at: r.created_at || "",
    confirmed_at: r.confirmed_at || null
  }));
}

export async function loadEventGoals(db, eventId, members) {
  const goalRow = await db
    .prepare(
      `SELECT id, event_id, title, target_per_member_minor, receiver_member_id, status
       FROM event_goals
       WHERE event_id = ? AND status != 'CANCELLED'
       ORDER BY rowid DESC
       LIMIT 1`
    )
    .bind(eventId)
    .first();

  if (!goalRow) return null;

  const contribRes = await db
    .prepare(
      `SELECT id, goal_id, member_id, status, settlement_id
       FROM goal_contributions
       WHERE goal_id = ?`
    )
    .bind(goalRow.id)
    .all();

  const contribRows = Array.isArray(contribRes?.results) ? contribRes.results : [];
  const byMember = new Map(contribRows.map(c => [c.member_id, c]));

  const contributions = members.map(m => {
    const existing = byMember.get(m.id);
    return {
      id: existing?.id || null,
      member_id: m.id,
      member_name: m.member_name,
      status: existing?.status || "UNPAID"
    };
  });

  const paidCount = contributions.filter(c => c.status === "PAID").length;
  const perMemberMinor = Number(goalRow.target_per_member_minor) || 0;
  return {
    id: goalRow.id,
    event_id: goalRow.event_id,
    title: goalRow.title,
    target_per_member_minor: perMemberMinor,
    receiver_member_id: goalRow.receiver_member_id,
    status: goalRow.status || "ACTIVE",
    collected_minor: paidCount * perMemberMinor,
    total_target_minor: members.length * perMemberMinor,
    paid_count: paidCount,
    total_members: members.length,
    contributions
  };
}

export async function loadEventAuditLog(db, eventId, limit = 50) {
  const res = await db
    .prepare(
      `SELECT id, event_id, actor_user_id, action, details_json, created_at
       FROM event_audit_log
       WHERE event_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(eventId, limit)
    .all();

  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map(row => {
    let details = {};
    try {
      details = row.details_json ? JSON.parse(row.details_json) : {};
    } catch {
      details = {};
    }
    return {
      id: row.id,
      event_id: row.event_id,
      actor_user_id: row.actor_user_id || null,
      action: row.action,
      text: details.text || row.action,
      details,
      created_at: row.created_at
    };
  });
}

export async function ensureEventDateColumn(db) {
  try {
    await db.prepare("ALTER TABLE events ADD COLUMN event_date TEXT").run();
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (!/duplicate column|already exists/i.test(msg)) {
      throw error;
    }
  }
}

export async function persistEventDate(db, eventId, eventDate) {
  const val = eventDate ? String(eventDate) : null;
  try {
    await db
      .prepare("UPDATE events SET event_date = ? WHERE id = ?")
      .bind(val, eventId)
      .run();
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (/no such column.*event_date/i.test(msg)) {
      await ensureEventDateColumn(db);
      await db
        .prepare("UPDATE events SET event_date = ? WHERE id = ?")
        .bind(val, eventId)
        .run();
      return;
    }
    throw error;
  }
}

export async function requireEventAccess(db, eventId, userProfileId, { requireAdmin = false } = {}) {
  const eventRow = await db
    .prepare("SELECT * FROM events WHERE id = ?")
    .bind(eventId)
    .first();
  if (!eventRow) {
    throw new ExpensesApiError(404, "Event not found");
  }
  const members = await loadEventMembers(db, eventId);
  const viewerMember = members.find(m => m.user_id === userProfileId);
  if (!viewerMember) {
    throw new ExpensesApiError(403, "You are not a member of this event");
  }
  if (requireAdmin && !["OWNER", "ADMIN"].includes(viewerMember.role)) {
    throw new ExpensesApiError(403, "Only event owner or admin can perform this action");
  }
  return { eventRow, members, viewerMember };
}

export function serializeEventDetail(eventRow, members, viewerMember, operations = [], auditLog = [], settlements = [], activeGoal = null) {
  const totalSpentMinor = operations
    .filter(op => op.operation_type !== "TRANSFER")
    .reduce((sum, op) => sum + (Number(op.base_amount_minor) || 0), 0);

  const confirmed = settlements.filter(s => s.status === "CONFIRMED");
  const pending = settlements.filter(s => s.status === "PENDING");
  const simplify = Boolean(Number(eventRow.simplify_debts ?? 1));
  const plan = computeEventSettlementPlan(members, operations, confirmed, pending, simplify);
  const viewerUnitId = viewerMember ? getUnitHeadId(members, viewerMember.id) : null;
  const netBalanceMinor = viewerUnitId ? (plan.unit_balances_minor[viewerUnitId] || 0) : 0;

  return {
    id: eventRow.id,
    title: eventRow.title,
    description: eventRow.description || "",
    icon: eventRow.icon || "🎉",
    event_date: eventRow.event_date || "",
    base_currency: eventRow.base_currency || "RUB",
    creator_id: eventRow.creator_id,
    simplify_debts: simplify,
    status: eventRow.status || "ACTIVE",
    invite_token: eventRow.invite_token,
    created_at: eventRow.created_at,
    updated_at: eventRow.updated_at,
    viewer_member_id: viewerMember?.id || null,
    viewer_unit_id: viewerUnitId,
    viewer_role: viewerMember?.role || null,
    members,
    wallets: buildUnifiedWalletsFromMembers(members),
    units: plan.units,
    unit_balances_minor: plan.unit_balances_minor,
    settlement_edges: plan.edges,
    total_spent_minor: totalSpentMinor,
    net_balance_minor: netBalanceMinor,
    operations,
    settlements,
    goal: activeGoal,
    audit_log: auditLog
  };
}

export async function loadFullEventDetail(db, eventId, userProfileId) {
  const { eventRow, members, viewerMember } = await requireEventAccess(db, eventId, userProfileId);
  const operations = await loadEventOperations(db, eventId);
  const settlements = await loadEventSettlements(db, eventId);
  const goal = await loadEventGoals(db, eventId, members);
  const auditLog = await loadEventAuditLog(db, eventId);
  return serializeEventDetail(eventRow, members, viewerMember, operations, auditLog, settlements, goal);
}

function crossUnitKey(unit) {
  const tokens = (unit.user_ids && unit.user_ids.length)
    ? unit.user_ids.map(id => `u:${id}`).sort()
    : [unit.name.toLocaleLowerCase("ru-RU")];
  return `${unit.is_wallet ? "w" : "p"}:${tokens.join("|")}`;
}

export async function listUserEventsSummary(db, userProfileId) {
  const summarySql = `SELECT e.id, e.title, e.description, e.icon, e.event_date, e.base_currency, e.creator_id,
              e.simplify_debts, e.status, e.invite_token, e.created_at, e.updated_at,
              em.id AS member_id, em.role AS member_role, em.default_weight,
              (SELECT COUNT(*) FROM event_members em2 WHERE em2.event_id = e.id) AS members_count
       FROM events e
       JOIN event_members em ON em.event_id = e.id
       WHERE em.user_id = ?
       ORDER BY e.updated_at DESC, e.created_at DESC`;
  let rowsResult;
  try {
    rowsResult = await db.prepare(summarySql).bind(userProfileId).all();
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (/no such column.*event_date/i.test(msg)) {
      await ensureEventDateColumn(db);
      rowsResult = await db.prepare(summarySql).bind(userProfileId).all();
    } else {
      throw error;
    }
  }

  const events = Array.isArray(rowsResult?.results) ? rowsResult.results : [];
  const activeEvents = [];
  const archivedEvents = [];
  const summaryByCurrency = {};
  const crossMap = new Map();

  for (const row of events) {
    const members = await loadEventMembers(db, row.id);
    const operations = await loadEventOperations(db, row.id);
    const settlements = await loadEventSettlements(db, row.id);
    const confirmed = settlements.filter(s => s.status === "CONFIRMED");
    const pending = settlements.filter(s => s.status === "PENDING");
    const simplify = Boolean(Number(row.simplify_debts ?? 1));
    const plan = computeEventSettlementPlan(members, operations, confirmed, pending, simplify);

    const totalSpentMinor = operations
      .filter(op => op.operation_type !== "TRANSFER")
      .reduce((sum, op) => sum + (Number(op.base_amount_minor) || 0), 0);
    const viewerUnitId = getUnitHeadId(members, row.member_id);
    const netMinor = plan.unit_balances_minor[viewerUnitId] || 0;
    const cur = row.base_currency || "RUB";

    const item = {
      id: row.id,
      title: row.title,
      description: row.description || "",
      icon: row.icon || "🎉",
      event_date: row.event_date || "",
      base_currency: cur,
      creator_id: row.creator_id,
      simplify_debts: simplify,
      status: row.status || "ACTIVE",
      invite_token: row.invite_token,
      member_id: row.member_id,
      viewer_unit_id: viewerUnitId,
      role: row.member_role,
      default_weight: Number(row.default_weight ?? 1.0),
      members_count: Number(row.members_count ?? members.length ?? 1),
      total_spent_minor: totalSpentMinor,
      net_balance_minor: netMinor,
      balance_state: netMinor > 0 ? "owed_to_you" : netMinor < 0 ? "you_owe" : "settled",
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    if (item.status === "ARCHIVED") {
      archivedEvents.push(item);
    } else {
      activeEvents.push(item);
      if (!summaryByCurrency[cur]) {
        summaryByCurrency[cur] = {
          you_owe_minor: 0,
          owed_to_you_minor: 0,
          pending_outgoing_minor: 0,
          pending_incoming_minor: 0
        };
      }
      if (netMinor > 0) summaryByCurrency[cur].owed_to_you_minor += netMinor;
      else if (netMinor < 0) summaryByCurrency[cur].you_owe_minor += Math.abs(netMinor);

      for (const st of pending) {
        const fromU = getUnitHeadId(members, st.from_member_id);
        const toU = getUnitHeadId(members, st.to_member_id);
        if (fromU === viewerUnitId) summaryByCurrency[cur].pending_outgoing_minor += st.allocated_amount_minor;
        if (toU === viewerUnitId) summaryByCurrency[cur].pending_incoming_minor += st.allocated_amount_minor;
      }

      for (const edge of plan.edges) {
        let otherUnitId = null;
        let sign = 0;
        if (edge.from_unit_id === viewerUnitId) {
          otherUnitId = edge.to_unit_id;
          sign = -1;
        } else if (edge.to_unit_id === viewerUnitId) {
          otherUnitId = edge.from_unit_id;
          sign = 1;
        }
        if (!otherUnitId) continue;
        const otherUnit = plan.units.find(u => u.id === otherUnitId);
        if (!otherUnit) continue;

        const key = `${cur}|${crossUnitKey(otherUnit)}`;
        if (!crossMap.has(key)) {
          crossMap.set(key, {
            key,
            currency: cur,
            name: otherUnit.name,
            is_wallet: otherUnit.is_wallet,
            payment_phone: otherUnit.payment_phone || "",
            preferred_banks: otherUnit.preferred_banks || [],
            recipient_user_id: otherUnit.recipient_user_id || null,
            net_minor: 0,
            allocations: []
          });
        }
        const entry = crossMap.get(key);
        const delta = sign * edge.amount_minor;
        entry.net_minor += delta;
        if (!entry.payment_phone && otherUnit.payment_phone) entry.payment_phone = otherUnit.payment_phone;
        if (!entry.preferred_banks.length && otherUnit.preferred_banks.length) entry.preferred_banks = otherUnit.preferred_banks;
        entry.allocations.push({
          event_id: row.id,
          event_title: row.title,
          from_member_id: row.member_id,
          to_member_id: otherUnit.id,
          amount_minor: delta
        });
      }
    }
  }

  if (!summaryByCurrency.RUB) {
    summaryByCurrency.RUB = {
      you_owe_minor: 0,
      owed_to_you_minor: 0,
      pending_outgoing_minor: 0,
      pending_incoming_minor: 0
    };
  }

  const crossEventDebts = [...crossMap.values()]
    .filter(x => Math.abs(x.net_minor) > 0)
    .sort((a, b) => Math.abs(b.net_minor) - Math.abs(a.net_minor));

  return {
    active_events: activeEvents,
    archived_events: archivedEvents,
    summary_by_currency: summaryByCurrency,
    cross_event_debts: crossEventDebts
  };
}

export function buildEventCsvExport(eventDetail) {
  const ev = eventDetail || {};
  const members = Array.isArray(ev.members) ? ev.members : [];
  const units = Array.isArray(ev.units) ? ev.units : [];
  const ops = Array.isArray(ev.operations) ? ev.operations : [];
  const edges = Array.isArray(ev.settlement_edges) ? ev.settlement_edges : [];
  const balances = ev.unit_balances_minor || {};
  const cur = ev.base_currency || "RUB";

  const memberName = id => (members.find(m => m.id === id) || { member_name: id }).member_name;
  const unitName = id => (units.find(u => u.id === id) || { name: id }).name;
  const fmtMoney = minor => ((Number(minor) || 0) / 100).toFixed(2);

  const rows = [];
  rows.push(["Событие", ev.title || ""]);
  rows.push(["Базовая валюта", cur]);
  rows.push(["Статус", ev.status || "ACTIVE"]);
  rows.push([]);
  rows.push(["Дата", "Тип", "Название", "Категория", "Сумма", "Валюта", "Курс", "В базовой валюте", "Плательщики", "Доли"]);

  for (const op of ops) {
    const typeLabel = op.operation_type === "TRANSFER"
      ? "Перевод"
      : op.operation_type === "PREPAYMENT"
        ? "В котёл"
        : "Расход";
    const payersText = (op.payers || []).map(memberName).join(" + ");
    const sharesText = Object.entries(op.shares_minor || {})
      .map(([mid, v]) => `${memberName(mid)}: ${fmtMoney(v)}`)
      .join("; ");
    rows.push([
      op.expense_date || "",
      typeLabel,
      op.title || "",
      op.category || "",
      fmtMoney(op.original_amount_minor),
      op.original_currency || cur,
      String(op.exchange_rate ?? 1),
      fmtMoney(op.base_amount_minor),
      payersText,
      sharesText
    ]);
  }

  rows.push([]);
  rows.push(["Итоговые балансы юнитов"]);
  rows.push(["Участник / Кошелёк", "Тип", `Баланс (${cur})`]);
  for (const u of units) {
    rows.push([
      u.name,
      u.is_wallet ? "Единый кошелёк" : "Участник",
      fmtMoney(balances[u.id] || 0)
    ]);
  }

  rows.push([]);
  rows.push(["Схема переводов"]);
  rows.push(["От кого", "Кому", `Сумма (${cur})`, "Статус"]);
  for (const e of edges) {
    rows.push([
      unitName(e.from_unit_id),
      unitName(e.to_unit_id),
      fmtMoney(e.amount_minor),
      e.pending ? "Ожидает подтверждения" : "К переводу"
    ]);
  }

  return "\uFEFF" + rows
    .map(r => r.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\r\n");
}
