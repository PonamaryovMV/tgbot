import { escapeHtml, triggerHaptic } from "./state.js";
import {
  getCategoryIconByLabel,
  getExpensesCurrencySymbol,
  formatExpenseMinor,
  getClientUnitHeadId,
  computeWalletsFromClientMembers,
  getExpensesState,
  switchSettleSubView
} from "./expenses-state.js";

const modalTriggers = {
  openExpenseOperationModal: () => {},
  openEventParticipantsModal: () => {},
  toggleEventSimplifyDebts: () => {},
  openEdgeSettleModal: () => {},
  confirmIncomingSettlement: () => {},
  rejectIncomingSettlement: () => {},
  openCrossPersonSettleModal: () => {}
};

export function registerExpensesViewHooks(hooks) {
  Object.assign(modalTriggers, hooks);
}

function getEventStatusBadge(status) {
  if (status === "ARCHIVED") return `<span class="exp-status-pill archived">Архив</span>`;
  if (status === "SETTLING") return `<span class="exp-status-pill settling">Расчёты · заморожено</span>`;
  return `<span class="exp-status-pill active">Активно</span>`;
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

export function renderExpensesModule() {
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

export function renderExpensesDashboard() {
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

  const renderCard = ev => {
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

export function renderExpenseEventDetail() {
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
        return `
          <div class="composer-card" style="padding: 13px; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: ${incoming ? "10px" : "0"};">
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

export function renderSettlementSvgGraph(ev) {
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

export function toggleGraphNodeFocus(unitId) {
  const exp = getExpensesState();
  exp.focusedUnitId = exp.focusedUnitId === unitId ? null : unitId;
  if (exp.currentEvent) renderSettlementSvgGraph(exp.currentEvent);
}

export {
  switchSettleSubView,
  modalTriggers
};
