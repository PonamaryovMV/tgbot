import {
  API_ORIGIN,
  tg,
  isTelegramSession,
  isBrowserDemo,
  telegramViewerName,
  queryListParam,
  startParam,
  state,
  triggerHaptic,
  showToast,
  readApiResponse
} from "./state.js";
import {
  showWishlistWorkspace,
  setThemePreset,
  renderAll
} from "./wishlist-render.js";

const SUPERAPP_PROFILE_STORAGE_KEY = "tg_superapp_profile_v1";

const hubHooks = {
  loadExpensesDashboard: () => {}
};

export function registerHubHooks(hooks) {
  Object.assign(hubHooks, hooks);
}

function getDefaultSuperappProfile() {
  const defaultName = isTelegramSession
    ? telegramViewerName
    : (typeof DEMO_USERS !== "undefined" ? DEMO_USERS.owner.name : "Максим");
  return {
    display_name: defaultName || "Пользователь",
    payment_phone: "",
    preferred_banks: [],
    default_currency: "RUB"
  };
}

export function loadLocalSuperappProfile() {
  const fallback = getDefaultSuperappProfile();
  try {
    const raw = localStorage.getItem(SUPERAPP_PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      display_name: String(parsed.display_name || fallback.display_name).trim() || fallback.display_name,
      payment_phone: String(parsed.payment_phone || "").trim(),
      preferred_banks: Array.isArray(parsed.preferred_banks)
        ? parsed.preferred_banks.map(b => String(b || "").trim()).filter(Boolean)
        : [],
      default_currency: ["RUB", "USD", "EUR", "KZT", "TRY", "GEL"].includes(String(parsed.default_currency || "").toUpperCase())
        ? String(parsed.default_currency).toUpperCase()
        : "RUB"
    };
  } catch {
    return fallback;
  }
}

export function saveLocalSuperappProfile(profile) {
  try {
    localStorage.setItem(SUPERAPP_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Игнорируем ошибки квоты локального хранилища
  }
}

export function resolveInitialSuperappScreen() {
  const params = new URLSearchParams(window.location.search);
  const explicitModule = String(params.get("module") || "").trim().toLowerCase();
  const explicitInvite = String(params.get("invite") || "").trim();
  const rawStartParam = typeof startParam === "string" ? startParam.trim() : "";

  if (explicitModule === "expenses" || explicitInvite.startsWith("exp_") || rawStartParam === "module_expenses" || rawStartParam.startsWith("exp_")) {
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
  if (isBrowserDemo) {
    return "wishlist";
  }
  return "hub";
}

export function getSuperappState() {
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
    const key = part.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
    if (unique.length >= 10) break;
  }
  return unique;
}

export function formatMinorRub(minor, currency = "RUB") {
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

export function renderSuperappHub() {
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

export function openSuperappHub() {
  const hub = getSuperappState();
  hub.screen = "hub";
  triggerHaptic("light");
  renderSuperappHub();
}

export function selectSuperappModule(moduleName) {
  const hub = getSuperappState();
  triggerHaptic("light");

  if (moduleName === "expenses") {
    hub.screen = "expenses";
    renderSuperappHub();
    hubHooks.loadExpensesDashboard();
    return;
  }

  hub.screen = "wishlist";
  renderSuperappHub();
  showWishlistWorkspace();
}

export function toggleHubTheme() {
  const current = document.body.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  setThemePreset(next);
}

export function openSbpProfileModal() {
  renderSuperappHub();
  const modal = document.getElementById("sbpProfileModalBackdrop");
  if (modal) modal.classList.add("open");
  triggerHaptic("light");
}

export function closeSbpProfileModal() {
  const modal = document.getElementById("sbpProfileModalBackdrop");
  if (modal) modal.classList.remove("open");
}

export async function syncCoreProfileFromServer() {
  if (!isTelegramSession || !API_ORIGIN) {
    return;
  }
  const hub = getSuperappState();
  try {
    const response = await fetch(`${API_ORIGIN}/api/core/bootstrap`, {
      headers: { "X-Telegram-Init-Data": tg?.initData || "" }
    });
    const data = await readApiResponse(response);
    if (data?.user) {
      hub.profile = {
        display_name: String(data.user.display_name || hub.profile.display_name || "Пользователь").trim() || "Пользователь",
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

export async function handleSaveSuperappProfile(event) {
  event.preventDefault();
  const hub = getSuperappState();
  if (hub.savingProfile) return;

  const displayName = String(document.getElementById("hubDisplayNameInput")?.value || "").trim();
  const paymentPhone = String(document.getElementById("hubPaymentPhoneInput")?.value || "").trim();
  const preferredBanks = parseBanksInput(document.getElementById("hubPreferredBanksInput")?.value || "");
  const defaultCurrency = String(document.getElementById("hubDefaultCurrencySelect")?.value || "RUB").trim().toUpperCase();

  const nextProfile = {
    display_name: displayName || hub.profile.display_name || "Пользователь",
    payment_phone: paymentPhone,
    preferred_banks: preferredBanks,
    default_currency: ["RUB", "USD", "EUR", "KZT", "TRY", "GEL"].includes(defaultCurrency) ? defaultCurrency : "RUB"
  };

  if (isTelegramSession && API_ORIGIN) {
    hub.savingProfile = true;
    const btn = document.getElementById("saveSuperappProfileBtn");
    if (btn) btn.disabled = true;
    try {
      const response = await fetch(`${API_ORIGIN}/api/core/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg?.initData || ""
        },
        body: JSON.stringify(nextProfile)
      });
      const data = await readApiResponse(response);
      if (data?.user) {
        nextProfile.display_name = String(data.user.display_name || nextProfile.display_name);
        nextProfile.payment_phone = String(data.user.payment_phone ?? nextProfile.payment_phone);
        nextProfile.preferred_banks = Array.isArray(data.user.preferred_banks) ? data.user.preferred_banks : nextProfile.preferred_banks;
        nextProfile.default_currency = String(data.user.default_currency || nextProfile.default_currency).toUpperCase();
      }
    } catch (error) {
      showToast(error.message || "Не удалось сохранить профиль");
      hub.savingProfile = false;
      if (btn) btn.disabled = false;
      return;
    }
    hub.savingProfile = false;
    if (btn) btn.disabled = false;
  }

  hub.profile = nextProfile;
  saveLocalSuperappProfile(hub.profile);
  renderSuperappHub();
  closeSbpProfileModal();
  triggerHaptic("success");
  showToast("Профиль и реквизиты СБП сохранены");
  renderAll();
}
