import {
  API_ORIGIN,
  tg,
  isTelegramSession,
  DEMO_USERS,
  state,
  parsePositiveId,
  getEmptyGroups,
  escapeHtml,
  triggerHaptic,
  showToast,
  readApiResponse,
  loadBotConfig,
  saveLocalGifts
} from "./state.js";
import { renderIcon } from "./icons.js";

const uiHooks = {
  renderAll: () => {},
  updateWorkspaceNav: () => {},
  mutateGifts: async () => false,
  fetchGifts: async () => {},
  openParticipatingWishlist: async () => {},
  cleanupDemoAudience: () => {},
  getDemoParticipationItems: () => [],
  copyToClipboard: async () => false
};

export function registerSocialUiHooks(hooks) {
  Object.assign(uiHooks, hooks);
}

export function normalizeGroups(groups, previousGroups = []) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return getEmptyGroups();
  }
  return groups.map(source => {
    const id = String(source?.id || "").trim();
    const previous = previousGroups.find(group => group?.id === id) || {};
    const sourceMembers = Array.isArray(source?.members) ? source.members : null;
    const memberIds = Array.isArray(source?.memberIds)
      ? source.memberIds.map(parsePositiveId).filter(Boolean)
      : (sourceMembers || []).map(member => parsePositiveId(member?.id)).filter(Boolean);
    const previousMembers = Array.isArray(previous.members) ? previous.members : [];
    const members = sourceMembers || memberIds.map(memberId => {
      const profile = previousMembers.find(member => parsePositiveId(member?.id) === memberId);
      return profile || { id: memberId, first_name: "Пользователь", username: "" };
    });
    return {
      id,
      name: String(source?.name || previous.name || id),
      memberIds: [...new Set(memberIds)],
      members: members.filter(member => memberIds.includes(parsePositiveId(member?.id)))
    };
  }).filter(group => group.id);
}

export function applySocialData(data) {
  state.subscriptions = (Array.isArray(data.subscriptions) ? data.subscriptions : [])
    .map(profile => ({
      id: parsePositiveId(profile?.id),
      first_name: String(profile?.first_name || "Пользователь"),
      username: String(profile?.username || "").replace(/^@/, "")
    }))
    .filter(profile => profile.id);
  state.groups = normalizeGroups(data.groups, state.groups);
  const validGroupIds = new Set(state.groups.map(group => group.id));
  state.groupDraft.add = state.groupDraft.add.filter(id => validGroupIds.has(id));
  state.groupDraft.edit = state.groupDraft.edit.filter(id => validGroupIds.has(id));
  if (state.ownerId !== state.viewerId) {
    state.isSubscribed = state.subscriptions.some(profile => profile.id === state.ownerId);
  }
  state.socialError = "";
  const helpBox = document.getElementById("selectionHelp");
  if (helpBox) helpBox.hidden = true;
  renderAudienceEditor("add");
  renderAudienceEditor("edit");
  uiHooks.updateWorkspaceNav();
}

export async function loadSocial() {
  state.socialLoading = true;
  state.socialError = "";
  if (state.activeWorkspace === "friends") renderSocial();
  try {
    if (isTelegramSession) {
      if (!API_ORIGIN) throw new Error("Не указан адрес Cloudflare Worker");
      const response = await fetch(`${API_ORIGIN}/api/social`, {
        headers: { "X-Telegram-Init-Data": tg?.initData || "" }
      });
      applySocialData(await readApiResponse(response));
    }
  } catch (error) {
    state.socialError = error.message || "Не удалось загрузить друзей и группы";
  } finally {
    state.socialLoading = false;
    uiHooks.updateWorkspaceNav();
    if (state.activeWorkspace === "friends") renderSocial();
  }
}

function findDemoProfileByUsername(username) {
  const normalized = String(username || "").trim().replace(/^@+/, "").toLowerCase();
  const user = Object.values(DEMO_USERS).find(item => item.username === normalized);
  return user ? { id: user.id, first_name: user.name, username: user.username } : null;
}

export async function mutateDemoSocial(action, payload) {
  let profile = null;
  if (action === "create_group") {
    const name = String(payload.name || "").trim().slice(0, 32);
    if (!name) throw new Error("Введите название группы");
    if (state.groups.length >= 20) throw new Error("Достигнут лимит в 20 групп");
    const dup = state.groups.some(g => g.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
    if (dup) throw new Error("Группа с таким названием уже существует");
    const id = `grp_${Math.random().toString(16).slice(2, 10)}`;
    state.groups.push({ id, name, memberIds: [], members: [] });
  } else if (action === "rename_group") {
    const group = state.groups.find(item => item.id === payload.group_id);
    if (!group) throw new Error("Группа не найдена");
    const name = String(payload.name || "").trim().slice(0, 32);
    if (!name) throw new Error("Введите название группы");
    const dup = state.groups.some(g => g.id !== group.id && g.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
    if (dup) throw new Error("Группа с таким названием уже существует");
    group.name = name;
  } else if (action === "delete_group") {
    const groupId = String(payload.group_id || "");
    state.groups = state.groups.filter(item => item.id !== groupId);
    state.gifts = state.gifts.map(gift => ({
      ...gift,
      group_ids: Array.isArray(gift.group_ids) ? gift.group_ids.filter(id => id !== groupId) : []
    }));
    state.groupDraft.add = state.groupDraft.add.filter(id => id !== groupId);
    state.groupDraft.edit = state.groupDraft.edit.filter(id => id !== groupId);
    uiHooks.cleanupDemoAudience();
    saveLocalGifts();
    state.participations = uiHooks.getDemoParticipationItems();
  } else if (action === "subscribe") {
    profile = payload.user_id
      ? { id: DEMO_USERS.owner.id, first_name: DEMO_USERS.owner.name, username: DEMO_USERS.owner.username }
      : findDemoProfileByUsername(payload.username);
    if (!profile) throw new Error("В демо доступны @maxim, @anna1 и @dima1");
    if (profile.id === state.viewerId) throw new Error("Нельзя подписаться на самого себя");
    if (!state.subscriptions.some(item => item.id === profile.id)) state.subscriptions.unshift(profile);
  } else if (action === "unsubscribe") {
    state.subscriptions = state.subscriptions.filter(item => item.id !== Number(payload.user_id));
  } else if (action === "add_group_member") {
    profile = findDemoProfileByUsername(payload.username);
    if (!profile) throw new Error("В демо доступны @maxim, @anna1 и @dima1");
    const group = state.groups.find(item => item.id === payload.group_id);
    if (!group) throw new Error("Группа не найдена");
    if (!group.memberIds.includes(profile.id)) {
      group.memberIds.push(profile.id);
      group.members.push(profile);
    }
  } else if (action === "remove_group_member") {
    const group = state.groups.find(item => item.id === payload.group_id);
    if (group) {
      group.memberIds = group.memberIds.filter(id => id !== Number(payload.user_id));
      group.members = group.members.filter(member => member.id !== Number(payload.user_id));
    }
    uiHooks.cleanupDemoAudience();
    saveLocalGifts();
    state.participations = uiHooks.getDemoParticipationItems();
  }
  if (state.ownerId !== state.viewerId) {
    state.isSubscribed = state.subscriptions.some(profileItem => profileItem.id === state.ownerId);
  }
  uiHooks.updateWorkspaceNav();
  renderAudienceEditor("add");
  renderAudienceEditor("edit");
  return { status: "ok" };
}

export async function socialMutate(action, payload) {
  if (!isTelegramSession) {
    try {
      const result = await mutateDemoSocial(action, payload);
      if (state.activeWorkspace === "friends") renderSocial();
      return result;
    } catch (error) {
      showToast(error.message);
      return { status: "error" };
    }
  }

  try {
    const response = await fetch(`${API_ORIGIN}/api/social`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg?.initData || ""
      },
      body: JSON.stringify({ action, payload })
    });
    const data = await readApiResponse(response);
    if (data.status === "selection_required") {
      state.selectionBotUsername = String(data.botUsername || state.botUsername || "").replace(/^@/, "");
      const helpEl = document.getElementById("selectionHelp");
      if (helpEl) helpEl.hidden = false;
      showToast("Выберите человека в сообщении от бота");
      return { status: "selection_required" };
    }
    applySocialData(data);
    if (state.activeWorkspace === "friends") renderSocial();
    return { status: "ok" };
  } catch (error) {
    showToast(error.message || "Не удалось изменить данные");
    return { status: "error" };
  }
}

export async function handleCreateGroupSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("newGroupNameInput");
  const name = String(input?.value || "").trim();
  if (!name) return;
  const result = await socialMutate("create_group", { name });
  if (result.status === "ok") {
    if (input) input.value = "";
    showToast(`Группа «${name}» создана`);
    triggerHaptic("success");
  }
}

export function openRenameGroupModal(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return;
  state.renamingGroupId = groupId;
  const input = document.getElementById("renameGroupInput");
  if (input) input.value = group.name;
  document.getElementById("renameGroupModalBackdrop")?.classList.add("open");
  setTimeout(() => input?.focus(), 50);
  triggerHaptic("light");
}

export function closeRenameGroupModal() {
  state.renamingGroupId = null;
  document.getElementById("renameGroupModalBackdrop")?.classList.remove("open");
}

export async function handleRenameGroupSubmit(event) {
  event.preventDefault();
  if (!state.renamingGroupId) return;
  const name = String(document.getElementById("renameGroupInput")?.value || "").trim();
  if (!name) return;
  const groupId = state.renamingGroupId;
  const result = await socialMutate("rename_group", { group_id: groupId, name });
  if (result.status === "ok") {
    closeRenameGroupModal();
    uiHooks.renderAll();
    showToast("Группа переименована");
    triggerHaptic("success");
  }
}

export function requestDeleteGroup(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return;
  state.pendingDeleteGroupId = groupId;
  const exclusiveGiftsCount = state.gifts.filter(gift => {
    const ids = Array.isArray(gift.group_ids) ? gift.group_ids : [];
    return ids.length === 1 && ids[0] === groupId;
  }).length;

  const warningText = exclusiveGiftsCount > 0
    ? `Группа «${group.name}» будет удалена. Внимание: для ${exclusiveGiftsCount} желаний это единственная группа видимости — после удаления они станут общими и будут видны всем.`
    : `Группа «${group.name}» будет удалена, а её привязка к подаркам снята.`;

  const dialogText = document.getElementById("deleteGroupDialogText");
  if (dialogText) dialogText.textContent = warningText;
  document.getElementById("deleteGroupModalBackdrop")?.classList.add("open");
  triggerHaptic("warning");
}

export function closeDeleteGroupModal() {
  state.pendingDeleteGroupId = null;
  document.getElementById("deleteGroupModalBackdrop")?.classList.remove("open");
}

export async function confirmDeleteGroup() {
  if (!state.pendingDeleteGroupId) return;
  const groupId = state.pendingDeleteGroupId;
  closeDeleteGroupModal();
  const result = await socialMutate("delete_group", { group_id: groupId });
  if (result.status === "ok") {
    if (isTelegramSession && state.ownerId === state.viewerId) {
      await uiHooks.fetchGifts();
    } else {
      uiHooks.renderAll();
    }
    showToast("Группа удалена");
    triggerHaptic("light");
  }
}

function validateUsernameInput(value) {
  const username = String(value || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    showToast("Введите корректный @username Telegram");
    return "";
  }
  return username;
}

export async function handleSubscribeSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("subscribeUsernameInput");
  const button = document.getElementById("subscribeSubmitBtn");
  const username = validateUsernameInput(input?.value || "");
  if (!username) return;
  if (button) button.disabled = true;
  const result = await socialMutate("subscribe", { username });
  if (button) button.disabled = false;
  if (result.status === "ok") {
    if (input) input.value = "";
    showToast("Вишлист добавлен в подписки");
    triggerHaptic("success");
  }
}

export async function handleGroupAddSubmit(event, groupId) {
  event.preventDefault();
  const input = document.getElementById(`groupUsername_${groupId}`);
  const username = validateUsernameInput(input?.value || "");
  if (!username) return;
  const result = await socialMutate("add_group_member", { group_id: groupId, username });
  if (result.status === "ok") {
    if (input) input.value = "";
    showToast("Пользователь добавлен в группу");
    triggerHaptic("success");
  }
}

export async function unsubscribeUser(userId) {
  const result = await socialMutate("unsubscribe", { user_id: userId });
  if (result.status === "ok") showToast("Подписка удалена");
}

export async function removeGroupMember(groupId, userId) {
  const result = await socialMutate("remove_group_member", { group_id: groupId, user_id: userId });
  if (result.status === "ok") {
    showToast("Пользователь удалён из группы; его недоступные брони отменены");
    if (state.ownerId === state.viewerId) await uiHooks.fetchGifts();
  }
}

export async function toggleCurrentWishlistSubscription() {
  if (state.ownerId === state.viewerId) return;
  const wasSubscribed = state.isSubscribed;
  const button = document.getElementById("subscribeListBtn");
  if (button) button.disabled = true;
  const result = await socialMutate(
    wasSubscribed ? "unsubscribe" : "subscribe",
    { user_id: state.ownerId }
  );
  if (button) button.disabled = false;
  if (result.status === "ok") {
    state.isSubscribed = !wasSubscribed;
    uiHooks.renderAll();
    if (state.activeWorkspace === "friends") renderSocial();
    showToast(wasSubscribed ? "Подписка удалена" : "Вы подписались на этот вишлист");
    triggerHaptic("success");
  }
}

export async function openBotForSelection() {
  if (!isTelegramSession) {
    showToast("Выбор реального пользователя доступен после открытия приложения через @testpmvbot_bot.");
    return;
  }
  let username = state.selectionBotUsername || state.botUsername;
  if (!username && isTelegramSession) {
    await loadBotConfig();
    username = state.botUsername;
  }
  username = String(username || "").replace(/^@/, "");
  if (!username) {
    showToast("Не удалось получить адрес бота");
    return;
  }
  const url = `https://t.me/${username}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function renderSocial() {
  const error = document.getElementById("socialError");
  if (error) {
    error.hidden = !state.socialError;
    error.textContent = state.socialError;
  }
  const list = document.getElementById("subscriptionsList");
  const empty = document.getElementById("subscriptionsEmpty");
  if (empty) {
    empty.hidden = state.subscriptions.length > 0;
    empty.textContent = state.socialLoading
      ? "Загружаем подписки…"
      : "Подписок пока нет. Можно также подписаться кнопкой внутри чужого вишлиста.";
  }

  if (list) {
    list.innerHTML = state.subscriptions.map(profile => {
      const username = profile.username ? `@${escapeHtml(profile.username)}` : "ID сохранён в KV";
      return `
        <div class="social-person-row">
          <div class="social-person-main">
            <div class="social-person-name">${escapeHtml(profile.first_name)}</div>
            <div class="social-person-meta">${username}</div>
          </div>
          <div class="social-person-actions">
            <button type="button" class="btn-glass" onclick="openParticipatingWishlist(${profile.id})">Открыть</button>
            <button type="button" class="btn-glass" onclick="unsubscribeUser(${profile.id})">Отписаться</button>
          </div>
        </div>
      `;
    }).join("");
  }

  const groupsListEl = document.getElementById("groupsList");
  if (groupsListEl) {
    groupsListEl.innerHTML = state.groups.map(group => {
      const safeGroupId = escapeHtml(group.id);
      const membersHtml = group.members.map(member => `
        <div class="social-person-row">
          <div class="social-person-main">
            <div class="social-person-name">${escapeHtml(member.first_name || "Пользователь")}</div>
            <div class="social-person-meta">${member.username ? `@${escapeHtml(member.username)}` : "Telegram ID сохранён"}</div>
          </div>
          <div class="social-person-actions">
            <button type="button" class="btn-glass" onclick="removeGroupMember('${safeGroupId}', ${member.id})">Удалить</button>
          </div>
        </div>
      `).join("");
      return `
        <section class="access-group" data-group-id="${safeGroupId}">
          <div class="access-group-head">
            <div class="access-group-title-wrap">
              <span class="access-group-name">${escapeHtml(group.name)}</span>
              <span class="access-group-count">${group.memberIds.length} чел.</span>
            </div>
            <div class="access-group-tools">
              <button type="button" class="btn-mini" onclick="openRenameGroupModal('${safeGroupId}')">Переименовать</button>
              <button type="button" class="btn-mini danger" onclick="requestDeleteGroup('${safeGroupId}')">Удалить</button>
            </div>
          </div>
          <form class="social-add-form" onsubmit="handleGroupAddSubmit(event, '${safeGroupId}')">
            <input type="text" class="input-modern" id="groupUsername_${safeGroupId}" placeholder="@username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="33" required />
            <button type="submit" class="btn-glass">Добавить</button>
          </form>
          ${membersHtml || '<div class="social-empty">В группе пока никого нет.</div>'}
        </section>
      `;
    }).join("");
  }
}

export function renderAudienceEditor(formPrefix) {
  const container = document.getElementById(`${formPrefix}AudienceControl`);
  const summary = document.getElementById(`${formPrefix}AudienceSummary`);
  if (!container || !summary || !state.groupDraft) return;
  const selected = state.groupDraft[formPrefix];
  const buttons = [{ id: "all", name: "Всем", memberIds: [] }, ...state.groups];
  container.innerHTML = buttons.map(group => {
    const active = group.id === "all" ? selected.length === 0 : selected.includes(group.id);
    const count = group.id === "all" ? "" : `<span class="audience-chip-count">${group.memberIds.length}</span>`;
    return `<button type="button" class="audience-chip ${active ? "active" : ""}" data-group="${escapeHtml(group.id)}" aria-pressed="${active}" onclick="toggleGiftAudience('${formPrefix}', this.dataset.group)">${escapeHtml(group.name)}${count}</button>`;
  }).join("");

  if (selected.length === 0) {
    summary.textContent = "Желание увидят все, кто откроет ваш вишлист.";
  } else {
    const names = state.groups.filter(group => selected.includes(group.id)).map(group => group.name);
    const totalMembers = new Set(state.groups.filter(group => selected.includes(group.id)).flatMap(group => group.memberIds)).size;
    summary.textContent = totalMembers
      ? `Видно только группам: ${names.join(", ")}.`
      : `Выбраны пустые группы: ${names.join(", ")}. Гости не увидят это желание.`;
  }
}

export function toggleGiftAudience(formPrefix, groupId) {
  const selected = state.groupDraft[formPrefix];
  if (groupId === "all") {
    state.groupDraft[formPrefix] = [];
  } else if (state.groups.some(group => group.id === groupId)) {
    state.groupDraft[formPrefix] = selected.includes(groupId)
      ? selected.filter(id => id !== groupId)
      : [...selected, groupId];
  }
  renderAudienceEditor(formPrefix);
  triggerHaptic("light");
}

export function renderOccasionEditor(formPrefix) {
  const container = document.getElementById(`${formPrefix}OccasionControl`);
  if (!container || !state.occasionDraft) return;
  const selected = state.occasionDraft[formPrefix];
  if (state.occasions.length === 0) {
    container.innerHTML = `<span style="font-size: 12px; color: var(--tg-theme-hint-color);">Поводов пока нет — создайте первый ниже</span>`;
    return;
  }
  container.innerHTML = state.occasions.map(occ => {
    const active = selected.includes(occ.id);
    return `<button type="button" class="audience-chip ${active ? "active" : ""}" data-occasion="${escapeHtml(occ.id)}" aria-pressed="${active}" onclick="toggleGiftOccasion('${formPrefix}', this.dataset.occasion)">${renderIcon("target", "app-icon-sm")}<span>${escapeHtml(occ.title)}</span></button>`;
  }).join("");
}

export function toggleGiftOccasion(formPrefix, occasionId) {
  const selected = state.occasionDraft[formPrefix];
  if (!state.occasions.some(item => item.id === occasionId)) return;
  state.occasionDraft[formPrefix] = selected.includes(occasionId)
    ? selected.filter(id => id !== occasionId)
    : [...selected, occasionId];
  renderOccasionEditor(formPrefix);
  triggerHaptic("light");
}

export async function quickCreateOccasionInForm(formPrefix) {
  const input = document.getElementById(`${formPrefix}QuickOccasionInput`);
  const title = String(input?.value || "").trim();
  if (!title) return;
  const beforeIds = new Set(state.occasions.map(item => item.id));
  const ok = await uiHooks.mutateGifts("save_occasion", { title });
  if (ok) {
    if (input) input.value = "";
    const created = state.occasions.find(item => !beforeIds.has(item.id));
    if (created && !state.occasionDraft[formPrefix].includes(created.id)) {
      state.occasionDraft[formPrefix].push(created.id);
    }
    renderOccasionEditor(formPrefix);
    showToast(`Повод «${title}» создан`);
    triggerHaptic("success");
  }
}

export function selectOccasionFilter(occasionId) {
  state.occasionFilter = state.occasionFilter === occasionId ? "all" : occasionId;
  triggerHaptic("light");
  uiHooks.renderAll();
}

export function clearOccasionFilter() {
  state.occasionFilter = "all";
  const url = new URL(window.location.href);
  url.searchParams.delete("occasion");
  window.history.replaceState({}, "", url);
  triggerHaptic("light");
  uiHooks.renderAll();
}

export function openOccasionManagerModal() {
  renderOccasionManagerList();
  document.getElementById("occasionModalBackdrop")?.classList.add("open");
  triggerHaptic("light");
}

export function closeOccasionManagerModal() {
  document.getElementById("occasionModalBackdrop")?.classList.remove("open");
}

export function renderOccasionManagerList() {
  const list = document.getElementById("occasionManagerList");
  if (!list) return;
  if (state.occasions.length === 0) {
    list.innerHTML = `<div class="social-empty">У вас пока нет подборок по поводам.</div>`;
    return;
  }
  list.innerHTML = state.occasions.map(occ => {
    const safeId = escapeHtml(occ.id);
    const safeTitle = escapeHtml(occ.title);
    const count = state.gifts.filter(g => Array.isArray(g.occasion_ids) && g.occasion_ids.includes(occ.id)).length;
    return `
      <div class="social-person-row">
        <div class="social-person-main">
          <div class="social-person-name" style="display:flex;align-items:center;gap:6px;">${renderIcon("target", "app-icon-sm")}<span>${safeTitle}</span></div>
          <div class="social-person-meta">Желаний: ${count}</div>
        </div>
        <div class="social-person-actions">
          <button type="button" class="btn-glass" onclick="deleteOccasion('${safeId}')">Удалить</button>
        </div>
      </div>
    `;
  }).join("");
}

export async function handleCreateOccasionModalSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("newOccasionTitleInput");
  const title = String(input?.value || "").trim();
  if (!title) return;
  const ok = await uiHooks.mutateGifts("save_occasion", { title });
  if (ok) {
    if (input) input.value = "";
    renderOccasionManagerList();
    showToast(`Повод «${title}» добавлен`);
    triggerHaptic("success");
  }
}

export async function deleteOccasion(occasionId) {
  const ok = await uiHooks.mutateGifts("delete_occasion", { id: occasionId });
  if (ok) {
    renderOccasionManagerList();
    showToast("Повод удалён");
    triggerHaptic("light");
  }
}

export async function openShareModal() {
  triggerHaptic("light");
  if (!isTelegramSession) {
    showToast("Это демо-вишлист. Откройте своё приложение через @testpmvbot_bot, чтобы поделиться им.");
    return;
  }
  if (!state.botUsername) await loadBotConfig();
  if (!state.botUsername) {
    showToast("Не удалось получить username бота. Проверьте BOT_TOKEN и Worker.");
    return;
  }

  state.shareOccasionId = state.occasionFilter !== "all" ? state.occasionFilter : "all";
  renderShareOccasionOptions();
  updateShareModalPreview();
  document.getElementById("shareModalBackdrop")?.classList.add("open");
}

export function closeShareModal() {
  document.getElementById("shareModalBackdrop")?.classList.remove("open");
}

export function renderShareOccasionOptions() {
  const container = document.getElementById("shareOccasionOptions");
  if (!container) return;
  const options = [{ id: "all", title: "Весь вишлист" }, ...state.occasions];
  container.innerHTML = options.map(opt => {
    const active = state.shareOccasionId === opt.id;
    return `<button type="button" class="audience-chip ${active ? "active" : ""}" data-share-occ="${escapeHtml(opt.id)}" aria-pressed="${active}" onclick="selectShareOccasion(this.dataset.shareOcc)">${renderIcon(opt.id === "all" ? "gift" : "target", "app-icon-sm")}<span>${escapeHtml(opt.title)}</span></button>`;
  }).join("");
}

export function selectShareOccasion(occasionId) {
  state.shareOccasionId = occasionId;
  renderShareOccasionOptions();
  updateShareModalPreview();
  triggerHaptic("light");
}

export function buildSharePayload() {
  const bot = state.botUsername || "testpmvbot_bot";
  const occ = state.shareOccasionId !== "all"
    ? state.occasions.find(item => item.id === state.shareOccasionId)
    : null;
  const startPayload = occ ? `list_${state.ownerId}_${occ.id}` : `list_${state.ownerId}`;
  const shareUrl = `https://t.me/${bot}?start=${startPayload}`;
  const shareText = occ
    ? `Привет! Загляни в мою подборку подарков «${occ.title}» в Telegram 🎁:`
    : "Привет! Загляни в мой вишлист подарков в Telegram 🎁 Тут можно забронировать подарок или скинуться вместе с друзьями:";
  return { shareUrl, shareText };
}

export function updateShareModalPreview() {
  const preview = document.getElementById("shareUrlPreview");
  if (!preview) return;
  preview.textContent = buildSharePayload().shareUrl;
}

export async function copyShareLinkOnly() {
  const { shareUrl } = buildSharePayload();
  const copied = await uiHooks.copyToClipboard(shareUrl);
  showToast(copied ? "Ссылка скопирована в буфер обмена!" : "Скопируйте ссылку из поля выше");
  triggerHaptic("success");
}

export async function confirmShareWishlist() {
  const { shareUrl, shareText } = buildSharePayload();
  const telegramShareLink = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
  const copied = await uiHooks.copyToClipboard(shareUrl);
  showToast(copied ? "Ссылка скопирована!" : "Откройте меню отправки ссылки");
  closeShareModal();

  if (tg?.openTelegramLink && tg?.initData) {
    try {
      tg.openTelegramLink(telegramShareLink);
    } catch {
      // Ссылка уже скопирована
    }
  }
}
