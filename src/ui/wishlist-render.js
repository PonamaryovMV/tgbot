import {
  API_ORIGIN,
  tg,
  DEMO_USERS,
  isTelegramSession,
  telegramViewerUsername,
  state,
  CATEGORY_STYLES,
  DEFAULT_TAGS,
  DESIRE_META,
  parsePositiveId,
  getGiftDesire,
  getInitialDemoGifts,
  getDefaultDemoOccasions,
  getDefaultDemoGroups,
  escapeHtml,
  isValidHttpUrl,
  formatPrice,
  resolveImageUrl,
  isInternalImageUrl,
  hydrateInternalImages,
  triggerHaptic,
  showToast,
  readApiResponse,
  saveLocalGifts,
  clearPhoto,
  updatePhotoPreviewUI
} from "./state.js";
import {
  normalizeGroups,
  loadSocial,
  renderSocial,
  renderAudienceEditor,
  renderOccasionEditor
} from "./wishlist-social.js";
import { renderIcon } from "./icons.js";

const wishlistHooks = {
  renderSuperappHub: () => {}
};

export function registerWishlistHooks(hooks) {
  Object.assign(wishlistHooks, hooks);
}

export function applyServerData(data) {
  if (!data || !Array.isArray(data.gifts)) {
    throw new Error("Сервер вернул некорректные данные");
  }
  const responseOwnerId = parsePositiveId(data.owner?.id);
  if (responseOwnerId) state.ownerId = responseOwnerId;
  const ownerName = String(data.owner?.first_name || "Пользователь").trim() || "Пользователь";
  const ownerUsername = String(data.owner?.username || "").trim().replace(/^@+/, "");
  state.ownerUsername = ownerUsername;
  state.ownerName = ownerName === "Пользователь" && ownerUsername ? `@${ownerUsername}` : ownerName;
  state.gifts = data.gifts;
  state.occasions = Array.isArray(data.occasions)
    ? data.occasions.map(item => ({ id: String(item.id || ""), title: String(item.title || "") })).filter(item => item.id && item.title)
    : [];
  if (state.occasionFilter !== "all" && !state.occasions.some(item => item.id === state.occasionFilter)) {
    state.occasionFilter = "all";
  }
  state.isSubscribed = Boolean(data.is_subscribed);
  if (responseOwnerId === state.viewerId && Array.isArray(data.groups)) {
    state.groups = normalizeGroups(data.groups, state.groups);
    renderAudienceEditor("add");
    renderAudienceEditor("edit");
  }
  renderOccasionEditor("add");
  renderOccasionEditor("edit");
  state.loadError = "";
}

export async function fetchGifts() {
  state.isLoading = true;
  state.loadError = "";
  renderSkeletons();

  if (isTelegramSession) {
    state.gifts = [];
    if (!API_ORIGIN) {
      state.isLoading = false;
      state.loadError = "Не указан адрес Cloudflare Worker в API_BASE_URL.";
      renderAll();
      return;
    }

    try {
      const response = await fetch(
        `${API_ORIGIN}/api/data?owner_id=${encodeURIComponent(state.ownerId)}`,
        {
          method: "GET",
          headers: { "X-Telegram-Init-Data": tg?.initData || "" }
        }
      );
      applyServerData(await readApiResponse(response));
    } catch (error) {
      state.loadError = error.message || "Не удалось загрузить вишлист.";
    }
    state.isLoading = false;
    renderAll();
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 260));
  const raw = localStorage.getItem("tg_miniapp_wishlist_2026_v2");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.gifts = Array.isArray(parsed) ? parsed : getInitialDemoGifts();
    } catch {
      state.gifts = getInitialDemoGifts();
    }
  } else {
    state.gifts = getInitialDemoGifts();
  }
  if (!Array.isArray(state.occasions) || state.occasions.length === 0) {
    state.occasions = getDefaultDemoOccasions();
  }
  const demoOwner = Object.values(DEMO_USERS).find(user => user.id === state.ownerId)
    || state.subscriptions.find(profile => profile.id === state.ownerId);
  state.ownerName = demoOwner?.name || demoOwner?.first_name || DEMO_USERS.owner.name;
  state.viewerName = DEMO_USERS[state.activeRoleKey]?.name || DEMO_USERS.owner.name;
  saveLocalGifts();
  renderOccasionEditor("add");
  renderOccasionEditor("edit");
  state.isLoading = false;
  renderAll();
}

export async function mutateGifts(action, payload) {
  if (isTelegramSession) {
    if (!API_ORIGIN) {
      showToast("Сначала укажите адрес Cloudflare Worker");
      return false;
    }
    try {
      const response = await fetch(`${API_ORIGIN}/api/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({
          owner_id: state.ownerId,
          action,
          payload
        })
      });
      applyServerData(await readApiResponse(response));
      renderAll();
      if (["toggle_book", "toggle_crowdfund"].includes(action)) loadParticipations(true);
      return true;
    } catch (error) {
      showToast(error.message || "Ошибка синхронизации с сервером");
      return false;
    }
  }

  if (["toggle_book", "toggle_crowdfund"].includes(action)) {
    const gift = state.gifts.find(item => item.id === payload.id);
    if (!gift || !canDemoViewerAccessGift(gift, state.viewerId)) {
      showToast("Это желание недоступно для вашей группы");
      return false;
    }
  }

  if (action === "save_occasion") {
    const title = String(payload.title || "").trim().slice(0, 40);
    if (!title) {
      showToast("Укажите название повода");
      return false;
    }
    const key = title.toLocaleLowerCase("ru-RU");
    const dup = state.occasions.some(item => item.id !== payload.id && item.title.toLocaleLowerCase("ru-RU") === key);
    if (dup) {
      showToast("Повод с таким названием уже есть");
      return false;
    }
    if (payload.id) {
      state.occasions = state.occasions.map(item => (item.id === payload.id ? { ...item, title } : item));
    } else {
      const id = `occ_${Math.random().toString(16).slice(2, 10)}`;
      state.occasions.push({ id, title });
    }
    renderOccasionEditor("add");
    renderOccasionEditor("edit");
    renderAll();
    return true;
  }

  if (action === "delete_occasion") {
    const id = String(payload.id || "");
    state.occasions = state.occasions.filter(item => item.id !== id);
    state.gifts = state.gifts.map(gift => ({
      ...gift,
      occasion_ids: Array.isArray(gift.occasion_ids) ? gift.occasion_ids.filter(occId => occId !== id) : []
    }));
    if (state.occasionFilter === id) state.occasionFilter = "all";
    saveLocalGifts();
    renderOccasionEditor("add");
    renderOccasionEditor("edit");
    renderAll();
    return true;
  }

  if (action === "add") {
    state.gifts.unshift({
      ...payload,
      is_reusable: Boolean(payload.is_reusable),
      reusable_givers: [],
      occasion_ids: Array.isArray(payload.occasion_ids) ? [...payload.occasion_ids] : []
    });
  } else if (action === "update") {
    state.gifts = state.gifts.map(g => {
      if (g.id !== payload.id) return g;
      const modeChanged = Boolean(g.is_crowdfund) !== Boolean(payload.is_crowdfund)
        || Boolean(g.is_reusable) !== Boolean(payload.is_reusable);
      return {
        ...g,
        ...payload,
        ...(modeChanged ? { booked_by: null, participants: [], reusable_givers: [] } : {})
      };
    });
  } else if (action === "delete") {
    state.gifts = state.gifts.filter(g => g.id !== payload.id);
  } else if (action === "toggle_gifted") {
    state.gifts = state.gifts.map(g => (g.id === payload.id ? { ...g, is_gifted: !g.is_gifted } : g));
  } else if (action === "toggle_book") {
    state.gifts = state.gifts.map(g => {
      if (g.id !== payload.id) return g;
      if (g.is_reusable) {
        const list = Array.isArray(g.reusable_givers) ? [...g.reusable_givers] : [];
        const idx = list.indexOf(state.viewerId);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(state.viewerId);
        return { ...g, reusable_givers: list };
      }
      if (g.booked_by === state.viewerId) return { ...g, booked_by: null };
      if (g.booked_by === null) return { ...g, booked_by: state.viewerId };
      return g;
    });
  } else if (action === "toggle_crowdfund") {
    state.gifts = state.gifts.map(g => {
      if (g.id !== payload.id) return g;
      const list = Array.isArray(g.participants) ? [...g.participants] : [];
      const idx = list.indexOf(state.viewerId);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(state.viewerId);
      return { ...g, participants: list };
    });
  }

  cleanupDemoAudience();
  saveLocalGifts();
  renderAll();
  if (["toggle_book", "toggle_crowdfund"].includes(action)) loadParticipations(true);
  return true;
}

export async function copyGiftToOwnWishlist(giftId) {
  if (state.viewerId === state.ownerId) return;
  if (state.copyingGiftIds.has(giftId) || state.copiedGiftIds.has(giftId)) return;

  state.copyingGiftIds.add(giftId);
  renderAll();

  try {
    if (isTelegramSession) {
      if (!API_ORIGIN) throw new Error("Не указан адрес Cloudflare Worker");
      const response = await fetch(`${API_ORIGIN}/api/gifts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify({
          owner_id: state.ownerId,
          action: "copy_gift",
          payload: { id: giftId }
        })
      });
      await readApiResponse(response);
    } else {
      const sourceGift = state.gifts.find(item => item.id === giftId);
      if (!sourceGift || !canDemoViewerAccessGift(sourceGift, state.viewerId)) {
        throw new Error("Подарок недоступен");
      }
    }

    state.copiedGiftIds.add(giftId);
    triggerHaptic("success");
    showToast("Добавлено в ваш вишлист");
  } catch (error) {
    showToast(error.message || "Не удалось скопировать желание");
  } finally {
    state.copyingGiftIds.delete(giftId);
    renderAll();
  }
}

export function setDesire(formPrefix, desire) {
  if (!DESIRE_META[desire]) return;
  state.desireDraft[formPrefix] = desire;
  document.querySelectorAll(`#${formPrefix}DesireControl .desire-btn`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.desire === desire);
    btn.setAttribute("aria-pressed", btn.dataset.desire === desire ? "true" : "false");
  });
  triggerHaptic("light");
}

function normalizeTag(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 30);
}

export function renderTagEditor(formPrefix) {
  const presets = document.getElementById(`${formPrefix}TagPresets`);
  const selected = document.getElementById(`${formPrefix}SelectedTags`);
  if (!presets || !selected) return;
  const tags = state.tagDraft[formPrefix];
  const selectedKeys = new Set(tags.map(tag => tag.toLocaleLowerCase("ru-RU")));

  presets.innerHTML = DEFAULT_TAGS.map(tag => {
    const active = selectedKeys.has(tag.toLocaleLowerCase("ru-RU"));
    return `<button type="button" class="cat-preset-btn ${active ? "selected" : ""}" data-tag="${escapeHtml(tag)}" aria-pressed="${active}" onclick="toggleTag('${formPrefix}', this.dataset.tag)">${escapeHtml(tag)}</button>`;
  }).join("");

  selected.innerHTML = tags.map((tag, index) => `
    <span class="selected-tag">
      ${escapeHtml(tag)}
      <button type="button" style="display:inline-flex;align-items:center;justify-content:center;" aria-label="Удалить тег ${escapeHtml(tag)}" onclick="removeTagByIndex('${formPrefix}', ${index})">${renderIcon("x", "app-icon-sm")}</button>
    </span>
  `).join("");
}

export function removeTagByIndex(formPrefix, index) {
  if (!Number.isInteger(index)) return;
  state.tagDraft[formPrefix].splice(index, 1);
  renderTagEditor(formPrefix);
  triggerHaptic("light");
}

export function toggleTag(formPrefix, rawTag) {
  const tag = normalizeTag(rawTag);
  if (!tag) return;
  const tags = state.tagDraft[formPrefix];
  const key = tag.toLocaleLowerCase("ru-RU");
  const index = tags.findIndex(item => item.toLocaleLowerCase("ru-RU") === key);
  if (index >= 0) tags.splice(index, 1);
  else {
    if (tags.length >= 8) {
      showToast("Можно выбрать не больше 8 тегов");
      return;
    }
    tags.push(tag);
  }
  renderTagEditor(formPrefix);
  triggerHaptic("light");
}

export function addCustomTag(formPrefix) {
  const input = document.getElementById(`${formPrefix}CustomTagInput`);
  const tag = normalizeTag(input?.value || "");
  if (!tag) return;
  const tags = state.tagDraft[formPrefix];
  if (tags.some(item => item.toLocaleLowerCase("ru-RU") === tag.toLocaleLowerCase("ru-RU"))) {
    showToast("Этот тег уже добавлен");
  } else if (tags.length >= 8) {
    showToast("Можно выбрать не больше 8 тегов");
    return;
  } else {
    tags.push(tag);
  }
  if (input) {
    input.value = "";
    input.focus();
  }
  renderTagEditor(formPrefix);
  triggerHaptic("light");
}

export function handleTagKeydown(event, formPrefix) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addCustomTag(formPrefix);
}

export function syncMutualExclusiveToggle(formPrefix, changedType) {
  const crowdEl = document.getElementById(`${formPrefix}CrowdfundToggle`);
  const reusableEl = document.getElementById(`${formPrefix}ReusableToggle`);
  if (!crowdEl || !reusableEl) return;
  if (changedType === "crowdfund" && crowdEl.checked) {
    reusableEl.checked = false;
  } else if (changedType === "reusable" && reusableEl.checked) {
    crowdEl.checked = false;
  }
  triggerHaptic("light");
}

export function toggleAddDetails() {
  const panel = document.getElementById("addDetailsPanel");
  const btn = document.getElementById("toggleDetailsBtn");
  const isOpen = panel?.classList.toggle("open");
  btn?.classList.toggle("active", Boolean(isOpen));
  triggerHaptic("light");
}

export function selectPresetCategory(formPrefix, categoryName) {
  const input = document.getElementById(`${formPrefix}CategoryInput`);
  if (!input) return;
  input.value = input.value.trim() === categoryName ? "" : categoryName;
  syncCategoryChipHighlight(formPrefix);
  triggerHaptic("light");
}

export function syncCategoryChipHighlight(formPrefix) {
  const val = document.getElementById(`${formPrefix}CategoryInput`)?.value.trim() || "";
  const container = document.getElementById(`${formPrefix}CategoryChips`);
  container?.querySelectorAll(".cat-preset-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.getAttribute("data-cat") === val);
  });
}

export async function handleAddGiftSubmit(event) {
  event.preventDefault();
  const titleEl = document.getElementById("addTitleInput");
  const title = titleEl?.value.trim() || "";
  if (!title) return;

  const rawPrice = document.getElementById("addPriceInput")?.value.trim() || "";
  const rawLink = document.getElementById("addLinkInput")?.value.trim() || "";
  const category = document.getElementById("addCategoryInput")?.value.trim() || "Разное";
  const comment = document.getElementById("addCommentInput")?.value.trim() || "";
  const desire = state.desireDraft.add;
  const tags = [...state.tagDraft.add];
  const isCrowdfund = Boolean(document.getElementById("addCrowdfundToggle")?.checked);
  const isReusable = !isCrowdfund && Boolean(document.getElementById("addReusableToggle")?.checked);

  if (rawLink && !isValidHttpUrl(rawLink)) {
    showToast("Ссылка должна начинаться с https:// или http://");
    return;
  }

  const newGift = {
    id: Date.now(),
    title,
    link: rawLink,
    image: state.photoDraft.add || "",
    price: rawPrice ? Number(rawPrice) : null,
    category,
    comment,
    desire,
    tags,
    group_ids: [...state.groupDraft.add],
    occasion_ids: [...state.occasionDraft.add],
    priority: desire === "high",
    is_crowdfund: isCrowdfund,
    is_reusable: isReusable,
    booked_by: null,
    participants: [],
    reusable_givers: [],
    is_gifted: false
  };

  const ok = await mutateGifts("add", newGift);
  if (ok) {
    triggerHaptic("success");
    showToast("Желание добавлено в ваш вишлист!");
    document.getElementById("addGiftForm")?.reset();
    clearPhoto("add");
    state.desireDraft.add = "medium";
    state.tagDraft.add = [];
    state.groupDraft.add = [];
    state.occasionDraft.add = [];
    setDesire("add", "medium");
    renderTagEditor("add");
    renderAudienceEditor("add");
    renderOccasionEditor("add");
    syncCategoryChipHighlight("add");
    state.activeTab = "active";
    renderAll();
  }
}

export function openEditModal(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;

  const idInput = document.getElementById("editGiftId");
  const titleInput = document.getElementById("editTitleInput");
  const priceInput = document.getElementById("editPriceInput");
  const linkInput = document.getElementById("editLinkInput");
  const catInput = document.getElementById("editCategoryInput");
  const commentInput = document.getElementById("editCommentInput");
  const crowdEl = document.getElementById("editCrowdfundToggle");
  const editReusableEl = document.getElementById("editReusableToggle");
  const urlInput = document.getElementById("editImageUrlInput");

  if (idInput) idInput.value = gift.id;
  if (titleInput) titleInput.value = gift.title || "";
  if (priceInput) priceInput.value = gift.price || "";
  if (linkInput) linkInput.value = gift.link || "";
  if (catInput) catInput.value = gift.category || "";
  if (commentInput) commentInput.value = gift.comment || "";
  state.desireDraft.edit = getGiftDesire(gift);
  state.tagDraft.edit = Array.isArray(gift.tags) ? [...gift.tags] : [];
  state.groupDraft.edit = Array.isArray(gift.group_ids) ? [...gift.group_ids] : [];
  state.occasionDraft.edit = Array.isArray(gift.occasion_ids) ? [...gift.occasion_ids] : [];
  setDesire("edit", state.desireDraft.edit);
  renderTagEditor("edit");
  renderAudienceEditor("edit");
  renderOccasionEditor("edit");
  if (crowdEl) crowdEl.checked = Boolean(gift.is_crowdfund);
  if (editReusableEl) editReusableEl.checked = !gift.is_crowdfund && Boolean(gift.is_reusable);

  state.photoDraft.edit = gift.image || "";
  if (urlInput) urlInput.value = gift.image && gift.image.startsWith("http") ? gift.image : "";
  updatePhotoPreviewUI("edit", gift.image || "", gift.image ? "Сохранено в карточке" : "");
  syncCategoryChipHighlight("edit");

  document.getElementById("editModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeEditModal() {
  document.getElementById("editModalBackdrop")?.classList.remove("open");
}

export async function handleEditGiftSubmit(event) {
  event.preventDefault();
  const id = Number(document.getElementById("editGiftId")?.value);
  const title = document.getElementById("editTitleInput")?.value.trim() || "";
  if (!title) return;

  const rawPrice = document.getElementById("editPriceInput")?.value.trim() || "";
  const rawLink = document.getElementById("editLinkInput")?.value.trim() || "";
  const category = document.getElementById("editCategoryInput")?.value.trim() || "Разное";
  const comment = document.getElementById("editCommentInput")?.value.trim() || "";
  const desire = state.desireDraft.edit;
  const tags = [...state.tagDraft.edit];
  const isCrowdfund = Boolean(document.getElementById("editCrowdfundToggle")?.checked);
  const isReusable = !isCrowdfund && Boolean(document.getElementById("editReusableToggle")?.checked);

  if (rawLink && !isValidHttpUrl(rawLink)) {
    showToast("Укажите корректный URL магазина (http:// или https://)");
    return;
  }

  const updatedPayload = {
    id,
    title,
    price: rawPrice ? Number(rawPrice) : null,
    link: rawLink,
    image: state.photoDraft.edit || "",
    category,
    comment,
    desire,
    tags,
    group_ids: [...state.groupDraft.edit],
    occasion_ids: [...state.occasionDraft.edit],
    priority: desire === "high",
    is_crowdfund: isCrowdfund,
    is_reusable: isReusable
  };

  const ok = await mutateGifts("update", updatedPayload);
  if (ok) {
    triggerHaptic("success");
    closeEditModal();
    showToast("Изменения сохранены");
  }
}

export function requestDeleteGift(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  state.pendingDeleteId = giftId;
  const dialogText = document.getElementById("deleteDialogText");
  if (dialogText) {
    dialogText.textContent = `Подарок «${gift.title}» будет навсегда удалён из вашего списка.`;
  }
  document.getElementById("deleteConfirmBackdrop")?.classList.add("open");
  triggerHaptic("warning");
}

export function closeDeleteConfirm() {
  state.pendingDeleteId = null;
  document.getElementById("deleteConfirmBackdrop")?.classList.remove("open");
}

export function handleBackdropClick(event, backdropId) {
  if (event.target.id === backdropId) {
    document.getElementById(backdropId)?.classList.remove("open");
  }
}

export async function toggleGiftArchive(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  const willBeGifted = !gift.is_gifted;
  const ok = await mutateGifts("toggle_gifted", { id: giftId });
  if (ok) {
    triggerHaptic("success");
    showToast(willBeGifted ? "Перенесено в «Уже подарили»" : "Возвращено в «Актуальные»");
  }
}

export async function toggleBookSingleGift(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  const isUnbooking = gift.is_reusable
    ? (Array.isArray(gift.reusable_givers) && gift.reusable_givers.includes(state.viewerId))
    : gift.booked_by === state.viewerId;
  const ok = await mutateGifts("toggle_book", { id: giftId });
  if (ok) {
    triggerHaptic("success");
    if (gift.is_reusable) {
      showToast(
        isUnbooking
          ? "Отметка участия снята"
          : "Вы отметили, что подарите этот подарок! Владелец не видит имена."
      );
    } else {
      showToast(
        isUnbooking
          ? "Бронь снята — подарок снова свободен"
          : "Вы забронировали подарок! Владелец не видит имя дарителя."
      );
    }
  }
}

export async function toggleCrowdfundJoin(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  const isLeaving = Array.isArray(gift.participants) && gift.participants.includes(state.viewerId);
  const ok = await mutateGifts("toggle_crowdfund", { id: giftId });
  if (ok) {
    triggerHaptic("success");
    showToast(
      isLeaving
        ? "Вы вышли из совместного сбора"
        : "Вы присоединились к сбору! Доля автоматически пересчитана."
    );
  }
}

export function openStoreLink(url) {
  if (!isValidHttpUrl(url)) {
    showToast("Некорректная ссылка на магазин");
    return;
  }
  triggerHaptic("light");
  if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback ниже
  }

  const tempInput = document.createElement("textarea");
  tempInput.value = text;
  tempInput.style.position = "fixed";
  tempInput.style.opacity = "0";
  document.body.appendChild(tempInput);
  tempInput.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  document.body.removeChild(tempInput);
  return copied;
}

export async function returnToOwnWishlist() {
  showWishlistWorkspace();
  state.occasionFilter = "all";
  if (!isTelegramSession) {
    const url = new URL(window.location.href);
    url.searchParams.delete("list");
    url.searchParams.delete("occasion");
    window.history.replaceState({}, "", url);
    switchDemoRole("owner");
    return;
  }
  if (state.ownerId === state.viewerId) {
    renderAll();
    return;
  }

  state.ownerId = state.viewerId;
  state.ownerName = state.viewerName;
  state.ownerUsername = telegramViewerUsername;
  state.activeTab = "active";
  state.onlyFreeFilter = false;
  state.priceFilter = "all";
  state.categoryFilter = "all";
  const url = new URL(window.location.href);
  url.searchParams.delete("list");
  url.searchParams.delete("occasion");
  window.history.replaceState({}, "", url);
  await fetchGifts();
}

export function updateWorkspaceNav() {
  const workspaces = ["wishlist", "participations", "friends"];
  for (const workspace of workspaces) {
    const active = state.activeWorkspace === workspace;
    const sectionId = workspace === "wishlist" ? "wishlistWorkspace" : `${workspace}Workspace`;
    const buttonId = workspace === "wishlist" ? "wishlistViewBtn" : `${workspace}ViewBtn`;
    const secEl = document.getElementById(sectionId);
    const btnEl = document.getElementById(buttonId);
    if (secEl) secEl.hidden = !active;
    if (btnEl) {
      btnEl.classList.toggle("active", active);
      btnEl.setAttribute("aria-current", active ? "page" : "false");
    }
  }
  const partCountEl = document.getElementById("participationsNavCount");
  const friendsCountEl = document.getElementById("friendsNavCount");
  if (partCountEl) partCountEl.textContent = state.participations.length;
  if (friendsCountEl) friendsCountEl.textContent = state.subscriptions.length;
}

export function showWishlistWorkspace() {
  state.activeWorkspace = "wishlist";
  updateWorkspaceNav();
  triggerHaptic("light");
}

export async function showParticipations() {
  state.activeWorkspace = "participations";
  updateWorkspaceNav();
  triggerHaptic("light");
  await loadParticipations();
}

export async function showFriends() {
  state.activeWorkspace = "friends";
  updateWorkspaceNav();
  renderSocial();
  triggerHaptic("light");
  await loadSocial();
}

export function canDemoViewerAccessGift(gift, viewerId) {
  if (viewerId === DEMO_USERS.owner.id) return true;
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return true;
  return groupIds.some(groupId => {
    const group = state.groups.find(item => item.id === groupId);
    return group?.memberIds.includes(viewerId);
  });
}

export function cleanupDemoAudience() {
  if (isTelegramSession) return;
  for (const gift of state.gifts) {
    const groupIds = Array.isArray(gift.group_ids) ? gift.group_ids : [];
    if (groupIds.length === 0) continue;
    if (gift.booked_by && !canDemoViewerAccessGift(gift, Number(gift.booked_by))) gift.booked_by = null;
    if (Array.isArray(gift.participants)) {
      gift.participants = gift.participants.filter(id => canDemoViewerAccessGift(gift, Number(id)));
    }
    if (Array.isArray(gift.reusable_givers)) {
      gift.reusable_givers = gift.reusable_givers.filter(id => canDemoViewerAccessGift(gift, Number(id)));
    }
  }
}

export function getDemoParticipationItems() {
  if (state.viewerId === DEMO_USERS.owner.id) return [];
  return state.gifts.filter(gift => canDemoViewerAccessGift(gift, state.viewerId)).flatMap(gift => {
    let type = "";
    if (gift.is_crowdfund) {
      if (Array.isArray(gift.participants) && gift.participants.includes(state.viewerId)) type = "crowdfund";
    } else if (gift.is_reusable) {
      if (Array.isArray(gift.reusable_givers) && gift.reusable_givers.includes(state.viewerId)) type = "reusable";
    } else if (gift.booked_by === state.viewerId) {
      type = "book";
    }
    return type ? [{
      type,
      updatedAt: "",
      owner: { id: DEMO_USERS.owner.id, first_name: DEMO_USERS.owner.name },
      gift: {
        ...gift,
        participantsCount: Array.isArray(gift.participants) ? gift.participants.length : 0,
        reusableCount: Array.isArray(gift.reusable_givers) ? gift.reusable_givers.length : 0
      }
    }] : [];
  });
}

export async function loadParticipations(silent = false) {
  if (!silent) {
    state.participationsLoading = true;
    state.participationsError = "";
    renderParticipations();
  }

  try {
    if (isTelegramSession) {
      if (!API_ORIGIN) throw new Error("Не указан адрес Cloudflare Worker");
      const response = await fetch(`${API_ORIGIN}/api/participations`, {
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      const data = await readApiResponse(response);
      if (!Array.isArray(data.items)) throw new Error("Сервер вернул некорректный список участий");
      state.participations = data.items;
    } else {
      state.participations = getDemoParticipationItems();
    }
    state.participationsError = "";
  } catch (error) {
    state.participationsError = error.message || "Не удалось загрузить участия";
  } finally {
    state.participationsLoading = false;
    updateWorkspaceNav();
    if (state.activeWorkspace === "participations" || !silent) renderParticipations();
  }
}

export function renderParticipations() {
  const grid = document.getElementById("participationsGrid");
  if (!grid) return;

  if (state.participationsLoading) {
    grid.innerHTML = Array.from({ length: 3 }, () => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="sk-content">
          <div class="sk-bar sm shimmer-block"></div>
          <div class="sk-bar lg shimmer-block"></div>
          <div class="sk-bar shimmer-block"></div>
          <div class="sk-bar full shimmer-block"></div>
        </div>
      </div>
    `).join("");
    return;
  }

  if (state.participationsError) {
    grid.innerHTML = `
      <div class="empty-bento">
        <div class="empty-orb">${renderIcon("info", "app-icon-lg")}</div>
        <div class="empty-heading">Не удалось загрузить участия</div>
        <div class="empty-subtext">${escapeHtml(state.participationsError)}</div>
        <button type="button" class="btn-glass" onclick="loadParticipations()">Повторить</button>
      </div>
    `;
    return;
  }

  if (state.participations.length === 0) {
    grid.innerHTML = `
      <div class="empty-bento">
        <div class="empty-orb">${renderIcon("gift", "app-icon-lg")}</div>
        <div class="empty-heading">Пока нет участий</div>
        <div class="empty-subtext">Откройте вишлист друга по его ссылке и забронируйте подарок или присоединитесь к совместному сбору.</div>
        <button type="button" class="btn-glass" onclick="showWishlistWorkspace()">Перейти к вишлисту</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.participations.map(buildParticipationCardHtml).join("");
}

function buildParticipationCardHtml(item) {
  const gift = item.gift || {};
  const ownerId = parsePositiveId(item.owner?.id);
  const ownerName = escapeHtml(item.owner?.first_name || "Пользователь");
  const title = escapeHtml(gift.title || "Подарок");
  let typeLabel = `${renderIcon("lock", "app-icon-sm")}<span>Вы забронировали</span>`;
  if (item.type === "crowdfund") typeLabel = `${renderIcon("handHeart", "app-icon-sm")}<span>Совместный сбор</span>`;
  else if (item.type === "reusable") typeLabel = `${renderIcon("repeat", "app-icon-sm")}<span>Многоразовый подарок</span>`;

  const price = formatPrice(gift.price);
  const tags = Array.isArray(gift.tags) ? gift.tags : [];
  const tagsHtml = tags.map(tag => `<span class="gift-tag">#${escapeHtml(tag)}</span>`).join("");
  const statusHtml = gift.is_gifted
    ? `<span class="participation-type" style="display:inline-flex;align-items:center;gap:5px;">${renderIcon("party", "app-icon-sm")}<span>Подарок уже вручён</span></span>`
    : `<span class="participation-type" style="display:inline-flex;align-items:center;gap:5px;">${typeLabel}</span>`;

  let extraMetaHtml = "";
  if (item.type === "crowdfund") {
    extraMetaHtml = `<span class="cf-count-text">Участников: ${Number(gift.participantsCount) || 0}</span>`;
  } else if (item.type === "reusable") {
    extraMetaHtml = `<span class="cf-count-text">Отметили: ${Number(gift.reusableCount) || 1}</span>`;
  }

  return `
    <article class="gift-card participation-card">
      ${statusHtml}
      <div class="participation-owner">Вишлист: ${ownerName}</div>
      <h2 class="card-title">${title}</h2>
      <div class="card-meta-row">
        <span class="price-badge ${price ? "" : "muted"}">${price || "Цена не указана"}</span>
        ${extraMetaHtml}
      </div>
      ${tagsHtml ? `<div class="gift-tags">${tagsHtml}</div>` : ""}
      <button type="button" class="btn-accent" onclick="openParticipatingWishlist(${ownerId})">Открыть вишлист</button>
    </article>
  `;
}

export async function openParticipatingWishlist(ownerId) {
  if (!parsePositiveId(ownerId)) return;
  state.ownerId = ownerId;
  state.activeTab = "active";
  state.occasionFilter = "all";
  const url = new URL(window.location.href);
  url.searchParams.set("list", String(ownerId));
  url.searchParams.delete("occasion");
  window.history.replaceState({}, "", url);
  showWishlistWorkspace();
  await fetchGifts();
}

export function switchTab(tabName) {
  if (state.activeTab === tabName) return;
  state.activeTab = tabName;
  state.categoryFilter = "all";
  triggerHaptic("light");
  renderAll();
}

export function toggleOnlyFreeFilter() {
  state.onlyFreeFilter = !state.onlyFreeFilter;
  triggerHaptic("light");
  renderAll();
}

export function setPriceFilter(val) {
  state.priceFilter = state.priceFilter === val ? "all" : val;
  triggerHaptic("light");
  renderAll();
}

export function setCategoryFilter(cat) {
  state.categoryFilter = state.categoryFilter === cat ? "all" : cat;
  triggerHaptic("light");
  renderAll();
}

export function resetAllFilters() {
  state.onlyFreeFilter = false;
  state.priceFilter = "all";
  state.categoryFilter = "all";
  state.occasionFilter = "all";
  triggerHaptic("light");
  renderAll();
}

export function switchDemoRole(roleKey) {
  if (isTelegramSession || !DEMO_USERS[roleKey]) return;
  state.activeRoleKey = roleKey;
  state.ownerId = DEMO_USERS.owner.id;
  state.viewerId = DEMO_USERS[roleKey].id;
  state.ownerName = DEMO_USERS.owner.name;
  state.viewerName = DEMO_USERS[roleKey].name;

  document.querySelectorAll(".role-pill-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-role") === roleKey);
  });

  triggerHaptic("light");
  renderAll();
  loadParticipations(true);
  showToast(
    roleKey === "owner"
      ? "Режим Владельца: доступно добавление и управление"
      : `Гостевой режим (${DEMO_USERS[roleKey].name}): доступно бронирование и складчина`
  );
}

export function setThemePreset(themeName, silent = false) {
  document.body.setAttribute("data-theme", themeName);
  document.querySelectorAll("[data-theme-btn]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-btn") === themeName);
  });
  if (!silent) {
    triggerHaptic("light");
  }
}

export function previewSkeletons() {
  triggerHaptic("light");
  state.isLoading = true;
  renderSkeletons();
  setTimeout(() => {
    state.isLoading = false;
    renderAll();
  }, 950);
}

export function resetDemoData() {
  if (isTelegramSession) return;
  state.gifts = getInitialDemoGifts();
  state.occasions = getDefaultDemoOccasions();
  state.groups = getDefaultDemoGroups();
  state.copiedGiftIds.clear();
  saveLocalGifts();
  renderOccasionEditor("add");
  renderOccasionEditor("edit");
  renderAudienceEditor("add");
  renderAudienceEditor("edit");
  resetAllFilters();
  loadParticipations(true);
  triggerHaptic("success");
  showToast("Демо-вишлист восстановлен по умолчанию");
}

export function renderSkeletons() {
  const grid = document.getElementById("giftsGrid");
  if (!grid) return;
  let html = "";
  for (let i = 0; i < 6; i++) {
    html += `
      <div class="skeleton-card" aria-hidden="true">
        <div class="sk-media shimmer-block"></div>
        <div class="sk-content">
          <div class="sk-bar lg shimmer-block"></div>
          <div class="sk-bar sm shimmer-block"></div>
          <div class="sk-bar shimmer-block"></div>
          <div class="sk-bar full shimmer-block"></div>
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
}

function renderOccasionsBar(visibleGifts, isOwner) {
  const section = document.getElementById("occasionsSection");
  const bar = document.getElementById("occasionsBar");
  const banner = document.getElementById("occasionBanner");
  const bannerTitle = document.getElementById("occasionBannerTitle");
  if (!section || !bar) return;

  const availableOccasions = isOwner
    ? state.occasions
    : state.occasions.filter(occ =>
      visibleGifts.some(gift => Array.isArray(gift.occasion_ids) && gift.occasion_ids.includes(occ.id))
    );

  if (!isOwner && availableOccasions.length === 0) {
    section.hidden = true;
    if (banner) banner.hidden = true;
    return;
  }

  section.hidden = false;
  const chipsHtml = [
    `<button type="button" class="filter-pill ${state.occasionFilter === "all" ? "active" : ""}" data-occasion-filter="all" onclick="clearOccasionFilter()">Все</button>`,
    ...availableOccasions.map(occ => {
      const active = state.occasionFilter === occ.id;
      return `<button type="button" class="filter-pill ${active ? "active" : ""}" data-occasion-filter="${escapeHtml(occ.id)}" onclick="selectOccasionFilter(this.dataset.occasionFilter)">${renderIcon("target", "app-icon-sm")}<span>${escapeHtml(occ.title)}</span></button>`;
    })
  ];

  if (isOwner) {
    chipsHtml.push(`<button type="button" class="filter-pill" id="manageOccasionsBtn" onclick="openOccasionManagerModal()">${renderIcon("plus", "app-icon-sm")}<span>Поводы</span></button>`);
  }
  bar.innerHTML = chipsHtml.join("");

  const activeOccasion = availableOccasions.find(item => item.id === state.occasionFilter);
  if (banner && bannerTitle) {
    if (activeOccasion) {
      banner.hidden = false;
      bannerTitle.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">${renderIcon("target", "app-icon-sm")}<span>${escapeHtml(activeOccasion.title)}</span></span>`;
    } else {
      banner.hidden = true;
    }
  }
}

export function renderAll() {
  if (state.isLoading) {
    renderSkeletons();
    return;
  }

  const isOwner = state.viewerId === state.ownerId;
  const currentUser = isTelegramSession
    ? { name: state.viewerName, avatar: "sparkles" }
    : DEMO_USERS[state.activeRoleKey] || DEMO_USERS.owner;

  const headerTitle = document.getElementById("headerTitle");
  const roleBadge = document.getElementById("roleBadge");
  const headerSubtitle = document.getElementById("headerSubtitle");
  const avatarEmoji = document.getElementById("heroAvatarEmoji");
  const shareBtn = document.getElementById("shareListBtn");
  const backBtn = document.getElementById("backToOwnListBtn");
  const subscribeBtn = document.getElementById("subscribeListBtn");
  const subscribeBtnText = document.getElementById("subscribeListBtnText");
  const addSection = document.getElementById("ownerAddSection");

  if (isOwner) {
    if (headerTitle) headerTitle.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;">${renderIcon("gift")}<span>Мой вишлист</span></span>`;
    if (roleBadge) roleBadge.innerHTML = `${renderIcon("crown", "app-icon-sm")}<span>Владелец списка</span>`;
    if (headerSubtitle) headerSubtitle.textContent = "Добавляйте желанные подарки и делитесь списком с близкими в Telegram";
    if (avatarEmoji) avatarEmoji.innerHTML = renderIcon("gift", "app-icon-lg");
    if (shareBtn) shareBtn.style.display = "inline-flex";
    if (subscribeBtn) subscribeBtn.style.display = "none";
    if (backBtn) backBtn.style.display = "none";
    if (addSection) addSection.style.display = "block";
  } else {
    if (headerTitle) headerTitle.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;">${renderIcon("gift")}<span>Вишлист ${escapeHtml(state.ownerName)}</span></span>`;
    if (roleBadge) roleBadge.innerHTML = `${renderIcon("users", "app-icon-sm")}<span>Гостевой режим · Вы: ${escapeHtml(currentUser.name)}</span>`;
    const ownerAccount = state.ownerUsername ? `@${state.ownerUsername} · ` : "";
    if (headerSubtitle) headerSubtitle.textContent = `${ownerAccount}Бронируйте подарки в 1 клик или скидывайтесь с друзьями — именинник не узнает заранее`;
    if (avatarEmoji) avatarEmoji.innerHTML = renderIcon(currentUser.avatar || "sparkles", "app-icon-lg");
    if (shareBtn) shareBtn.style.display = "none";
    if (subscribeBtn) subscribeBtn.style.display = "inline-flex";
    if (subscribeBtnText) {
      subscribeBtnText.innerHTML = state.isSubscribed
        ? `<span style="display:inline-flex;align-items:center;gap:6px;">${renderIcon("check", "app-icon-sm")}<span>Вы подписаны</span></span>`
        : `<span style="display:inline-flex;align-items:center;gap:6px;">${renderIcon("bell", "app-icon-sm")}<span>Подписаться</span></span>`;
    }
    if (backBtn) backBtn.style.display = "inline-flex";
    if (addSection) addSection.style.display = "none";
  }

  const visibleGifts = !isTelegramSession && !isOwner
    ? state.gifts.filter(gift => canDemoViewerAccessGift(gift, state.viewerId))
    : state.gifts;

  renderOccasionsBar(visibleGifts, isOwner);

  const occasionScopedGifts = state.occasionFilter !== "all"
    ? visibleGifts.filter(gift => Array.isArray(gift.occasion_ids) && gift.occasion_ids.includes(state.occasionFilter))
    : visibleGifts;

  const activeGifts = occasionScopedGifts.filter(g => !g.is_gifted);
  const giftedGifts = occasionScopedGifts.filter(g => g.is_gifted);
  const freeGiftsCount = activeGifts.filter(g => g.is_crowdfund || g.is_reusable || g.booked_by === null).length;
  const totalActiveSum = activeGifts.reduce((acc, g) => acc + (Number(g.price) || 0), 0);

  const metricActive = document.getElementById("metricActiveCount");
  const metricFree = document.getElementById("metricFreeCount");
  const metricSum = document.getElementById("metricTotalSum");
  if (metricActive) metricActive.textContent = activeGifts.length;
  if (metricFree) metricFree.textContent = `${freeGiftsCount} из ${activeGifts.length}`;
  if (metricSum) metricSum.textContent = formatPrice(totalActiveSum) || "0 ₽";

  document.getElementById("tabActiveBtn")?.classList.toggle("active", state.activeTab === "active");
  document.getElementById("tabGiftedBtn")?.classList.toggle("active", state.activeTab === "gifted");
  const tabActiveCnt = document.getElementById("tabActiveCount");
  const tabGiftedCnt = document.getElementById("tabGiftedCount");
  if (tabActiveCnt) tabActiveCnt.textContent = activeGifts.length;
  if (tabGiftedCnt) tabGiftedCnt.textContent = giftedGifts.length;

  const currentTabItems = state.activeTab === "active" ? activeGifts : giftedGifts;
  renderFiltersBar(currentTabItems);

  const filtered = currentTabItems
    .filter(item => {
      if (state.onlyFreeFilter) {
        if (!item.is_crowdfund && !item.is_reusable && item.booked_by !== null) return false;
      }
      if (state.priceFilter !== "all") {
        const p = Number(item.price) || 0;
        if (!p) return false;
        if (state.priceFilter === "under2k" && p > 2000) return false;
        if (state.priceFilter === "2k_5k" && (p < 2000 || p > 5000)) return false;
        if (state.priceFilter === "over5k" && p <= 5000) return false;
      }
      if (state.categoryFilter !== "all" && item.category !== state.categoryFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (state.activeTab === "active") {
        const desireDifference = DESIRE_META[getGiftDesire(a)].rank - DESIRE_META[getGiftDesire(b)].rank;
        if (desireDifference !== 0) return desireDifference;
      }
      return b.id - a.id;
    });

  renderGiftCards(filtered, currentTabItems.length === 0, isOwner);
  wishlistHooks.renderSuperappHub();
}

function renderFiltersBar(tabItems) {
  const bar = document.getElementById("filtersBar");
  if (!bar) return;
  const categories = Array.from(new Set(tabItems.map(g => g.category).filter(Boolean)));
  const isAllReset = !state.onlyFreeFilter && state.priceFilter === "all" && state.categoryFilter === "all" && state.occasionFilter === "all";

  let html = `
    <button type="button" class="filter-pill ${isAllReset ? "active" : ""}" onclick="resetAllFilters()">
      Все желания
    </button>
    <button type="button" class="filter-pill ${state.onlyFreeFilter ? "active" : ""}" onclick="toggleOnlyFreeFilter()">
      ${renderIcon("unlock", "app-icon-sm")}
      <span>Только свободные</span>
    </button>
    <span class="rail-divider"></span>
    <button type="button" class="filter-pill tabular-nums ${state.priceFilter === "under2k" ? "active" : ""}" onclick="setPriceFilter('under2k')">
      До 2 000 ₽
    </button>
    <button type="button" class="filter-pill tabular-nums ${state.priceFilter === "2k_5k" ? "active" : ""}" onclick="setPriceFilter('2k_5k')">
      2 000 – 5 000 ₽
    </button>
    <button type="button" class="filter-pill tabular-nums ${state.priceFilter === "over5k" ? "active" : ""}" onclick="setPriceFilter('over5k')">
      От 5 000 ₽
    </button>
  `;

  if (categories.length > 0) {
    html += `<span class="rail-divider"></span>`;
    categories.forEach(cat => {
      const styleObj = CATEGORY_STYLES[cat] || CATEGORY_STYLES.default;
      const activeClass = state.categoryFilter === cat ? "active" : "";
      const safeCat = escapeHtml(cat);
      html += `
        <button type="button" class="filter-pill ${activeClass}" data-cat="${safeCat}" onclick="setCategoryFilter(this.getAttribute('data-cat'))">
          ${renderIcon(styleObj.icon, "app-icon-sm")}
          <span>${safeCat}</span>
        </button>
      `;
    });
  }

  bar.innerHTML = html;
}

function renderGiftCards(items, isTabCompletelyEmpty, isOwner) {
  const grid = document.getElementById("giftsGrid");
  if (!grid) return;

  if (state.loadError) {
    grid.innerHTML = `
      <div class="empty-bento">
        <div class="empty-orb">${renderIcon("info", "app-icon-lg")}</div>
        <div class="empty-heading">Не удалось загрузить вишлист</div>
        <div class="empty-subtext">${escapeHtml(state.loadError)}</div>
        <button type="button" class="btn-glass" style="margin-top: 6px;" onclick="fetchGifts()">
          Повторить
        </button>
      </div>
    `;
    return;
  }

  if (items.length === 0) {
    if (isTabCompletelyEmpty) {
      grid.innerHTML = `
        <div class="empty-bento">
          <div class="empty-orb">${renderIcon(state.activeTab === "active" ? "gift" : "party", "app-icon-lg")}</div>
          <div class="empty-heading">
            ${state.activeTab === "active" ? "Список желаний пока пуст" : "В архиве пока нет подарков"}
          </div>
          <div class="empty-subtext">
            ${
              state.activeTab === "active"
                ? isOwner
                  ? "Используйте форму выше, чтобы добавить свой первый желанный подарок и поделиться ссылкой с друзьями."
                  : "Владелец вишлиста ещё не добавил актуальные подарки."
                : "Когда подарки будут вручены, они появятся в этом разделе."
            }
          </div>
        </div>
      `;
    } else {
      grid.innerHTML = `
        <div class="empty-bento">
          <div class="empty-orb">${renderIcon("search", "app-icon-lg")}</div>
          <div class="empty-heading">По выбранным фильтрам ничего не найдено</div>
          <div class="empty-subtext">Попробуйте отключить фильтр «Только свободные» или изменить ценовой диапазон.</div>
          <button type="button" class="btn-glass" style="margin-top: 6px;" onclick="resetAllFilters()">
            Сбросить все фильтры
          </button>
        </div>
      `;
    }
    return;
  }

  grid.innerHTML = items.map(gift => buildGiftCardHtml(gift, isOwner)).join("");
  hydrateInternalImages(grid);
}

function buildGiftCardHtml(gift, isOwner) {
  const catStyle = CATEGORY_STYLES[gift.category] || CATEGORY_STYLES.default;
  const safeTitle = escapeHtml(gift.title);
  const safeCategory = escapeHtml(gift.category || "Разное");
  const safeComment = escapeHtml(gift.comment || "");
  const formattedPrice = formatPrice(gift.price);
  const hasValidLink = isValidHttpUrl(gift.link);
  const desire = getGiftDesire(gift);
  const desireMeta = DESIRE_META[desire];
  const desireBadgeHtml = `<span class="glass-pill ${desireMeta.className}">${desireMeta.icon ? renderIcon(desireMeta.icon, "app-icon-sm") : ""}${desireMeta.label}</span>`;
  const reusableBadgeHtml = gift.is_reusable
    ? `<span class="glass-pill pill-status-reusable">${renderIcon("repeat", "app-icon-sm")}Можно дарить несколько раз</span>`
    : "";
  const giftGroupIds = Array.isArray(gift.group_ids) ? gift.group_ids : [];
  const giftGroupNames = state.groups.filter(group => giftGroupIds.includes(group.id)).map(group => group.name);
  const audienceBadgeHtml = isOwner && giftGroupIds.length
    ? `<span class="glass-pill pill-status-booked">Для: ${escapeHtml(giftGroupNames.join(", ") || "выбранных")}</span>`
    : "";
  const tags = Array.isArray(gift.tags) ? gift.tags : [];
  const tagsHtml = tags.length
    ? `<div class="gift-tags">${tags.map(tag => `<span class="gift-tag">#${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";

  let mediaContentHtml = "";
  if (gift.image) {
    const useProtectedImage = isTelegramSession && isInternalImageUrl(gift.image);
    const safeImg = escapeHtml(useProtectedImage ? gift.image : resolveImageUrl(gift.image));
    const sourceAttribute = useProtectedImage
      ? `data-internal-image="${safeImg}" style="display: none;"`
      : `src="${safeImg}"`;
    mediaContentHtml = `
      <img
        ${sourceAttribute}
        alt="${safeTitle}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="card-art-placeholder" style="display: ${useProtectedImage ? "flex" : "none"}; background: ${catStyle.gradient};">
        <div class="art-icon-orb">${renderIcon(catStyle.icon, "app-icon-lg")}</div>
        <span class="art-cat-caption">${safeCategory}</span>
      </div>
    `;
  } else {
    mediaContentHtml = `
      <div class="card-art-placeholder" style="background: ${catStyle.gradient};">
        <div class="art-icon-orb">${renderIcon(catStyle.icon, "app-icon-lg")}</div>
        <span class="art-cat-caption">${safeCategory}</span>
      </div>
    `;
  }

  const participants = Array.isArray(gift.participants) ? gift.participants : [];
  const reusableGivers = Array.isArray(gift.reusable_givers) ? gift.reusable_givers : [];
  const isBookedByMe = gift.booked_by === state.viewerId;
  const isBookedByOther = gift.booked_by !== null && gift.booked_by !== state.viewerId;
  const isJoinedByMe = participants.includes(state.viewerId);
  const isReusableMine = reusableGivers.includes(state.viewerId);

  let rightBadgeHtml = "";
  if (gift.is_gifted) {
    rightBadgeHtml = `<span class="glass-pill pill-status-mine">${renderIcon("checkCircle", "app-icon-sm")}Подарено</span>`;
  } else if (gift.is_crowdfund) {
    rightBadgeHtml = `<span class="glass-pill pill-status-crowdfund">${renderIcon("handHeart", "app-icon-sm")}Сбор · ${participants.length} чел.</span>`;
  } else if (gift.is_reusable) {
    if (isOwner && reusableGivers.length > 0) {
      rightBadgeHtml = `<span class="glass-pill pill-status-booked">Отметили: ${reusableGivers.length}</span>`;
    } else if (!isOwner && isReusableMine) {
      rightBadgeHtml = `<span class="glass-pill pill-status-mine">${renderIcon("checkCircle", "app-icon-sm")}Вы выбрали этот подарок</span>`;
    }
  } else if (isBookedByMe && !isOwner) {
    rightBadgeHtml = `<span class="glass-pill pill-status-mine">${renderIcon("lock", "app-icon-sm")}Вы забронировали</span>`;
  } else if (gift.booked_by !== null) {
    rightBadgeHtml = `<span class="glass-pill pill-status-booked">${renderIcon("lock", "app-icon-sm")}Забронировано</span>`;
  }

  let crowdfundWidgetHtml = "";
  if (gift.is_crowdfund) {
    const count = participants.length;
    const priceNum = Number(gift.price) || 0;
    let splitDescription = "Совместный подарок — можно разделить стоимость";

    if (priceNum > 0) {
      if (count > 0) {
        const perPerson = formatPrice(Math.ceil(priceNum / count));
        splitDescription = `По ~${perPerson} с человека`;
        if (!isOwner && !isJoinedByMe) {
          const withMe = formatPrice(Math.ceil(priceNum / (count + 1)));
          splitDescription += ` · с вами по ~${withMe}`;
        }
      } else {
        const ifTwo = formatPrice(Math.ceil(priceNum / 2));
        splitDescription = `Свободно · вдвоём выйдет по ~${ifTwo}`;
      }
    }

    const avatarsHtml = participants
      .slice(0, 4)
      .map((uid, idx) => {
        const label = uid === 2002 ? "А" : uid === 3003 ? "Д" : `Г${idx + 1}`;
        return `<span class="stack-Chip" title="Участник сбора">${label}</span>`;
      })
      .join("");

    crowdfundWidgetHtml = `
      <div class="crowdfund-widget">
        <div class="cf-top-line">
          <div class="cf-participants-wrap">
            ${avatarsHtml ? `<div class="avatar-stack">${avatarsHtml}</div>` : ""}
            <span class="cf-count-text">Участвуют: ${count} чел.</span>
          </div>
          <span style="font-size: 11px; font-weight: 700; color: var(--tg-theme-button-color);">Складчина</span>
        </div>
        <div class="cf-split-pill">(${splitDescription})</div>
      </div>
    `;
  }

  let footerHtml = "";
  if (isOwner) {
    footerHtml = `
      <div class="owner-btn-row">
        <button type="button" class="action-btn btn-owner-edit" onclick="openEditModal(${gift.id})">
          ${renderIcon("pencil", "app-icon-sm")}
          <span>Изменить</span>
        </button>
        <button type="button" class="action-btn btn-owner-archive" onclick="toggleGiftArchive(${gift.id})" title="${gift.is_gifted ? "Вернуть в актуальные" : "Отметить, что подарок вручён"}">
          ${gift.is_gifted ? `${renderIcon("rotateCcw", "app-icon-sm")}<span>Вернуть</span>` : `${renderIcon("check", "app-icon-sm")}<span>Отметить вручение</span>`}
        </button>
        <button type="button" class="action-btn btn-owner-delete" onclick="requestDeleteGift(${gift.id})" title="Удалить подарок" aria-label="Удалить подарок">
          ${renderIcon("trash", "app-icon-sm")}
        </button>
      </div>
    `;
  } else {
    let primaryBtnHtml = "";
    if (gift.is_gifted) {
      primaryBtnHtml = `
        <button type="button" class="action-btn btn-guest-locked" disabled>
          ${renderIcon("party", "app-icon-sm")}
          <span>Подарок уже вручён</span>
        </button>
      `;
    } else if (gift.is_crowdfund) {
      primaryBtnHtml = isJoinedByMe
        ? `<button type="button" class="action-btn btn-guest-unbook" onclick="toggleCrowdfundJoin(${gift.id})">${renderIcon("check", "app-icon-sm")}<span>Вы участвуете · Выйти</span></button>`
        : `<button type="button" class="action-btn btn-guest-crowdfund" onclick="toggleCrowdfundJoin(${gift.id})">${renderIcon("handHeart", "app-icon-sm")}<span>Скинуться</span></button>`;
    } else if (gift.is_reusable) {
      primaryBtnHtml = isReusableMine
        ? `<button type="button" class="action-btn btn-guest-unbook" onclick="toggleBookSingleGift(${gift.id})">Отменить участие</button>`
        : `<button type="button" class="action-btn btn-guest-book" onclick="toggleBookSingleGift(${gift.id})">${renderIcon("gift", "app-icon-sm")}<span>Я подарю</span></button>`;
    } else if (gift.booked_by === null) {
      primaryBtnHtml = `
        <button type="button" class="action-btn btn-guest-book" onclick="toggleBookSingleGift(${gift.id})">
          ${renderIcon("gift", "app-icon-sm")}
          <span>Я подарю</span>
        </button>
      `;
    } else if (isBookedByMe) {
      primaryBtnHtml = `
        <button type="button" class="action-btn btn-guest-unbook" onclick="toggleBookSingleGift(${gift.id})">
          Отменить бронь
        </button>
      `;
    } else if (isBookedByOther) {
      primaryBtnHtml = `
        <button type="button" class="action-btn btn-guest-locked" disabled>
          ${renderIcon("lock", "app-icon-sm")}
          <span>Забронировано</span>
        </button>
      `;
    }

    const isCopied = state.copiedGiftIds.has(gift.id);
    const isCopying = state.copyingGiftIds.has(gift.id);
    const copyBtnHtml = isCopied
      ? `<button type="button" class="action-btn btn-guest-copy copied" disabled>${renderIcon("check", "app-icon-sm")}<span>В вашем списке</span></button>`
      : `<button type="button" class="action-btn btn-guest-copy" ${isCopying ? "disabled" : ""} onclick="copyGiftToOwnWishlist(${gift.id})">${isCopying ? "Добавляем..." : `${renderIcon("plus", "app-icon-sm")}<span>Добавить себе</span>`}</button>`;

    footerHtml = primaryBtnHtml + copyBtnHtml;
  }

  return `
    <article class="gift-card ${desire === "high" && !gift.is_gifted ? "is-priority" : ""} ${gift.is_gifted ? "is-gifted-card" : ""}">
      <div class="card-media">
        ${mediaContentHtml}
        <div class="media-badges-left">
          ${desireBadgeHtml}
          ${reusableBadgeHtml}
          ${audienceBadgeHtml}
          <span class="glass-pill pill-category">${renderIcon(catStyle.icon, "app-icon-sm")}${safeCategory}</span>
        </div>
        <div class="media-badge-right">
          ${rightBadgeHtml}
        </div>
      </div>

      <div class="card-content">
        <h3 class="card-title">${safeTitle}</h3>

        <div class="card-meta-row">
          ${
            formattedPrice
              ? `<span class="price-badge">${formattedPrice}</span>`
              : `<span class="price-badge muted">Цена не указана</span>`
          }
          ${
            hasValidLink
              ? `<button type="button" class="store-ext-btn" data-url="${escapeHtml(gift.link)}" onclick="openStoreLink(this.getAttribute('data-url'))">
                  <span>В магазин</span>
                  ${renderIcon("externalLink", "app-icon-sm")}
                 </button>`
              : ""
          }
        </div>

        ${tagsHtml}
        ${safeComment ? `<div class="card-note-box">${safeComment}</div>` : ""}
        ${crowdfundWidgetHtml}
      </div>

      <div class="card-actions-footer">
        ${footerHtml}
      </div>
    </article>
  `;
}
