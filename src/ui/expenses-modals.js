import {
  API_ORIGIN,
  tg,
  DEMO_USERS,
  state,
  isTelegramSession,
  startParam,
  escapeHtml,
  triggerHaptic,
  showToast,
  readApiResponse
} from "./state.js";
import { openBotForSelection } from "./wishlist-social.js";
import { getSuperappState, selectSuperappModule } from "./hub.js";
import {
  EXPENSE_ICONS,
  EXPENSE_CATEGORIES,
  formatExpenseMinor,
  loadDemoExpensesStore,
  saveDemoExpensesStore,
  computeWalletsFromClientMembers,
  computeClientSettlementPlan,
  getExpensesState,
  loadExpensesDashboard,
  loadExpensesContacts,
  openExpenseEvent
} from "./expenses-state.js";
import { renderExpensesModule, renderExpenseEventDetail } from "./expenses-views.js";
import {
  renderIcon,
  renderEventIcon,
  resolveEventIconKey
} from "./icons.js";

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

export function openExpenseOperationModal(opId) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (!opId && (ev.status === "SETTLING" || ev.status === "ARCHIVED")) {
    showToast("Траты заморожены");
    return;
  }

  const existing = opId ? (ev.operations || []).find(o => o.id === opId) : null;
  exp.opDraft = createDefaultOperationDraft(ev, existing);
  renderExpenseOperationModal();

  document.getElementById("expenseOperationModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeExpenseOperationModal() {
  document.getElementById("expenseOperationModalBackdrop")?.classList.remove("open");
}

export function renderExpenseOperationModal() {
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
        <button type="button" class="btn-close-circle" onclick="closeExpenseOperationModal()" aria-label="Закрыть">${renderIcon("x", "app-icon-sm")}</button>
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
              <button type="button" class="cat-preset-btn ${d.category === c.label ? "selected" : ""}" onclick="setDraftOperationCategory('${escapeHtml(c.label)}')">${renderIcon(c.icon, "app-icon-sm")} <span>${escapeHtml(c.label)}</span></button>
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

export function setDraftOperationType(type) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.operation_type = type;
  renderExpenseOperationModal();
}

export function setDraftOperationCategory(cat) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.category = cat;
  renderExpenseOperationModal();
}

export function setDraftOperationCurrency(cur) {
  const exp = getExpensesState();
  const d = exp.opDraft;
  if (!d) return;
  d.currency = cur;
  if (cur === (exp.currentEvent?.base_currency || "RUB")) d.rate = "1";
  renderExpenseOperationModal();
}

export function toggleDraftOperationPayer(memberId) {
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

export function setDraftOperationSplitMode(mode) {
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
            ${checked ? renderIcon("check", "app-icon-sm") : ""}
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
          <button type="button" class="btn-mini danger" onclick="removeDraftReceiptItem(${idx})" aria-label="Удалить позицию">${renderIcon("x", "app-icon-sm")}</button>
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
      ${renderIcon("plus", "app-icon-sm")} Добавить позицию
    </button>
    ${members.map(m => `
      <div class="exp-split-row">
        <div style="flex: 1; font-size: 13.5px;">${escapeHtml(m.member_name)}</div>
        <span class="exp-split-share-hint" data-op-share="${escapeHtml(m.id)}"></span>
      </div>
    `).join("")}
  `;
}

export function toggleDraftSplitMember(memberId) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.included[memberId] = !d.included[memberId];
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

export function addDraftReceiptItem() {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.items.push({ title: "", amount: "", member_ids: [] });
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

export function removeDraftReceiptItem(idx) {
  const d = getExpensesState().opDraft;
  if (!d) return;
  d.items.splice(idx, 1);
  renderOperationSplitEditor();
  refreshOperationSplitPreview();
}

export function toggleDraftReceiptItemMember(idx, memberId) {
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

export function refreshOperationSplitPreview() {
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

export async function submitExpenseOperation() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  if (!ev || !d) return;

  const title = String(d.title || "").trim();
  if (!title) {
    showToast("Введите название операции");
    return;
  }

  const preview = computeClientDraftPreview(ev, d);
  if (preview.origMinor <= 0) {
    showToast("Укажите сумму больше нуля");
    return;
  }
  if (!preview.valid) {
    showToast("Проверьте распределение долей");
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

  if (isTelegramSession && API_ORIGIN) {
    try {
      const url = d.id
        ? `${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/operations/${encodeURIComponent(d.id)}`
        : `${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/operations`;
      const response = await fetch(url, {
        method: d.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify(payload)
      });
      const data = await readApiResponse(response);
      closeExpenseOperationModal();
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      triggerHaptic("success");
      showToast(d.id ? "Операция обновлена" : "Операция добавлена");
    } catch (error) {
      showToast(error.message || "Не удалось сохранить операцию");
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
  showToast(d.id ? "Операция обновлена" : "Операция добавлена");
}

export async function deleteCurrentExpenseOperation() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.opDraft;
  if (!ev || !d?.id) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/operations/${encodeURIComponent(d.id)}`, {
        method: "DELETE",
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      closeExpenseOperationModal();
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      showToast("Операция удалена");
    } catch (error) {
      showToast(error.message || "Не удалось удалить операцию");
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
  showToast("Операция удалена");
}

function normalizeExpenseUsername(value) {
  const username = String(value || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    showToast("Введите корректный @username Telegram");
    return "";
  }
  return username.toLowerCase();
}

function resolveDemoUserByInput({ username, telegram_id }) {
  const all = [];
  for (const u of Object.values(DEMO_USERS)) {
    all.push({ telegram_id: u.id, username: u.username, display_name: u.name });
  }
  for (const sub of state.subscriptions || []) {
    const id = Number(sub?.id);
    if (id && !all.some(x => x.telegram_id === id)) {
      all.push({ telegram_id: id, username: sub.username || "", display_name: sub.first_name || "Пользователь" });
    }
  }
  if (telegram_id !== undefined && telegram_id !== null && telegram_id !== "") {
    return all.find(x => Number(x.telegram_id) === Number(telegram_id)) || null;
  }
  if (username) {
    const clean = String(username).trim().replace(/^@+/, "").toLowerCase();
    return all.find(x => String(x.username || "").toLowerCase() === clean) || null;
  }
  return null;
}

export function renderNewEventMembersSection() {
  const exp = getExpensesState();
  const selectedEl = document.getElementById("newEventSelectedMembers");
  const quickPickEl = document.getElementById("newEventContactsQuickPick");
  const selected = Array.isArray(exp.newEventMembers) ? exp.newEventMembers : [];

  if (selectedEl) {
    const myLabel = state.viewerName || "Вы";
    const chips = [
      `<span class="audience-chip active" style="cursor: default;">${renderIcon("crown", "app-icon-sm")} ${escapeHtml(myLabel)} (Вы)</span>`,
      ...selected.map(m => {
        const sub = m.username ? ` @${escapeHtml(m.username)}` : "";
        return `
          <button type="button" class="audience-chip active" onclick="removeDraftNewEventMember(${Number(m.telegram_id)})" title="Убрать из события">
            ${escapeHtml(m.display_name || "Пользователь")}${sub} ${renderIcon("x", "app-icon-sm")}
          </button>
        `;
      })
    ];
    selectedEl.innerHTML = chips.join("");
  }

  if (quickPickEl) {
    const selectedIds = new Set(selected.map(m => Number(m.telegram_id)));
    const available = (exp.contacts || []).filter(c => !selectedIds.has(Number(c.telegram_id)));
    if (available.length > 0) {
      quickPickEl.innerHTML = `
        <div style="font-size: 11.5px; color: var(--tg-theme-hint-color); margin-bottom: 6px;">Контакты и подписки (нажмите, чтобы добавить):</div>
        <div class="audience-editor">
          ${available.map(c => `
            <button type="button" class="audience-chip" onclick="toggleDraftNewEventContact(${Number(c.telegram_id)})">
              ${renderIcon("plus", "app-icon-sm")} ${escapeHtml(c.display_name || "Пользователь")}${c.username ? ` (@${escapeHtml(c.username)})` : ""}
            </button>
          `).join("")}
        </div>
      `;
    } else if (selected.length === 0) {
      quickPickEl.innerHTML = `<div class="composer-hint">Добавьте участников по @username или выберите через Telegram.</div>`;
    } else {
      quickPickEl.innerHTML = "";
    }
  }
}

export async function refreshExpensesContacts() {
  await loadExpensesContacts(false);
  renderNewEventMembersSection();
  if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
    renderEventParticipantsModal();
  }
  if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
    renderEditEventModal();
  }
}

export function toggleDraftNewEventContact(telegramId) {
  const exp = getExpensesState();
  const contact = (exp.contacts || []).find(c => Number(c.telegram_id) === Number(telegramId));
  if (!contact) return;
  if (!exp.newEventMembers.some(m => Number(m.telegram_id) === Number(telegramId))) {
    exp.newEventMembers.push(contact);
  }
  renderNewEventMembersSection();
  triggerHaptic("light");
}

export function removeDraftNewEventMember(telegramId) {
  const exp = getExpensesState();
  exp.newEventMembers = (exp.newEventMembers || []).filter(m => Number(m.telegram_id) !== Number(telegramId));
  renderNewEventMembersSection();
  triggerHaptic("light");
}

export async function addDraftNewEventMemberByUsername() {
  const exp = getExpensesState();
  const input = document.getElementById("newEventMemberUsernameInput");
  const username = normalizeExpenseUsername(input?.value || "");
  if (!username) return;

  if (isTelegramSession && API_ORIGIN) {
    const btn = document.getElementById("newEventAddMemberBtn");
    if (btn) btn.disabled = true;
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/contacts/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({ username })
      });
      const data = await readApiResponse(response);
      if (data?.status === "selection_required") {
        state.selectionBotUsername = String(data.botUsername || state.botUsername || "").replace(/^@/, "");
        exp.pendingSelectionContext = {
          mode: "new_event",
          beforeIds: new Set((exp.contacts || []).map(c => Number(c.telegram_id)))
        };
        const helpEl = document.getElementById("newEventSelectionHelp");
        if (helpEl) helpEl.hidden = false;
        showToast("Выберите человека в сообщении от бота");
        return;
      }
      if (data?.user) {
        if (!exp.newEventMembers.some(m => Number(m.telegram_id) === Number(data.user.telegram_id))) {
          exp.newEventMembers.push(data.user);
        }
        if (input) input.value = "";
        const helpEl = document.getElementById("newEventSelectionHelp");
        if (helpEl) helpEl.hidden = true;
        await loadExpensesContacts(true);
        renderNewEventMembersSection();
        triggerHaptic("success");
        showToast(`${data.user.display_name} добавлен(а) в список`);
      }
    } catch (error) {
      showToast(error.message || "Не удалось найти пользователя");
    } finally {
      if (btn) btn.disabled = false;
    }
    return;
  }

  const found = resolveDemoUserByInput({ username });
  if (!found) {
    showToast("В демо доступны @maxim, @anna1 и @dima1");
    return;
  }
  if (Number(found.telegram_id) === Number(state.viewerId)) {
    showToast("Вы уже являетесь создателем события");
    return;
  }
  if (!exp.newEventMembers.some(m => Number(m.telegram_id) === Number(found.telegram_id))) {
    exp.newEventMembers.push(found);
  }
  if (input) input.value = "";
  renderNewEventMembersSection();
  showToast(`${found.display_name} добавлен(а) в список`);
}

export async function requestTelegramContactForExpenses(eventId = null) {
  if (!isTelegramSession || !API_ORIGIN) {
    showToast("Выбор реального пользователя доступен после открытия приложения через @testpmvbot_bot.");
    return;
  }
  const exp = getExpensesState();
  try {
    const response = await fetch(`${API_ORIGIN}/api/expenses/contacts/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg?.initData || ""
      },
      body: JSON.stringify(eventId ? { event_id: eventId } : {})
    });
    const data = await readApiResponse(response);
    if (data?.status === "selection_required") {
      state.selectionBotUsername = String(data.botUsername || state.botUsername || "").replace(/^@/, "");
      exp.pendingSelectionContext = eventId
        ? { mode: "event", eventId }
        : {
            mode: "new_event",
            beforeIds: new Set((exp.contacts || []).map(c => Number(c.telegram_id)))
          };
      const helpId = eventId
        ? (document.getElementById("editEventModalBackdrop")?.classList.contains("open")
            ? "editEventSelectionHelp"
            : "expParticipantsSelectionHelp")
        : "newEventSelectionHelp";
      const helpEl = document.getElementById(helpId);
      if (helpEl) helpEl.hidden = false;
      showToast("Откройте чат с ботом и выберите контакт");
    }
  } catch (error) {
    showToast(error.message || "Не удалось запросить выбор пользователя");
  }
}

export function openNewEventModal() {
  const exp = getExpensesState();
  const hub = getSuperappState();
  exp.newEventIcon = "🎉";
  exp.newEventSimplify = true;
  exp.newEventMembers = [];

  const iconsBox = document.getElementById("newEventIconsPicker");
  if (iconsBox) {
    iconsBox.innerHTML = EXPENSE_ICONS.map(ico => `
      <button type="button" class="cat-preset-btn ${ico === exp.newEventIcon ? "selected" : ""}" data-ne-icon="${ico}" onclick="selectNewEventIcon('${ico}')" aria-label="${escapeHtml(resolveEventIconKey(ico).key)}">${renderEventIcon(ico, "ico-badge-sm")}</button>
    `).join("");
  }

  const titleInput = document.getElementById("newEventTitleInput");
  const dateInput = document.getElementById("newEventDateInput");
  const curSelect = document.getElementById("newEventCurrencySelect");
  const copySelect = document.getElementById("newEventCopyMembersSelect");
  const usernameInput = document.getElementById("newEventMemberUsernameInput");
  const simplifyInput = document.getElementById("newEventSimplifyInput");
  const helpEl = document.getElementById("newEventSelectionHelp");

  if (titleInput) titleInput.value = "";
  if (dateInput) dateInput.value = "";
  syncNewEventDateClearBtn();
  if (curSelect) curSelect.value = hub?.profile?.default_currency || "RUB";
  if (usernameInput) usernameInput.value = "";
  if (simplifyInput) simplifyInput.checked = true;
  if (helpEl) helpEl.hidden = true;

  if (copySelect) {
    const pastEvents = [...exp.activeEvents, ...exp.archivedEvents];
    copySelect.innerHTML = `<option value="">— не копировать —</option>` + pastEvents.map(e => `
      <option value="${escapeHtml(e.id)}">${escapeHtml(e.title)} (${Number(e.members_count || e.members?.length || 1)})</option>
    `).join("");
  }

  renderNewEventMembersSection();
  loadExpensesContacts(true).then(() => renderNewEventMembersSection());

  document.getElementById("newEventModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeNewEventModal() {
  document.getElementById("newEventModalBackdrop")?.classList.remove("open");
}

export function syncNewEventDateClearBtn() {
  const dateInput = document.getElementById("newEventDateInput");
  const clearBtn = document.getElementById("newEventClearDateBtn");
  if (clearBtn) {
    clearBtn.hidden = !String(dateInput?.value || "").trim();
  }
}

export function clearNewEventDate() {
  const dateInput = document.getElementById("newEventDateInput");
  if (dateInput) dateInput.value = "";
  syncNewEventDateClearBtn();
  triggerHaptic("light");
}

export function selectNewEventIcon(icon) {
  const exp = getExpensesState();
  exp.newEventIcon = icon;
  document.querySelectorAll("[data-ne-icon]").forEach(btn => {
    btn.classList.toggle("selected", btn.getAttribute("data-ne-icon") === icon);
  });
  triggerHaptic("light");
}

export async function handleCreateExpenseEventSubmit(event) {
  event.preventDefault();
  const exp = getExpensesState();
  const title = String(document.getElementById("newEventTitleInput")?.value || "").trim();
  if (!title) {
    showToast("Введите название события");
    return;
  }
  const eventDate = String(document.getElementById("newEventDateInput")?.value || "").trim();
  const baseCurrency = String(document.getElementById("newEventCurrencySelect")?.value || "RUB").toUpperCase();
  const copyFromEventId = String(document.getElementById("newEventCopyMembersSelect")?.value || "").trim();
  const simplifyDebts = Boolean(document.getElementById("newEventSimplifyInput")?.checked);
  const memberTelegramIds = (exp.newEventMembers || [])
    .map(m => Number(m.telegram_id))
    .filter(id => Number.isSafeInteger(id) && id > 0);

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({
          title,
          icon: exp.newEventIcon,
          event_date: eventDate || undefined,
          base_currency: baseCurrency,
          simplify_debts: simplifyDebts,
          copy_from_event_id: copyFromEventId || undefined,
          member_telegram_ids: memberTelegramIds
        })
      });
      const data = await readApiResponse(response);
      exp.newEventMembers = [];
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
      triggerHaptic("success");
      showToast("Событие создано");
    } catch (error) {
      showToast(error.message || "Не удалось создать событие");
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
      role: "OWNER",
      default_weight: 1,
      linked_payer_member_id: null,
      payment_phone: "+7 999 123-45-67",
      preferred_banks: ["Т-Банк"]
    }
  ];
  const seenUserIds = new Set(["usr_1001"]);

  if (copyFromEventId) {
    const src = demo.events.find(e => e.id === copyFromEventId);
    for (const m of src?.members || []) {
      if (!m.user_id || seenUserIds.has(m.user_id)) continue;
      seenUserIds.add(m.user_id);
      members.push({
        ...m,
        id: `mem_${Date.now()}_${members.length + 1}`,
        event_id: newId,
        role: "MEMBER",
        linked_payer_member_id: null
      });
    }
  }

  for (const m of exp.newEventMembers || []) {
    const uid = `usr_${m.telegram_id}`;
    if (seenUserIds.has(uid)) continue;
    seenUserIds.add(uid);
    members.push({
      id: `mem_${Date.now()}_${members.length + 1}`,
      event_id: newId,
      user_id: uid,
      telegram_id: Number(m.telegram_id),
      username: m.username || "",
      member_name: m.display_name || "Участник",
      role: "MEMBER",
      default_weight: 1,
      linked_payer_member_id: null,
      payment_phone: "",
      preferred_banks: []
    });
  }

  const created = {
    id: newId,
    title,
    description: "",
    icon: exp.newEventIcon,
    event_date: eventDate,
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
    audit_log: [
      { id: `log_${Date.now()}`, action: "EVENT_CREATED", text: `${meName} создал(а) событие «${title}»`, created_at: now }
    ]
  };
  computeClientSettlementPlan(created);
  demo.events.unshift(created);
  saveDemoExpensesStore(demo);
  exp.newEventMembers = [];
  closeNewEventModal();
  await loadExpensesDashboard();
  exp.currentEvent = created;
  exp.view = "event";
  renderExpensesModule();
  showToast("Событие создано");
}

export function openEventParticipantsModal() {
  const exp = getExpensesState();
  exp.mergeSelection = [];
  renderEventParticipantsModal();
  loadExpensesContacts(true).then(() => {
    if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
      renderEventParticipantsModal();
    }
  });
  document.getElementById("eventParticipantsModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeEventParticipantsModal() {
  document.getElementById("eventParticipantsModalBackdrop")?.classList.remove("open");
}

export function renderEventParticipantsModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const container = document.getElementById("eventParticipantsModalBody");
  if (!ev || !container) return;

  const members = Array.isArray(ev.members) ? ev.members : [];
  const wallets = computeWalletsFromClientMembers(members);
  const canManage = ["OWNER", "ADMIN"].includes(ev.viewer_role);
  const existingTgIds = new Set(members.map(m => Number(m.telegram_id)).filter(Boolean));
  const availableContacts = (exp.contacts || []).filter(c => !existingTgIds.has(Number(c.telegram_id)));

  container.innerHTML = `
    ${wallets.length ? `
      <div class="hub-section-label" style="margin-top: 0;">Единые кошельки</div>
      ${wallets.map(w => `
        <div class="exp-wallet-card">
          <div style="flex: 1; min-width: 0;">
            <strong style="font-size: 14px; display: inline-flex; align-items: center; gap: 6px;">${renderIcon("wallet", "app-icon-sm")} <span>${escapeHtml(w.name)}</span></strong>
            <span style="font-size: 12px; color: var(--tg-theme-hint-color); display: block;">Общий баланс и расчёт в одном юните</span>
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
            <div class="exp-member-avatar">${escapeHtml(m.member_name.slice(0, 2).toUpperCase())}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 14px; font-weight: 700;">
                ${escapeHtml(m.member_name)}
              </div>
              <div style="font-size: 11.5px; color: var(--tg-theme-hint-color);">
                ${inWallet ? "в едином кошельке" : m.role === "OWNER" ? "создатель" : m.username ? `@${escapeHtml(m.username)}` : "участник Telegram"}
              </div>
            </div>
            <div class="exp-weight-stepper">
              <button type="button" onclick="adjustMemberWeight('${escapeHtml(m.id)}', -0.5)" aria-label="Уменьшить вес">−</button>
              <span class="tabular-nums">${weight}x</span>
              <button type="button" onclick="adjustMemberWeight('${escapeHtml(m.id)}', 0.5)" aria-label="Увеличить вес">+</button>
            </div>
            <button type="button" class="exp-merge-check ${selected ? "on" : ""}" onclick="toggleMergeMemberSelection('${escapeHtml(m.id)}')" title="Выбрать для единого кошелька">
              ${selected ? renderIcon("check", "app-icon-sm") : ""}
            </button>
            ${canManage && m.role !== "OWNER" ? `
              <button type="button" class="btn-mini danger" onclick="removeExpenseMember('${escapeHtml(m.id)}')" title="Удалить участника" aria-label="Удалить участника">${renderIcon("x", "app-icon-sm")}</button>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>

    ${exp.mergeSelection.length >= 2 ? `
      <button type="button" class="btn-accent" style="width: 100%; margin-bottom: 14px;" onclick="mergeSelectedIntoUnifiedWallet()">
        ${renderIcon("wallet", "app-icon-sm")} Объединить в единый кошелёк (${exp.mergeSelection.length})
      </button>
    ` : `
      <div class="composer-hint" style="margin-bottom: 14px;">Отметьте галочками 2 и более участников, чтобы объединить их в единый кошелёк.</div>
    `}

    <div class="hub-section-label">Добавить участника (Telegram)</div>
    <form class="social-add-form" style="margin-top: 6px; margin-bottom: 8px;" onsubmit="handleAddRealMemberSubmit(event)">
      <input type="text" class="input-modern" id="addRealMemberUsernameInput" maxlength="33" placeholder="@username" autocomplete="off" autocapitalize="none" spellcheck="false" required />
      <button type="submit" class="btn-glass">${renderIcon("plus", "app-icon-sm")} Добавить</button>
    </form>
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;">
      <button type="button" class="btn-mini" onclick="requestTelegramContactForExpenses('${escapeHtml(ev.id)}')">${renderIcon("phone", "app-icon-sm")} Выбрать в Telegram</button>
      <button type="button" class="btn-mini" onclick="refreshExpensesContacts()">${renderIcon("refresh", "app-icon-sm")} Обновить</button>
    </div>
    <div class="selection-help" id="expParticipantsSelectionHelp" hidden>
      <p>Пользователь пока неизвестен приложению. Откройте чат с ботом и выберите человека через Telegram.</p>
      <button type="button" class="btn-glass" onclick="openBotForSelection()">Открыть чат с ботом</button>
    </div>
    ${availableContacts.length ? `
      <div style="font-size: 11.5px; color: var(--tg-theme-hint-color); margin-bottom: 6px;">Быстро добавить из контактов:</div>
      <div class="audience-editor">
        ${availableContacts.map(c => `
          <button type="button" class="audience-chip" onclick="addRealMemberToCurrentEvent({ telegram_id: ${Number(c.telegram_id)} })">
            ${renderIcon("plus", "app-icon-sm")} ${escapeHtml(c.display_name || "Пользователь")}${c.username ? ` (@${escapeHtml(c.username)})` : ""}
          </button>
        `).join("")}
      </div>
    ` : ""}
  `;
}

export function toggleMergeMemberSelection(memberId) {
  const exp = getExpensesState();
  const idx = exp.mergeSelection.indexOf(memberId);
  if (idx >= 0) exp.mergeSelection.splice(idx, 1);
  else exp.mergeSelection.push(memberId);
  renderEventParticipantsModal();
}

export async function handleAddRealMemberSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("addRealMemberUsernameInput")
    || document.getElementById("editEventMemberUsernameInput");
  const username = normalizeExpenseUsername(input?.value || "");
  if (!username) return;
  const ok = await addRealMemberToCurrentEvent({ username });
  if (ok && input) input.value = "";
}

export async function addRealMemberToCurrentEvent({ username = "", telegram_id = null } = {}) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return false;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const payload = telegram_id ? { telegram_id: Number(telegram_id) } : { username };
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify(payload)
      });
      const data = await readApiResponse(response);
      if (data?.status === "selection_required") {
        state.selectionBotUsername = String(data.botUsername || state.botUsername || "").replace(/^@/, "");
        exp.pendingSelectionContext = { mode: "event", eventId: ev.id };
        const helpId = document.getElementById("editEventModalBackdrop")?.classList.contains("open")
          ? "editEventSelectionHelp"
          : "expParticipantsSelectionHelp";
        const helpEl = document.getElementById(helpId);
        if (helpEl) helpEl.hidden = false;
        showToast("Выберите человека в сообщении от бота");
        return false;
      }
      if (data?.event) {
        exp.currentEvent = data.event;
        if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
          renderEventParticipantsModal();
        }
        if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
          renderEditEventModal();
        }
        renderExpenseEventDetail();
        loadExpensesDashboard();
        loadExpensesContacts(true);
      }
      triggerHaptic("success");
      showToast("Участник добавлен");
      return true;
    } catch (error) {
      showToast(error.message || "Не удалось добавить участника");
      return false;
    }
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return false;
  const resolved = resolveDemoUserByInput({ username, telegram_id });
  if (!resolved) {
    showToast("В демо доступны @maxim, @anna1 и @dima1");
    return false;
  }
  if (target.members.some(m => Number(m.telegram_id) === Number(resolved.telegram_id))) {
    showToast("Этот пользователь уже участвует в событии");
    return false;
  }
  const now = new Date().toISOString();
  target.members.push({
    id: `mem_${Date.now()}`,
    event_id: ev.id,
    user_id: `usr_${resolved.telegram_id}`,
    telegram_id: Number(resolved.telegram_id),
    username: resolved.username || "",
    member_name: resolved.display_name,
    role: "MEMBER",
    default_weight: 1,
    linked_payer_member_id: null,
    payment_phone: "",
    preferred_banks: []
  });
  target.audit_log.unshift({
    id: `log_${Date.now()}`,
    action: "MEMBER_ADDED",
    text: `Добавлен(а) участник: ${resolved.display_name}`,
    created_at: now
  });
  computeClientSettlementPlan(target);
  saveDemoExpensesStore(demo);
  exp.currentEvent = target;
  if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
    renderEventParticipantsModal();
  }
  if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
    renderEditEventModal();
  }
  renderExpenseEventDetail();
  loadExpensesDashboard();
  showToast(`Участник «${resolved.display_name}» добавлен`);
  return true;
}

export async function adjustMemberWeight(memberId, delta) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;
  const member = (ev.members || []).find(m => m.id === memberId);
  if (!member) return;
  const nextWeight = Math.max(0.5, Math.min(10, Math.round((Number(member.default_weight || 1) + delta) * 2) / 2));
  if (nextWeight === Number(member.default_weight || 1)) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({ default_weight: nextWeight })
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        renderEventParticipantsModal();
        renderExpenseEventDetail();
      }
    } catch (error) {
      showToast(error.message || "Не удалось изменить вес");
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

export async function removeExpenseMember(memberId) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members/${encodeURIComponent(memberId)}`, {
        method: "DELETE",
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.mergeSelection = exp.mergeSelection.filter(id => id !== memberId);
        if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
          renderEventParticipantsModal();
        }
        if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
          renderEditEventModal();
        }
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      showToast("Участник удалён");
    } catch (error) {
      showToast(error.message || "Не удалось удалить участника");
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
  if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
    renderEventParticipantsModal();
  }
  if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
    renderEditEventModal();
  }
  renderExpenseEventDetail();
  loadExpensesDashboard();
}

export async function mergeSelectedIntoUnifiedWallet() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev || exp.mergeSelection.length < 2) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/wallets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({ member_ids: exp.mergeSelection })
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        exp.mergeSelection = [];
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      triggerHaptic("success");
      showToast("Единый кошелёк создан");
    } catch (error) {
      showToast(error.message || "Не удалось объединить кошелёк");
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  const selected = exp.mergeSelection.map(id => target.members.find(m => m.id === id)).filter(Boolean);
  if (selected.length < 2) return;
  const head = selected.find(m => m.role === "OWNER") || selected.find(m => Boolean(m.user_id)) || selected[0];
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
  showToast("Единый кошелёк создан");
}

export async function unmergeUnifiedWallet(headMemberId) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/wallets/${encodeURIComponent(headMemberId)}`, {
        method: "DELETE",
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      showToast("Единый кошелёк разъединён");
    } catch (error) {
      showToast(error.message || "Не удалось разъединить кошелёк");
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
  showToast("Единый кошелёк разъединён");
}

export function openExpenseEventMenuModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const body = document.getElementById("expenseEventMenuBody");
  if (!ev || !body) return;

  const isFrozen = ev.status === "SETTLING";
  const isArchived = ev.status === "ARCHIVED";
  const canManage = ["OWNER", "ADMIN"].includes(ev.viewer_role);

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${canManage ? `
        <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); openEditEventModal();">
          ${renderIcon("pencil", "app-icon-sm")} Редактировать событие и участников
        </button>
      ` : ""}
      <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); openEventParticipantsModal();">
        ${renderIcon("users", "app-icon-sm")} Участники, веса и единые кошельки
      </button>
      <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="closeExpenseEventMenuModal(); openEventInviteShareModal();">
        ${renderIcon("link", "app-icon-sm")} Пригласить по ссылке
      </button>
      ${!isArchived ? `
        <button type="button" class="btn-glass" style="justify-content: flex-start;" onclick="toggleExpenseEventFreeze()">
          ${isFrozen ? `${renderIcon("sun", "app-icon-sm")} Разморозить траты` : `${renderIcon("snowflake", "app-icon-sm")} Заморозить траты на время расчётов`}
        </button>
      ` : ""}
      <button type="button" class="btn-glass" style="justify-content: flex-start; color: ${isArchived ? "var(--tg-theme-text-color)" : "var(--tg-theme-destructive-text-color)"};" onclick="toggleExpenseEventArchive()">
        ${isArchived ? `${renderIcon("rotateCcw", "app-icon-sm")} Вернуть событие из архива` : `${renderIcon("archive", "app-icon-sm")} Переместить событие в архив`}
      </button>
    </div>
  `;

  document.getElementById("expenseEventMenuBackdrop")?.classList.add("open");
}

export function openEditEventModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;
  exp.editEventDraft = {
    title: ev.title || "",
    icon: ev.icon || "🎉",
    event_date: ev.event_date || "",
    base_currency: ev.base_currency || "RUB",
    simplify_debts: Boolean(ev.simplify_debts)
  };
  renderEditEventModal();
  loadExpensesContacts(true).then(() => {
    if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
      renderEditEventModal();
    }
  });
  document.getElementById("editEventModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeEditEventModal() {
  document.getElementById("editEventModalBackdrop")?.classList.remove("open");
}

export function selectEditEventIcon(icon) {
  const exp = getExpensesState();
  if (!exp.editEventDraft) return;
  exp.editEventDraft.icon = icon;
  renderEditEventModal();
  triggerHaptic("light");
}

export function clearEditEventDate() {
  const exp = getExpensesState();
  if (!exp.editEventDraft) return;
  exp.editEventDraft.event_date = "";
  renderEditEventModal();
  triggerHaptic("light");
}

export function renderEditEventModal() {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const d = exp.editEventDraft;
  const body = document.getElementById("editEventModalBody");
  if (!ev || !d || !body) return;

  const members = Array.isArray(ev.members) ? ev.members : [];
  const canManage = ["OWNER", "ADMIN"].includes(ev.viewer_role);
  const existingTgIds = new Set(members.map(m => Number(m.telegram_id)).filter(Boolean));
  const availableContacts = (exp.contacts || []).filter(c => !existingTgIds.has(Number(c.telegram_id)));

  body.innerHTML = `
    <form id="editExpenseEventForm" onsubmit="handleEditExpenseEventSubmit(event)">
      <div class="form-bento-grid">
        <div class="field-block span-2">
          <label class="field-label" for="editEventTitleInput">Название</label>
          <input type="text" class="input-modern" id="editEventTitleInput" maxlength="80" value="${escapeHtml(d.title)}" oninput="getExpensesState().editEventDraft.title=this.value" required />
        </div>
        <div class="field-block span-2">
          <span class="field-label">Иконка</span>
          <div class="category-preset-row">
            ${EXPENSE_ICONS.map(ico => `
              <button type="button" class="cat-preset-btn ${ico === d.icon ? "selected" : ""}" onclick="selectEditEventIcon('${ico}')" aria-label="${escapeHtml(resolveEventIconKey(ico).key)}">${renderEventIcon(ico, "ico-badge-sm")}</button>
            `).join("")}
          </div>
        </div>
        <div class="field-block span-2">
          <div class="field-label">
            <label for="editEventDateInput">Дата события <span style="font-weight: 500; opacity: 0.7; text-transform: none;">(необязательно)</span></label>
            ${d.event_date ? `<button type="button" class="btn-mini" onclick="clearEditEventDate()">${renderIcon("x", "app-icon-sm")} Очистить</button>` : ""}
          </div>
          <input type="date" class="input-modern" id="editEventDateInput" value="${escapeHtml(d.event_date || "")}" oninput="getExpensesState().editEventDraft.event_date=this.value" onchange="getExpensesState().editEventDraft.event_date=this.value;renderEditEventModal()" />
        </div>
        <div class="field-block span-2">
          <label class="field-label" for="editEventCurrencySelect">Базовая валюта</label>
          <select class="input-modern" id="editEventCurrencySelect" onchange="getExpensesState().editEventDraft.base_currency=this.value">
            ${["RUB", "USD", "EUR", "KZT", "TRY", "GEL"].map(c => `<option value="${c}" ${d.base_currency === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
      </div>

      <label class="bento-switch-card" for="editEventSimplifyInput" style="margin-top: 12px;">
        <div class="switch-text-wrap">
          <span class="switch-title">Упрощать долги</span>
          <span class="switch-subtitle">Минимизировать число переводов</span>
        </div>
        <span class="ios-switch">
          <input type="checkbox" id="editEventSimplifyInput" ${d.simplify_debts ? "checked" : ""} onchange="getExpensesState().editEventDraft.simplify_debts=this.checked" />
          <span class="ios-slider"></span>
        </span>
      </label>

      <div class="hub-section-label">Участники (${members.length})</div>
      <div class="audience-editor" style="margin-bottom: 8px;">
        ${members.map(m => `
          <span class="audience-chip active" style="cursor: default;">
            ${escapeHtml(m.member_name)}${m.username ? ` (@${escapeHtml(m.username)})` : ""}
            ${canManage && m.role !== "OWNER" ? `<button type="button" style="background:none;border:0;color:inherit;margin-left:4px;cursor:pointer;display:inline-flex;align-items:center;" onclick="removeExpenseMember('${escapeHtml(m.id)}')" aria-label="Удалить">${renderIcon("x", "app-icon-sm")}</button>` : ""}
          </span>
        `).join("")}
      </div>

      <div class="social-add-form" style="margin-top: 6px; margin-bottom: 6px;">
        <input type="text" class="input-modern" id="editEventMemberUsernameInput" maxlength="33" placeholder="@username" autocomplete="off" autocapitalize="none" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();handleAddRealMemberSubmit(event);}" />
        <button type="button" class="btn-glass" onclick="handleAddRealMemberSubmit(event)">${renderIcon("plus", "app-icon-sm")} Добавить</button>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;">
        <button type="button" class="btn-mini" onclick="requestTelegramContactForExpenses('${escapeHtml(ev.id)}')">${renderIcon("phone", "app-icon-sm")} Выбрать в Telegram</button>
        <button type="button" class="btn-mini" onclick="refreshExpensesContacts()">${renderIcon("refresh", "app-icon-sm")} Обновить</button>
      </div>
      <div class="selection-help" id="editEventSelectionHelp" hidden>
        <p>Пользователь пока неизвестен приложению. Откройте чат с ботом и выберите человека через Telegram.</p>
        <button type="button" class="btn-glass" onclick="openBotForSelection()">Открыть чат с ботом</button>
      </div>
      ${availableContacts.length ? `
        <div class="audience-editor" style="margin-bottom: 8px;">
          ${availableContacts.map(c => `
            <button type="button" class="audience-chip" onclick="addRealMemberToCurrentEvent({ telegram_id: ${Number(c.telegram_id)} })">
              ${renderIcon("plus", "app-icon-sm")} ${escapeHtml(c.display_name || "Пользователь")}${c.username ? ` (@${escapeHtml(c.username)})` : ""}
            </button>
          `).join("")}
        </div>
      ` : ""}

      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <button type="button" class="btn-glass" style="flex: 1;" onclick="closeEditEventModal()">Отмена</button>
        <button type="submit" class="btn-accent" id="submitEditEventBtn" style="flex: 2;">${renderIcon("check", "app-icon-sm")} Сохранить</button>
      </div>
    </form>
  `;
}

export async function handleEditExpenseEventSubmit(event) {
  event.preventDefault();
  const exp = getExpensesState();
  const d = exp.editEventDraft;
  if (!d) return;
  const title = String(d.title || "").trim();
  if (!title) {
    showToast("Введите название события");
    return;
  }
  await patchCurrentExpenseEvent({
    title,
    icon: d.icon,
    event_date: String(d.event_date || "").trim(),
    base_currency: d.base_currency,
    simplify_debts: Boolean(d.simplify_debts)
  });
  closeEditEventModal();
  triggerHaptic("success");
  showToast("Событие обновлено");
}

export function closeExpenseEventMenuModal() {
  document.getElementById("expenseEventMenuBackdrop")?.classList.remove("open");
}

async function patchCurrentExpenseEvent(patch) {
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  if (!ev) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify(patch)
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
    } catch (error) {
      showToast(error.message || "Не удалось обновить событие");
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

export async function toggleEventSimplifyDebts(domEvent) {
  if (domEvent) domEvent.stopPropagation();
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  await patchCurrentExpenseEvent({ simplify_debts: !ev.simplify_debts });
}

export async function toggleExpenseEventFreeze() {
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  closeExpenseEventMenuModal();
  const nextStatus = ev.status === "SETTLING" ? "ACTIVE" : "SETTLING";
  await patchCurrentExpenseEvent({ status: nextStatus });
  showToast(nextStatus === "SETTLING" ? "Траты заморожены" : "Траты разморожены");
}

export async function toggleExpenseEventArchive() {
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  closeExpenseEventMenuModal();
  const nextStatus = ev.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
  await patchCurrentExpenseEvent({ status: nextStatus });
  showToast(nextStatus === "ARCHIVED" ? "Событие перенесено в архив" : "Событие возвращено из архива");
}

function buildExpenseInviteUrl(inviteToken) {
  const bot = state.botUsername || "testpmvbot_bot";
  const prefix = ["http", "s://"].join("");
  return `${prefix}t.me/${bot}?start=${encodeURIComponent(inviteToken)}`;
}

export function openEventInviteShareModal() {
  const ev = getExpensesState().currentEvent;
  const body = document.getElementById("claimProfileModalBody");
  if (!ev || !body) return;

  const inviteUrl = buildExpenseInviteUrl(ev.invite_token || "");

  body.innerHTML = `
    <p class="social-panel-copy">
      Отправьте ссылку друзьям в Telegram: при переходе по ней они смогут присоединиться к событию со своего аккаунта.
    </p>
    <div class="share-preview-box" id="expenseInviteUrlBox">${escapeHtml(inviteUrl)}</div>
    <div style="display: flex; gap: 10px; margin-top: 12px;">
      <button type="button" class="btn-accent" style="flex: 1;" onclick="copyExpenseInviteLink('${escapeHtml(inviteUrl)}')">
        ${renderIcon("copy", "app-icon-sm")} Скопировать ссылку
      </button>
    </div>
  `;

  document.getElementById("claimProfileModalBackdrop")?.classList.add("open");
}

export async function copyExpenseInviteLink(url) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url).catch(() => {});
  }
  triggerHaptic("success");
  showToast("Скопировано");
}

export function closeClaimProfileModal() {
  document.getElementById("claimProfileModalBackdrop")?.classList.remove("open");
}

export async function checkPendingExpenseInvite() {
  const params = new URLSearchParams(window.location.search);
  const queryInvite = String(params.get("invite") || "").trim();
  const rawStart = typeof startParam === "string" ? startParam.trim() : "";
  const token = queryInvite || (rawStart.startsWith("exp_") ? rawStart : "");
  if (!token) return;

  selectSuperappModule("expenses");

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/invite/${encodeURIComponent(token)}`, {
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      if (data?.already_joined && data?.event?.id) {
        await openExpenseEvent(data.event.id);
        return;
      }
      renderIncomingClaimModal(token, data.event);
    } catch (error) {
      showToast(error.message || "Недействительная ссылка приглашения");
    }
  }
}

function renderIncomingClaimModal(token, eventInfo) {
  const body = document.getElementById("claimProfileModalBody");
  if (!body || !eventInfo) return;

  body.innerHTML = `
    <p class="social-panel-copy">
      Вас пригласили в событие <strong style="display: inline-flex; align-items: center; gap: 6px; vertical-align: middle;">${renderEventIcon(eventInfo.icon || "🎉", "ico-badge-sm")} <span>«${escapeHtml(eventInfo.title)}»</span></strong>.
    </p>
    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
      <button type="button" class="btn-accent" style="width: 100%; margin-top: 4px;" onclick="submitClaimExpenseProfile('${escapeHtml(token)}')">
        ${renderIcon("plus", "app-icon-sm")} Присоединиться к событию
      </button>
    </div>
  `;

  document.getElementById("claimProfileModalBackdrop")?.classList.add("open");
}

export async function submitClaimExpenseProfile(token) {
  const exp = getExpensesState();
  if (!isTelegramSession || !API_ORIGIN) {
    closeClaimProfileModal();
    return;
  }
  try {
    const response = await fetch(`${API_ORIGIN}/api/expenses/invite/${encodeURIComponent(token)}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg?.initData || ""
      },
      body: JSON.stringify({})
    });
    const data = await readApiResponse(response);
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
    triggerHaptic("success");
    showToast("Вы присоединились к событию");
  } catch (error) {
    showToast(error.message || "Не удалось присоединиться к событию");
  }
}

export function openEdgeSettleModal(fromUnitId, toUnitId, amountMinor) {
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
    showToast("Перевод между другими участниками");
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

export function openCrossPersonSettleModal(key) {
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
      <h2 class="modal-title" id="settleTransferModalTitle" style="display: inline-flex; align-items: center; gap: 8px;">${renderIcon("bell", "app-icon-sm")} <span>Напоминание о долге</span></h2>
      <button type="button" class="btn-close-circle" onclick="closeSettleTransferModal()" aria-label="Закрыть">${renderIcon("x", "app-icon-sm")}</button>
    </div>
    <div class="exp-recipient-box">
      <div class="exp-member-avatar" style="width: 46px; height: 46px;">${renderIcon("bell")}</div>
      <div style="flex: 1; min-width: 0;">
        <strong style="font-size: 16px; display: block;">${escapeHtml(debtorName)}</strong>
        <div style="font-size: 13px; color: var(--tg-theme-hint-color); margin-top: 3px;">Вам должны ${formatExpenseMinor(amountMinor, currency)}</div>
      </div>
    </div>
    <div class="composer-card" style="box-shadow: none; font-size: 13.5px; color: var(--tg-theme-hint-color);">
      «Привет! Напоминаю про общий бюджет (${formatExpenseMinor(amountMinor, currency)}) — скинь, пожалуйста, когда будет удобно. Спасибо!»
    </div>
    <button type="button" class="btn-accent" style="width: 100%;" onclick="sendDebtReminder('${escapeHtml(debtorName)}', '${escapeHtml(formatExpenseMinor(amountMinor, currency))}')">
      ${renderIcon("copy", "app-icon-sm")} Скопировать напоминание
    </button>
  `;

  document.getElementById("settleTransferModalBackdrop")?.classList.add("open");
}

export async function sendDebtReminder(name, formattedAmount) {
  const text = `Привет, ${name}! Напоминаю про расчёт по общим тратам (${formattedAmount}) — переведи, пожалуйста, когда будет удобно.`;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text).catch(() => {});
  }
  closeSettleTransferModal();
  showToast("Текст напоминания скопирован");
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
      <button type="button" class="btn-close-circle" onclick="closeSettleTransferModal()" aria-label="Закрыть">${renderIcon("x", "app-icon-sm")}</button>
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

  document.getElementById("settleTransferModalBackdrop")?.classList.add("open");
}

export function closeSettleTransferModal() {
  document.getElementById("settleTransferModalBackdrop")?.classList.remove("open");
}

export function toggleSettleItemCheckbox(idx, checked) {
  const ctx = getExpensesState().settleCtx;
  if (!ctx?.items?.[idx]) return;
  ctx.items[idx].checked = Boolean(checked);
  renderSettleTransferModal();
}

export function setSettlePaymentMethod(method) {
  const ctx = getExpensesState().settleCtx;
  if (!ctx) return;
  ctx.method = method;
  renderSettleTransferModal();
}

export async function submitSettlePayment() {
  const exp = getExpensesState();
  const ctx = exp.settleCtx;
  if (!ctx) return;
  const selected = ctx.items.filter(i => i.checked && i.amount_minor > 0);
  if (!selected.length) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
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
      await readApiResponse(response);
      closeSettleTransferModal();
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      triggerHaptic("success");
      showToast("Перевод отправлен на подтверждение");
    } catch (error) {
      showToast(error.message || "Не удалось зафиксировать перевод");
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
  showToast("Перевод отправлен на подтверждение");
}

export async function confirmIncomingSettlement(settlementId) {
  const exp = getExpensesState();
  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements/${encodeURIComponent(settlementId)}/confirm`, {
        method: "POST",
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      await readApiResponse(response);
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      showToast("Перевод подтверждён");
    } catch (error) {
      showToast(error.message || "Не удалось подтвердить перевод");
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
  showToast("Перевод подтверждён");
}

export async function rejectIncomingSettlement(settlementId) {
  const exp = getExpensesState();
  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements/${encodeURIComponent(settlementId)}/reject`, {
        method: "POST",
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      await readApiResponse(response);
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      showToast("Отмечено: деньги не пришли");
    } catch (error) {
      showToast(error.message || "Не удалось отклонить перевод");
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
  showToast("Отмечено: деньги не пришли");
}

export async function cancelPendingSettlement(settlementId) {
  const exp = getExpensesState();
  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/settlements/${encodeURIComponent(settlementId)}/cancel`, {
        method: "POST",
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      await readApiResponse(response);
      if (exp.currentEvent) await openExpenseEvent(exp.currentEvent.id);
      await loadExpensesDashboard();
      showToast("Перевод отозван");
    } catch (error) {
      showToast(error.message || "Не удалось отозвать перевод");
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
  showToast("Перевод отозван");
}
