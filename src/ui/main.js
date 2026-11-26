import { hydrateDataIcons } from "./icons.js";
import {
  API_ORIGIN,
  tg,
  STORAGE_KEY,
  isTelegramSession,
  isBrowserDemo,
  telegramViewerUsername,
  queryListParam,
  queryOccasionParam,
  state,
  parsePositiveId,
  parseOccasionId,
  handleFileSelect,
  handleImageUrlInput,
  clearPhoto,
  switchPhotoTab,
  loadBotConfig,
  triggerHaptic,
  showToast
} from "./state.js";
import {
  registerSocialUiHooks,
  loadSocial,
  handleCreateGroupSubmit,
  openRenameGroupModal,
  closeRenameGroupModal,
  handleRenameGroupSubmit,
  requestDeleteGroup,
  closeDeleteGroupModal,
  confirmDeleteGroup,
  handleSubscribeSubmit,
  handleGroupAddSubmit,
  unsubscribeUser,
  removeGroupMember,
  toggleCurrentWishlistSubscription,
  openBotForSelection,
  renderSocial,
  renderAudienceEditor,
  toggleGiftAudience,
  renderOccasionEditor,
  toggleGiftOccasion,
  quickCreateOccasionInForm,
  selectOccasionFilter,
  clearOccasionFilter,
  openOccasionManagerModal,
  closeOccasionManagerModal,
  handleCreateOccasionModalSubmit,
  deleteOccasion,
  openShareModal,
  closeShareModal,
  selectShareOccasion,
  copyShareLinkOnly,
  confirmShareWishlist
} from "./wishlist-social.js";
import {
  registerWishlistHooks,
  applyServerData,
  fetchGifts,
  mutateGifts,
  copyGiftToOwnWishlist,
  setDesire,
  renderTagEditor,
  removeTagByIndex,
  toggleTag,
  addCustomTag,
  handleTagKeydown,
  syncMutualExclusiveToggle,
  toggleAddDetails,
  selectPresetCategory,
  syncCategoryChipHighlight,
  handleAddGiftSubmit,
  openEditModal,
  closeEditModal,
  handleEditGiftSubmit,
  requestDeleteGift,
  closeDeleteConfirm,
  handleBackdropClick,
  toggleGiftArchive,
  toggleBookSingleGift,
  toggleCrowdfundJoin,
  openStoreLink,
  copyToClipboard,
  returnToOwnWishlist,
  updateWorkspaceNav,
  showWishlistWorkspace,
  showParticipations,
  showFriends,
  canDemoViewerAccessGift,
  cleanupDemoAudience,
  getDemoParticipationItems,
  loadParticipations,
  renderParticipations,
  openParticipatingWishlist,
  switchTab,
  toggleOnlyFreeFilter,
  setPriceFilter,
  setCategoryFilter,
  resetAllFilters,
  switchDemoRole,
  setThemePreset,
  previewSkeletons,
  resetDemoData,
  renderAll
} from "./wishlist-render.js";
import {
  registerHubHooks,
  getSuperappState,
  renderSuperappHub,
  openSuperappHub,
  selectSuperappModule,
  toggleHubTheme,
  openSbpProfileModal,
  closeSbpProfileModal,
  syncCoreProfileFromServer,
  handleSaveSuperappProfile
} from "./hub.js";
import {
  registerExpensesStateHooks,
  getExpensesState,
  loadExpensesDashboard,
  loadExpensesContacts,
  openExpenseEvent,
  backToExpensesDashboard,
  switchExpenseEventTab,
  switchSettleSubView
} from "./expenses-state.js";
import {
  renderExpensesModule,
  toggleGraphNodeFocus
} from "./expenses-views.js";
import {
  openExpenseOperationModal,
  closeExpenseOperationModal,
  setDraftOperationType,
  setDraftOperationCategory,
  setDraftOperationCurrency,
  toggleDraftOperationPayer,
  setDraftOperationSplitMode,
  toggleDraftSplitMember,
  addDraftReceiptItem,
  removeDraftReceiptItem,
  toggleDraftReceiptItemMember,
  refreshOperationSplitPreview,
  submitExpenseOperation,
  deleteCurrentExpenseOperation,
  openNewEventModal,
  closeNewEventModal,
  selectNewEventIcon,
  syncNewEventDateClearBtn,
  clearNewEventDate,
  renderNewEventMembersSection,
  refreshExpensesContacts,
  toggleDraftNewEventContact,
  removeDraftNewEventMember,
  addDraftNewEventMemberByUsername,
  requestTelegramContactForExpenses,
  handleCreateExpenseEventSubmit,
  openEditEventModal,
  closeEditEventModal,
  selectEditEventIcon,
  clearEditEventDate,
  renderEditEventModal,
  handleEditExpenseEventSubmit,
  openEventParticipantsModal,
  closeEventParticipantsModal,
  renderEventParticipantsModal,
  toggleMergeMemberSelection,
  handleAddRealMemberSubmit,
  addRealMemberToCurrentEvent,
  adjustMemberWeight,
  removeExpenseMember,
  mergeSelectedIntoUnifiedWallet,
  unmergeUnifiedWallet,
  openExpenseEventMenuModal,
  closeExpenseEventMenuModal,
  toggleEventSimplifyDebts,
  toggleExpenseEventFreeze,
  toggleExpenseEventArchive,
  openEventInviteShareModal,
  copyExpenseInviteLink,
  closeClaimProfileModal,
  checkPendingExpenseInvite,
  submitClaimExpenseProfile,
  openEdgeSettleModal,
  openCrossPersonSettleModal,
  sendDebtReminder,
  closeSettleTransferModal,
  toggleSettleItemCheckbox,
  setSettlePaymentMethod,
  submitSettlePayment,
  confirmIncomingSettlement,
  rejectIncomingSettlement,
  cancelPendingSettlement
} from "./expenses-modals.js";

registerSocialUiHooks({
  renderAll,
  updateWorkspaceNav,
  mutateGifts,
  fetchGifts,
  openParticipatingWishlist,
  cleanupDemoAudience,
  getDemoParticipationItems,
  copyToClipboard
});

registerWishlistHooks({
  renderSuperappHub
});

registerHubHooks({
  loadExpensesDashboard
});

registerExpensesStateHooks({
  renderExpensesModule
});

Object.assign(window, {
  state,
  STORAGE_KEY,
  isTelegramSession,
  handleFileSelect,
  handleImageUrlInput,
  clearPhoto,
  switchPhotoTab,
  loadSocial,
  handleCreateGroupSubmit,
  openRenameGroupModal,
  closeRenameGroupModal,
  handleRenameGroupSubmit,
  requestDeleteGroup,
  closeDeleteGroupModal,
  confirmDeleteGroup,
  handleSubscribeSubmit,
  handleGroupAddSubmit,
  unsubscribeUser,
  removeGroupMember,
  toggleCurrentWishlistSubscription,
  openBotForSelection,
  renderSocial,
  renderAudienceEditor,
  toggleGiftAudience,
  renderOccasionEditor,
  toggleGiftOccasion,
  quickCreateOccasionInForm,
  selectOccasionFilter,
  clearOccasionFilter,
  openOccasionManagerModal,
  closeOccasionManagerModal,
  handleCreateOccasionModalSubmit,
  deleteOccasion,
  openShareModal,
  closeShareModal,
  selectShareOccasion,
  copyShareLinkOnly,
  confirmShareWishlist,
  applyServerData,
  fetchGifts,
  mutateGifts,
  copyGiftToOwnWishlist,
  setDesire,
  renderTagEditor,
  removeTagByIndex,
  toggleTag,
  addCustomTag,
  handleTagKeydown,
  syncMutualExclusiveToggle,
  toggleAddDetails,
  selectPresetCategory,
  syncCategoryChipHighlight,
  handleAddGiftSubmit,
  openEditModal,
  closeEditModal,
  handleEditGiftSubmit,
  requestDeleteGift,
  closeDeleteConfirm,
  handleBackdropClick,
  toggleGiftArchive,
  toggleBookSingleGift,
  toggleCrowdfundJoin,
  openStoreLink,
  copyToClipboard,
  returnToOwnWishlist,
  updateWorkspaceNav,
  showWishlistWorkspace,
  showParticipations,
  showFriends,
  canDemoViewerAccessGift,
  cleanupDemoAudience,
  getDemoParticipationItems,
  loadParticipations,
  renderParticipations,
  openParticipatingWishlist,
  switchTab,
  toggleOnlyFreeFilter,
  setPriceFilter,
  setCategoryFilter,
  resetAllFilters,
  switchDemoRole,
  setThemePreset,
  previewSkeletons,
  resetDemoData,
  renderAll,
  getSuperappState,
  renderSuperappHub,
  openSuperappHub,
  selectSuperappModule,
  toggleHubTheme,
  openSbpProfileModal,
  closeSbpProfileModal,
  syncCoreProfileFromServer,
  handleSaveSuperappProfile,
  getExpensesState,
  loadExpensesDashboard,
  loadExpensesContacts,
  openExpenseEvent,
  backToExpensesDashboard,
  switchExpenseEventTab,
  switchSettleSubView,
  renderExpensesModule,
  toggleGraphNodeFocus,
  openExpenseOperationModal,
  closeExpenseOperationModal,
  setDraftOperationType,
  setDraftOperationCategory,
  setDraftOperationCurrency,
  toggleDraftOperationPayer,
  setDraftOperationSplitMode,
  toggleDraftSplitMember,
  addDraftReceiptItem,
  removeDraftReceiptItem,
  toggleDraftReceiptItemMember,
  refreshOperationSplitPreview,
  submitExpenseOperation,
  deleteCurrentExpenseOperation,
  openNewEventModal,
  closeNewEventModal,
  selectNewEventIcon,
  syncNewEventDateClearBtn,
  clearNewEventDate,
  refreshExpensesContacts,
  toggleDraftNewEventContact,
  removeDraftNewEventMember,
  addDraftNewEventMemberByUsername,
  requestTelegramContactForExpenses,
  handleCreateExpenseEventSubmit,
  openEditEventModal,
  closeEditEventModal,
  selectEditEventIcon,
  clearEditEventDate,
  handleEditExpenseEventSubmit,
  openEventParticipantsModal,
  closeEventParticipantsModal,
  toggleMergeMemberSelection,
  handleAddRealMemberSubmit,
  addRealMemberToCurrentEvent,
  adjustMemberWeight,
  removeExpenseMember,
  mergeSelectedIntoUnifiedWallet,
  unmergeUnifiedWallet,
  openExpenseEventMenuModal,
  closeExpenseEventMenuModal,
  toggleEventSimplifyDebts,
  toggleExpenseEventFreeze,
  toggleExpenseEventArchive,
  openEventInviteShareModal,
  copyExpenseInviteLink,
  closeClaimProfileModal,
  checkPendingExpenseInvite,
  submitClaimExpenseProfile,
  openEdgeSettleModal,
  openCrossPersonSettleModal,
  sendDebtReminder,
  closeSettleTransferModal,
  toggleSettleItemCheckbox,
  setSettlePaymentMethod,
  submitSettlePayment,
  confirmIncomingSettlement,
  rejectIncomingSettlement,
  cancelPendingSettlement
});

document.getElementById("confirmDeleteBtn")?.addEventListener("click", async () => {
  if (!state.pendingDeleteId) return;
  const id = state.pendingDeleteId;
  closeDeleteConfirm();
  const ok = await mutateGifts("delete", { id });
  if (ok) {
    triggerHaptic("light");
    showToast("Подарок удалён из списка");
  }
});

window.addEventListener("DOMContentLoaded", () => {
  if (!isTelegramSession && !isBrowserDemo) {
    const params = new URLSearchParams(window.location.search);
    const hasExplicitScreen = Boolean(params.get("module") || params.get("invite"));
    if (!hasExplicitScreen) {
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
  }

  hydrateDataIcons();

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

  renderSuperappHub();
  if (isTelegramSession && API_ORIGIN) {
    syncCoreProfileFromServer();
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      const exp = getExpensesState();
      if (!exp.pendingSelectionContext) return;
      const ctx = exp.pendingSelectionContext;
      await loadExpensesContacts(true);
      if (ctx.mode === "new_event" && document.getElementById("newEventModalBackdrop")?.classList.contains("open")) {
        renderNewEventMembersSection();
      } else if (ctx.mode === "event" && exp.currentEvent?.id === ctx.eventId) {
        exp.pendingSelectionContext = null;
        await openExpenseEvent(ctx.eventId);
        if (document.getElementById("eventParticipantsModalBackdrop")?.classList.contains("open")) {
          renderEventParticipantsModal();
        }
        if (document.getElementById("editEventModalBackdrop")?.classList.contains("open")) {
          renderEditEventModal();
        }
      }
    });
  }
  loadExpensesDashboard();
  checkPendingExpenseInvite();
});
