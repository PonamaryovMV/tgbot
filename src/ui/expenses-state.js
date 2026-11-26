import {
  API_ORIGIN,
  tg,
  isTelegramSession,
  DEMO_USERS,
  state,
  triggerHaptic,
  showToast,
  readApiResponse
} from "./state.js";
import { getSuperappState, renderSuperappHub } from "./hub.js";

export const EXPENSES_DEMO_STORAGE_KEY = "tg_expenses_stage4_demo_v1";
export const EXPENSE_ICONS = ["🎉", "🎄", "🍸", "🏖", "🎂", "🚗", "🏕", "🏙", "⚽", "🎮"];
export const EXPENSE_CATEGORIES = [
  { id: "food", label: "Еда", icon: "food" },
  { id: "grocery", label: "Продукты", icon: "grocery" },
  { id: "home", label: "Жильё", icon: "home" },
  { id: "taxi", label: "Транспорт", icon: "taxi" },
  { id: "fun", label: "Развлечения", icon: "fun" },
  { id: "other", label: "Другое", icon: "package" }
];

const viewHooks = {
  renderExpensesModule: () => {}
};

export function registerExpensesStateHooks(hooks) {
  Object.assign(viewHooks, hooks);
}

export function getCategoryIconByLabel(label) {
  const found = EXPENSE_CATEGORIES.find(c => c.label === label || c.id === label);
  return found ? found.icon : "package";
}

export function getExpensesCurrencySymbol(code) {
  const map = { RUB: "₽", USD: "$", EUR: "€", KZT: "₸", TRY: "₺", GEL: "₾" };
  return map[String(code || "RUB").toUpperCase()] || code || "₽";
}

export function formatExpenseMinor(minor, currency = "RUB") {
  const sym = getExpensesCurrencySymbol(currency);
  const val = Math.round(Number(minor) || 0) / 100;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(val);
  return `${formatted} ${sym}`;
}

export function getInitialDemoExpensesData() {
  const now = new Date().toISOString();
  const meName = typeof DEMO_USERS !== "undefined" ? DEMO_USERS.owner.name : "Максим";
  return {
    events: [
      {
        id: "demo_ev_1",
        title: "Новый год 2027",
        description: "Коттедж и продукты на компанию",
        icon: "🎄",
        base_currency: "RUB",
        creator_id: "usr_1001",
        simplify_debts: true,
        status: "ACTIVE",
        invite_token: "exp_demo2027ny",
        created_at: now,
        updated_at: now,
        viewer_member_id: "mem_1",
        viewer_role: "OWNER",
        total_spent_minor: 3600000,
        net_balance_minor: 1200000,
        members: [
          {
            id: "mem_1",
            event_id: "demo_ev_1",
            user_id: "usr_1001",
            telegram_id: 1001,
            username: "maxim",
            member_name: meName,
            role: "OWNER",
            default_weight: 1,
            linked_payer_member_id: null,
            payment_phone: "+7 999 123-45-67",
            preferred_banks: ["Т-Банк", "Сбер"]
          },
          {
            id: "mem_2",
            event_id: "demo_ev_1",
            user_id: "usr_2002",
            telegram_id: 2002,
            username: "anna1",
            member_name: "Анна",
            role: "MEMBER",
            default_weight: 1,
            linked_payer_member_id: null,
            payment_phone: "+7 916 555-33-19",
            preferred_banks: ["Т-Банк", "ВТБ"]
          },
          {
            id: "mem_3",
            event_id: "demo_ev_1",
            user_id: "usr_3003",
            telegram_id: 3003,
            username: "dima1",
            member_name: "Дима",
            role: "MEMBER",
            default_weight: 1,
            linked_payer_member_id: null,
            payment_phone: "",
            preferred_banks: []
          }
        ],
        operations: [
          {
            id: "demo_op_1",
            event_id: "demo_ev_1",
            created_by_member_id: "mem_1",
            operation_type: "EXPENSE",
            title: "Аренда коттеджа",
            category: "Жильё",
            original_amount_minor: 2400000,
            original_currency: "RUB",
            exchange_rate: 1,
            base_amount_minor: 2400000,
            split_type: "EQUAL",
            items: [],
            split_meta: { included_member_ids: ["mem_1", "mem_2", "mem_3"] },
            comment: "Дом с баней на двое суток",
            expense_date: new Date().toISOString().slice(0, 10),
            created_at: now,
            payers: ["mem_1"],
            shares_minor: { mem_1: 800000, mem_2: 800000, mem_3: 800000 },
            splits: [
              { member_id: "mem_1", paid_amount_minor: 2400000, owed_amount_minor: 800000, share_value: 1 },
              { member_id: "mem_2", paid_amount_minor: 0, owed_amount_minor: 800000, share_value: 1 },
              { member_id: "mem_3", paid_amount_minor: 0, owed_amount_minor: 800000, share_value: 1 }
            ]
          },
          {
            id: "demo_op_2",
            event_id: "demo_ev_1",
            created_by_member_id: "mem_2",
            operation_type: "EXPENSE",
            title: "Продукты и напитки",
            category: "Продукты",
            original_amount_minor: 1200000,
            original_currency: "RUB",
            exchange_rate: 1,
            base_amount_minor: 1200000,
            split_type: "EQUAL",
            items: [],
            split_meta: { included_member_ids: ["mem_1", "mem_2", "mem_3"] },
            comment: "",
            expense_date: new Date().toISOString().slice(0, 10),
            created_at: now,
            payers: ["mem_2"],
            shares_minor: { mem_1: 400000, mem_2: 400000, mem_3: 400000 },
            splits: [
              { member_id: "mem_1", paid_amount_minor: 0, owed_amount_minor: 400000, share_value: 1 },
              { member_id: "mem_2", paid_amount_minor: 1200000, owed_amount_minor: 400000, share_value: 1 },
              { member_id: "mem_3", paid_amount_minor: 0, owed_amount_minor: 400000, share_value: 1 }
            ]
          }
        ],
        settlements: [],
        audit_log: [
          {
            id: "log_2",
            action: "OPERATION_ADDED",
            text: "Анна добавил(а) трату «Продукты и напитки» — 12 000 ₽",
            created_at: now
          },
          {
            id: "log_1",
            action: "OPERATION_ADDED",
            text: `${meName} добавил(а) трату «Аренда коттеджа» — 24 000 ₽`,
            created_at: now
          }
        ]
      }
    ]
  };
}

export function loadDemoExpensesStore() {
  try {
    const raw = localStorage.getItem(EXPENSES_DEMO_STORAGE_KEY);
    if (!raw) return getInitialDemoExpensesData();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.events)) return getInitialDemoExpensesData();
    return parsed;
  } catch {
    return getInitialDemoExpensesData();
  }
}

export function saveDemoExpensesStore(store) {
  try {
    localStorage.setItem(EXPENSES_DEMO_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Игнорируем ошибку квоты
  }
}

export function getClientUnitHeadId(members, memberId) {
  const byId = new Map((members || []).map(m => [m.id, m]));
  const m = byId.get(memberId);
  if (!m) return memberId;
  return m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
    ? m.linked_payer_member_id
    : m.id;
}

export function computeWalletsFromClientMembers(members) {
  const groups = new Map();
  for (const m of members || []) {
    const headId = getClientUnitHeadId(members, m.id);
    if (!groups.has(headId)) groups.set(headId, []);
    groups.get(headId).push(m);
  }
  const wallets = [];
  for (const [headId, list] of groups.entries()) {
    if (list.length >= 2) {
      wallets.push({
        id: headId,
        head_member_id: headId,
        name: list.map(m => m.member_name).join(" + "),
        member_ids: list.map(m => m.id)
      });
    }
  }
  return wallets;
}

export function computeClientSettlementPlan(ev) {
  const members = Array.isArray(ev.members) ? ev.members : [];
  const ops = Array.isArray(ev.operations) ? ev.operations : [];
  const settlements = Array.isArray(ev.settlements) ? ev.settlements : [];
  const confirmed = settlements.filter(s => s.status === "CONFIRMED");
  const pending = settlements.filter(s => s.status === "PENDING");

  const unitGroups = new Map();
  for (const m of members) {
    const headId = getClientUnitHeadId(members, m.id);
    if (!unitGroups.has(headId)) unitGroups.set(headId, []);
    unitGroups.get(headId).push(m);
  }

  const units = [];
  const unitBalances = {};
  for (const [headId, list] of unitGroups.entries()) {
    const recipient = list.find(x => x.payment_phone) || list.find(x => Boolean(x.user_id)) || list[0];
    units.push({
      id: headId,
      name: list.length >= 2 ? list.map(x => x.member_name).join(" + ") : list[0].member_name,
      is_wallet: list.length >= 2,
      member_ids: list.map(x => x.id),
      payment_phone: recipient?.payment_phone || "",
      preferred_banks: Array.isArray(recipient?.preferred_banks) ? recipient.preferred_banks : []
    });
    unitBalances[headId] = 0;
  }

  const pairMap = new Map();
  const addPair = (fromU, toU, amt) => {
    if (!fromU || !toU || fromU === toU || amt <= 0) return;
    const k = `${fromU}|${toU}`;
    pairMap.set(k, (pairMap.get(k) || 0) + amt);
  };

  for (const op of ops) {
    const splits = Array.isArray(op.splits) ? op.splits : [];
    const payers = splits.filter(s => (Number(s.paid_amount_minor) || 0) > 0);
    const totalPaid = payers.reduce((s, p) => s + (Number(p.paid_amount_minor) || 0), 0);

    for (const s of splits) {
      const u = getClientUnitHeadId(members, s.member_id);
      const paid = Number(s.paid_amount_minor) || 0;
      const owed = Number(s.owed_amount_minor) || 0;
      unitBalances[u] = (unitBalances[u] || 0) + (paid - owed);

      if (owed > 0 && totalPaid > 0) {
        payers.forEach((p, idx) => {
          const share = idx === payers.length - 1
            ? owed - payers.slice(0, idx).reduce((acc, x) => acc + Math.round(owed * (Number(x.paid_amount_minor) || 0) / totalPaid), 0)
            : Math.round(owed * (Number(p.paid_amount_minor) || 0) / totalPaid);
          addPair(u, getClientUnitHeadId(members, p.member_id), share);
        });
      }
    }
  }

  for (const st of confirmed) {
    const fromU = getClientUnitHeadId(members, st.from_member_id);
    const toU = getClientUnitHeadId(members, st.to_member_id);
    const amt = Number(st.allocated_amount_minor ?? st.total_amount_minor) || 0;
    if (fromU && toU && amt > 0) {
      unitBalances[fromU] = (unitBalances[fromU] || 0) + amt;
      unitBalances[toU] = (unitBalances[toU] || 0) - amt;
      addPair(toU, fromU, amt);
    }
  }

  const isPending = (fromU, toU) =>
    pending.some(st =>
      getClientUnitHeadId(members, st.from_member_id) === fromU &&
      getClientUnitHeadId(members, st.to_member_id) === toU
    );

  let edges = [];
  if (ev.simplify_debts) {
    const debtors = [];
    const creditors = [];
    for (const [id, bal] of Object.entries(unitBalances)) {
      if (bal < 0) debtors.push({ id, amt: -bal });
      else if (bal > 0) creditors.push({ id, amt: bal });
    }
    debtors.sort((a, b) => b.amt - a.amt);
    creditors.sort((a, b) => b.amt - a.amt);
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const amt = Math.min(d.amt, c.amt);
      if (amt > 0) {
        edges.push({ from_unit_id: d.id, to_unit_id: c.id, amount_minor: amt, pending: isPending(d.id, c.id) });
      }
      d.amt -= amt;
      c.amt -= amt;
      if (d.amt <= 0) i += 1;
      if (c.amt <= 0) j += 1;
    }
  } else {
    const seen = new Set();
    for (const key of pairMap.keys()) {
      if (seen.has(key)) continue;
      const [a, b] = key.split("|");
      seen.add(`${a}|${b}`);
      seen.add(`${b}|${a}`);
      const net = (pairMap.get(`${a}|${b}`) || 0) - (pairMap.get(`${b}|${a}`) || 0);
      if (net > 0) edges.push({ from_unit_id: a, to_unit_id: b, amount_minor: net, pending: isPending(a, b) });
      else if (net < 0) edges.push({ from_unit_id: b, to_unit_id: a, amount_minor: -net, pending: isPending(b, a) });
    }
  }

  ev.units = units;
  ev.unit_balances_minor = unitBalances;
  ev.settlement_edges = edges;
  ev.viewer_unit_id = ev.viewer_member_id ? getClientUnitHeadId(members, ev.viewer_member_id) : (units[0]?.id || null);
  ev.total_spent_minor = ops
    .filter(o => o.operation_type !== "TRANSFER")
    .reduce((sum, o) => sum + (Number(o.base_amount_minor) || 0), 0);
  ev.net_balance_minor = ev.viewer_unit_id ? (unitBalances[ev.viewer_unit_id] || 0) : 0;
}

export function getExpensesState() {
  if (!state.expenses) {
    state.expenses = {
      view: "dashboard",
      activeTab: "ops",
      settleView: "graph",
      focusedUnitId: null,
      loading: false,
      activeEvents: [],
      archivedEvents: [],
      crossEventDebts: [],
      currentEvent: null,
      mergeSelection: [],
      contacts: [],
      contactsLoading: false,
      newEventIcon: "🎉",
      newEventSimplify: true,
      newEventMembers: [],
      editEventDraft: null,
      pendingSelectionContext: null,
      opDraft: null,
      settleCtx: null
    };
  }
  return state.expenses;
}

export async function loadExpensesContacts(silent = false) {
  const exp = getExpensesState();
  exp.contactsLoading = true;
  const previousIds = new Set((exp.contacts || []).map(c => Number(c.telegram_id)));

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/contacts`, {
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      exp.contacts = Array.isArray(data.contacts) ? data.contacts : [];
      if (exp.pendingSelectionContext?.mode === "new_event") {
        const before = exp.pendingSelectionContext.beforeIds || previousIds;
        const newlyPicked = exp.contacts.filter(c => !before.has(Number(c.telegram_id)));
        if (newlyPicked.length > 0) {
          for (const person of newlyPicked) {
            if (!exp.newEventMembers.some(m => Number(m.telegram_id) === Number(person.telegram_id))) {
              exp.newEventMembers.push(person);
            }
          }
          exp.pendingSelectionContext = null;
          const helpEl = document.getElementById("newEventSelectionHelp");
          if (helpEl) helpEl.hidden = true;
        }
      }
    } catch (error) {
      if (!silent) showToast(error.message || "Не удалось загрузить контакты");
    } finally {
      exp.contactsLoading = false;
    }
    return exp.contacts;
  }

  const demoList = [];
  const seen = new Set([Number(state.viewerId)]);
  for (const u of Object.values(DEMO_USERS)) {
    if (!seen.has(Number(u.id))) {
      seen.add(Number(u.id));
      demoList.push({
        telegram_id: u.id,
        username: u.username,
        display_name: u.name
      });
    }
  }
  for (const sub of state.subscriptions || []) {
    const id = Number(sub?.id);
    if (id && !seen.has(id)) {
      seen.add(id);
      demoList.push({
        telegram_id: id,
        username: sub.username || "",
        display_name: sub.first_name || "Пользователь"
      });
    }
  }
  exp.contacts = demoList;
  exp.contactsLoading = false;
  return exp.contacts;
}

export function syncExpensesSummaryToHub() {
  const exp = getExpensesState();
  const hub = getSuperappState();
  if (!hub) return;

  hub.activeEventsCount = exp.activeEvents.length;
  let oweMe = 0;
  let iOwe = 0;
  for (const ev of exp.activeEvents) {
    const bal = Number(ev.net_balance_minor) || 0;
    if (bal > 0) oweMe += bal;
    else if (bal < 0) iOwe += Math.abs(bal);
  }
  hub.oweMeMinor = oweMe;
  hub.iOweMinor = iOwe;
  renderSuperappHub();
}

export async function loadExpensesDashboard() {
  const exp = getExpensesState();
  exp.loading = true;
  viewHooks.renderExpensesModule();

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/dashboard`, {
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      exp.activeEvents = Array.isArray(data.active_events) ? data.active_events : [];
      exp.archivedEvents = Array.isArray(data.archived_events) ? data.archived_events : [];
      exp.crossEventDebts = Array.isArray(data.cross_event_debts) ? data.cross_event_debts : [];
    } catch (error) {
      showToast(error.message || "Не удалось загрузить события");
    } finally {
      exp.loading = false;
      syncExpensesSummaryToHub();
      viewHooks.renderExpensesModule();
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const crossMap = new Map();
  for (const ev of demo.events) {
    computeClientSettlementPlan(ev);
    if (ev.status === "ARCHIVED") continue;
    const myU = ev.viewer_unit_id;
    for (const edge of ev.settlement_edges || []) {
      let otherU = null;
      let sign = 0;
      if (edge.from_unit_id === myU) { otherU = edge.to_unit_id; sign = -1; }
      else if (edge.to_unit_id === myU) { otherU = edge.from_unit_id; sign = 1; }
      if (!otherU) continue;
      const unitObj = (ev.units || []).find(u => u.id === otherU);
      if (!unitObj) continue;
      const key = `${ev.base_currency}|${unitObj.name.toLowerCase()}`;
      if (!crossMap.has(key)) {
        crossMap.set(key, {
          key,
          currency: ev.base_currency || "RUB",
          name: unitObj.name,
          is_wallet: unitObj.is_wallet,
          payment_phone: unitObj.payment_phone || "",
          preferred_banks: unitObj.preferred_banks || [],
          net_minor: 0,
          allocations: []
        });
      }
      const rec = crossMap.get(key);
      rec.net_minor += sign * edge.amount_minor;
      rec.allocations.push({
        event_id: ev.id,
        event_title: ev.title,
        from_member_id: ev.viewer_member_id,
        to_member_id: unitObj.id,
        amount_minor: sign * edge.amount_minor
      });
    }
  }
  saveDemoExpensesStore(demo);

  exp.activeEvents = demo.events
    .filter(e => e.status !== "ARCHIVED")
    .map(e => ({ ...e, members_count: (e.members || []).length }));
  exp.archivedEvents = demo.events
    .filter(e => e.status === "ARCHIVED")
    .map(e => ({ ...e, members_count: (e.members || []).length }));
  exp.crossEventDebts = [...crossMap.values()].filter(x => Math.abs(x.net_minor) > 0);
  exp.loading = false;
  syncExpensesSummaryToHub();
  viewHooks.renderExpensesModule();
}

export async function openExpenseEvent(eventId) {
  const exp = getExpensesState();
  triggerHaptic("light");

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(eventId)}`, {
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.view = "event";
        exp.activeTab = "ops";
        exp.focusedUnitId = null;
        viewHooks.renderExpensesModule();
      }
    } catch (error) {
      showToast(error.message || "Не удалось открыть событие");
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const found = demo.events.find(e => e.id === eventId);
  if (found) {
    found.wallets = computeWalletsFromClientMembers(found.members || []);
    computeClientSettlementPlan(found);
    exp.currentEvent = found;
    exp.view = "event";
    exp.activeTab = "ops";
    exp.focusedUnitId = null;
    viewHooks.renderExpensesModule();
  }
}

export function backToExpensesDashboard() {
  const exp = getExpensesState();
  exp.view = "dashboard";
  exp.currentEvent = null;
  exp.focusedUnitId = null;
  triggerHaptic("light");
  loadExpensesDashboard();
}

export function switchExpenseEventTab(tabName) {
  const exp = getExpensesState();
  exp.activeTab = tabName;
  exp.focusedUnitId = null;
  triggerHaptic("light");
  viewHooks.renderExpensesModule();
}

export function switchSettleSubView(viewName) {
  const exp = getExpensesState();
  exp.settleView = viewName;
  exp.focusedUnitId = null;
  viewHooks.renderExpensesModule();
}
