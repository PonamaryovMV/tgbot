import { cleanPlainText } from "../../worker.js";
import { OPERATION_TYPES, SPLIT_TYPES, ExpensesApiError } from "./schema.js";

export function getUnitHeadId(members, memberId) {
  const byId = new Map(members.map(m => [m.id, m]));
  const m = byId.get(memberId);
  if (!m) return memberId;
  return m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
    ? m.linked_payer_member_id
    : m.id;
}

export function buildUnifiedWalletsFromMembers(members) {
  const byId = new Map(members.map(m => [m.id, m]));
  const groups = new Map();

  for (const m of members) {
    const headId = m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
      ? m.linked_payer_member_id
      : m.id;
    if (!groups.has(headId)) groups.set(headId, []);
    groups.get(headId).push(m);
  }

  const wallets = [];
  for (const [headId, groupMembers] of groups.entries()) {
    if (groupMembers.length >= 2) {
      wallets.push({
        id: headId,
        head_member_id: headId,
        name: groupMembers.map(m => m.member_name).join(" + "),
        member_ids: groupMembers.map(m => m.id)
      });
    }
  }
  return wallets;
}

export function buildSettlementUnits(members) {
  const groups = new Map();
  for (const m of members) {
    const headId = getUnitHeadId(members, m.id);
    if (!groups.has(headId)) groups.set(headId, []);
    groups.get(headId).push(m);
  }

  const units = [];
  for (const [headId, list] of groups.entries()) {
    const isWallet = list.length >= 2;
    const primaryRecipient = list.find(m => m.payment_phone)
      || list.find(m => Boolean(m.user_id))
      || list[0];
    units.push({
      id: headId,
      name: isWallet ? list.map(m => m.member_name).join(" + ") : list[0].member_name,
      is_wallet: isWallet,
      member_ids: list.map(m => m.id),
      user_ids: list.map(m => m.user_id).filter(Boolean),
      payment_phone: primaryRecipient?.payment_phone || "",
      preferred_banks: Array.isArray(primaryRecipient?.preferred_banks) ? primaryRecipient.preferred_banks : [],
      recipient_user_id: primaryRecipient?.user_id || null
    });
  }
  return units;
}

export function distributeExactMinor(totalMinor, items) {
  const total = Math.round(Number(totalMinor) || 0);
  if (!Array.isArray(items) || items.length === 0 || total <= 0) return [];
  const totalWeight = items.reduce((s, it) => s + (Number(it.weight) || 0), 0);
  if (totalWeight <= 0) return [];

  const rows = items.map((it, idx) => {
    const exact = (total * (Number(it.weight) || 0)) / totalWeight;
    const floored = Math.floor(exact);
    return {
      member_id: it.member_id,
      weight: Number(it.weight) || 0,
      minor: floored,
      remainder: exact - floored,
      idx
    };
  });

  const remainderMinor = total - rows.reduce((s, r) => s + r.minor, 0);
  const byRemainder = [...rows].sort((a, b) => (b.remainder - a.remainder) || (a.idx - b.idx));
  for (let i = 0; i < remainderMinor; i += 1) {
    byRemainder[i % byRemainder.length].minor += 1;
  }

  return rows.map(r => ({
    member_id: r.member_id,
    amount_minor: r.minor,
    share_value: r.weight
  }));
}

export function computeOperationSplits({
  operationType,
  originalAmountMinor,
  exchangeRate,
  splitType,
  payers,
  transferFromId,
  transferToId,
  includedMemberIds,
  weightsMap,
  exactMinorMap,
  percentMap,
  items,
  members
}) {
  const memberIds = new Set(members.map(m => m.id));
  const opType = String(operationType || "EXPENSE").toUpperCase();
  if (!OPERATION_TYPES.includes(opType)) {
    throw new ExpensesApiError(400, "Unsupported operation type");
  }

  const rate = Number(exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000000) {
    throw new ExpensesApiError(400, "Exchange rate must be a positive number");
  }

  let origMinor = Math.round(Number(originalAmountMinor) || 0);
  const mode = opType === "TRANSFER" ? "EXACT" : String(splitType || "EQUAL").toUpperCase();
  if (!SPLIT_TYPES.includes(mode)) {
    throw new ExpensesApiError(400, "Unsupported split mode");
  }

  if (opType === "TRANSFER") {
    if (!transferFromId || !transferToId || !memberIds.has(transferFromId) || !memberIds.has(transferToId)) {
      throw new ExpensesApiError(400, "Select valid sender and recipient for transfer");
    }
    if (transferFromId === transferToId) {
      throw new ExpensesApiError(400, "Sender and recipient must be different members");
    }
    if (origMinor <= 0) {
      throw new ExpensesApiError(400, "Amount must be greater than zero");
    }
    const baseMinor = Math.round(origMinor * rate);
    return {
      operation_type: "TRANSFER",
      split_type: "EXACT",
      original_amount_minor: origMinor,
      exchange_rate: rate,
      base_amount_minor: baseMinor,
      normalized_items: [],
      splits: [
        { member_id: transferFromId, paid_amount_minor: baseMinor, owed_amount_minor: 0, share_value: 0 },
        { member_id: transferToId, paid_amount_minor: 0, owed_amount_minor: baseMinor, share_value: baseMinor }
      ]
    };
  }

  const validPayers = [...new Set((Array.isArray(payers) ? payers : []).filter(id => memberIds.has(id)))];
  if (validPayers.length === 0) {
    throw new ExpensesApiError(400, "Select at least one payer");
  }

  const normalizedItems = [];
  if (mode === "MANUAL_ITEMS") {
    const rawItems = Array.isArray(items) ? items : [];
    if (rawItems.length === 0) {
      throw new ExpensesApiError(400, "Add at least one receipt item");
    }
    let itemsOrigSum = 0;
    for (const raw of rawItems) {
      const itemTitle = cleanPlainText(raw?.title, 80) || "Позиция";
      const itemMinor = Math.round(Number(raw?.amount_minor) || 0);
      const itemPids = [...new Set((Array.isArray(raw?.member_ids) ? raw.member_ids : []).filter(id => memberIds.has(id)))];
      if (itemMinor <= 0) {
        throw new ExpensesApiError(400, "Each item must have a positive amount");
      }
      if (itemPids.length === 0) {
        throw new ExpensesApiError(400, `Select participants for item «${itemTitle}»`);
      }
      itemsOrigSum += itemMinor;
      normalizedItems.push({
        title: itemTitle,
        amount_minor: itemMinor,
        member_ids: itemPids
      });
    }
    origMinor = itemsOrigSum;
  }

  if (origMinor <= 0) {
    throw new ExpensesApiError(400, "Amount must be greater than zero");
  }

  const baseMinor = Math.round(origMinor * rate);
  const paidRows = distributeExactMinor(
    baseMinor,
    validPayers.map(id => ({ member_id: id, weight: 1 }))
  );
  const paidByMember = new Map(paidRows.map(r => [r.member_id, r.amount_minor]));

  const owedByMember = new Map();
  const shareValByMember = new Map();

  if (mode === "EQUAL") {
    const inc = [...new Set((Array.isArray(includedMemberIds) ? includedMemberIds : []).filter(id => memberIds.has(id)))];
    if (inc.length === 0) {
      throw new ExpensesApiError(400, "Select at least one participant to split equally");
    }
    const dist = distributeExactMinor(
      baseMinor,
      inc.map(id => ({ member_id: id, weight: 1 }))
    );
    for (const d of dist) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, 1);
    }
  } else if (mode === "SHARES") {
    const inc = [...new Set((Array.isArray(includedMemberIds) ? includedMemberIds : []).filter(id => memberIds.has(id)))];
    if (inc.length === 0) {
      throw new ExpensesApiError(400, "Select at least one participant");
    }
    const weighted = inc.map(id => {
      const m = members.find(x => x.id === id);
      const rawW = weightsMap && weightsMap[id] !== undefined ? Number(weightsMap[id]) : Number(m?.default_weight ?? 1);
      if (!Number.isFinite(rawW) || rawW <= 0 || rawW > 100) {
        throw new ExpensesApiError(400, "Share weight must be positive");
      }
      return { member_id: id, weight: rawW };
    });
    const dist = distributeExactMinor(baseMinor, weighted);
    for (const d of dist) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, d.share_value);
    }
  } else if (mode === "EXACT") {
    let sumExact = 0;
    for (const m of members) {
      const val = Math.round(Number(exactMinorMap?.[m.id]) || 0);
      if (val < 0) throw new ExpensesApiError(400, "Exact share cannot be negative");
      if (val > 0) {
        owedByMember.set(m.id, val);
        shareValByMember.set(m.id, val);
        sumExact += val;
      }
    }
    if (Math.abs(sumExact - baseMinor) > 1) {
      throw new ExpensesApiError(400, "Sum of exact amounts must equal total amount");
    }
    if (sumExact !== baseMinor && owedByMember.size > 0) {
      const lastKey = [...owedByMember.keys()].at(-1);
      owedByMember.set(lastKey, owedByMember.get(lastKey) + (baseMinor - sumExact));
    }
  } else if (mode === "PERCENT") {
    const pctItems = [];
    let sumPct = 0;
    for (const m of members) {
      const pct = Number(percentMap?.[m.id]) || 0;
      if (pct < 0) throw new ExpensesApiError(400, "Percent cannot be negative");
      if (pct > 0) {
        pctItems.push({ member_id: m.id, weight: pct });
        sumPct += pct;
      }
    }
    if (pctItems.length === 0 || Math.abs(sumPct - 100) > 0.05) {
      throw new ExpensesApiError(400, "Percentages must sum to 100%");
    }
    const dist = distributeExactMinor(baseMinor, pctItems);
    for (const d of dist) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, d.share_value);
    }
  } else if (mode === "MANUAL_ITEMS") {
    const rawTotals = new Map();
    for (const item of normalizedItems) {
      const itemBaseMinor = Math.round(item.amount_minor * rate);
      const dist = distributeExactMinor(
        itemBaseMinor,
        item.member_ids.map(id => ({ member_id: id, weight: 1 }))
      );
      for (const d of dist) {
        rawTotals.set(d.member_id, (rawTotals.get(d.member_id) || 0) + d.amount_minor);
      }
    }
    const totalRaw = [...rawTotals.values()].reduce((s, v) => s + v, 0);
    if (totalRaw <= 0) {
      throw new ExpensesApiError(400, "Items distribution failed");
    }
    const scaled = distributeExactMinor(
      baseMinor,
      [...rawTotals.entries()].map(([member_id, weight]) => ({ member_id, weight }))
    );
    for (const d of scaled) {
      owedByMember.set(d.member_id, d.amount_minor);
      shareValByMember.set(d.member_id, d.amount_minor);
    }
  }

  const allInvolved = new Set([...paidByMember.keys(), ...owedByMember.keys()]);
  const splits = [];
  for (const memberId of allInvolved) {
    const paid = paidByMember.get(memberId) || 0;
    const owed = owedByMember.get(memberId) || 0;
    if (paid === 0 && owed === 0) continue;
    splits.push({
      member_id: memberId,
      paid_amount_minor: paid,
      owed_amount_minor: owed,
      share_value: shareValByMember.get(memberId) || 0
    });
  }

  return {
    operation_type: opType,
    split_type: mode,
    original_amount_minor: origMinor,
    exchange_rate: rate,
    base_amount_minor: baseMinor,
    normalized_items: normalizedItems,
    splits
  };
}

export function computeEventSettlementPlan(members, operations, confirmedSettlements = [], pendingSettlements = [], simplify = true) {
  const units = buildSettlementUnits(members);
  const unitBalancesMinor = {};
  for (const u of units) unitBalancesMinor[u.id] = 0;

  const pairMatrix = new Map();
  const addPair = (fromUnit, toUnit, amtMinor) => {
    if (!fromUnit || !toUnit || fromUnit === toUnit || !amtMinor) return;
    const key = `${fromUnit}|${toUnit}`;
    pairMatrix.set(key, (pairMatrix.get(key) || 0) + amtMinor);
  };

  for (const op of operations || []) {
    const splits = Array.isArray(op.splits) ? op.splits : [];
    const payers = splits.filter(s => (Number(s.paid_amount_minor) || 0) > 0);
    const totalPaid = payers.reduce((s, p) => s + (Number(p.paid_amount_minor) || 0), 0);

    for (const s of splits) {
      const u = getUnitHeadId(members, s.member_id);
      const paid = Number(s.paid_amount_minor) || 0;
      const owed = Number(s.owed_amount_minor) || 0;
      unitBalancesMinor[u] = (unitBalancesMinor[u] || 0) + (paid - owed);

      if (owed > 0 && totalPaid > 0) {
        const dist = distributeExactMinor(
          owed,
          payers.map(p => ({ member_id: p.member_id, weight: Number(p.paid_amount_minor) || 0 }))
        );
        for (const d of dist) {
          const payerUnit = getUnitHeadId(members, d.member_id);
          addPair(u, payerUnit, d.amount_minor);
        }
      }
    }
  }

  for (const st of confirmedSettlements || []) {
    const fromU = getUnitHeadId(members, st.from_member_id);
    const toU = getUnitHeadId(members, st.to_member_id);
    const amt = Number(st.allocated_amount_minor ?? st.total_amount_minor) || 0;
    if (fromU && toU && amt > 0) {
      unitBalancesMinor[fromU] = (unitBalancesMinor[fromU] || 0) + amt;
      unitBalancesMinor[toU] = (unitBalancesMinor[toU] || 0) - amt;
      addPair(toU, fromU, amt);
    }
  }

  const isPendingEdge = (fromU, toU) =>
    (pendingSettlements || []).some(st =>
      getUnitHeadId(members, st.from_member_id) === fromU &&
      getUnitHeadId(members, st.to_member_id) === toU
    );

  if (simplify) {
    const debtors = [];
    const creditors = [];
    for (const [id, bal] of Object.entries(unitBalancesMinor)) {
      const r = Math.round(bal);
      if (r < 0) debtors.push({ id, amt: -r });
      else if (r > 0) creditors.push({ id, amt: r });
    }
    debtors.sort((a, b) => (b.amt - a.amt) || a.id.localeCompare(b.id));
    creditors.sort((a, b) => (b.amt - a.amt) || a.id.localeCompare(b.id));

    const edges = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const amt = Math.min(d.amt, c.amt);
      if (amt > 0) {
        edges.push({
          from_unit_id: d.id,
          to_unit_id: c.id,
          amount_minor: amt,
          pending: isPendingEdge(d.id, c.id)
        });
      }
      d.amt -= amt;
      c.amt -= amt;
      if (d.amt <= 0) i += 1;
      if (c.amt <= 0) j += 1;
    }
    return { units, unit_balances_minor: unitBalancesMinor, edges };
  }

  const seen = new Set();
  const directEdges = [];
  for (const key of pairMatrix.keys()) {
    if (seen.has(key)) continue;
    const [a, b] = key.split("|");
    seen.add(`${a}|${b}`);
    seen.add(`${b}|${a}`);
    const ab = pairMatrix.get(`${a}|${b}`) || 0;
    const ba = pairMatrix.get(`${b}|${a}`) || 0;
    const net = Math.round(ab - ba);
    if (net > 0) {
      directEdges.push({
        from_unit_id: a,
        to_unit_id: b,
        amount_minor: net,
        pending: isPendingEdge(a, b)
      });
    } else if (net < 0) {
      directEdges.push({
        from_unit_id: b,
        to_unit_id: a,
        amount_minor: -net,
        pending: isPendingEdge(b, a)
      });
    }
  }
  return { units, unit_balances_minor: unitBalancesMinor, edges: directEdges };
}
