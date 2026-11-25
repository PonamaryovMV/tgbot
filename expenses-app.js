/**
 * Модуль 4: «Совместные расходы» (Этапы 2–5) — дашборд событий, создание события,
 * виртуальные участники (Ghost Profiles), веса, «Единый кошелёк», Claim Profile,
 * операции (Расход / В котёл / Перевод), 5 режимов сплита, SVG-граф долгов,
 * кросс-событийная сводка, 2-шаговое погашение по СБП, целевые сборы и CSV-экспорт.
 */
const EXPENSES_DEMO_STORAGE_KEY = "tg_expenses_stage5_demo_v1";
const EXPENSE_ICONS = ["🎉", "🎄", "🍸", "🏖", "🎂", "🚗", "🏕", "🏙", "⚽", "🎮"];
const EXPENSE_CATEGORIES = [
  { id: "food", label: "Еда", icon: "🍽" },
  { id: "grocery", label: "Продукты", icon: "🛒" },
  { id: "home", label: "Жильё", icon: "🏠" },
  { id: "taxi", label: "Транспорт", icon: "🚕" },
  { id: "fun", label: "Развлечения", icon: "🎉" },
  { id: "other", label: "Другое", icon: "📦" }
];

function getCategoryIconByLabel(label) {
  const found = EXPENSE_CATEGORIES.find(c => c.label === label || c.id === label);
  return found ? found.icon : "📦";
}

function getExpensesCurrencySymbol(code) {
  const map = { RUB: "₽", USD: "$", EUR: "€", KZT: "₸", TRY: "₺", GEL: "₾" };
  return map[String(code || "RUB").toUpperCase()] || code || "₽";
}

function formatExpenseMinor(minor, currency = "RUB") {
  const sym = getExpensesCurrencySymbol(currency);
  const val = Math.round((Number(minor) || 0)) / 100;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(val);
  return `${formatted} ${sym}`;
}

function getInitialDemoExpensesData() {
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
            is_ghost: false,
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
            is_ghost: false,
            role: "MEMBER",
            default_weight: 1,
            linked_payer_member_id: null,
            payment_phone: "+7 916 555-33-19",
            preferred_banks: ["Т-Банк", "ВТБ"]
          },
          {
            id: "mem_3",
            event_id: "demo_ev_1",
            user_id: null,
            telegram_id: null,
            username: "",
            member_name: "Гоша",
            is_ghost: true,
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
        goal: {
          id: "demo_goal_1",
          event_id: "demo_ev_1",
          title: "Предоплата за коттедж",
          target_per_member_minor: 500000,
          receiver_member_id: "mem_1",
          status: "ACTIVE",
          contributions: [
            { member_id: "mem_1", member_name: meName, status: "PAID" },
            { member_id: "mem_2", member_name: "Анна", status: "PENDING" },
            { member_id: "mem_3", member_name: "Гоша", status: "UNPAID" }
          ]
        },
        audit_log: [
          {
            id: "log_2",
            action: "OPERATION_ADDED",
            text: `Анна добавил(а) трату «Продукты и напитки» — 12 000 ₽`,
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

function loadDemoExpensesStore() {
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

function saveDemoExpensesStore(store) {
  try {
    localStorage.setItem(EXPENSES_DEMO_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Игнорируем ошибку квоты
  }
}

function getClientUnitHeadId(members, memberId) {
  const byId = new Map((members || []).map(m => [m.id, m]));
  const m = byId.get(memberId);
  if (!m) return memberId;
  return m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
    ? m.linked_payer_member_id
    : m.id;
}

function computeWalletsFromClientMembers(members) {
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

function computeClientSettlementPlan(ev) {
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
    const recipient = list.find(x => x.payment_phone) || list.find(x => !x.is_ghost) || list[0];
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

function getExpensesState() {
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
      newEventIcon: "🎉",
      newEventSimplify: true,
      opDraft: null,
      settleCtx: null
    };
  }
  return state.expenses;
}

function syncExpensesSummaryToHub() {
  const exp = getExpensesState();
  const hub = typeof getSuperappState === "function" ? getSuperappState() : null;
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
  if (typeof renderSuperappHub === "function") {
    renderSuperappHub();
  }
}

async function loadExpensesDashboard() {
  const exp = getExpensesState();
  exp.loading = true;
  renderExpensesModule();

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/dashboard`, {
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      exp.activeEvents = Array.isArray(data.active_events) ? data.active_events : [];
      exp.archivedEvents = Array.isArray(data.archived_events) ? data.archived_events : [];
      exp.crossEventDebts = Array.isArray(data.cross_event_debts) ? data.cross_event_debts : [];
    } catch (error) {
      if (typeof showToast === "function") {
        showToast(`❌ ${error.message || "Не удалось загрузить события"}`);
      }
    } finally {
      exp.loading = false;
      syncExpensesSummaryToHub();
      renderExpensesModule();
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
  renderExpensesModule();
}

function getEventStatusBadge(status) {
  if (status === "ARCHIVED") return `<span class="exp-status-pill archived">Архив</span>`;
  if (status === "SETTLING") return `<span class="exp-status-pill settling">Расчёты · заморожено</span>`;
  return `<span class="exp-status-pill active">Активно</span>`;
}

function renderExpensesModule() {
  const exp = getExpensesState();
  const dashView = document.getElementById("expensesDashboardView");
  const detailView = document.getElementById("expenseEventDetailView");
  if (!dashView || !detailView) return;

  const isDetail = exp.view === "event" && Boolean(exp.currentEvent);
  dashView.hidden = isDetail;
  detailView.hidden = !isDetail;

  if (isDetail) {
    renderExpenseEventDetail();
  } else {
    renderExpensesDashboard();
  }
}

function renderExpensesDashboard() {
  const exp = getExpensesState();
  const activeContainer = document.getElementById("expensesActiveEventsList");
  const archivedSection = document.getElementById("expensesArchivedSection");
  const archivedContainer = document.getElementById("expensesArchivedEventsList");
  const crossContainer = document.getElementById("expensesCrossPeopleSection");
  if (!activeContainer) return;

  if (crossContainer) {
    if (!exp.loading && exp.crossEventDebts.length > 0) {
      crossContainer.innerHTML = `
        <div class="hub-section-label">По людям <span style="text-transform: none; font-weight: 500; opacity: 0.75;">с учётом всех событий</span></div>
        <div class="composer-card" style="padding: 8px 14px; margin-bottom: 14px;">
          ${exp.crossEventDebts.map(c => {
            const isPos = c.net_minor > 0;
            const nEv = c.allocations.length;
            return `
              <button type="button" class="exp-edge-row" onclick="openCrossPersonSettleModal('${escapeHtml(c.key)}')">
                <div class="exp-member-avatar">${escapeHtml(c.name.slice(0, 2).toUpperCase())}</div>
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 14.5px; font-weight: 700;">${escapeHtml(c.name)}</div>
                  <div style="font-size: 12px; color: var(--tg-theme-hint-color);">${isPos ? "Вам должны" : "Вы должны"} · ${nEv} событ.</div>
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                  <div class="exp-event-bal ${isPos ? "pos" : "neg"}">${formatExpenseMinor(Math.abs(c.net_minor), c.currency)}</div>
                  <span class="btn-mini" style="margin-top: 4px;">${isPos ? "Напомнить" : "Закрыть долг"}</span>
                </div>
              </button>
            `;
          }).join("")}
        </div>
      `;
    } else {
      crossContainer.innerHTML = "";
    }
  }

  if (exp.loading) {
    activeContainer.innerHTML = `<div class="composer-card" style="text-align: center; color: var(--tg-theme-hint-color);">Загрузка событий...</div>`;
    return;
  }

  const renderCard = (ev) => {
    const count = Number(ev.members_count || ev.members?.length || 1);
    const totalSpent = Number(ev.total_spent_minor) || 0;
    const bal = Number(ev.net_balance_minor) || 0;
    const balText = bal > 0
      ? `+${formatExpenseMinor(bal, ev.base_currency)}`
      : bal < 0
        ? `−${formatExpenseMinor(Math.abs(bal), ev.base_currency)}`
        : "0 " + getExpensesCurrencySymbol(ev.base_currency);
    const balCls = bal > 0 ? "pos" : bal < 0 ? "neg" : "";
    return `
      <button type="button" class="exp-event-card" data-event-id="${escapeHtml(ev.id)}" onclick="openExpenseEvent('${escapeHtml(ev.id)}')">
        <div class="exp-event-icon">${escapeHtml(ev.icon || "🎉")}</div>
        <div class="exp-event-info">
          <div class="exp-event-title">${escapeHtml(ev.title)}</div>
          <div class="exp-event-meta">${count} уч. · ${formatExpenseMinor(totalSpent, ev.base_currency)}</div>
        </div>
        <div class="exp-event-right">
          <div class="exp-event-bal ${balCls}">${balText}</div>
          ${getEventStatusBadge(ev.status)}
        </div>
      </button>
    `;
  };

  if (exp.activeEvents.length === 0) {
    activeContainer.innerHTML = `
      <div class="empty-bento" style="padding: 32px 18px;">
        <div class="empty-orb">💸</div>
        <div class="empty-heading" style="font-size: 17px;">Пока нет активных событий</div>
        <div class="empty-subtext">Создайте поездку, ужин или праздник и добавьте участников, чтобы вести общий бюджет.</div>
      </div>
    `;
  } else {
    activeContainer.innerHTML = exp.activeEvents.map(renderCard).join("");
  }

  if (archivedSection && archivedContainer) {
    if (exp.archivedEvents.length > 0) {
      archivedSection.hidden = false;
      archivedContainer.innerHTML = exp.archivedEvents.map(renderCard).join("");
    } else {
      archivedSection.hidden = true;
      archivedContainer.innerHTML = "";
    }
  }
}

async function openExpenseEvent(eventId) {
  const exp = getExpensesState();
  if (typeof triggerHaptic === "function") triggerHaptic("light");

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(eventId)}`, {
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.view = "event";
        exp.activeTab = "ops";
        exp.focusedUnitId = null;
        renderExpensesModule();
      }
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось открыть событие"}`);
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
    renderExpensesModule();
  }
}

function backToExpensesDashboard() {
  const exp = getExpensesState();
  exp.view = "dashboard";
  exp.currentEvent = null;
  exp.focusedUnitId = null;
  if (typeof triggerHaptic === "function") triggerHaptic("light");
  loadExpensesDashboard();
}

function switchExpenseEventTab(tabName) {
  const exp = getExpensesState();
  exp.activeTab = tabName;
  exp.focusedUnitId = null;
  if (typeof triggerHaptic === "function") triggerHaptic("light");
  renderExpenseEventDetail();
}

function switchSettleSubView(viewName) {
  const exp = getExpensesState();
  exp.settleView = viewName;
  exp.focusedUnitId = null;
  renderExpenseEventDetail();
}

function buildOperationPersonalLabel(ev, op) {
  const viewerId = ev.viewer_member_id;
  if (!viewerId) return { cls: "none", text: "" };
  const mySplit = (op.splits || []).find(s => s.member_id === viewerId);
  const paid = Number(mySplit?.paid_amount_minor) || 0;
  const owed = Number(mySplit?.owed_amount_minor) || 0;
  if (paid === 0 && owed === 0) return { cls: "none", text: "Не участвуете" };
  const diff = paid - owed;
  const cur = ev.base_currency || "RUB";
  if (Math.abs(diff) < 1) return { cls: "none", text: "Без долга" };
  if (diff > 0) return { cls: "pos", text: `Вам должны +${formatExpenseMinor(diff, cur)}` };
  return { cls: "neg", text: `Ваша доля −${formatExpenseMinor(Math.abs(diff), cur)}` };
}

function renderEventGoalSection(ev) {
  const goal = ev.goal;
  const cur = ev.base_currency || "RUB";
  const members = Array.isArray(ev.members) ? ev.members : [];
  if (!goal) {
    return `
      <button type="button" class="btn-glass" style="width: 100%; min-height: 40px; font-size: 13px; margin-bottom: 12px;" onclick="openCreateGoalModal()">
        🎯 Открыть целевой сбор фиксированной суммы
      </button>
    `;
  }

  const contribs = Array.isArray(goal.contributions) ? goal.contributions : [];
  const perMember = Number(goal.target_per_member_minor) || 0;
  const paidCount = contribs.filter(c => c.status === "PAID").length;
  const totalCount = contribs.length || members.length || 1;
  const collectedMinor = paidCount * perMember;
  const targetMinor = totalCount * perMember;
  const pct = targetMinor > 0 ? Math.min(100, Math.round((collectedMinor / targetMinor) * 100)) : 0;

  return `
    <div class="exp-goal-card">
      <div class="exp-goal-head">
        <div>
          <div class="exp-goal-title">🎯 ${escapeHtml(goal.title)}</div>
          <div style="font-size: 12px; color: var(--tg-theme-hint-color);">По ${formatExpenseMinor(perMember, cur)} с участника</div>
        </div>
        <strong class="tabular-nums" style="font-size: 13px;">${formatExpenseMinor(collectedMinor, cur)} / ${formatExpenseMinor(targetMinor, cur)}</strong>
      </div>
      <div class="exp-goal-progress">
        <div class="exp-goal-progress-fill" style="width: ${pct}%;"></div>
      </div>
      ${contribs.map(c => {
        const m = members.find(x => x.id === c.member_id);
        const name = c.member_name || m?.member_name || "Участник";
        const badge = c.status === "PAID"
          ? `<span class="exp-status-pill active">Сдал</span>`
          : c.status === "PENDING"
            ? `<span class="exp-status-pill settling">Отметил перевод</span>`
            : `<span class="exp-status-pill archived">Не сдал</span>`;
        const nextStatus = c.status === "UNPAID" ? "PENDING" : c.status === "PENDING" ? "PAID" : "UNPAID";
        const btnLabel = c.status === "UNPAID" ? "Отметить" : c.status === "PENDING" ? "Подтвердить" : "Сбросить";
        return `
          <div class="exp-goal-row">
            <span style="flex: 1; min-width: 0; font-weight: 600;">${escapeHtml(name)}</span>
            ${badge}
            <button type="button" class="btn-mini" onclick="cycleGoalContributionStatus('${escapeHtml(goal.id)}', '${escapeHtml(c.member_id)}', '${nextStatus}')">${btnLabel}</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function getAuditEventMeta(action) {
  const act = String(action || "").toUpperCase();
  if (act === "EXPENSE_CREATED" || act === "OPERATION_ADDED") {
    return { icon: "💳", badge: "Расход", bg: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" };
  }
  if (act === "EXPENSE_UPDATED" || act === "OPERATION_UPDATED") {
    return { icon: "✏️", badge: "Изменение", bg: "rgba(245, 158, 11, 0.15)", color: "#fbbf24" };
  }
  if (act === "EXPENSE_DELETED" || act === "OPERATION_DELETED") {
    return { icon: "🗑", badge: "Удаление", bg: "rgba(239, 68, 68, 0.15)", color: "#f87171" };
  }
  if (act === "SETTLEMENT_SENT") {
    return { icon: "📤", badge: "Перевод отправлен", bg: "rgba(99, 102, 241, 0.15)", color: "#818cf8" };
  }
  if (act === "SETTLEMENT_CONFIRMED") {
    return { icon: "✅", badge: "Перевод подтверждён", bg: "rgba(34, 197, 94, 0.15)", color: "#4ade80" };
  }
  if (act === "SETTLEMENT_REJECTED") {
    return { icon: "❌", badge: "Перевод отклонён", bg: "rgba(239, 68, 68, 0.15)", color: "#f87171" };
  }
  if (act === "SETTLEMENT_CANCELLED") {
    return { icon: "↩️", badge: "Перевод отозван", bg: "rgba(156, 163, 175, 0.18)", color: "#9ca3af" };
  }
  if (act === "MEMBER_ADDED" || act === "MEMBER_JOINED") {
    return { icon: "👤", badge: "Участник", bg: "rgba(168, 85, 247, 0.15)", color: "#c084fc" };
  }
  if (act === "MEMBER_REMOVED") {
    return { icon: "🚪", badge: "Участник удалён", bg: "rgba(239, 68, 68, 0.15)", color: "#f87171" };
  }
  if (act === "MEMBER_WEIGHT_UPDATED") {
    return { icon: "⚖️", badge: "Вес участника", bg: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" };
  }
  if (act === "EVENT_CREATED") {
    return { icon: "🎉", badge: "Событие создано", bg: "rgba(16, 185, 129, 0.15)", color: "#34d399" };
  }
  if (act === "EVENT_UPDATED" || act === "STATUS_CHANGED" || act === "SIMPLIFY_TOGGLED") {
    return { icon: "⚙️", badge: "Настройки", bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8" };
  }
  if (act.startsWith("GOAL_")) {
    return { icon: "🎯", badge: "Целевой сбор", bg: "rgba(236, 72, 153, 0.15)", color: "#f472b6" };
  }
  if (act === "WALLET_MERGED" || act === "WALLET_UNMERGED") {
    return { icon: "🤝", badge: "Единый кошелёк", bg: "rgba(6, 182, 212, 0.15)", color: "#22d3ee" };
  }
  return { icon: "📝", badge: "Событие", bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8" };
}

function renderExpenseEventDetail() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  const titleEl = document.getElementById("expDetailTitle");
  const subEl = document.getElementById("expDetailSub");
  const budgetEl = document.getElementById("expDetailBudget");
  const balLabelEl = document.getElementById("expDetailBalLabel");
  const balValEl = document.getElementById("expDetailBalValue");

  const members = Array.isArray(ev.members) ? ev.members : [];
  const wallets = computeWalletsFromClientMembers(members);
  ev.wallets = wallets;

  if (titleEl) titleEl.textContent = `${ev.icon || "🎉"} ${ev.title}`;
  if (subEl) {
    const statusText = ev.status === "ARCHIVED"
      ? "Архив"
      : ev.status === "SETTLING"
        ? "Траты заморожены"
        : "Активно";
    const walletsNote = wallets.length ? ` · ${wallets.length} общ. кошелёк` : "";
    subEl.textContent = `${members.length} уч.${walletsNote} · ${statusText}`;
  }

  const cur = ev.base_currency || "RUB";
  if (budgetEl) budgetEl.textContent = formatExpenseMinor(ev.total_spent_minor || 0, cur);
  const net = Number(ev.net_balance_minor) || 0;
  if (balLabelEl) balLabelEl.textContent = net >= 0 ? "Вам должны" : "Вы должны";
  if (balValEl) balValEl.textContent = formatExpenseMinor(Math.abs(net), cur);

  document.querySelectorAll("[data-exp-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-exp-tab") === exp.activeTab);
  });

  const bodyEl = document.getElementById("expDetailTabBody");
  if (!bodyEl) return;

  if (exp.activeTab === "ops") {
    const isFrozen = ev.status === "SETTLING" || ev.status === "ARCHIVED";
    const operations = Array.isArray(ev.operations) ? ev.operations : [];
    const nameById = new Map(members.map(m => [m.id, m.member_name]));

    const opsHtml = operations.length
      ? operations.map(op => {
          const payersNames = (op.payers || []).map(id => nameById.get(id) || "Участник").join(", ");
          const personal = buildOperationPersonalLabel(ev, op);
          const foreign = op.original_currency && op.original_currency !== cur;
          const ico = op.operation_type === "TRANSFER"
            ? "🔁"
            : op.operation_type === "PREPAYMENT"
              ? "🫙"
              : getCategoryIconByLabel(op.category);
          return `
            <button type="button" class="exp-op-card" data-op-id="${escapeHtml(op.id)}" onclick="openExpenseOperationModal('${escapeHtml(op.id)}')">
              <div class="exp-op-icon">${ico}</div>
              <div class="exp-op-main">
                <div class="exp-op-title">${escapeHtml(op.title || "Без названия")}</div>
                <div class="exp-op-meta">${escapeHtml(payersNames || "—")} · ${escapeHtml(op.expense_date || "")}${foreign ? ` · ${formatExpenseMinor(op.base_amount_minor, cur)}` : ""}</div>
              </div>
              <div class="exp-op-right">
                <div class="exp-op-amt">${formatExpenseMinor(op.original_amount_minor, op.original_currency || cur)}</div>
                <div class="exp-op-sub ${personal.cls}">${personal.text}</div>
              </div>
            </button>
          `;
        }).join("")
      : `<div class="composer-card" style="text-align: center; color: var(--tg-theme-hint-color);">Пока нет операций. Нажмите «＋ Добавить операцию», чтобы внести первую трату.</div>`;

    bodyEl.innerHTML = `
      <div style="margin-top: 12px;">
        ${renderEventGoalSection(ev)}
      </div>
      <div class="hub-section-label" style="display: flex; align-items: center; justify-content: space-between;">
        <span>Операции (${operations.length})</span>
        <button type="button" class="btn-mini" onclick="openEventParticipantsModal()">👥 Участники (${members.length})</button>
      </div>
      ${opsHtml}
      ${isFrozen
        ? `<div class="composer-card" style="text-align: center; color: var(--tg-theme-hint-color); margin-top: 10px;">
             ❄️ Траты заморожены (${ev.status === "ARCHIVED" ? "событие в архиве" : "идут расчёты"}). Разморозьте событие в меню «⋯».
           </div>`
        : `<button type="button" class="btn-accent" style="width: 100%; margin-top: 8px;" id="openAddExpenseOpBtn" onclick="openExpenseOperationModal(null)">
             ＋ Добавить операцию
           </button>`}
    `;
    return;
  }

  if (exp.activeTab === "settle") {
    const units = Array.isArray(ev.units) ? ev.units : [];
    const edges = Array.isArray(ev.settlement_edges) ? ev.settlement_edges : [];
    const pendingSettlements = (ev.settlements || []).filter(s => s.status === "PENDING");
    const myUnitId = ev.viewer_unit_id;
    const unitName = id => (units.find(u => u.id === id) || { name: id }).name;

    const listHtml = edges.length
      ? edges.map(e => `
          <button type="button" class="exp-edge-row" onclick="openEdgeSettleModal('${escapeHtml(e.from_unit_id)}', '${escapeHtml(e.to_unit_id)}', ${e.amount_minor})">
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 14.5px; font-weight: 700;">
                ${escapeHtml(unitName(e.from_unit_id))} <span style="color: var(--tg-theme-hint-color);">→</span> ${escapeHtml(unitName(e.to_unit_id))}
              </div>
              <div style="font-size: 12px; color: var(--tg-theme-hint-color);">
                ${e.pending ? "Ожидает подтверждения" : e.to_unit_id === myUnitId ? "Вам должны" : e.from_unit_id === myUnitId ? "Вы должны · нажать для перевода" : "Перевод между участниками"}
              </div>
            </div>
            <div class="exp-op-amt">${formatExpenseMinor(e.amount_minor, cur)}</div>
          </button>
        `).join("")
      : `<div style="text-align: center; color: var(--tg-theme-hint-color); padding: 18px 8px;">Все расчёты завершены 🎉</div>`;

    const pendingHtml = pendingSettlements.length ? `
      <div class="hub-section-label">Ожидают подтверждения (${pendingSettlements.length})</div>
      ${pendingSettlements.map(s => {
        const toU = getClientUnitHeadId(members, s.to_member_id);
        const fromU = getClientUnitHeadId(members, s.from_member_id);
        const incoming = toU === myUnitId;
        const outgoing = fromU === myUnitId || s.from_unit_id === myUnitId || (ev.viewer_member_id && (s.from_member_id === ev.viewer_member_id || s.from_user_id === ev.viewer_user_id));
        return `
          <div class="composer-card" style="padding: 13px; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: ${incoming || outgoing ? "10px" : "0"};">
              <div class="exp-member-avatar">${incoming ? "↓" : "↑"}</div>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 14px; font-weight: 700;">${escapeHtml(unitName(fromU))} → ${escapeHtml(unitName(toU))}</div>
                <div style="font-size: 12px; color: var(--tg-theme-hint-color);">${escapeHtml(s.payment_method || "СБП")}${s.comment ? " · " + escapeHtml(s.comment) : ""}</div>
              </div>
              <div class="exp-op-amt">${formatExpenseMinor(s.allocated_amount_minor ?? s.total_amount_minor, s.currency || cur)}</div>
            </div>
            ${incoming ? `
              <div style="display: flex; gap: 8px;">
                <button type="button" class="btn-accent" style="flex: 1; min-height: 38px; font-size: 13px;" onclick="confirmIncomingSettlement('${escapeHtml(s.id)}')">Подтвердить</button>
                <button type="button" class="btn-glass" style="flex: 1; min-height: 38px; font-size: 13px;" onclick="rejectIncomingSettlement('${escapeHtml(s.id)}')">Деньги не пришли</button>
              </div>
            ` : outgoing ? `
              <div style="display: flex; gap: 8px;">
                <button type="button" class="btn-glass" style="flex: 1; min-height: 38px; font-size: 13px;" onclick="cancelPendingSettlement('${escapeHtml(s.id)}')">Отозвать перевод</button>
              </div>
            ` : `<div class="composer-hint">Ожидает подтверждения получателем</div>`}
          </div>
        `;
      }).join("")}
    ` : "";

    bodyEl.innerHTML = `
      <div class="composer-card" style="margin-top: 12px; padding: 12px 14px; margin-bottom: 10px;">
        <div class="bento-switch-card" style="padding: 0; border: 0; background: transparent;" onclick="toggleEventSimplifyDebts()">
          <div class="switch-text-wrap">
            <span class="switch-title">Упрощать долги</span>
            <span class="switch-subtitle">Минимизировать число переводов</span>
          </div>
          <span class="ios-switch">
            <input type="checkbox" id="expSimplifyToggleInput" ${ev.simplify_debts ? "checked" : ""} onchange="toggleEventSimplifyDebts(event)" />
            <span class="ios-slider"></span>
          </span>
        </div>
      </div>

      <div class="segmented-tabs" style="margin-bottom: 12px;">
        <button type="button" class="seg-tab-btn ${exp.settleView === "graph" ? "active" : ""}" onclick="switchSettleSubView('graph')">Граф</button>
        <button type="button" class="seg-tab-btn ${exp.settleView === "list" ? "active" : ""}" onclick="switchSettleSubView('list')">Список</button>
      </div>

      ${exp.settleView === "graph"
        ? `<div class="exp-graph-host" id="expSettlementGraphHost"></div>`
        : `<div class="composer-card" style="padding: 10px 14px;">${listHtml}</div>`}

      ${pendingHtml}
    `;

    if (exp.settleView === "graph") {
      requestAnimationFrame(() => renderSettlementSvgGraph(ev));
    }
    return;
  }

  const logs = Array.isArray(ev.audit_log) ? ev.audit_log : [];
  bodyEl.innerHTML = `
    <div class="composer-card" style="margin-top: 12px;">
      <h3 class="modal-title" style="font-size: 16px; margin-bottom: 10px;">Журнал событий</h3>
      ${logs.length === 0
        ? `<div class="composer-hint">История пока пуста.</div>`
        : logs.map(item => {
            const meta = getAuditEventMeta(item.action);
            return `
              <div class="exp-history-row" style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border-hairline);">
                <div class="exp-history-icon-box" style="width: 36px; height: 36px; border-radius: 10px; background: ${meta.bg}; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">
                  ${meta.icon}
                </div>
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
                    <span class="exp-history-badge" style="display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; background: ${meta.bg}; color: ${meta.color}; line-height: 1.3;">
                      ${escapeHtml(meta.badge)}
                    </span>
                    <span style="font-size: 11px; color: var(--tg-theme-hint-color);">${escapeHtml(String(item.created_at || "").replace("T", " ").slice(0, 16))}</span>
                  </div>
                  <div style="font-size: 13.5px; line-height: 1.4; color: var(--tg-theme-text-color);">${escapeHtml(item.text || item.action)}</div>
                </div>
              </div>
            `;
          }).join("")}
    </div>
  `;
}

/* ==========================================================================
   ЭТАП 5: ЦЕЛЕВЫЕ СБОРЫ И ЭКСПОРТ ВЕДОМОСТИ В CSV
   ========================================================================== */
function openCreateGoalModal() {
  const ev = getExpensesState().currentEvent;
  const body = document.getElementById("settleTransferModalBody");
  if (!ev || !body) return;
  const cur = ev.base_currency || "RUB";

  body.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title" id="settleTransferModalTitle">🎯 Новый целевой сбор</h2>
      <button type="button" class="btn-close-circle" onclick="closeSettleTransferModal()" aria-label="Закрыть">✕</button>
    </div>
    <form onsubmit="handleCreateGoalSubmit(event)">
      <div class="form-bento-grid">
        <div class="field-block span-2">
          <label class="field-label" for="expGoalTitleInput">Название сбора</label>
          <input type="text" class="input-modern" id="expGoalTitleInput" maxlength="100" placeholder="Например, Подарок имениннику" required />
        </div>
        <div class="field-block span-2">
          <label class="field-label" for="expGoalAmountInput">Сумма с каждого участника (${escapeHtml(cur)})</label>
          <input type="number" step="0.01" min="1" class="input-modern tabular-nums" id="expGoalAmountInput" placeholder="2000" required />
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <button type="button" class="btn-glass" style="flex: 1;" onclick="closeSettleTransferModal()">Отмена</button>
        <button type="submit" class="btn-accent" style="flex: 2;">Открыть сбор</button>
      </div>
    </form>
  `;

  const backdrop = document.getElementById("settleTransferModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
}

async function handleCreateGoalSubmit(event) {
  event.preventDefault();
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  const title = String(document.getElementById("expGoalTitleInput")?.value || "").trim();
  const amount = Number(document.getElementById("expGoalAmountInput")?.value || 0);
  const targetMinor = Math.round(amount * 100);
  if (!title || targetMinor <= 0) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/goals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify({
          title,
          target_per_member_minor: targetMinor,
          receiver_member_id: ev.viewer_member_id
        })
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      closeSettleTransferModal();
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
      }
      if (typeof showToast === "function") showToast("🎯 Целевой сбор открыт");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось открыть сбор"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  target.goal = {
    id: `demo_goal_${Date.now()}`,
    event_id: ev.id,
    title,
    target_per_member_minor: targetMinor,
    receiver_member_id: target.viewer_member_id,
    status: "ACTIVE",
    contributions: (target.members || []).map(m => ({
      member_id: m.id,
      member_name: m.member_name,
      status: m.id === target.viewer_member_id ? "PAID" : "UNPAID"
    }))
  };
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  closeSettleTransferModal();
  renderExpenseEventDetail();
  if (typeof showToast === "function") showToast("🎯 Целевой сбор открыт");
}

async function cycleGoalContributionStatus(goalId, memberId, nextStatus) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(
        `${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/goals/${encodeURIComponent(goalId)}/contributions/${encodeURIComponent(memberId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
          },
          body: JSON.stringify({ status: nextStatus })
        }
      );
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
      }
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось обновить статус"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  const c = target?.goal?.contributions?.find(x => x.member_id === memberId);
  if (c) {
    c.status = nextStatus;
    saveDemoExpensesStore(demo);
    exp.currentEvent = target;
    renderExpenseEventDetail();
  }
}

function exportCurrentExpenseEventCsv() {
  const ev = getExpensesState().currentEvent;
  if (!ev) return;

  const members = Array.isArray(ev.members) ? ev.members : [];
  const units = Array.isArray(ev.units) ? ev.units : [];
  const ops = Array.isArray(ev.operations) ? ev.operations : [];
  const edges = Array.isArray(ev.settlement_edges) ? ev.settlement_edges : [];
  const balances = ev.unit_balances_minor || {};
  const cur = ev.base_currency || "RUB";

  const memberName = id => (members.find(m => m.id === id) || { member_name: id }).member_name;
  const unitName = id => (units.find(u => u.id === id) || { name: id }).name;
  const fmtMoney = minor => ((Number(minor) || 0) / 100).toFixed(2);

  const rows = [
    ["Событие", ev.title || ""],
    ["Базовая валюта", cur],
    ["Статус", ev.status || "ACTIVE"],
    [],
    ["Дата", "Тип", "Название", "Категория", "Сумма", "Валюта", "Курс", "В базовой валюте", "Плательщики", "Доли"]
  ];

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

  const csvContent = "\uFEFF" + rows
    .map(r => r.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${String(ev.title || "event").replace(/[^a-zA-Zа-яА-Я0-9_-]+/g, "_")}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof showToast === "function") showToast("📊 Ведомость CSV скачана");
}

/* ==========================================================================
   ЭТАП 4: ИНТЕРАКТИВНЫЙ SVG-ГРАФ ПЕРЕВОДОВ И ПОГАШЕНИЕ ПО СБП
   ========================================================================== */
function renderSettlementSvgGraph(ev) {
  const host = document.getElementById("expSettlementGraphHost");
  if (!host) return;

  const exp = getExpensesState();
  const units = Array.isArray(ev.units) ? ev.units : [];
  const edges = Array.isArray(ev.settlement_edges) ? ev.settlement_edges : [];
  const balances = ev.unit_balances_minor || {};
  const cur = ev.base_currency || "RUB";

  if (edges.length === 0) {
    host.style.height = "auto";
    host.innerHTML = `<div style="text-align: center; color: var(--tg-theme-hint-color); padding: 26px 12px;">Все расчёты завершены 🎉</div>`;
    return;
  }

  const W = host.clientWidth || 340;
  const CW = 104;
  const CH = 44;
  const byId = new Map(units.map(u => [u.id, u]));
  const pos = {};
  let H = 0;

  if (ev.simplify_debts) {
    const leftIds = [...new Set(edges.map(e => e.from_unit_id))];
    const rightIds = [...new Set(edges.map(e => e.to_unit_id))];
    const gap = 18;
    const colH = n => n * CH + Math.max(0, n - 1) * gap;
    H = Math.max(colH(leftIds.length), colH(rightIds.length)) + 36;

    leftIds.forEach((id, i) => {
      pos[id] = { x: 10, y: (H - colH(leftIds.length)) / 2 + i * (CH + gap) };
    });
    rightIds.forEach((id, i) => {
      pos[id] = { x: W - CW - 10, y: (H - colH(rightIds.length)) / 2 + i * (CH + gap) };
    });
  } else {
    const ids = [...new Set(edges.flatMap(e => [e.from_unit_id, e.to_unit_id]))];
    H = Math.max(280, Math.round(W * 0.8));
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W / 2 - CW / 2 - 12, H / 2 - CH / 2 - 14);
    ids.forEach((id, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / ids.length;
      pos[id] = { x: cx + R * Math.cos(a) - CW / 2, y: cy + R * Math.sin(a) - CH / 2 };
    });
  }

  host.style.height = `${H}px`;
  const svgParts = [];
  const pills = [];

  for (const e of edges) {
    const a = pos[e.from_unit_id];
    const b = pos[e.to_unit_id];
    if (!a || !b) continue;

    let d;
    let ex;
    let ey;
    let angle;
    let px;
    let py;
    if (ev.simplify_debts) {
      const x1 = a.x + CW;
      const y1 = a.y + CH / 2;
      const x2 = b.x;
      const y2 = b.y + CH / 2;
      const c1 = x1 + 38;
      const c2 = x2 - 38;
      d = `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
      ex = x2;
      ey = y2;
      angle = Math.atan2(y2 - y1, x2 - c2);
      px = W / 2;
      py = (y1 + y2) / 2;
    } else {
      const c1x = a.x + CW / 2;
      const c1y = a.y + CH / 2;
      const c2x = b.x + CW / 2;
      const c2y = b.y + CH / 2;
      const dx = c2x - c1x;
      const dy = c2y - c1y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const sx = c1x + ux * 56;
      const sy = c1y + uy * 26;
      const tx = c2x - ux * 58;
      const ty = c2y - uy * 26;
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const ox = mx - W / 2;
      const oy = my - H / 2;
      const ol = Math.hypot(ox, oy) || 1;
      const ccx = mx + (ox / ol) * 24;
      const ccy = my + (oy / ol) * 24;
      d = `M ${sx} ${sy} Q ${ccx} ${ccy} ${tx} ${ty}`;
      ex = tx;
      ey = ty;
      angle = Math.atan2(ty - ccy, tx - ccx);
      px = 0.25 * sx + 0.5 * ccx + 0.25 * tx;
      py = 0.25 * sy + 0.5 * ccy + 0.25 * ty;
    }

    const s = 7;
    const hx1 = ex - s * Math.cos(angle - 0.42);
    const hy1 = ey - s * Math.sin(angle - 0.42);
    const hx2 = ex - s * Math.cos(angle + 0.42);
    const hy2 = ey - s * Math.sin(angle + 0.42);

    const focused = exp.focusedUnitId;
    const isHot = Boolean(focused && (e.from_unit_id === focused || e.to_unit_id === focused));
    const isDim = Boolean(focused && !isHot);

    svgParts.push(`
      <g class="exp-edge-g ${isHot ? "hot" : ""} ${isDim ? "dim" : ""}">
        <path class="exp-edge-path ${e.pending ? "pending" : ""}" d="${d}"/>
        <polygon class="exp-edge-arrow" points="${ex},${ey} ${hx1},${hy1} ${hx2},${hy2}"/>
      </g>
    `);
    pills.push({ ...e, x: px, y: py, isHot, isDim });
  }

  const nodesHtml = Object.entries(pos).map(([id, p]) => {
    const u = byId.get(id);
    if (!u) return "";
    const bal = Number(balances[id]) || 0;
    const focused = exp.focusedUnitId;
    const isHot = focused === id;
    const isDim = Boolean(focused && !isHot);
    return `
      <div class="exp-graph-node ${isHot ? "hot" : ""} ${isDim ? "dim" : ""}"
           style="left: ${p.x}px; top: ${p.y}px;"
           onclick="toggleGraphNodeFocus('${escapeHtml(id)}')">
        <div class="exp-graph-node-name">${escapeHtml(u.name)}</div>
        <div class="exp-graph-node-bal">${bal > 0 ? "+" : ""}${formatExpenseMinor(bal, cur)}</div>
      </div>
    `;
  }).join("");

  const pillsHtml = pills.map(p => `
    <div class="exp-graph-pill ${p.isHot ? "hot" : ""} ${p.isDim ? "dim" : ""}"
         style="left: ${p.x}px; top: ${p.y}px;"
         onclick="openEdgeSettleModal('${escapeHtml(p.from_unit_id)}', '${escapeHtml(p.to_unit_id)}', ${p.amount_minor})">
      ${formatExpenseMinor(p.amount_minor, cur)}
    </div>
  `).join("");

  host.innerHTML = `
    <svg class="exp-graph-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${svgParts.join("")}
    </svg>
    ${nodesHtml}
    ${pillsHtml}
  `;
}

function toggleGraphNodeFocus(unitId) {
  const exp = getExpensesState();
  exp.focusedUnitId = exp.focusedUnitId === unitId ? null : unitId;
  if (exp.currentEvent) renderSettlementSvgGraph(exp.currentEvent);
}

function openEdgeSettleModal(fromUnitId, toUnitId, amountMinor) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  const units = Array.isArray(ev.units) ? ev.units : [];
  const fromU = units.find(u => u.id === fromUnitId);
  const toU = units.find(u => u.id === toUnitId);
  if (!fromU || !toU) return;

  const myU = ev.viewer_unit_id;
  if (toUnitId === myU) {
    openDebtReminderModal(fromU.name, amountMinor, ev.base_currency || "RUB");
    return;
  }
  if (fromUnitId !== myU) {
    if (typeof showToast === "function") showToast("Перевод между другими участниками");
    return;
  }

  exp.settleCtx = {
    recipientName: toU.name,
    paymentPhone: toU.payment_phone || "",
    preferredBanks: Array.isArray(toU.preferred_banks) ? toU.preferred_banks : [],
    currency: ev.base_currency || "RUB",
    method: "СБП",
    comment: "",
    items: [
      {
        event_id: ev.id,
        event_title: ev.title,
        to_member_id: toU.id,
        amount_minor: Number(amountMinor) || 0,
        checked: true
      }
    ]
  };
  renderSettleTransferModal();
}

function openCrossPersonSettleModal(key) {
  const exp = getExpensesState();
  const c = exp.crossEventDebts.find(x => x.key === key);
  if (!c) return;

  if (c.net_minor > 0) {
    openDebtReminderModal(c.name, c.net_minor, c.currency);
    return;
  }

  const items = (c.allocations || [])
    .filter(a => a.amount_minor < 0)
    .map(a => ({
      event_id: a.event_id,
      event_title: a.event_title,
      to_member_id: a.to_member_id,
      amount_minor: Math.abs(a.amount_minor),
      checked: true
    }));

  exp.settleCtx = {
    recipientName: c.name,
    paymentPhone: c.payment_phone || "",
    preferredBanks: Array.isArray(c.preferred_banks) ? c.preferred_banks : [],
    currency: c.currency || "RUB",
    method: "СБП",
    comment: "",
    items
  };
  renderSettleTransferModal();
}

function openDebtReminderModal(debtorName, amountMinor, currency) {
  const body = document.getElementById("settleTransferModalBody");
  if (!body) return;

  body.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title" id="settleTransferModalTitle">🔔 Напоминание о долге</h2>
      <button type="button" class="btn-close-circle" onclick="closeSettleTransferModal()" aria-label="Закрыть">✕</button>
    </div>
    <div class="exp-recipient-box">
      <div class="exp-member-avatar" style="width: 46px; height: 46px; font-size: 18px;">🔔</div>
      <div style="flex: 1; min-width: 0;">
        <strong style="font-size: 16px; display: block;">${escapeHtml(debtorName)}</strong>
        <div style="font-size: 13px; color: var(--tg-theme-hint-color); margin-top: 3px;">Вам должны ${formatExpenseMinor(amountMinor, currency)}</div>
      </div>
    </div>
    <div class="composer-card" style="box-shadow: none; font-size: 13.5px; color: var(--tg-theme-hint-color);">
      «Привет! Напоминаю про общий бюджет (${formatExpenseMinor(amountMinor, currency)}) — скинь, пожалуйста, когда будет удобно. Спасибо!»
    </div>
    <button type="button" class="btn-accent" style="width: 100%;" onclick="sendDebtReminder('${escapeHtml(debtorName)}', '${escapeHtml(formatExpenseMinor(amountMinor, currency))}')">
      📋 Скопировать напоминание
    </button>
  `;

  const backdrop = document.getElementById("settleTransferModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
}

async function sendDebtReminder(name, formattedAmount) {
  const text = `Привет, ${name}! Напоминаю про расчёт по общим тратам (${formattedAmount}) — переведи, пожалуйста, когда будет удобно.`;
  if (typeof copyToClipboard === "function") await copyToClipboard(text);
  closeSettleTransferModal();
  if (typeof showToast === "function") showToast("📋 Текст напоминания скопирован");
}

function renderSettleTransferModal() {
  const exp = getExpensesState();
  const ctx = exp.settleCtx;
  const body = document.getElementById("settleTransferModalBody");
  if (!ctx || !body) return;

  const totalMinor = ctx.items.filter(i => i.checked).reduce((s, i) => s + i.amount_minor, 0);
  const cur = ctx.currency || "RUB";

  body.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title" id="settleTransferModalTitle">Погашение долга</h2>
      <button type="button" class="btn-close-circle" onclick="closeSettleTransferModal()" aria-label="Закрыть">✕</button>
    </div>

    <div class="exp-recipient-box">
      <div class="exp-member-avatar" style="width: 46px; height: 46px; font-size: 16px;">${escapeHtml(ctx.recipientName.slice(0, 2).toUpperCase())}</div>
      <div style="flex: 1; min-width: 0;">
        <strong style="font-size: 16px; display: block; margin-bottom: 3px;">${escapeHtml(ctx.recipientName)}</strong>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
          <span style="font-size: 13px; color: var(--tg-theme-hint-color);">${ctx.paymentPhone ? escapeHtml(ctx.paymentPhone) : "Телефон СБП не указан"}</span>
          ${ctx.paymentPhone ? `<button type="button" class="btn-mini" onclick="copyExpenseInviteLink('${escapeHtml(ctx.paymentPhone)}')">Копировать</button>` : ""}
        </div>
        <div class="audience-editor">
          ${ctx.preferredBanks.length
            ? ctx.preferredBanks.map(b => `<span class="audience-chip active" style="min-height: 28px; padding: 3px 9px;">${escapeHtml(b)}</span>`).join("")
            : `<span class="audience-chip" style="min-height: 28px; padding: 3px 9px;">СБП</span>`}
        </div>
      </div>
    </div>

    <div class="hub-section-label">Из каких событий</div>
    <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;">
      ${ctx.items.map((it, idx) => `
        <label class="exp-split-row" style="cursor: pointer;">
          <input type="checkbox" style="width: 18px; height: 18px; accent-color: var(--tg-theme-button-color);" ${it.checked ? "checked" : ""} onchange="toggleSettleItemCheckbox(${idx}, this.checked)" />
          <span style="flex: 1; font-size: 14px;">${escapeHtml(it.event_title)}</span>
          <strong class="tabular-nums">${formatExpenseMinor(it.amount_minor, cur)}</strong>
        </label>
      `).join("")}
    </div>

    <div class="exp-split-summary-bar" style="margin-bottom: 12px;">
      <span>Итого к переводу</span>
      <strong class="tabular-nums">${formatExpenseMinor(totalMinor, cur)}</strong>
    </div>

    <div class="hub-section-label">Способ перевода</div>
    <div class="desire-segment" style="margin-bottom: 12px;">
      ${["СБП", "Карта", "Наличные"].map(m => `
        <button type="button" class="desire-btn ${ctx.method === m ? "active" : ""}" onclick="setSettlePaymentMethod('${m}')">${m}</button>
      `).join("")}
    </div>

    <div class="field-block" style="margin-bottom: 14px;">
      <label class="field-label" for="expSettleCommentInput">Комментарий</label>
      <input type="text" class="input-modern" id="expSettleCommentInput" placeholder="Необязательно" value="${escapeHtml(ctx.comment)}" oninput="getExpensesState().settleCtx.comment=this.value" />
    </div>

    <button type="button" class="btn-accent" style="width: 100%;" ${totalMinor <= 0 ? "disabled" : ""} onclick="submitSettlePayment()">
      Я отправил деньги${totalMinor > 0 ? " · " + formatExpenseMinor(totalMinor, cur) : ""}
    </button>
    <div class="composer-hint" style="text-align: center; margin-top: 10px;">Получатель увидит перевод в статусе «Ожидает подтверждения».</div>
  `;

  const backdrop = document.getElementById("settleTransferModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
}

function closeSettleTransferModal() {
  const backdrop = document.getElementById("settleTransferModalBackdrop");
  if (backdrop) backdrop.classList.remove("open");
}

function toggleSettleItemCheckbox(idx, checked) {
  const ctx = getExpensesState().settleCtx;
  if (!ctx?.items?.[idx]) return;
  ctx.items[idx].checked = Boolean(checked);
  renderSettleTransferModal();
}

function setSettlePaymentMethod(method) {
  const ctx = getExpensesState().settleCtx;
  if (!ctx) return;
  ctx.method = method;
  renderSettleTransferModal();
}

async function submitSettlePayment() {
  const exp = getExpensesState();
  const ctx = exp.settleCtx;
  if (!ctx) return;
  const selected = ctx.items.filter(i => i.checked && i.amount_minor > 0);
  if (!selected.length) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify({
          currency: ctx.currency,
          payment_method: ctx.method,
          comment: ctx.comment,
          allocations: selected.map(s => ({
            event_id: s.event_id,
            to_member_id: s.to_member_id,
            amount_minor: s.amount_minor
          }))
        })
      });
      await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      closeSettleTransferModal();
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      if (typeof triggerHaptic === "function") triggerHaptic("success");
      if (typeof showToast === "function") showToast("✓ Перевод отправлен на подтверждение");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось зафиксировать перевод"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const now = new Date().toISOString();
  for (const item of selected) {
    const ev = demo.events.find(e => e.id === item.event_id);
    if (!ev) continue;
    ev.settlements = ev.settlements || [];
    ev.settlements.push({
      id: `demo_st_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      from_member_id: ev.viewer_member_id,
      to_member_id: item.to_member_id,
      total_amount_minor: item.amount_minor,
      allocated_amount_minor: item.amount_minor,
      currency: ctx.currency,
      payment_method: ctx.method,
      comment: ctx.comment,
      status: "PENDING",
      created_at: now
    });
    ev.audit_log.unshift({
      id: `log_${Date.now()}`,
      action: "SETTLEMENT_SENT",
      text: `Вы отправили перевод ${formatExpenseMinor(item.amount_minor, ctx.currency)} (${ctx.method}) — ожидает подтверждения`,
      created_at: now
    });
    computeClientSettlementPlan(ev);
    if (exp.currentEvent?.id === ev.id) exp.currentEvent = ev;
  }
  saveDemoExpensesStore(demo);
  closeSettleTransferModal();
  if (exp.currentEvent) renderExpenseEventDetail();
  await loadExpensesDashboard();
  if (typeof showToast === "function") showToast("✓ Перевод отправлен на подтверждение");
}

async function confirmIncomingSettlement(settlementId) {
  const exp = getExpensesState();
  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements/${encodeURIComponent(settlementId)}/confirm`, {
        method: "POST",
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      if (typeof showToast === "function") showToast("✓ Перевод подтверждён");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось подтвердить перевод"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  for (const ev of demo.events) {
    const st = (ev.settlements || []).find(s => s.id === settlementId);
    if (st) {
      st.status = "CONFIRMED";
      computeClientSettlementPlan(ev);
      if (exp.currentEvent?.id === ev.id) exp.currentEvent = ev;
    }
  }
  saveDemoExpensesStore(demo);
  if (exp.currentEvent) renderExpenseEventDetail();
  await loadExpensesDashboard();
  if (typeof showToast === "function") showToast("✓ Перевод подтверждён");
}

async function rejectIncomingSettlement(settlementId) {
  const exp = getExpensesState();
  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements/${encodeURIComponent(settlementId)}/reject`, {
        method: "POST",
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      if (typeof showToast === "function") showToast("Отмечено: деньги не пришли");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось отклонить перевод"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  for (const ev of demo.events) {
    const st = (ev.settlements || []).find(s => s.id === settlementId);
    if (st) {
      st.status = "REJECTED";
      computeClientSettlementPlan(ev);
      if (exp.currentEvent?.id === ev.id) exp.currentEvent = ev;
    }
  }
  saveDemoExpensesStore(demo);
  if (exp.currentEvent) renderExpenseEventDetail();
  await loadExpensesDashboard();
  if (typeof showToast === "function") showToast("Отмечено: деньги не пришли");
}

async function cancelPendingSettlement(settlementId) {
  const exp = getExpensesState();
  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements/${encodeURIComponent(settlementId)}/cancel`, {
        method: "POST",
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      if (typeof showToast === "function") showToast("✓ Перевод отозван");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось отозвать перевод"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  for (const ev of demo.events) {
    const st = (ev.settlements || []).find(s => s.id === settlementId);
    if (st) {
      st.status = "CANCELLED";
      computeClientSettlementPlan(ev);
      if (Array.isArray(ev.audit_log)) {
        ev.audit_log.unshift({
          id: `log_${Date.now()}`,
          action: "SETTLEMENT_CANCELLED",
          text: `Перевод на сумму ${Math.round((Number(st.allocated_amount_minor ?? st.total_amount_minor) || 0) / 100)} ${st.currency || ev.base_currency || "RUB"} отозван`,
          created_at: new Date().toISOString()
        });
      }
      if (exp.currentEvent?.id === ev.id) exp.currentEvent = ev;
    }
  }
  saveDemoExpensesStore(demo);
  if (exp.currentEvent) renderExpenseEventDetail();
  await loadExpensesDashboard();
  if (typeof showToast === "function") showToast("✓ Перевод отозван");
}

/* ==========================================================================
   ЭТАП 3: ДОБАВЛЕНИЕ И РЕДАКТИРОВАНИЕ ОПЕРАЦИЙ + 5 РЕЖИМОВ СПЛИТА
   ========================================================================== */
function createDefaultOperationDraft(ev, existingOp) {
  const members = Array.isArray(ev.members) ? ev.members : [];
  const defaultPayer = ev.viewer_member_id || members[0]?.id || "";
  const secondMember = members.find(m => m.id !== defaultPayer)?.id || defaultPayer;

  if (existingOp) {
    const meta = existingOp.split_meta || {};
    const includedMap = {};
    const weightsMap = {};
    const exactMap = {};
    const percentMap = {};

    const incList = Array.isArray(meta.included_member_ids) && meta.included_member_ids.length
      ? meta.included_member_ids
      : Object.keys(existingOp.shares_minor || {});

    for (const m of members) {
      includedMap[m.id] = incList.includes(m.id);
      weightsMap[m.id] = meta.weights_map?.[m.id] !== undefined
        ? String(meta.weights_map[m.id])
        : String(m.default_weight || 1);
      exactMap[m.id] = meta.exact_minor_map?.[m.id] !== undefined
        ? String(Math.round(Number(meta.exact_minor_map[m.id]) / 100 * 100) / 100)
        : existingOp.shares_minor?.[m.id]
          ? String(Math.round(Number(existingOp.shares_minor[m.id])) / 100)
          : "";
      percentMap[m.id] = meta.percent_map?.[m.id] !== undefined ? String(meta.percent_map[m.id]) : "";
    }

    const items = Array.isArray(existingOp.items)
      ? existingOp.items.map(it => ({
          title: it.title || "",
          amount: it.amount_minor ? String(Math.round(Number(it.amount_minor)) / 100) : "",
          member_ids: Array.isArray(it.member_ids) ? [...it.member_ids] : []
        }))
      : [];

    return {
      id: existingOp.id,
      operation_type: existingOp.operation_type || "EXPENSE",
      title: existingOp.title || "",
      category: existingOp.category || "Еда",
      date: existingOp.expense_date || new Date().toISOString().slice(0, 10),
      amount: existingOp.original_amount_minor ? String(Math.round(Number(existingOp.original_amount_minor)) / 100) : "",
      currency: existingOp.original_currency || ev.base_currency || "RUB",
      rate: String(existingOp.exchange_rate || 1),
      payers: Array.isArray(existingOp.payers) && existingOp.payers.length ? [...existingOp.payers] : [defaultPayer],
      transfer_from_id: meta.transfer_from_id || existingOp.payers?.[0] || defaultPayer,
      transfer_to_id: meta.transfer_to_id || Object.keys(existingOp.shares_minor || {})[0] || secondMember,
      split_type: existingOp.split_type || "EQUAL",
      included: includedMap,
      weights: weightsMap,
      exact: exactMap,
      percent: percentMap,
      items,
      comment: existingOp.comment || ""
    };
  }

  const included = {};
  const weights = {};
  for (const m of members) {
    included[m.id] = true;
    weights[m.id] = String(m.default_weight || 1);
  }

  return {
    id: null,
    operation_type: "EXPENSE",
    title: "",
    category: "Еда",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    currency: ev.base_currency || "RUB",
    rate: "1",
    payers: defaultPayer ? [defaultPayer] : [],
    transfer_from_id: defaultPayer,
    transfer_to_id: secondMember,
    split_type: "EQUAL",
    included,
    weights,
    exact: {},
    percent: {},
    items: [],
    comment: ""
  };
}

function openExpenseOperationModal(opId) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (!opId && (ev.status === "SETTLING" || ev.status === "ARCHIVED")) {
    if (typeof showToast === "function") showToast("❄️ Траты заморожены");
    return;
  }

  const existing = opId ? (ev.operations || []).find(o => o.id === opId) : null;
  exp.opDraft = createDefaultOperationDraft(ev, existing);
  renderExpenseOperationModal();

  const backdrop = document.getElementById("expenseOperationModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
  if (typeof triggerHaptic === "function") triggerHaptic("light");
}

function closeExpenseOperationModal() {
  const backdrop = document.getElementById("expenseOperationModalBackdrop");
  if (backdrop) backdrop.classList.remove("open");
}

function renderExpenseOperationModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  const body = document.getElementById("expenseOperationModalBody");
  if (!ev || !d || !body) return;

  const members = Array.isArray(ev.members) ? ev.members : [];
  const baseCur = ev.base_currency || "RUB";
  const isForeign = d.currency !== baseCur;
  const isFrozen = ev.status === "SETTLING" || ev.status === "ARCHIVED";

  body.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title" id="expenseOperationModalTitle">${d.id ? "Изменить операцию" : "Новая операция"}</h2>
      <div style="display: flex; gap: 6px; align-items: center;">
        ${d.id && !isFrozen ? `<button type="button" class="btn-mini danger" id="deleteExpenseOpBtn" onclick="deleteCurrentExpenseOperation()">Удалить</button>` : ""}
        <button type="button" class="btn-close-circle" onclick="closeExpenseOperationModal()" aria-label="Закрыть">✕</button>
      </div>
    </div>

    <div class="form-bento-grid">
      <div class="field-block span-2">
        <label class="field-label" for="expOpTitleInput">Название</label>
        <input type="text" class="input-modern" id="expOpTitleInput" maxlength="100" placeholder="Например, Ужин в ресторане" value="${escapeHtml(d.title)}" oninput="getExpensesState().opDraft.title=this.value" />
      </div>

      ${d.operation_type !== "TRANSFER" ? `
        <div class="field-block span-2">
          <span class="field-label">Категория</span>
          <div class="category-preset-row">
            ${EXPENSE_CATEGORIES.map(c => `
              <button type="button" class="cat-preset-btn ${d.category === c.label ? "selected" : ""}" onclick="setDraftOperationCategory('${escapeHtml(c.label)}')">${c.icon} ${escapeHtml(c.label)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div class="field-block">
        <label class="field-label" for="expOpAmountInput">Сумма</label>
        <div style="display: flex; gap: 6px;">
          <input type="number" step="0.01" min="0" class="input-modern tabular-nums" id="expOpAmountInput" placeholder="0" value="${escapeHtml(d.amount)}" oninput="getExpensesState().opDraft.amount=this.value; refreshOperationSplitPreview()" />
          <select class="input-modern" style="width: 92px; flex-shrink: 0;" id="expOpCurrencySelect" onchange="setDraftOperationCurrency(this.value)">
            ${["RUB", "USD", "EUR", "KZT", "TRY", "GEL"].map(c => `<option value="${c}" ${d.currency === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="field-block">
        <label class="field-label" for="expOpDateInput">Дата</label>
        <input type="date" class="input-modern" id="expOpDateInput" value="${escapeHtml(d.date)}" onchange="getExpensesState().opDraft.date=this.value" />
      </div>

      ${isForeign ? `
        <div class="field-block span-2">
          <label class="field-label" for="expOpRateInput">Курс (${escapeHtml(baseCur)} за 1 ${escapeHtml(d.currency)})</label>
          <input type="number" step="0.0001" min="0.0001" class="input-modern tabular-nums" id="expOpRateInput" value="${escapeHtml(d.rate)}" oninput="getExpensesState().opDraft.rate=this.value; refreshOperationSplitPreview()" />
        </div>
      ` : ""}

      ${d.operation_type === "TRANSFER" ? `
        <div class="field-block">
          <label class="field-label" for="expTransferFromSelect">От кого</label>
          <select class="input-modern" id="expTransferFromSelect" onchange="getExpensesState().opDraft.transfer_from_id=this.value">
            ${members.map(m => `<option value="${escapeHtml(m.id)}" ${d.transfer_from_id === m.id ? "selected" : ""}>${escapeHtml(m.member_name)}</option>`).join("")}
          </select>
        </div>
        <div class="field-block">
          <label class="field-label" for="expTransferToSelect">Кому</label>
          <select class="input-modern" id="expTransferToSelect" onchange="getExpensesState().opDraft.transfer_to_id=this.value">
            ${members.map(m => `<option value="${escapeHtml(m.id)}" ${d.transfer_to_id === m.id ? "selected" : ""}>${escapeHtml(m.member_name)}</option>`).join("")}
          </select>
        </div>
      ` : `
        <div class="field-block span-2">
          <span class="field-label">Кто платил</span>
          <div class="audience-editor">
            ${members.map(m => `
              <button type="button" class="audience-chip ${d.payers.includes(m.id) ? "active" : ""}" onclick="toggleDraftOperationPayer('${escapeHtml(m.id)}')">
                ${escapeHtml(m.member_name)}
              </button>
            `).join("")}
          </div>
        </div>

        <div class="field-block span-2">
          <span class="field-label">Как делим</span>
          <div class="exp-split-mode-bar">
            ${[
              ["EQUAL", "Поровну"],
              ["SHARES", "Веса"],
              ["EXACT", "Суммы"],
              ["PERCENT", "%"],
              ["MANUAL_ITEMS", "Позиции"]
            ].map(([code, label]) => `
              <button type="button" class="exp-split-mode-btn ${d.split_type === code ? "active" : ""}" onclick="setDraftOperationSplitMode('${code}')">${label}</button>
            `).join("")}
          </div>
          <div id="expOperationSplitEditorBody"></div>
          <div class="exp-split-summary-bar" id="expOperationSplitSummary"></div>
        </div>
      `}

      <div class="field-block span-2">
        <label class="field-label" for="expOpCommentInput">Комментарий</label>
        <input type="text" class="input-modern" id="expOpCommentInput" maxlength="240" placeholder="Необязательно" value="${escapeHtml(d.comment)}" oninput="getExpensesState().opDraft.comment=this.value" />
      </div>
    </div>

    ${!isFrozen ? `
      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <button type="button" class="btn-glass" style="flex: 1;" onclick="closeExpenseOperationModal()">Отмена</button>
        <button type="button" class="btn-accent" id="saveExpenseOperationBtn" style="flex: 2;" onclick="submitExpenseOperation()">
          ${d.id ? "Сохранить изменения" : "Добавить"}
        </button>
      </div>
    ` : ""}
  `;

  if (d.operation_type !== "TRANSFER") {
    renderOperationSplitEditor();
    refreshOperationSplitPreview();
  }
}

function setDraftOperationType(type) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.operation_type = type;
  renderExpenseOperationModal();
}

function setDraftOperationCategory(cat) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.category = cat;
  renderExpenseOperationModal();
}

function setDraftOperationCurrency(cur) {
  const exp = getExpensesState();
  const d = exp.opDraft;
  if (!d) return;
  d.currency = cur;
  if (cur === (exp.currentEvent?.base_currency || "RUB")) d.rate = "1";
  renderExpenseOperationModal();
}

function toggleDraftOperationPayer(memberId) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  const idx = d.payers.indexOf(memberId);
  if (idx >= 0) {
    if (d.payers.length > 1) d.payers.splice(idx, 1);
  } else {
    d.payers.push(memberId);
  }
  renderExpenseOperationModal();
}

function setDraftOperationSplitMode(mode) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.split_type = mode;
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

function renderOperationSplitEditor() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  const box = document.getElementById("expOperationSplitEditorBody");
  if (!ev || !d || !box) return;

  const members = Array.isArray(ev.members) ? ev.members : [];
  const mode = d.split_type;

  if (mode === "EQUAL" || mode === "SHARES") {
    box.innerHTML = members.map(m => {
      const checked = Boolean(d.included[m.id]);
      return `
        <div class="exp-split-row">
          <div style="flex: 1; min-width: 0; font-size: 14px; font-weight: 600;">${escapeHtml(m.member_name)}</div>
          ${mode === "SHARES" ? `
            <input type="number" step="0.5" min="0.5" class="exp-split-num-input" value="${escapeHtml(d.weights[m.id] ?? "1")}"
                   oninput="getExpensesState().opDraft.weights['${escapeHtml(m.id)}']=this.value; refreshOperationSplitPreview()" />
          ` : ""}
          <button type="button" class="exp-merge-check ${checked ? "on" : ""}" onclick="toggleDraftSplitMember('${escapeHtml(m.id)}')">
            ${checked ? "✓" : ""}
          </button>
          <span class="exp-split-share-hint" data-op-share="${escapeHtml(m.id)}"></span>
        </div>
      `;
    }).join("");
    return;
  }

  if (mode === "EXACT") {
    box.innerHTML = members.map(m => `
      <div class="exp-split-row">
        <div style="flex: 1; min-width: 0; font-size: 14px; font-weight: 600;">${escapeHtml(m.member_name)}</div>
        <input type="number" step="0.01" min="0" class="exp-split-num-input" placeholder="0" value="${escapeHtml(d.exact[m.id] ?? "")}"
               oninput="getExpensesState().opDraft.exact['${escapeHtml(m.id)}']=this.value; refreshOperationSplitPreview()" />
      </div>
    `).join("");
    return;
  }

  if (mode === "PERCENT") {
    box.innerHTML = members.map(m => `
      <div class="exp-split-row">
        <div style="flex: 1; min-width: 0; font-size: 14px; font-weight: 600;">${escapeHtml(m.member_name)}</div>
        <input type="number" step="0.1" min="0" max="100" class="exp-split-num-input" placeholder="0" value="${escapeHtml(d.percent[m.id] ?? "")}"
               oninput="getExpensesState().opDraft.percent['${escapeHtml(m.id)}']=this.value; refreshOperationSplitPreview()" />
        <span style="font-size: 12px; color: var(--tg-theme-hint-color);">%</span>
        <span class="exp-split-share-hint" data-op-share="${escapeHtml(m.id)}"></span>
      </div>
    `).join("");
    return;
  }

  box.innerHTML = `
    ${d.items.map((it, idx) => `
      <div class="exp-receipt-item-card">
        <div class="exp-receipt-item-top">
          <input type="text" class="input-modern" style="min-height: 36px; padding: 6px 10px; font-size: 13.5px;" placeholder="Позиция" value="${escapeHtml(it.title)}"
                 oninput="getExpensesState().opDraft.items[${idx}].title=this.value" />
          <input type="number" step="0.01" min="0" class="exp-split-num-input" placeholder="0" value="${escapeHtml(it.amount)}"
                 oninput="getExpensesState().opDraft.items[${idx}].amount=this.value; refreshOperationSplitPreview()" />
          <button type="button" class="btn-mini danger" onclick="removeDraftReceiptItem(${idx})">✕</button>
        </div>
        <div class="audience-editor">
          ${members.map(m => `
            <button type="button" class="audience-chip ${it.member_ids.includes(m.id) ? "active" : ""}" style="min-height: 32px; padding: 4px 10px;" onclick="toggleDraftReceiptItemMember(${idx}, '${escapeHtml(m.id)}')">
              ${escapeHtml(m.member_name)}
            </button>
          `).join("")}
        </div>
      </div>
    `).join("")}
    <button type="button" class="btn-glass" style="width: 100%; min-height: 38px; font-size: 13px; margin-bottom: 8px;" onclick="addDraftReceiptItem()">
      ＋ Добавить позицию
    </button>
    ${members.map(m => `
      <div class="exp-split-row">
        <div style="flex: 1; font-size: 13.5px;">${escapeHtml(m.member_name)}</div>
        <span class="exp-split-share-hint" data-op-share="${escapeHtml(m.id)}"></span>
      </div>
    `).join("")}
  `;
}

function toggleDraftSplitMember(memberId) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.included[memberId] = !d.included[memberId];
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

function addDraftReceiptItem() {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.items.push({ title: "", amount: "", member_ids: [] });
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

function removeDraftReceiptItem(idx) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.items.splice(idx, 1);
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

function toggleDraftReceiptItemMember(idx, memberId) {
  const d = getExpensesState().opDraft;
  const item = d?.items?.[idx];
  if (!item) return;
  const pos = item.member_ids.indexOf(memberId);
  if (pos >= 0) item.member_ids.splice(pos, 1);
  else item.member_ids.push(memberId);
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

function computeClientDraftPreview(ev, d) {
  const members = Array.isArray(ev.members) ? ev.members : [];
  const baseCur = ev.base_currency || "RUB";
  const rate = d.currency === baseCur ? 1 : (Number(d.rate) || 0);

  let origMinor = 0;
  if (d.split_type === "MANUAL_ITEMS" && d.operation_type !== "TRANSFER") {
    origMinor = Math.round(d.items.reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100);
  } else {
    origMinor = Math.round((Number(d.amount) || 0) * 100);
  }
  const baseMinor = Math.round(origMinor * rate);
  const sharesMinor = {};

  if (d.operation_type === "TRANSFER") {
    if (d.transfer_to_id && baseMinor > 0) sharesMinor[d.transfer_to_id] = baseMinor;
    return { origMinor, baseMinor, sharesMinor, distributedMinor: baseMinor, valid: baseMinor > 0 && d.transfer_from_id !== d.transfer_to_id };
  }

  if (d.split_type === "EQUAL") {
    const inc = members.filter(m => d.included[m.id]);
    if (inc.length && baseMinor > 0) {
      const each = Math.floor(baseMinor / inc.length);
      let rem = baseMinor - each * inc.length;
      inc.forEach(m => {
        sharesMinor[m.id] = each + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
      });
    }
  } else if (d.split_type === "SHARES") {
    const inc = members.filter(m => d.included[m.id] && (Number(d.weights[m.id]) || 0) > 0);
    const totalW = inc.reduce((s, m) => s + (Number(d.weights[m.id]) || 0), 0);
    if (inc.length && totalW > 0 && baseMinor > 0) {
      let sum = 0;
      inc.forEach((m, idx) => {
        const val = idx === inc.length - 1
          ? baseMinor - sum
          : Math.round(baseMinor * (Number(d.weights[m.id]) || 0) / totalW);
        sharesMinor[m.id] = val;
        sum += val;
      });
    }
  } else if (d.split_type === "EXACT") {
    for (const m of members) {
      const v = Math.round((Number(d.exact[m.id]) || 0) * 100);
      if (v > 0) sharesMinor[m.id] = v;
    }
  } else if (d.split_type === "PERCENT") {
    const active = members.filter(m => (Number(d.percent[m.id]) || 0) > 0);
    let sum = 0;
    active.forEach((m, idx) => {
      const pct = Number(d.percent[m.id]) || 0;
      const val = idx === active.length - 1 && Math.abs(active.reduce((s, x) => s + (Number(d.percent[x.id]) || 0), 0) - 100) < 0.05
        ? baseMinor - sum
        : Math.round(baseMinor * pct / 100);
      sharesMinor[m.id] = val;
      sum += val;
    });
  } else if (d.split_type === "MANUAL_ITEMS") {
    for (const it of d.items) {
      const itemMinor = Math.round((Number(it.amount) || 0) * rate * 100);
      if (itemMinor <= 0 || !it.member_ids.length) continue;
      const each = Math.floor(itemMinor / it.member_ids.length);
      let rem = itemMinor - each * it.member_ids.length;
      it.member_ids.forEach(id => {
        sharesMinor[id] = (sharesMinor[id] || 0) + each + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
      });
    }
  }

  const distributedMinor = Object.values(sharesMinor).reduce((s, v) => s + v, 0);
  const valid = baseMinor > 0 && Math.abs(baseMinor - distributedMinor) <= 1;
  return { origMinor, baseMinor, sharesMinor, distributedMinor, valid };
}

function refreshOperationSplitPreview() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  if (!ev || !d) return;

  const baseCur = ev.base_currency || "RUB";
  const preview = computeClientDraftPreview(ev, d);

  document.querySelectorAll("[data-op-share]").forEach(el => {
    const mid = el.getAttribute("data-op-share");
    const minor = preview.sharesMinor[mid] || 0;
    el.textContent = minor > 0 ? formatExpenseMinor(minor, baseCur) : "";
  });

  const summaryEl = document.getElementById("expOperationSplitSummary");
  if (summaryEl) {
    const diff = preview.baseMinor - preview.distributedMinor;
    const statusText = preview.valid
      ? "Готово"
      : diff > 0
        ? `Осталось ${formatExpenseMinor(diff, baseCur)}`
        : `Перебор ${formatExpenseMinor(Math.abs(diff), baseCur)}`;
    summaryEl.innerHTML = `
      <span>Распределено ${formatExpenseMinor(preview.distributedMinor, baseCur)} из ${formatExpenseMinor(preview.baseMinor, baseCur)}</span>
      <span class="${preview.valid ? "ok" : "bad"}">${statusText}</span>
    `;
  }
}

async function submitExpenseOperation() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  if (!ev || !d) return;

  const title = String(d.title || "").trim();
  if (!title) {
    if (typeof showToast === "function") showToast("⚠️ Введите название операции");
    return;
  }

  const preview = computeClientDraftPreview(ev, d);
  if (preview.origMinor <= 0) {
    if (typeof showToast === "function") showToast("⚠️ Укажите сумму больше нуля");
    return;
  }
  if (!preview.valid) {
    if (typeof showToast === "function") showToast("⚠️ Проверьте распределение долей");
    return;
  }

  const baseCur = ev.base_currency || "RUB";
  const rate = d.currency === baseCur ? 1 : (Number(d.rate) || 1);
  const includedMemberIds = Object.entries(d.included || {})
    .filter(([, on]) => Boolean(on))
    .map(([id]) => id);
  const weightsMap = {};
  for (const [k, v] of Object.entries(d.weights || {})) weightsMap[k] = Number(v) || 1;
  const exactMinorMap = {};
  for (const [k, v] of Object.entries(d.exact || {})) exactMinorMap[k] = Math.round((Number(v) || 0) * 100);
  const percentMap = {};
  for (const [k, v] of Object.entries(d.percent || {})) percentMap[k] = Number(v) || 0;
  const itemsPayload = (d.items || []).map(it => ({
    title: String(it.title || "").trim() || "Позиция",
    amount_minor: Math.round((Number(it.amount) || 0) * 100),
    member_ids: [...(it.member_ids || [])]
  }));

  const payload = {
    operation_type: d.operation_type,
    title,
    category: d.operation_type === "TRANSFER" ? "Другое" : d.category,
    original_amount_minor: preview.origMinor,
    original_currency: d.currency,
    exchange_rate: rate,
    split_type: d.operation_type === "TRANSFER" ? "EXACT" : d.split_type,
    payers: d.operation_type === "TRANSFER" ? [d.transfer_from_id] : [...d.payers],
    transfer_from_id: d.transfer_from_id,
    transfer_to_id: d.transfer_to_id,
    included_member_ids: includedMemberIds,
    weights_map: weightsMap,
    exact_minor_map: exactMinorMap,
    percent_map: percentMap,
    items: itemsPayload,
    comment: String(d.comment || "").trim(),
    expense_date: d.date || new Date().toISOString().slice(0, 10)
  };

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const url = d.id
        ? `${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/operations/${encodeURIComponent(d.id)}`
        : `${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/operations`;
      const response = await fetch(url, {
        method: d.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      closeExpenseOperationModal();
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      if (typeof triggerHaptic === "function") triggerHaptic("success");
      if (typeof showToast === "function") showToast(d.id ? "✓ Операция обновлена" : "✓ Операция добавлена");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось сохранить операцию"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;

  const splits = [];
  if (d.operation_type === "TRANSFER") {
    splits.push({ member_id: d.transfer_from_id, paid_amount_minor: preview.baseMinor, owed_amount_minor: 0, share_value: 0 });
    splits.push({ member_id: d.transfer_to_id, paid_amount_minor: 0, owed_amount_minor: preview.baseMinor, share_value: preview.baseMinor });
  } else {
    const eachPaid = Math.floor(preview.baseMinor / d.payers.length);
    let remPaid = preview.baseMinor - eachPaid * d.payers.length;
    const paidMap = {};
    d.payers.forEach(pid => {
      paidMap[pid] = eachPaid + (remPaid > 0 ? 1 : 0);
      if (remPaid > 0) remPaid -= 1;
    });
    const involved = new Set([...Object.keys(paidMap), ...Object.keys(preview.sharesMinor)]);
    for (const mid of involved) {
      splits.push({
        member_id: mid,
        paid_amount_minor: paidMap[mid] || 0,
        owed_amount_minor: preview.sharesMinor[mid] || 0,
        share_value: 1
      });
    }
  }

  const now = new Date().toISOString();
  const opRecord = {
    id: d.id || `demo_op_${Date.now()}`,
    event_id: ev.id,
    created_by_member_id: target.viewer_member_id,
    operation_type: payload.operation_type,
    title: payload.title,
    category: payload.category,
    original_amount_minor: payload.original_amount_minor,
    original_currency: payload.original_currency,
    exchange_rate: payload.exchange_rate,
    base_amount_minor: preview.baseMinor,
    split_type: payload.split_type,
    items: itemsPayload,
    split_meta: {
      included_member_ids: includedMemberIds,
      weights_map: weightsMap,
      exact_minor_map: exactMinorMap,
      percent_map: percentMap,
      transfer_from_id: d.transfer_from_id,
      transfer_to_id: d.transfer_to_id
    },
    comment: payload.comment,
    expense_date: payload.expense_date,
    created_at: now,
    payers: payload.payers,
    shares_minor: preview.sharesMinor,
    splits
  };

  target.operations = target.operations || [];
  if (d.id) {
    const idx = target.operations.findIndex(o => o.id === d.id);
    if (idx >= 0) target.operations[idx] = opRecord;
  } else {
    target.operations.unshift(opRecord);
  }
  target.audit_log.unshift({
    id: `log_${Date.now()}`,
    action: d.id ? "OPERATION_UPDATED" : "OPERATION_ADDED",
    text: `${d.id ? "Изменена" : "Добавлена"} операция «${opRecord.title}» — ${formatExpenseMinor(opRecord.original_amount_minor, opRecord.original_currency)}`,
    created_at: now
  });
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  closeExpenseOperationModal();
  renderExpenseEventDetail();
  loadExpensesDashboard();
  if (typeof showToast === "function") showToast(d.id ? "✓ Операция обновлена" : "✓ Операция добавлена");
}

async function deleteCurrentExpenseOperation() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  if (!ev || !d?.id) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/operations/${encodeURIComponent(d.id)}`, {
        method: "DELETE",
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      closeExpenseOperationModal();
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      if (typeof showToast === "function") showToast("🗑 Операция удалена");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось удалить операцию"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  target.operations = (target.operations || []).filter(o => o.id !== d.id);
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  closeExpenseOperationModal();
  renderExpenseEventDetail();
  loadExpensesDashboard();
  if (typeof showToast === "function") showToast("🗑 Операция удалена");
}

/* ==========================================================================
   СОЗДАНИЕ НОВОГО СОБЫТИЯ
   ========================================================================== */
function openNewEventModal() {
  const exp = getExpensesState();
  const hub = typeof getSuperappState === "function" ? getSuperappState() : null;
  exp.newEventIcon = "🎉";
  exp.newEventSimplify = true;

  const iconsBox = document.getElementById("newEventIconsPicker");
  if (iconsBox) {
    iconsBox.innerHTML = EXPENSE_ICONS.map(ico => `
      <button type="button" class="cat-preset-btn ${ico === exp.newEventIcon ? "selected" : ""}" data-ne-icon="${ico}" onclick="selectNewEventIcon('${ico}')">${ico}</button>
    `).join("");
  }

  const titleInput = document.getElementById("newEventTitleInput");
  const curSelect = document.getElementById("newEventCurrencySelect");
  const copySelect = document.getElementById("newEventCopyMembersSelect");
  const ghostsInput = document.getElementById("newEventGhostsInput");
  const simplifyInput = document.getElementById("newEventSimplifyInput");

  if (titleInput) titleInput.value = "";
  if (curSelect) curSelect.value = hub?.profile?.default_currency || "RUB";
  if (ghostsInput) ghostsInput.value = "";
  if (simplifyInput) simplifyInput.checked = true;

  if (copySelect) {
    const pastEvents = [...exp.activeEvents, ...exp.archivedEvents];
    copySelect.innerHTML = `<option value="">— не копировать —</option>` + pastEvents.map(e => `
      <option value="${escapeHtml(e.id)}">${escapeHtml(e.icon || "🎉")} ${escapeHtml(e.title)} (${Number(e.members_count || e.members?.length || 1)})</option>
    `).join("");
  }

  const backdrop = document.getElementById("newEventModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
  if (typeof triggerHaptic === "function") triggerHaptic("light");
}

function closeNewEventModal() {
  const backdrop = document.getElementById("newEventModalBackdrop");
  if (backdrop) backdrop.classList.remove("open");
}

function selectNewEventIcon(icon) {
  const exp = getExpensesState();
  exp.newEventIcon = icon;
  document.querySelectorAll("[data-ne-icon]").forEach(btn => {
    btn.classList.toggle("selected", btn.getAttribute("data-ne-icon") === icon);
  });
  if (typeof triggerHaptic === "function") triggerHaptic("light");
}

async function handleCreateExpenseEventSubmit(event) {
  event.preventDefault();
  const exp = getExpensesState();
  const title = String(document.getElementById("newEventTitleInput")?.value || "").trim();
  if (!title) {
    if (typeof showToast === "function") showToast("⚠️ Введите название события");
    return;
  }
  const baseCurrency = String(document.getElementById("newEventCurrencySelect")?.value || "RUB").toUpperCase();
  const copyFromEventId = String(document.getElementById("newEventCopyMembersSelect")?.value || "").trim();
  const ghostsRaw = String(document.getElementById("newEventGhostsInput")?.value || "");
  const simplifyDebts = Boolean(document.getElementById("newEventSimplifyInput")?.checked);

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify({
          title,
          icon: exp.newEventIcon,
          base_currency: baseCurrency,
          simplify_debts: simplifyDebts,
          copy_from_event_id: copyFromEventId || undefined,
          ghost_names: ghostsRaw
        })
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      closeNewEventModal();
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.view = "event";
        exp.activeTab = "ops";
        await loadExpensesDashboard();
        exp.currentEvent = data.event;
        exp.view = "event";
        renderExpensesModule();
      }
      if (typeof triggerHaptic === "function") triggerHaptic("success");
      if (typeof showToast === "function") showToast("✓ Событие создано");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось создать событие"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const now = new Date().toISOString();
  const meName = typeof DEMO_USERS !== "undefined" ? DEMO_USERS.owner.name : "Максим";
  const newId = `demo_ev_${Date.now()}`;
  const members = [
    {
      id: `mem_${Date.now()}_1`,
      event_id: newId,
      user_id: "usr_1001",
      telegram_id: 1001,
      username: "maxim",
      member_name: meName,
      is_ghost: false,
      role: "OWNER",
      default_weight: 1,
      linked_payer_member_id: null,
      payment_phone: "+7 999 123-45-67",
      preferred_banks: ["Т-Банк"]
    }
  ];
  const seen = new Set([meName.toLocaleLowerCase("ru-RU")]);

  if (copyFromEventId) {
    const src = demo.events.find(e => e.id === copyFromEventId);
    for (const m of src?.members || []) {
      const k = m.member_name.toLocaleLowerCase("ru-RU");
      if (seen.has(k)) continue;
      seen.add(k);
      members.push({
        ...m,
        id: `mem_${Date.now()}_${members.length + 1}`,
        event_id: newId,
        linked_payer_member_id: null
      });
    }
  }

  ghostsRaw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).forEach(nm => {
    const k = nm.toLocaleLowerCase("ru-RU");
    if (seen.has(k)) return;
    seen.add(k);
    members.push({
      id: `mem_${Date.now()}_${members.length + 1}`,
      event_id: newId,
      user_id: null,
      telegram_id: null,
      username: "",
      member_name: nm,
      is_ghost: true,
      role: "MEMBER",
      default_weight: 1,
      linked_payer_member_id: null,
      payment_phone: "",
      preferred_banks: []
    });
  });

  const created = {
    id: newId,
    title,
    description: "",
    icon: exp.newEventIcon,
    base_currency: baseCurrency,
    creator_id: "usr_1001",
    simplify_debts: simplifyDebts,
    status: "ACTIVE",
    invite_token: `exp_${Math.random().toString(16).slice(2, 10)}`,
    created_at: now,
    updated_at: now,
    viewer_member_id: members[0].id,
    viewer_role: "OWNER",
    total_spent_minor: 0,
    net_balance_minor: 0,
    members,
    wallets: [],
    operations: [],
    settlements: [],
    goal: null,
    audit_log: [
      { id: `log_${Date.now()}`, action: "EVENT_CREATED", text: `${meName} создал(а) событие «${title}»`, created_at: now }
    ]
  };
  computeClientSettlementPlan(created);
  demo.events.unshift(created);
  saveDemoExpensesStore(demo);
  closeNewEventModal();
  await loadExpensesDashboard();
  exp.currentEvent = created;
  exp.view = "event";
  renderExpensesModule();
  if (typeof showToast === "function") showToast("✓ Событие создано");
}

/* ==========================================================================
   УЧАСТНИКИ, GHOST PROFILES, ВЕСА И «ЕДИНЫЙ КОШЕЛЁК»
   ========================================================================== */
function openEventParticipantsModal() {
  const exp = getExpensesState();
  exp.mergeSelection = [];
  renderEventParticipantsModal();
  const backdrop = document.getElementById("eventParticipantsModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
  if (typeof triggerHaptic === "function") triggerHaptic("light");
}

function closeEventParticipantsModal() {
  const backdrop = document.getElementById("eventParticipantsModalBackdrop");
  if (backdrop) backdrop.classList.remove("open");
}

function renderEventParticipantsModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const container = document.getElementById("eventParticipantsModalBody");
  if (!ev || !container) return;

  const members = Array.isArray(ev.members) ? ev.members : [];
  const wallets = computeWalletsFromClientMembers(members);
  const canManage = ["OWNER", "ADMIN"].includes(ev.viewer_role);

  container.innerHTML = `
    ${wallets.length ? `
      <div class="hub-section-label" style="margin-top: 0;">Единые кошельки</div>
      ${wallets.map(w => `
        <div class="exp-wallet-card">
          <div style="flex: 1; min-width: 0;">
            <strong style="font-size: 14px; display: block;">🤝 ${escapeHtml(w.name)}</strong>
            <span style="font-size: 12px; color: var(--tg-theme-hint-color);">Общий баланс и расчёт в одном юните</span>
          </div>
          <button type="button" class="btn-mini" onclick="unmergeUnifiedWallet('${escapeHtml(w.head_member_id)}')">Разъединить</button>
        </div>
      `).join("")}
    ` : ""}

    <div class="hub-section-label">Все участники (${members.length})</div>
    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
      ${members.map(m => {
        const selected = exp.mergeSelection.includes(m.id);
        const inWallet = wallets.some(w => w.member_ids.includes(m.id));
        const weight = Number(m.default_weight || 1);
        return `
          <div class="exp-member-row">
            <div class="exp-member-avatar ${m.is_ghost ? "ghost" : ""}">${escapeHtml(m.member_name.slice(0, 2).toUpperCase())}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 14px; font-weight: 700;">
                ${escapeHtml(m.member_name)}
                ${m.is_ghost ? `<span class="exp-ghost-tag">виртуальный</span>` : ""}
              </div>
              <div style="font-size: 11.5px; color: var(--tg-theme-hint-color);">
                ${inWallet ? "в едином кошельке" : m.role === "OWNER" ? "создатель" : m.username ? `@${escapeHtml(m.username)}` : "участник"}
              </div>
            </div>
            <div class="exp-weight-stepper">
              <button type="button" onclick="adjustMemberWeight('${escapeHtml(m.id)}', -0.5)" aria-label="Уменьшить вес">−</button>
              <span class="tabular-nums">${weight}x</span>
              <button type="button" onclick="adjustMemberWeight('${escapeHtml(m.id)}', 0.5)" aria-label="Увеличить вес">+</button>
            </div>
            <button type="button" class="exp-merge-check ${selected ? "on" : ""}" onclick="toggleMergeMemberSelection('${escapeHtml(m.id)}')" title="Выбрать для единого кошелька">
              ${selected ? "✓" : ""}
            </button>
            ${canManage && m.role !== "OWNER" ? `
              <button type="button" class="btn-mini danger" onclick="removeExpenseMember('${escapeHtml(m.id)}')" title="Удалить участника">✕</button>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>

    ${exp.mergeSelection.length >= 2 ? `
      <button type="button" class="btn-accent" style="width: 100%; margin-bottom: 14px;" onclick="mergeSelectedIntoUnifiedWallet()">
        🤝 Объединить в единый кошелёк (${exp.mergeSelection.length})
      </button>
    ` : `
      <div class="composer-hint" style="margin-bottom: 14px;">Отметьте галочками 2 и более участников, чтобы объединить их в единый кошелёк.</div>
    `}

    <form class="social-add-form" style="margin-top: 8px; margin-bottom: 0;" onsubmit="handleAddGhostMemberSubmit(event)">
      <input type="text" class="input-modern" id="addGhostMemberNameInput" maxlength="64" placeholder="Имя нового участника (можно без Telegram)" required />
      <button type="submit" class="btn-glass">＋ Добавить</button>
    </form>
  `;
}

function toggleMergeMemberSelection(memberId) {
  const exp = getExpensesState();
  const idx = exp.mergeSelection.indexOf(memberId);
  if (idx >= 0) exp.mergeSelection.splice(idx, 1);
  else exp.mergeSelection.push(memberId);
  renderEventParticipantsModal();
}

async function handleAddGhostMemberSubmit(event) {
  event.preventDefault();
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const input = document.getElementById("addGhostMemberNameInput");
  const name = String(input?.value || "").trim();
  if (!ev || !name) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify({ member_name: name })
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        if (input) input.value = "";
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      if (typeof showToast === "function") showToast(`✓ Участник «${name}» добавлен`);
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось добавить участника"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  if (target.members.some(m => m.member_name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) {
    if (typeof showToast === "function") showToast("⚠️ Участник с таким именем уже есть");
    return;
  }
  const now = new Date().toISOString();
  target.members.push({
    id: `mem_${Date.now()}`,
    event_id: ev.id,
    user_id: null,
    telegram_id: null,
    username: "",
    member_name: name,
    is_ghost: true,
    role: "MEMBER",
    default_weight: 1,
    linked_payer_member_id: null,
    payment_phone: "",
    preferred_banks: []
  });
  if (target.goal?.contributions) {
    target.goal.contributions.push({ member_id: target.members.at(-1).id, member_name: name, status: "UNPAID" });
  }
  target.audit_log.unshift({
    id: `log_${Date.now()}`,
    action: "MEMBER_ADDED",
    text: `Добавлен участник «${name}»`,
    created_at: now
  });
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  if (input) input.value = "";
  renderEventParticipantsModal();
  renderExpenseEventDetail();
  loadExpensesDashboard();
  if (typeof showToast === "function") showToast(`✓ Участник «${name}» добавлен`);
}

async function adjustMemberWeight(memberId, delta) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;
  const member = (ev.members || []).find(m => m.id === memberId);
  if (!member) return;
  const nextWeight = Math.max(0.5, Math.min(10, Math.round((Number(member.default_weight || 1) + delta) * 2) / 2));
  if (nextWeight === Number(member.default_weight || 1)) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify({ default_weight: nextWeight })
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        renderEventParticipantsModal();
        renderExpenseEventDetail();
      }
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось изменить вес"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  const m = target?.members.find(x => x.id === memberId);
  if (m) {
    m.default_weight = nextWeight;
    saveDemoExpensesStore(demo);
    exp.currentEvent = target;
    renderEventParticipantsModal();
    renderExpenseEventDetail();
  }
}

async function removeExpenseMember(memberId) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members/${encodeURIComponent(memberId)}`, {
        method: "DELETE",
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.mergeSelection = exp.mergeSelection.filter(id => id !== memberId);
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      if (typeof showToast === "function") showToast("🗑 Участник удалён");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось удалить участника"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  target.members = target.members.filter(m => m.id !== memberId);
  for (const m of target.members) {
    if (m.linked_payer_member_id === memberId) m.linked_payer_member_id = null;
  }
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  exp.mergeSelection = exp.mergeSelection.filter(id => id !== memberId);
  renderEventParticipantsModal();
  renderExpenseEventDetail();
  loadExpensesDashboard();
}

async function mergeSelectedIntoUnifiedWallet() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev || exp.mergeSelection.length < 2) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/wallets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify({ member_ids: exp.mergeSelection })
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.mergeSelection = [];
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      if (typeof triggerHaptic === "function") triggerHaptic("success");
      if (typeof showToast === "function") showToast("🤝 Единый кошелёк создан");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось объединить кошелёк"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  const selected = exp.mergeSelection.map(id => target.members.find(m => m.id === id)).filter(Boolean);
  if (selected.length < 2) return;
  const head = selected.find(m => m.role === "OWNER") || selected.find(m => !m.is_ghost) || selected[0];
  head.linked_payer_member_id = null;
  for (const m of selected) {
    if (m.id !== head.id) m.linked_payer_member_id = head.id;
  }
  computeClientSettlementPlan(target);
  target.audit_log.unshift({
    id: `log_${Date.now()}`,
    action: "WALLET_MERGED",
    text: `Создан единый кошелёк «${selected.map(m => m.member_name).join(" + ")}»`,
    created_at: new Date().toISOString()
  });
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  exp.mergeSelection = [];
  renderEventParticipantsModal();
  renderExpenseEventDetail();
  loadExpensesDashboard();
  if (typeof showToast === "function") showToast("🤝 Единый кошелёк создан");
}

async function unmergeUnifiedWallet(headMemberId) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/wallets/${encodeURIComponent(headMemberId)}`, {
        method: "DELETE",
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      if (typeof showToast === "function") showToast("Единый кошелёк разъединён");
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось разъединить кошелёк"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  for (const m of target.members) {
    if (m.id === headMemberId || m.linked_payer_member_id === headMemberId) {
      m.linked_payer_member_id = null;
    }
  }
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  renderEventParticipantsModal();
  renderExpenseEventDetail();
  loadExpensesDashboard();
  if (typeof showToast === "function") showToast("Единый кошелёк разъединён");
}

/* ==========================================================================
   НАСТРОЙКИ СОБЫТИЯ (ЗАМОРОЗКА / АРХИВ / УПРОЩЕНИЕ ДОЛГОВ / CSV)
   ========================================================================== */
function openExpenseEventMenuModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const body = document.getElementById("expenseEventMenuBody");
  if (!ev || !body) return;

  const isFrozen = ev.status === "SETTLING";
  const isArchived = ev.status === "ARCHIVED";

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); openEventParticipantsModal();">
        👥 Участники, веса и единые кошельки
      </button>
      <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); openCreateGoalModal();">
        🎯 Целевой сбор фиксированной суммы
      </button>
      <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); exportCurrentExpenseEventCsv();">
        📊 Экспорт ведомости в CSV
      </button>
      <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); openEventInviteShareModal();">
        🔗 Пригласить по ссылке / Claim Profile
      </button>
      ${!isArchived ? `
        <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="toggleExpenseEventFreeze()">
          ${isFrozen ? "☀️ Разморозить траты" : "❄️ Заморозить траты на время расчётов"}
        </button>
      ` : ""}
      <button type="button" class="btn-glass" style="justify-content: flex-start; color: ${isArchived ? "var(--tg-theme-text-color)" : "var(--tg-theme-destructive-text-color)"};" onclick="toggleExpenseEventArchive()">
        ${isArchived ? "↩️ Вернуть событие из архива" : "📦 Переместить событие в архив"}
      </button>
    </div>
  `;

  const backdrop = document.getElementById("expenseEventMenuBackdrop");
  if (backdrop) backdrop.classList.add("open");
}

function closeExpenseEventMenuModal() {
  const backdrop = document.getElementById("expenseEventMenuBackdrop");
  if (backdrop) backdrop.classList.remove("open");
}

async function patchCurrentExpenseEvent(patch) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify(patch)
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось обновить событие"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  Object.assign(target, patch);
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  renderExpenseEventDetail();
  loadExpensesDashboard();
}

async function toggleEventSimplifyDebts(domEvent) {
  if (domEvent) domEvent.stopPropagation();
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  await patchCurrentExpenseEvent({ simplify_debts: !ev.simplify_debts });
}

async function toggleExpenseEventFreeze() {
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  closeExpenseEventMenuModal();
  const nextStatus = ev.status === "SETTLING" ? "ACTIVE" : "SETTLING";
  await patchCurrentExpenseEvent({ status: nextStatus });
  if (typeof showToast === "function") {
    showToast(nextStatus === "SETTLING" ? "❄️ Траты заморожены" : "☀️ Траты разморожены");
  }
}

async function toggleExpenseEventArchive() {
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  closeExpenseEventMenuModal();
  const nextStatus = ev.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
  await patchCurrentExpenseEvent({ status: nextStatus });
  if (typeof showToast === "function") {
    showToast(nextStatus === "ARCHIVED" ? "📦 Событие перенесено в архив" : "↩️ Событие возвращено из архива");
  }
}

/* ==========================================================================
   ИНВАЙТ-ССЫЛКА И CLAIM PROFILE
   ========================================================================== */
function buildExpenseInviteUrl(inviteToken) {
  const bot = (typeof state !== "undefined" && state.botUsername) ? state.botUsername : "testpmvbot_bot";
  const prefix = ["http", "s://"].join("");
  return `${prefix}t.me/${bot}?start=${encodeURIComponent(inviteToken)}`;
}

function openEventInviteShareModal() {
  const ev = getExpensesState().currentEvent;
  const body = document.getElementById("claimProfileModalBody");
  if (!ev || !body) return;

  const inviteUrl = buildExpenseInviteUrl(ev.invite_token || "");
  const ghosts = (ev.members || []).filter(m => m.is_ghost || !m.user_id);

  body.innerHTML = `
    <p class="social-panel-copy">
      Отправьте ссылку друзьям: при переходе по ней они смогут выбрать своё имя из виртуальных профилей события или войти как новый участник.
    </p>
    <div class="share-preview-box" id="expenseInviteUrlBox">${escapeHtml(inviteUrl)}</div>
    <div style="display: flex; gap: 10px; margin-top: 12px; margin-bottom: 18px;">
      <button type="button" class="btn-accent" style="flex: 1;" onclick="copyExpenseInviteLink('${escapeHtml(inviteUrl)}')">
        📋 Скопировать ссылку
      </button>
    </div>

    <div class="hub-section-label">Предпросмотр входа по ссылке (Claim Profile)</div>
    ${ghosts.length ? ghosts.map(g => `
      <div class="exp-wallet-card" style="background: var(--surface-input);">
        <div class="exp-member-avatar ghost">${escapeHtml(g.member_name.slice(0, 2).toUpperCase())}</div>
        <div style="flex: 1; min-width: 0;">
          <strong style="font-size: 14px; display: block;">${escapeHtml(g.member_name)}</strong>
          <span style="font-size: 12px; color: var(--tg-theme-hint-color);">Виртуальный профиль · ждёт привязки</span>
        </div>
        <span class="exp-ghost-tag">Ghost</span>
      </div>
    `).join("") : `<div class="composer-hint">Все участники уже привязаны к аккаунтам Telegram.</div>`}
  `;

  const backdrop = document.getElementById("claimProfileModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
}

async function copyExpenseInviteLink(url) {
  if (typeof copyToClipboard === "function") {
    await copyToClipboard(url);
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url).catch(() => {});
  }
  if (typeof triggerHaptic === "function") triggerHaptic("success");
  if (typeof showToast === "function") showToast("🔗 Скопировано");
}

function closeClaimProfileModal() {
  const backdrop = document.getElementById("claimProfileModalBackdrop");
  if (backdrop) backdrop.classList.remove("open");
}

async function checkPendingExpenseInvite() {
  const params = new URLSearchParams(window.location.search);
  const queryInvite = String(params.get("invite") || "").trim();
  const rawStart = typeof startParam === "string" ? startParam.trim() : "";
  const token = queryInvite || (rawStart.startsWith("exp_") ? rawStart : "");
  if (!token) return;

  if (typeof selectSuperappModule === "function") {
    selectSuperappModule("expenses");
  }

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/invite/${encodeURIComponent(token)}`, {
        headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.already_joined && data?.event?.id) {
        await openExpenseEvent(data.event.id);
        return;
      }
      renderIncomingClaimModal(token, data.event, data.ghost_profiles || []);
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Недействительная ссылка приглашения"}`);
    }
  }
}

function renderIncomingClaimModal(token, eventInfo, ghostProfiles) {
  const body = document.getElementById("claimProfileModalBody");
  if (!body || !eventInfo) return;

  body.innerHTML = `
    <p class="social-panel-copy">
      Вас пригласили в событие <strong>${escapeHtml(eventInfo.icon || "🎉")} «${escapeHtml(eventInfo.title)}»</strong>.
      Выберите свой виртуальный профиль, если вас уже добавили в список, или войдите как новый участник.
    </p>
    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
      ${ghostProfiles.map(g => `
        <button type="button" class="exp-wallet-card" style="text-align: left; width: 100%;" onclick="submitClaimExpenseProfile('${escapeHtml(token)}', '${escapeHtml(g.id)}')">
          <div class="exp-member-avatar ghost">${escapeHtml(g.member_name.slice(0, 2).toUpperCase())}</div>
          <div style="flex: 1; min-width: 0;">
            <strong style="font-size: 14.5px; display: block;">Это я — ${escapeHtml(g.member_name)}</strong>
            <span style="font-size: 12px; color: var(--tg-theme-hint-color);">Привязать все доли и траты к моему Telegram</span>
          </div>
          <span class="hub-chevron">›</span>
        </button>
      `).join("")}
      <button type="button" class="btn-accent" style="width: 100%; margin-top: 4px;" onclick="submitClaimExpenseProfile('${escapeHtml(token)}', '__new')">
        ➕ Войти как новый участник
      </button>
    </div>
  `;

  const backdrop = document.getElementById("claimProfileModalBackdrop");
  if (backdrop) backdrop.classList.add("open");
}

async function submitClaimExpenseProfile(token, memberId) {
  const exp = getExpensesState();
  if (typeof isTelegramSession === "undefined" || !isTelegramSession || typeof API_ORIGIN === "undefined" || !API_ORIGIN) {
    closeClaimProfileModal();
    return;
  }
  try {
    const response = await fetch(`${API_ORIGIN}/api/expenses/invite/${encodeURIComponent(token)}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
      },
      body: JSON.stringify({ member_id: memberId })
    });
    const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
    closeClaimProfileModal();
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url);

    if (data?.event) {
      exp.currentEvent = data.event;
      exp.view = "event";
      exp.activeTab = "ops";
      await loadExpensesDashboard();
      exp.currentEvent = data.event;
      exp.view = "event";
      renderExpensesModule();
    }
    if (typeof triggerHaptic === "function") triggerHaptic("success");
    if (typeof showToast === "function") {
      showToast(data?.claimed ? "✓ Виртуальный профиль привязан к вашему аккаунту" : "✓ Вы присоединились к событию");
    }
  } catch (error) {
    if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось присоединиться к событию"}`);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadExpensesDashboard();
  checkPendingExpenseInvite();
});
