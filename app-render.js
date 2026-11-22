/**
 * Модуль 3: Формы добавления/редактирования, переключатели, разделы участия и рендеринг UI.
 */
function setDesire(formPrefix, desire) {
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

function renderTagEditor(formPrefix) {
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
      <button type="button" aria-label="Удалить тег ${escapeHtml(tag)}" onclick="removeTagByIndex('${formPrefix}', ${index})">×</button>
    </span>
  `).join("");
}

function removeTagByIndex(formPrefix, index) {
  if (!Number.isInteger(index)) return;
  state.tagDraft[formPrefix].splice(index, 1);
  renderTagEditor(formPrefix);
  triggerHaptic("light");
}

function toggleTag(formPrefix, rawTag) {
  const tag = normalizeTag(rawTag);
  if (!tag) return;
  const tags = state.tagDraft[formPrefix];
  const key = tag.toLocaleLowerCase("ru-RU");
  const index = tags.findIndex(item => item.toLocaleLowerCase("ru-RU") === key);
  if (index >= 0) tags.splice(index, 1);
  else {
    if (tags.length >= 8) {
      showToast("⚠️ Можно выбрать не больше 8 тегов");
      return;
    }
    tags.push(tag);
  }
  renderTagEditor(formPrefix);
  triggerHaptic("light");
}

function addCustomTag(formPrefix) {
  const input = document.getElementById(`${formPrefix}CustomTagInput`);
  const tag = normalizeTag(input.value);
  if (!tag) return;
  const tags = state.tagDraft[formPrefix];
  if (tags.some(item => item.toLocaleLowerCase("ru-RU") === tag.toLocaleLowerCase("ru-RU"))) {
    showToast("Этот тег уже добавлен");
  } else if (tags.length >= 8) {
    showToast("⚠️ Можно выбрать не больше 8 тегов");
    return;
  } else {
    tags.push(tag);
  }
  input.value = "";
  renderTagEditor(formPrefix);
  input.focus();
  triggerHaptic("light");
}

function handleTagKeydown(event, formPrefix) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addCustomTag(formPrefix);
}

function syncMutualExclusiveToggle(formPrefix, changedType) {
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

function toggleAddDetails() {
  const panel = document.getElementById("addDetailsPanel");
  const btn = document.getElementById("toggleDetailsBtn");
  const isOpen = panel.classList.toggle("open");
  btn.classList.toggle("active", isOpen);
  triggerHaptic("light");
}

function selectPresetCategory(formPrefix, categoryName) {
  const input = document.getElementById(`${formPrefix}CategoryInput`);
  input.value = input.value.trim() === categoryName ? "" : categoryName;
  syncCategoryChipHighlight(formPrefix);
  triggerHaptic("light");
}

function syncCategoryChipHighlight(formPrefix) {
  const val = document.getElementById(`${formPrefix}CategoryInput`).value.trim();
  const container = document.getElementById(`${formPrefix}CategoryChips`);
  container.querySelectorAll(".cat-preset-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.getAttribute("data-cat") === val);
  });
}

async function handleAddGiftSubmit(event) {
  event.preventDefault();
  const titleEl = document.getElementById("addTitleInput");
  const title = titleEl.value.trim();
  if (!title) return;

  const rawPrice = document.getElementById("addPriceInput").value.trim();
  const rawLink = document.getElementById("addLinkInput").value.trim();
  const category = document.getElementById("addCategoryInput").value.trim() || "Разное";
  const comment = document.getElementById("addCommentInput").value.trim();
  const desire = state.desireDraft.add;
  const tags = [...state.tagDraft.add];
  const isCrowdfund = document.getElementById("addCrowdfundToggle").checked;
  const isReusable = !isCrowdfund && Boolean(document.getElementById("addReusableToggle")?.checked);

  if (rawLink && !isValidHttpUrl(rawLink)) {
    showToast("⚠️ Ссылка должна начинаться с https:// или http://");
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
    showToast("🎁 Желание добавлено в ваш вишлист!");
    document.getElementById("addGiftForm").reset();
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

function openEditModal(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;

  document.getElementById("editGiftId").value = gift.id;
  document.getElementById("editTitleInput").value = gift.title || "";
  document.getElementById("editPriceInput").value = gift.price || "";
  document.getElementById("editLinkInput").value = gift.link || "";
  document.getElementById("editCategoryInput").value = gift.category || "";
  document.getElementById("editCommentInput").value = gift.comment || "";
  state.desireDraft.edit = getGiftDesire(gift);
  state.tagDraft.edit = Array.isArray(gift.tags) ? [...gift.tags] : [];
  state.groupDraft.edit = Array.isArray(gift.group_ids) ? [...gift.group_ids] : [];
  state.occasionDraft.edit = Array.isArray(gift.occasion_ids) ? [...gift.occasion_ids] : [];
  setDesire("edit", state.desireDraft.edit);
  renderTagEditor("edit");
  renderAudienceEditor("edit");
  renderOccasionEditor("edit");
  document.getElementById("editCrowdfundToggle").checked = Boolean(gift.is_crowdfund);
  const editReusableEl = document.getElementById("editReusableToggle");
  if (editReusableEl) editReusableEl.checked = !gift.is_crowdfund && Boolean(gift.is_reusable);

  state.photoDraft.edit = gift.image || "";
  document.getElementById("editImageUrlInput").value =
    gift.image && gift.image.startsWith("http") ? gift.image : "";
  updatePhotoPreviewUI("edit", gift.image || "", gift.image ? "Сохранено в карточке" : "");
  syncCategoryChipHighlight("edit");

  document.getElementById("editModalBackdrop").classList.add("open");
  triggerHaptic("light");
}

function closeEditModal() {
  document.getElementById("editModalBackdrop").classList.remove("open");
}

async function handleEditGiftSubmit(event) {
  event.preventDefault();
  const id = Number(document.getElementById("editGiftId").value);
  const title = document.getElementById("editTitleInput").value.trim();
  if (!title) return;

  const rawPrice = document.getElementById("editPriceInput").value.trim();
  const rawLink = document.getElementById("editLinkInput").value.trim();
  const category = document.getElementById("editCategoryInput").value.trim() || "Разное";
  const comment = document.getElementById("editCommentInput").value.trim();
  const desire = state.desireDraft.edit;
  const tags = [...state.tagDraft.edit];
  const isCrowdfund = document.getElementById("editCrowdfundToggle").checked;
  const isReusable = !isCrowdfund && Boolean(document.getElementById("editReusableToggle")?.checked);

  if (rawLink && !isValidHttpUrl(rawLink)) {
    showToast("⚠️ Укажите корректный URL магазина (http:// или https://)");
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
    showToast("✓ Изменения сохранены");
  }
}

function requestDeleteGift(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  state.pendingDeleteId = giftId;
  document.getElementById("deleteDialogText").textContent =
    `Подарок «${gift.title}» будет навсегда удалён из вашего списка.`;
  document.getElementById("deleteConfirmBackdrop").classList.add("open");
  triggerHaptic("warning");
}

function closeDeleteConfirm() {
  state.pendingDeleteId = null;
  document.getElementById("deleteConfirmBackdrop").classList.remove("open");
}

document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
  if (!state.pendingDeleteId) return;
  const id = state.pendingDeleteId;
  closeDeleteConfirm();
  const ok = await mutateGifts("delete", { id });
  if (ok) {
    triggerHaptic("light");
    showToast("🗑 Подарок удалён из списка");
  }
});

function handleBackdropClick(event, backdropId) {
  if (event.target.id === backdropId) {
    document.getElementById(backdropId).classList.remove("open");
  }
}

async function toggleGiftArchive(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  const willBeGifted = !gift.is_gifted;
  const ok = await mutateGifts("toggle_gifted", { id: giftId });
  if (ok) {
    triggerHaptic("success");
    showToast(willBeGifted ? "🎉 Перенесено в «Уже подарили»" : "↩ Возвращено в «Актуальные»");
  }
}

async function toggleBookSingleGift(giftId) {
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
          : "🎁 Вы отметили, что подарите этот подарок! Владелец не видит имена."
      );
    } else {
      showToast(
        isUnbooking
          ? "Бронь снята — подарок снова свободен"
          : "🎁 Вы забронировали подарок! Владелец не видит имя дарителя."
      );
    }
  }
}

async function toggleCrowdfundJoin(giftId) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift) return;
  const isLeaving = Array.isArray(gift.participants) && gift.participants.includes(state.viewerId);
  const ok = await mutateGifts("toggle_crowdfund", { id: giftId });
  if (ok) {
    triggerHaptic("success");
    showToast(
      isLeaving
        ? "Вы вышли из совместного сбора"
        : "🤝 Вы присоединились к сбору! Доля автоматически пересчитана."
    );
  }
}

function openStoreLink(url) {
  if (!isValidHttpUrl(url)) {
    showToast("⚠️ Некорректная ссылка на магазин");
    return;
  }
  triggerHaptic("light");
  if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
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
  } catch (error) {}
  document.body.removeChild(tempInput);
  return copied;
}

async function returnToOwnWishlist() {
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

function updateWorkspaceNav() {
  const workspaces = ["wishlist", "participations", "friends"];
  for (const workspace of workspaces) {
    const active = state.activeWorkspace === workspace;
    const sectionId = workspace === "wishlist" ? "wishlistWorkspace" : `${workspace}Workspace`;
    const buttonId = workspace === "wishlist" ? "wishlistViewBtn" : `${workspace}ViewBtn`;
    document.getElementById(sectionId).hidden = !active;
    document.getElementById(buttonId).classList.toggle("active", active);
    document.getElementById(buttonId).setAttribute("aria-current", active ? "page" : "false");
  }
  document.getElementById("participationsNavCount").textContent = state.participations.length;
  document.getElementById("friendsNavCount").textContent = state.subscriptions.length;
}

function showWishlistWorkspace() {
  state.activeWorkspace = "wishlist";
  updateWorkspaceNav();
  triggerHaptic("light");
}

async function showParticipations() {
  state.activeWorkspace = "participations";
  updateWorkspaceNav();
  triggerHaptic("light");
  await loadParticipations();
}

async function showFriends() {
  state.activeWorkspace = "friends";
  updateWorkspaceNav();
  renderSocial();
  triggerHaptic("light");
  await loadSocial();
}

function canDemoViewerAccessGift(gift, viewerId) {
  if (viewerId === DEMO_USERS.owner.id) return true;
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return true;
  return groupIds.some(groupId => {
    const group = state.groups.find(item => item.id === groupId);
    return group?.memberIds.includes(viewerId);
  });
}

function cleanupDemoAudience() {
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

function getDemoParticipationItems() {
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

async function loadParticipations(silent = false) {
  if (!silent) {
    state.participationsLoading = true;
    state.participationsError = "";
    renderParticipations();
  }

  try {
    if (isTelegramSession) {
      if (!API_ORIGIN) throw new Error("Не указан адрес Cloudflare Worker");
      const response = await fetch(`${API_ORIGIN}/api/participations`, {
        headers: getAuthHeaders()
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

function renderParticipations() {
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
        <div class="empty-orb">⚠️</div>
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
        <div class="empty-orb">🎁</div>
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
  let typeLabel = "🔒 Вы забронировали";
  if (item.type === "crowdfund") typeLabel = "🤝 Совместный сбор";
  else if (item.type === "reusable") typeLabel = "♻️ Многоразовый подарок";

  const price = formatPrice(gift.price);
  const tags = Array.isArray(gift.tags) ? gift.tags : [];
  const tagsHtml = tags.map(tag => `<span class="gift-tag">#${escapeHtml(tag)}</span>`).join("");
  const statusHtml = gift.is_gifted
    ? `<span class="participation-type">🎉 Подарок уже вручён</span>`
    : `<span class="participation-type">${typeLabel}</span>`;

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

async function openParticipatingWishlist(ownerId) {
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

function switchTab(tabName) {
  if (state.activeTab === tabName) return;
  state.activeTab = tabName;
  state.categoryFilter = "all";
  triggerHaptic("light");
  renderAll();
}

function toggleOnlyFreeFilter() {
  state.onlyFreeFilter = !state.onlyFreeFilter;
  triggerHaptic("light");
  renderAll();
}

function setPriceFilter(val) {
  state.priceFilter = state.priceFilter === val ? "all" : val;
  triggerHaptic("light");
  renderAll();
}

function setCategoryFilter(cat) {
  state.categoryFilter = state.categoryFilter === cat ? "all" : cat;
  triggerHaptic("light");
  renderAll();
}

function resetAllFilters() {
  state.onlyFreeFilter = false;
  state.priceFilter = "all";
  state.categoryFilter = "all";
  state.occasionFilter = "all";
  triggerHaptic("light");
  renderAll();
}

function switchDemoRole(roleKey) {
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
      ? "👑 Режим Владельца: доступно добавление и управление"
      : `👤 Гостевой режим (${DEMO_USERS[roleKey].name}): доступно бронирование и складчина`
  );
}

function setThemePreset(themeName, silent = false) {
  document.body.setAttribute("data-theme", themeName);
  document.querySelectorAll("[data-theme-btn]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-btn") === themeName);
  });
  if (!silent) {
    triggerHaptic("light");
  }
}

function previewSkeletons() {
  triggerHaptic("light");
  state.isLoading = true;
  renderSkeletons();
  setTimeout(() => {
    state.isLoading = false;
    renderAll();
  }, 950);
}

function resetDemoData() {
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
  showToast("🔄 Демо-вишлист восстановлен по умолчанию");
}

function renderSkeletons() {
  const grid = document.getElementById("giftsGrid");
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
      return `<button type="button" class="filter-pill ${active ? "active" : ""}" data-occasion-filter="${escapeHtml(occ.id)}" onclick="selectOccasionFilter(this.dataset.occasionFilter)">🎯 ${escapeHtml(occ.title)}</button>`;
    })
  ];

  if (isOwner) {
    chipsHtml.push(`<button type="button" class="filter-pill" id="manageOccasionsBtn" onclick="openOccasionManagerModal()">＋ Поводы</button>`);
  }
  bar.innerHTML = chipsHtml.join("");

  const activeOccasion = availableOccasions.find(item => item.id === state.occasionFilter);
  if (banner && bannerTitle) {
    if (activeOccasion) {
      banner.hidden = false;
      bannerTitle.textContent = `🎯 ${activeOccasion.title}`;
    } else {
      banner.hidden = true;
    }
  }
}

function renderAll() {
  if (state.isLoading) {
    renderSkeletons();
    return;
  }

  const isOwner = state.viewerId === state.ownerId;
  const currentUser = isTelegramSession
    ? { name: state.viewerName, avatar: "✨" }
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
    headerTitle.textContent = "🎁 Мой вишлист";
    roleBadge.textContent = "👑 Владелец списка";
    headerSubtitle.textContent = "Добавляйте желанные подарки и делитесь списком с близкими в Telegram";
    avatarEmoji.textContent = "🎁";
    shareBtn.style.display = "inline-flex";
    subscribeBtn.style.display = "none";
    backBtn.style.display = "none";
    addSection.style.display = "block";
  } else {
    headerTitle.textContent = `🎁 Вишлист ${state.ownerName}`;
    roleBadge.textContent = `Гостевой режим · Вы: ${currentUser.name}`;
    const ownerAccount = state.ownerUsername ? `@${state.ownerUsername} · ` : "";
    headerSubtitle.textContent = `${ownerAccount}Бронируйте подарки в 1 клик или скидывайтесь с друзьями — именинник не узнает заранее`;
    avatarEmoji.textContent = currentUser.avatar;
    shareBtn.style.display = "none";
    subscribeBtn.style.display = "inline-flex";
    subscribeBtnText.textContent = state.isSubscribed ? "✓ Вы подписаны" : "Подписаться";
    backBtn.style.display = "inline-flex";
    addSection.style.display = "none";
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

  document.getElementById("metricActiveCount").textContent = activeGifts.length;
  document.getElementById("metricFreeCount").textContent = `${freeGiftsCount} из ${activeGifts.length}`;
  document.getElementById("metricTotalSum").textContent = formatPrice(totalActiveSum) || "0 ₽";

  document.getElementById("tabActiveBtn").classList.toggle("active", state.activeTab === "active");
  document.getElementById("tabGiftedBtn").classList.toggle("active", state.activeTab === "gifted");
  document.getElementById("tabActiveCount").textContent = activeGifts.length;
  document.getElementById("tabGiftedCount").textContent = giftedGifts.length;

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
}

function renderFiltersBar(tabItems) {
  const bar = document.getElementById("filtersBar");
  const categories = Array.from(new Set(tabItems.map(g => g.category).filter(Boolean)));
  const isAllReset = !state.onlyFreeFilter && state.priceFilter === "all" && state.categoryFilter === "all" && state.occasionFilter === "all";

  let html = `
    <button type="button" class="filter-pill ${isAllReset ? "active" : ""}" onclick="resetAllFilters()">
      Все желания
    </button>
    <button type="button" class="filter-pill ${state.onlyFreeFilter ? "active" : ""}" onclick="toggleOnlyFreeFilter()">
      🔓 Только свободные
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
          <span>${styleObj.emoji}</span>
          <span>${safeCat}</span>
        </button>
      `;
    });
  }

  bar.innerHTML = html;
}

function renderGiftCards(items, isTabCompletelyEmpty, isOwner) {
  const grid = document.getElementById("giftsGrid");

  if (state.loadError) {
    grid.innerHTML = `
      <div class="empty-bento">
        <div class="empty-orb">⚠️</div>
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
          <div class="empty-orb">${state.activeTab === "active" ? "🎁" : "🎉"}</div>
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
          <div class="empty-orb">🔍</div>
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
  const desireBadgeHtml = `<span class="glass-pill ${desireMeta.className}">${desireMeta.label}</span>`;
  const reusableBadgeHtml = gift.is_reusable
    ? `<span class="glass-pill pill-status-reusable">♻️ Можно дарить несколько раз</span>`
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
        <div class="art-icon-orb">${catStyle.emoji}</div>
        <span class="art-cat-caption">${safeCategory}</span>
      </div>
    `;
  } else {
    mediaContentHtml = `
      <div class="card-art-placeholder" style="background: ${catStyle.gradient};">
        <div class="art-icon-orb">${catStyle.emoji}</div>
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
    rightBadgeHtml = `<span class="glass-pill pill-status-mine">✓ Подарено</span>`;
  } else if (gift.is_crowdfund) {
    rightBadgeHtml = `<span class="glass-pill pill-status-crowdfund">🤝 Сбор · ${participants.length} чел.</span>`;
  } else if (gift.is_reusable) {
    if (isOwner && reusableGivers.length > 0) {
      rightBadgeHtml = `<span class="glass-pill pill-status-booked">Отметили: ${reusableGivers.length}</span>`;
    } else if (!isOwner && isReusableMine) {
      rightBadgeHtml = `<span class="glass-pill pill-status-mine">✓ Вы выбрали этот подарок</span>`;
    }
  } else if (isBookedByMe && !isOwner) {
    rightBadgeHtml = `<span class="glass-pill pill-status-mine">🔒 Вы забронировали</span>`;
  } else if (gift.booked_by !== null) {
    rightBadgeHtml = `<span class="glass-pill pill-status-booked">🔒 Забронировано</span>`;
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
          <span>✏️ Изменить</span>
        </button>
        <button type="button" class="action-btn btn-owner-archive" onclick="toggleGiftArchive(${gift.id})" title="${gift.is_gifted ? "Вернуть в актуальные" : "Отметить, что подарок вручён"}">
          <span>${gift.is_gifted ? "↩ Вернуть" : "Отметить вручение"}</span>
        </button>
        <button type="button" class="action-btn btn-owner-delete" onclick="requestDeleteGift(${gift.id})" title="Удалить подарок" aria-label="Удалить подарок">
          🗑
        </button>
      </div>
    `;
  } else {
    let primaryBtnHtml = "";
    if (gift.is_gifted) {
      primaryBtnHtml = `
        <button type="button" class="action-btn btn-guest-locked" disabled>
          🎉 Подарок уже вручён
        </button>
      `;
    } else if (gift.is_crowdfund) {
      primaryBtnHtml = isJoinedByMe
        ? `<button type="button" class="action-btn btn-guest-unbook" onclick="toggleCrowdfundJoin(${gift.id})">✓ Вы участвуете · Выйти</button>`
        : `<button type="button" class="action-btn btn-guest-crowdfund" onclick="toggleCrowdfundJoin(${gift.id})">🤝 Скинуться</button>`;
    } else if (gift.is_reusable) {
      primaryBtnHtml = isReusableMine
        ? `<button type="button" class="action-btn btn-guest-unbook" onclick="toggleBookSingleGift(${gift.id})">Отменить участие</button>`
        : `<button type="button" class="action-btn btn-guest-book" onclick="toggleBookSingleGift(${gift.id})">🎁 Я подарю</button>`;
    } else if (gift.booked_by === null) {
      primaryBtnHtml = `
        <button type="button" class="action-btn btn-guest-book" onclick="toggleBookSingleGift(${gift.id})">
          🎁 Я подарю
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
          🔒 Забронировано
        </button>
      `;
    }

    const isCopied = state.copiedGiftIds.has(gift.id);
    const isCopying = state.copyingGiftIds.has(gift.id);
    const copyBtnHtml = isCopied
      ? `<button type="button" class="action-btn btn-guest-copy copied" disabled>✓ В вашем списке</button>`
      : `<button type="button" class="action-btn btn-guest-copy" ${isCopying ? "disabled" : ""} onclick="copyGiftToOwnWishlist(${gift.id})">${isCopying ? "Добавляем..." : "➕ Добавить себе"}</button>`;

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
          <span class="glass-pill pill-category">${catStyle.emoji} ${safeCategory}</span>
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
                  <span>↗</span>
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

function showToast(message) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast-item";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    toast.style.transition = "all 0.22s ease";
    setTimeout(() => toast.remove(), 240);
  }, 2800);
}

window.addEventListener("DOMContentLoaded", () => {
  if (!isTelegramSession && !isBrowserDemo) {
    const sharedOwnerId = parsePositiveId(queryListParam);
    const sharedOccasionId = parseOccasionId(queryOccasionParam);
    let startQuery = "";
    if (sharedOwnerId && sharedOccasionId) {
      startQuery = `?start=list_${sharedOwnerId}_${sharedOccasionId}`;
    } else if (sharedOwnerId) {
      startQuery = `?start=list_${sharedOwnerId}`;
    }
    window.location.replace(`https://t.me/testpmvbot_bot${startQuery}`);
    return;
  }

  if (tg?.colorScheme === "light") {
    setThemePreset("light", true);
  }

  const demoDock = document.querySelector(".demo-dock-wrapper");
  if (demoDock) demoDock.style.display = isTelegramSession ? "none" : "";

  setDesire("add", "medium");
  setDesire("edit", "medium");
  renderTagEditor("add");
  renderTagEditor("edit");
  renderAudienceEditor("add");
  renderAudienceEditor("edit");
  renderOccasionEditor("add");
  renderOccasionEditor("edit");
  updateWorkspaceNav();
  if (!isTelegramSession && state.ownerId !== state.viewerId) {
    switchDemoRole("guest1");
  }
  fetchGifts().then(() => {
    loadParticipations(true);
    loadSocial();
  });
  loadBotConfig();
});
