/**
 * Модуль главного меню супераппа и профиля СБП.
 * Оба раздела («Вишлисты и подарки» и «Совместные расходы») открываются из главного меню
 * или напрямую по параметру запуска бота (?module=wishlist / ?module=expenses).
 */
const SUPERAPP_PROFILE_STORAGE_KEY = "tg_superapp_profile_v1";

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
      default_currency: ["RUB", "USD", "EUR", "KZT", "TRY", "GEL"].includes(String(parsed?.default_currency || "").toUpperCase())
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

function resolveInitialSuperappScreen() {
  const params = new URLSearchParams(window.location.search);
  const explicitModule = String(params.get("module") || "").trim().toLowerCase();
  const rawStartParam = typeof startParam === "string" ? startParam.trim() : "";

  if (explicitModule === "expenses" || rawStartParam === "module_expenses") {
    return "expenses";
  }
  if (explicitModule === "wishlist" || rawStartParam === "module_wishlist") {
    return "wishlist";
  }
  if (explicitModule === "hub") {
    return "hub";
  }
  if ((typeof queryListParam === "string" && queryListParam.trim()) || /^list_\d+/.test(rawStartParam)) {
    return "wishlist";
  }
  if (typeof isBrowserDemo !== "undefined" && isBrowserDemo) {
    return "wishlist";
  }
  return "hub";
}

function getSuperappState() {
  if (!state.superapp) {
    state.superapp = {
      screen: resolveInitialSuperappScreen(),
      profile: loadLocalSuperappProfile(),
      activeEventsCount: 0,
      oweMeMinor: 0,
      iOweMinor: 0,
      savingProfile: false
    };
  }
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

function formatMinorRub(minor, currency = "RUB") {
  const symbols = { RUB: "₽", USD: "$", EUR: "€", KZT: "₸", TRY: "₺", GEL: "₾" };
  const val = Math.round((Number(minor) || 0) / 100);
  return `${new Intl.NumberFormat("ru-RU").format(val)} ${symbols[currency] || currency}`;
}

function computeInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "П";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function renderSuperappHub() {
  const hub = getSuperappState();
  const profile = hub.profile;

  const hubScreen = document.getElementById("superappHubScreen");
  const expensesScreen = document.getElementById("expensesAppShell");
  const wishlistScreen = document.getElementById("wishlistAppShell");

  if (hubScreen) hubScreen.hidden = hub.screen !== "hub";
  if (expensesScreen) expensesScreen.hidden = hub.screen !== "expenses";
  if (wishlistScreen) wishlistScreen.hidden = hub.screen !== "wishlist";

  const initialsEl = document.getElementById("hubUserInitials");
  const userNameEl = document.getElementById("hubUserName");
  const userPhoneSubEl = document.getElementById("hubUserPhoneSub");
  const sbpPreview = document.getElementById("hubSbpSummaryBadge");

  if (initialsEl) initialsEl.textContent = computeInitials(profile.display_name);
  if (userNameEl) userNameEl.textContent = profile.display_name || "Пользователь";
  if (userPhoneSubEl) {
    userPhoneSubEl.textContent = profile.payment_phone || "Телефон для СБП не указан";
  }
  if (sbpPreview) {
    const banksText = (profile.preferred_banks || []).length
      ? profile.preferred_banks.join(", ")
      : "банки не указаны";
    sbpPreview.textContent = profile.payment_phone
      ? `СБП: ${profile.payment_phone} · ${banksText} · ${profile.default_currency || "RUB"}`
      : `Телефон для СБП · банки · ${profile.default_currency || "RUB"}`;
  }

  const activeGiftsCount = Array.isArray(state.gifts)
    ? state.gifts.filter(g => !g.is_gifted).length
    : 0;
  const hubWishlistCountEl = document.getElementById("hubWishlistCount");
  if (hubWishlistCountEl) hubWishlistCountEl.textContent = String(activeGiftsCount);

  const hubExpensesSub = document.getElementById("hubExpensesEventsSub");
  if (hubExpensesSub) {
    const cnt = Number(hub.activeEventsCount) || 0;
    hubExpensesSub.textContent = `${cnt} активных событий`;
  }

  const oweMeFormatted = formatMinorRub(hub.oweMeMinor, profile.default_currency);
  const iOweFormatted = formatMinorRub(hub.iOweMinor, profile.default_currency);
  const hubOweMeEl = document.getElementById("hubOweMeAmount");
  const hubIOweEl = document.getElementById("hubIOweAmount");
  const expOweMeEl = document.getElementById("expensesOweMeValue");
  const expIOweEl = document.getElementById("expensesIOweValue");
  if (hubOweMeEl) hubOweMeEl.textContent = oweMeFormatted;
  if (hubIOweEl) hubIOweEl.textContent = iOweFormatted;
  if (expOweMeEl) expOweMeEl.textContent = oweMeFormatted;
  if (expIOweEl) expIOweEl.textContent = iOweFormatted;

  const nameInput = document.getElementById("hubDisplayNameInput");
  const phoneInput = document.getElementById("hubPaymentPhoneInput");
  const banksInput = document.getElementById("hubPreferredBanksInput");
  const currencySelect = document.getElementById("hubDefaultCurrencySelect");

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
}

function openSuperappHub() {
  const hub = getSuperappState();
  hub.screen = "hub";
  if (typeof triggerHaptic === "function") triggerHaptic("light");
  renderSuperappHub();
}

function selectSuperappModule(moduleName) {
  const hub = getSuperappState();
  if (typeof triggerHaptic === "function") triggerHaptic("light");

  if (moduleName === "expenses") {
    hub.screen = "expenses";
    renderSuperappHub();
    return;
  }

  hub.screen = "wishlist";
  renderSuperappHub();
  if (typeof showWishlistWorkspace === "function") {
    showWishlistWorkspace();
  }
}

function toggleHubTheme() {
  const current = document.body.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  if (typeof setThemePreset === "function") {
    setThemePreset(next);
  } else {
    document.body.setAttribute("data-theme", next);
  }
}

function openSbpProfileModal() {
  renderSuperappHub();
  const modal = document.getElementById("sbpProfileModalBackdrop");
  if (modal) modal.classList.add("open");
  if (typeof triggerHaptic === "function") triggerHaptic("light");
}

function closeSbpProfileModal() {
  const modal = document.getElementById("sbpProfileModalBackdrop");
  if (modal) modal.classList.remove("open");
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
    }
    if (data?.dashboard) {
      hub.activeEventsCount = Array.isArray(data.dashboard.active_events)
        ? data.dashboard.active_events.length
        : 0;
      const cur = hub.profile.default_currency || "RUB";
      const summary = data.dashboard.summary_by_currency?.[cur] || data.dashboard.summary_by_currency?.RUB;
      if (summary) {
        hub.oweMeMinor = Number(summary.owed_to_you_minor) || 0;
        hub.iOweMinor = Number(summary.you_owe_minor) || 0;
      }
    }
    renderSuperappHub();
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
    default_currency: ["RUB", "USD", "EUR", "KZT", "TRY", "GEL"].includes(defaultCurrency) ? defaultCurrency : "RUB"
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
  closeSbpProfileModal();
  if (typeof triggerHaptic === "function") triggerHaptic("success");
  if (typeof showToast === "function") showToast("✓ Профиль и реквизиты СБП сохранены");
}

if (typeof renderAll === "function") {
  const originalRenderAll = renderAll;
  renderAll = function patchedRenderAll() {
    originalRenderAll();
    renderSuperappHub();
  };
}

window.addEventListener("DOMContentLoaded", () => {
  renderSuperappHub();
  if (typeof isTelegramSession !== "undefined" && isTelegramSession && typeof API_ORIGIN !== "undefined" && API_ORIGIN) {
    syncCoreProfileFromServer();
  }
});
