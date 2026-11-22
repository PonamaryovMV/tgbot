/**
 * Модуль главного меню супераппа и профиля СБП (Этап 1).
 * В меню два раздела: «Вишлисты» (переводит в интерфейс вишлиста)
 * и «Совместные расходы» (пока заглушка, не открывает рабочий раздел).
 */
const SUPERAPP_PROFILE_STORAGE_KEY = "tg_superapp_profile_v1";
const SUPERAPP_ACTIVE_MODULE_KEY = "tg_superapp_active_module_v1";

function getDefaultSuperappProfile() {
  const defaultName = typeof isTelegramSession !== "undefined" && isTelegramSession
    ? (typeof telegramViewerName !== "undefined" ? telegramViewerName : "Пользователь")
    : (typeof DEMO_USERS !== "undefined" ? DEMO_USERS.owner.name : "Максим");
  const defaultUsername = typeof isTelegramSession !== "undefined" && isTelegramSession
    ? (typeof telegramViewerUsername !== "undefined" ? telegramViewerUsername : "")
    : (typeof DEMO_USERS !== "undefined" ? DEMO_USERS.owner.username : "maxim");

  return {
    display_name: defaultName,
    username: defaultUsername,
    payment_phone: "",
    preferred_banks: [],
    default_currency: "RUB"
  };
}

function loadLocalSuperappProfile() {
  const fallback = getDefaultSuperappProfile();
  try {
    const raw = localStorage.getItem(SUPERAPP_PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      display_name: String(parsed?.display_name || fallback.display_name).trim() || fallback.display_name,
      username: String(parsed?.username || fallback.username).replace(/^@+/, ""),
      payment_phone: String(parsed?.payment_phone || "").trim(),
      preferred_banks: Array.isArray(parsed?.preferred_banks)
        ? parsed.preferred_banks.map(b => String(b || "").trim()).filter(Boolean)
        : [],
      default_currency: ["RUB", "USD", "EUR", "KZT", "TRY"].includes(String(parsed?.default_currency || "").toUpperCase())
        ? String(parsed.default_currency).toUpperCase()
        : "RUB"
    };
  } catch {
    return fallback;
  }
}

function saveLocalSuperappProfile(profile) {
  try {
    localStorage.setItem(SUPERAPP_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Игнорируем ошибку квоты хранилища
  }
}

function getSuperappState() {
  if (!state.superapp) {
    state.superapp = {
      activeModule: "wishlist",
      profile: loadLocalSuperappProfile(),
      savingProfile: false
    };
  }
  try {
    localStorage.setItem(SUPERAPP_ACTIVE_MODULE_KEY, "wishlist");
  } catch {}
  return state.superapp;
}

function parseBanksInput(rawText) {
  const parts = String(rawText || "")
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const part of parts) {
    const trimmed = part.slice(0, 40);
    const key = trimmed.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
    if (unique.length >= 10) break;
  }
  return unique;
}

function renderSuperappHub() {
  const hub = getSuperappState();
  const profile = hub.profile;

  const nameInput = document.getElementById("hubDisplayNameInput");
  const phoneInput = document.getElementById("hubPaymentPhoneInput");
  const banksInput = document.getElementById("hubPreferredBanksInput");
  const currencySelect = document.getElementById("hubDefaultCurrencySelect");
  const sbpPreview = document.getElementById("hubSbpSummaryBadge");

  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = profile.display_name || "";
  }
  if (phoneInput && document.activeElement !== phoneInput) {
    phoneInput.value = profile.payment_phone || "";
  }
  if (banksInput && document.activeElement !== banksInput) {
    banksInput.value = (profile.preferred_banks || []).join(", ");
  }
  if (currencySelect) {
    currencySelect.value = profile.default_currency || "RUB";
  }
  if (sbpPreview) {
    const banksText = (profile.preferred_banks || []).length
      ? profile.preferred_banks.join(", ")
      : "банки не указаны";
    sbpPreview.textContent = profile.payment_phone
      ? `СБП: ${profile.payment_phone} · ${banksText}`
      : "Реквизиты СБП не заполнены";
  }

  const wishlistCard = document.getElementById("hubModuleWishlistBtn");
  const expensesCard = document.getElementById("hubModuleExpensesBtn");
  if (wishlistCard) wishlistCard.classList.add("active");
  if (expensesCard) {
    expensesCard.classList.remove("active");
    expensesCard.setAttribute("aria-disabled", "true");
  }

  const expensesHubSection = document.getElementById("expensesStage1Section");
  if (expensesHubSection) expensesHubSection.hidden = true;
  if (typeof updateWorkspaceNav === "function") updateWorkspaceNav();
}

function focusWishlistMenu() {
  if (typeof showWishlistWorkspace === "function") {
    showWishlistWorkspace();
  }
  const navEl = document.querySelector(".workspace-nav");
  if (navEl && typeof navEl.scrollIntoView === "function") {
    navEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function selectSuperappModule(moduleName) {
  const hub = getSuperappState();
  hub.activeModule = "wishlist";
  if (typeof triggerHaptic === "function") triggerHaptic("light");

  if (moduleName === "wishlist") {
    renderSuperappHub();
    focusWishlistMenu();
    return;
  }

  renderSuperappHub();
  if (typeof showToast === "function") {
    showToast("⏳ Раздел «Совместные расходы» пока в разработке");
  }
}

async function syncCoreProfileFromServer() {
  if (typeof isTelegramSession === "undefined" || !isTelegramSession || typeof API_ORIGIN === "undefined" || !API_ORIGIN) {
    return;
  }
  const hub = getSuperappState();
  try {
    const response = await fetch(`${API_ORIGIN}/api/core/bootstrap`, {
      headers: typeof getAuthHeaders === "function" ? getAuthHeaders() : {}
    });
    if (!response.ok) return;
    const data = await response.json().catch(() => null);
    if (data?.user) {
      hub.profile = {
        display_name: String(data.user.display_name || hub.profile.display_name).trim(),
        username: String(data.user.username || hub.profile.username).replace(/^@+/, ""),
        payment_phone: String(data.user.payment_phone || "").trim(),
        preferred_banks: Array.isArray(data.user.preferred_banks) ? data.user.preferred_banks : [],
        default_currency: String(data.user.default_currency || "RUB").toUpperCase()
      };
      saveLocalSuperappProfile(hub.profile);
      renderSuperappHub();
    }
  } catch {
    // Сохраняем локальные данные при недоступности сети
  }
}

async function handleSaveSuperappProfile(event) {
  event.preventDefault();
  const hub = getSuperappState();
  const displayName = String(document.getElementById("hubDisplayNameInput")?.value || "").trim();
  const paymentPhone = String(document.getElementById("hubPaymentPhoneInput")?.value || "").trim();
  const preferredBanks = parseBanksInput(document.getElementById("hubPreferredBanksInput")?.value || "");
  const defaultCurrency = String(document.getElementById("hubDefaultCurrencySelect")?.value || "RUB").toUpperCase();

  if (paymentPhone && !/^\+?\d[\d\s()-]{6,22}\d$/.test(paymentPhone)) {
    if (typeof showToast === "function") showToast("⚠️ Укажите корректный номер телефона для СБП");
    return;
  }

  const nextProfile = {
    ...hub.profile,
    display_name: displayName || hub.profile.display_name || "Пользователь",
    payment_phone: paymentPhone,
    preferred_banks: preferredBanks,
    default_currency: ["RUB", "USD", "EUR", "KZT", "TRY"].includes(defaultCurrency) ? defaultCurrency : "RUB"
  };

  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    hub.savingProfile = true;
    try {
      const response = await fetch(`${API_ORIGIN}/api/core/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {})
        },
        body: JSON.stringify(nextProfile)
      });
      const data = await (typeof readApiResponse === "function" ? readApiResponse(response) : response.json());
      if (data?.user) {
        hub.profile = {
          ...nextProfile,
          display_name: String(data.user.display_name || nextProfile.display_name),
          payment_phone: String(data.user.payment_phone || nextProfile.payment_phone),
          preferred_banks: Array.isArray(data.user.preferred_banks) ? data.user.preferred_banks : nextProfile.preferred_banks,
          default_currency: String(data.user.default_currency || nextProfile.default_currency)
        };
      } else {
        hub.profile = nextProfile;
      }
    } catch (error) {
      if (typeof showToast === "function") showToast(`❌ ${error.message || "Не удалось сохранить профиль"}`);
      hub.savingProfile = false;
      return;
    }
    hub.savingProfile = false;
  } else {
    hub.profile = nextProfile;
  }

  saveLocalSuperappProfile(hub.profile);
  renderSuperappHub();
  if (typeof triggerHaptic === "function") triggerHaptic("success");
  if (typeof showToast === "function") showToast("✓ Профиль и реквизиты СБП сохранены");
}

window.addEventListener("DOMContentLoaded", () => {
  renderSuperappHub();
  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    syncCoreProfileFromServer();
  }
});
