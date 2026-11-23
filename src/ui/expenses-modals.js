import {
  API_ORIGIN,
  tg,
  DEMO_USERS,
  isTelegramSession,
  startParam,
  escapeHtml,
  triggerHaptic,
  showToast,
  readApiResponse
} from "./state.js";
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
  openExpenseEvent
} from "./expenses-state.js";
import { renderExpensesModule, renderExpenseEventDetail } from "./expenses-views.js";

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
    showToast("❄️ Траты заморожены");
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
        <button type="button" class="btn-close-circle" onclick="closeExpenseOperationModal()" aria-label="Закрыть">✕</button>
      </div>
    </div>

    <div class="desire-segment" style="margin-bottom: 14px;">
      <button type="button" class="desire-btn ${d.operation_type === "EXPENSE" ? "active" : ""}" onclick="setDraftOperationType('EXPENSE')">Расход</button>
      <button type="button" class="desire-btn ${d.operation_type === "PREPAYMENT" ? "active" : ""}" onclick="setDraftOperationType('PREPAYMENT')">В котёл</button>
      <button type="button" class="desire-btn ${d.operation_type === "TRANSFER" ? "active" : ""}" onclick="setDraftOperationType('TRANSFER')">Перевод</button>
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
    showToast("⚠️ Введите название операции");
    return;
  }

  const preview = computeClientDraftPreview(ev, d);
  if (preview.origMinor <= 0) {
    showToast("⚠️ Укажите сумму больше нуля");
    return;
  }
  if (!preview.valid) {
    showToast("⚠️ Проверьте распределение долей");
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
      showToast(d.id ? "✓ Операция обновлена" : "✓ Операция добавлена");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось сохранить операцию"}`);
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
  showToast(d.id ? "✓ Операция обновлена" : "✓ Операция добавлена");
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
      showToast("🗑 Операция удалена");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось удалить операцию"}`);
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
  showToast("🗑 Операция удалена");
}

export function openNewEventModal() {
  const exp = getExpensesState();
  const hub = getSuperappState();
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

  document.getElementById("newEventModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeNewEventModal() {
  document.getElementById("newEventModalBackdrop")?.classList.remove("open");
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
    showToast("⚠️ Введите название события");
    return;
  }
  const baseCurrency = String(document.getElementById("newEventCurrencySelect")?.value || "RUB").toUpperCase();
  const copyFromEventId = String(document.getElementById("newEventCopyMembersSelect")?.value || "").trim();
  const ghostsRaw = String(document.getElementById("newEventGhostsInput")?.value || "");
  const simplifyDebts = Boolean(document.getElementById("newEventSimplifyInput")?.checked);

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
          base_currency: baseCurrency,
          simplify_debts: simplifyDebts,
          copy_from_event_id: copyFromEventId || undefined,
          ghost_names: ghostsRaw
        })
      });
      const data = await readApiResponse(response);
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
      showToast("✓ Событие создано");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось создать событие"}`);
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
  showToast("✓ Событие создано");
}

export function openEventParticipantsModal() {
  const exp = getExpensesState();
  exp.mergeSelection = [];
  renderEventParticipantsModal();
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

export function toggleMergeMemberSelection(memberId) {
  const exp = getExpensesState();
  const idx = exp.mergeSelection.indexOf(memberId);
  if (idx >= 0) exp.mergeSelection.splice(idx, 1);
  else exp.mergeSelection.push(memberId);
  renderEventParticipantsModal();
}

export async function handleAddGhostMemberSubmit(event) {
  event.preventDefault();
  const exp = getExpensesState();
  const ev = exp.currentEvent;
  const input = document.getElementById("addGhostMemberNameInput");
  const name = String(input?.value || "").trim();
  if (!ev || !name) return;

  if (isTelegramSession && API_ORIGIN) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/expenses/events/${encodeURIComponent(ev.id)}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({ member_name: name })
      });
      const data = await readApiResponse(response);
      if (data?.event) {
        exp.currentEvent = data.event;
        if (input) input.value = "";
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      showToast(`✓ Участник «${name}» добавлен`);
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось добавить участника"}`);
    }
    return;
  }

  const demo = loadDemoExpensesStore();
  const target = demo.events.find(e => e.id === ev.id);
  if (!target) return;
  if (target.members.some(m => m.member_name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) {
    showToast("⚠️ Участник с таким именем уже есть");
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
  showToast(`✓ Участник «${name}» добавлен`);
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
      showToast(`❌ ${error.message || "Не удалось изменить вес"}`);
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
        renderEventParticipantsModal();
        renderExpenseEventDetail();
        loadExpensesDashboard();
      }
      showToast("🗑 Участник удалён");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось удалить участника"}`);
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
      showToast("🤝 Единый кошелёк создан");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось объединить кошелёк"}`);
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
  showToast("🤝 Единый кошелёк создан");
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
      showToast(`❌ ${error.message || "Не удалось разъединить кошелёк"}`);
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

  document.getElementById("expenseEventMenuBackdrop")?.classList.add("open");
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
      showToast(`❌ ${error.message || "Не удалось обновить событие"}`);
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
  showToast(nextStatus === "SETTLING" ? "❄️ Траты заморожены" : "☀️ Траты разморожены");
}

export async function toggleExpenseEventArchive() {
  const ev = getExpensesState().currentEvent;
  if (!ev) return;
  closeExpenseEventMenuModal();
  const nextStatus = ev.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
  await patchCurrentExpenseEvent({ status: nextStatus });
  showToast(nextStatus === "ARCHIVED" ? "📦 Событие перенесено в архив" : "↩️ Событие возвращено из архива");
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

  document.getElementById("claimProfileModalBackdrop")?.classList.add("open");
}

export async function copyExpenseInviteLink(url) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url).catch(() => {});
  }
  triggerHaptic("success");
  showToast("🔗 Скопировано");
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
      renderIncomingClaimModal(token, data.event, data.ghost_profiles || []);
    } catch (error) {
      showToast(`❌ ${error.message || "Недействительная ссылка приглашения"}`);
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

  document.getElementById("claimProfileModalBackdrop")?.classList.add("open");
}

export async function submitClaimExpenseProfile(token, memberId) {
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
      body: JSON.stringify({ member_id: memberId })
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
    showToast(data?.claimed ? "✓ Виртуальный профиль привязан к вашему аккаунту" : "✓ Вы присоединились к событию");
  } catch (error) {
    showToast(`❌ ${error.message || "Не удалось присоединиться к событию"}`);
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

  document.getElementById("settleTransferModalBackdrop")?.classList.add("open");
}

export async function sendDebtReminder(name, formattedAmount) {
  const text = `Привет, ${name}! Напоминаю про расчёт по общим тратам (${formattedAmount}) — переведи, пожалуйста, когда будет удобно.`;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text).catch(() => {});
  }
  closeSettleTransferModal();
  showToast("📋 Текст напоминания скопирован");
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
      showToast("✓ Перевод отправлен на подтверждение");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось зафиксировать перевод"}`);
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
  showToast("✓ Перевод отправлен на подтверждение");
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
      showToast("✓ Перевод подтверждён");
    } catch (error) {
      showToast(`❌ ${error.message || "Не удалось подтвердить перевод"}`);
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
  showToast("✓ Перевод подтверждён");
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
      showToast(`❌ ${error.message || "Не удалось отклонить перевод"}`);
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
