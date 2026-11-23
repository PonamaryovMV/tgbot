/**
 * Модуль 4: Этап 2 «Совместные расходы» — дашборд событий, создание события,
 * виртуальные участники (Ghost Profiles), веса, «Единый кошелёк» и Claim Profile.
 */
const EXPENSES_DEMO_STORAGE_KEY = "tg_expenses_stage2_demo_v1";
const EXPENSE_ICONS = ["🎉", "🎄", "🍸", "🏖", "🎂", "🚗", "🏕", "🏙", "⚽", "🎮"];

function getExpensesCurrencySymbol(code) {
  const map = { RUB: "₽", USD: "$", EUR: "€", KZT: "₸", TRY: "₺", GEL: "₾" };
  return map[String(code || "RUB").toUpperCase()] || code || "₽";
}

function formatExpenseMinor(minor, currency = "RUB") {
  const sym = getExpensesCurrencySymbol(currency);
  const val = Math.round((Number(minor) || 0) / 100);
  return `${new Intl.NumberFormat("ru-RU").format(val)} ${sym}`;
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
        total_spent_minor: 0,
        net_balance_minor: 0,
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
            linked_payer_member_id: null
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
            linked_payer_member_id: "mem_1"
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
            linked_payer_member_id: null
          }
        ],
        audit_log: [
          {
            id: "log_1",
            action: "EVENT_CREATED",
            text: `${meName} создал(а) событие «Новый год 2027»`,
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

function computeWalletsFromClientMembers(members) {
  const byId = new Map((members || []).map(m => [m.id, m]));
  const groups = new Map();
  for (const m of members || []) {
    const headId = m.linked_payer_member_id && byId.has(m.linked_payer_member_id)
      ? m.linked_payer_member_id
      : m.id;
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

function getExpensesState() {
  if (!state.expenses) {
    state.expenses = {
      view: "dashboard", // "dashboard" | "event"
      activeTab: "ops", // "ops" | "settle" | "history"
      loading: false,
      activeEvents: [],
      archivedEvents: [],
      currentEvent: null,
      mergeSelection: [],
      newEventIcon: "🎉",
      newEventSimplify: true,
      invitePreview: null,
      inviteToken: ""
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
  exp.activeEvents = demo.events
    .filter(e => e.status !== "ARCHIVED")
    .map(e => ({ ...e, members_count: (e.members || []).length }));
  exp.archivedEvents = demo.events
    .filter(e => e.status === "ARCHIVED")
    .map(e => ({ ...e, members_count: (e.members || []).length }));
  exp.loading = false;
  syncExpensesSummaryToHub();
  renderExpensesModule();
}

function getEventStatusBadge(status) {
  if (status === "ARCHIVED") {
    return `<span class="exp-status-pill archived">Архив</span>`;
  }
  if (status === "SETTLING") {
    return `<span class="exp-status-pill settling">Расчёты · заморожено</span>`;
  }
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
  if (!activeContainer) return;

  if (exp.loading) {
    activeContainer.innerHTML = `<div class="composer-card" style="text-align: center; color: var(--tg-theme-hint-color);">Загрузка событий...</div>`;
    return;
  }

  const renderCard = (ev) => {
    const count = Number(ev.members_count || ev.members?.length || 1);
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
          <div class="exp-event-meta">${count} уч. · ${escapeHtml(ev.base_currency || "RUB")}</div>
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
    exp.currentEvent = found;
    exp.view = "event";
    exp.activeTab = "ops";
    renderExpensesModule();
  }
}

function backToExpensesDashboard() {
  const exp = getExpensesState();
  exp.view = "dashboard";
  exp.currentEvent = null;
  if (typeof triggerHaptic === "function") triggerHaptic("light");
  loadExpensesDashboard();
}

function switchExpenseEventTab(tabName) {
  const exp = getExpensesState();
  exp.activeTab = tabName;
  if (typeof triggerHaptic === "function") triggerHaptic("light");
  renderExpenseEventDetail();
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
    bodyEl.innerHTML = `
      <div class="composer-card" style="margin-top: 12px;">
        <div class="modal-head" style="margin-bottom: 8px;">
          <h3 class="modal-title" style="font-size: 16px;">Участники события (${members.length})</h3>
          <button type="button" class="btn-glass" style="min-height: 36px; padding: 0 12px; font-size: 13px;" onclick="openEventParticipantsModal()">
            👥 Настроить
          </button>
        </div>
        <div class="audience-editor" style="margin-bottom: 12px;">
          ${members.map(m => `
            <span class="audience-chip active">
              ${escapeHtml(m.member_name)}${m.is_ghost ? " (вирт.)" : ""}${Number(m.default_weight) !== 1 ? ` · ${m.default_weight}x` : ""}
            </span>
          `).join("")}
        </div>
        ${isFrozen
          ? `<div class="composer-hint">❄️ Добавление трат заблокировано (${ev.status === "ARCHIVED" ? "событие в архиве" : "идут расчёты"}).</div>`
          : `<div class="composer-hint">Участники готовы. Добавление чеков и 5 режимов сплита подключаются на Этапе 3.</div>`}
      </div>
    `;
    return;
  }

  if (exp.activeTab === "settle") {
    bodyEl.innerHTML = `
      <div class="composer-card" style="margin-top: 12px;">
        <div class="bento-switch-card" style="margin-bottom: 12px;" onclick="toggleEventSimplifyDebts()">
          <div class="switch-text-wrap">
            <span class="switch-title">Упрощать долги</span>
            <span class="switch-subtitle">Минимизировать число переводов между участниками</span>
          </div>
          <span class="ios-switch">
            <input type="checkbox" id="expSimplifyToggleInput" ${ev.simplify_debts ? "checked" : ""} onchange="toggleEventSimplifyDebts(event)" />
            <span class="ios-slider"></span>
          </span>
        </div>
        <div class="composer-hint">
          ${wallets.length
            ? `Активны единые кошельки: ${wallets.map(w => escapeHtml(w.name)).join(", ")}. При расчёте их доли объединяются.`
            : "Пока нет задолженностей. Граф переводов и погашение по СБП появятся после добавления операций."}
        </div>
      </div>
    `;
    return;
  }

  // Вкладка «История»
  const logs = Array.isArray(ev.audit_log) ? ev.audit_log : [];
  bodyEl.innerHTML = `
    <div class="composer-card" style="margin-top: 12px;">
      <h3 class="modal-title" style="font-size: 16px; margin-bottom: 10px;">Журнал событий</h3>
      ${logs.length === 0
        ? `<div class="composer-hint">История пока пуста.</div>`
        : logs.map(item => `
            <div class="exp-history-row">
              <span class="exp-history-dot"></span>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 13.5px;">${escapeHtml(item.text || item.action)}</div>
                <div style="font-size: 11px; color: var(--tg-theme-hint-color); margin-top: 2px;">${escapeHtml(String(item.created_at || "").replace("T", " ").slice(0, 16))}</div>
              </div>
            </div>
          `).join("")}
    </div>
  `;
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

  // Демо-режим
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
      linked_payer_member_id: null
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
      linked_payer_member_id: null
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
    audit_log: [
      { id: `log_${Date.now()}`, action: "EVENT_CREATED", text: `${meName} создал(а) событие «${title}»`, created_at: now }
    ]
  };
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
    linked_payer_member_id: null
  });
  target.audit_log.unshift({
    id: `log_${Date.now()}`,
    action: "MEMBER_ADDED",
    text: `Добавлен участник «${name}»`,
    created_at: now
  });
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
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  renderEventParticipantsModal();
  renderExpenseEventDetail();
  if (typeof showToast === "function") showToast("Единый кошелёк разъединён");
}

/* ==========================================================================
   НАСТРОЙКИ СОБЫТИЯ (ЗАМОРОЗКА / АРХИВ / УПРОЩЕНИЕ ДОЛГОВ)
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
  if (typeof showToast === "function") showToast("🔗 Ссылка-приглашение скопирована");
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
