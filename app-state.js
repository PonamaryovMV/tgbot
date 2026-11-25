/**
 * Модуль 1: Состояние приложения, SDK Telegram, API-клиент, KV-изображения и мутации подарков.
 */
const API_ORIGIN = API_BASE_URL.replace(/\/+$/, "");
const STORAGE_KEY = "tg_miniapp_wishlist_2026_v2";
const MAX_IMAGE_BYTES = 512 * 1024;

const tg = window.Telegram?.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (typeof tg.requestFullscreen === "function") {
      tg.requestFullscreen();
    }
    if (tg.colorScheme === "light") {
      document.body.setAttribute("data-theme", "light");
    }
  } catch (err) {
    console.warn("Telegram WebApp init fallback:", err);
  }
}

function triggerHaptic(type = "light") {
  try {
    if (!tg?.HapticFeedback) return;
    if (type === "success" || type === "warning" || type === "error") {
      tg.HapticFeedback.notificationOccurred(type);
    } else {
      tg.HapticFeedback.impactOccurred(type);
    }
  } catch (e) {
    // Игнорируем в десктопном браузере
  }
}

const DEMO_USERS = {
  owner: { id: 1001, name: "Максим", username: "maxim", label: "Владелец (Максим)", avatar: "🎁", initials: "М" },
  guest1: { id: 2002, name: "Анна", username: "anna1", label: "Гость 1 (Анна)", avatar: "✨", initials: "А" },
  guest2: { id: 3003, name: "Дима", username: "dima1", label: "Гость 2 (Дима)", avatar: "🚀", initials: "Д" }
};

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseOccasionId(value) {
  const id = String(value || "").trim();
  return /^occ_[A-Za-z0-9_-]{1,32}$/.test(id) ? id : "";
}

function parseStartParam(rawParam) {
  const match = String(rawParam || "").trim().match(/^list_(\d+)(?:_(occ_[A-Za-z0-9_-]{1,32}))?$/);
  if (!match) return { ownerId: null, occasionId: "" };
  return {
    ownerId: parsePositiveId(match[1]),
    occasionId: parseOccasionId(match[2] || "")
  };
}

const telegramUser = tg?.initDataUnsafe?.user;
const telegramUserId = parsePositiveId(telegramUser?.id);
const isTelegramSession = Boolean(tg?.initData && telegramUserId);
const tgUserId = isTelegramSession ? telegramUserId : DEMO_USERS.owner.id;
const startParam = tg?.initDataUnsafe?.start_param || "";
const queryParams = new URLSearchParams(window.location.search);
const queryListParam = queryParams.get("list") || "";
const queryOccasionParam = parseOccasionId(queryParams.get("occasion") || "");
const isBrowserDemo = !isTelegramSession && queryParams.get("demo") === "1";

const parsedStart = parseStartParam(startParam);
const parsedOwnerId = parsedStart.ownerId || parsePositiveId(queryListParam) || tgUserId;
const initialOccasionId = parsedStart.occasionId || queryOccasionParam || "";
const telegramViewerName = String(telegramUser?.first_name || "Пользователь").trim() || "Пользователь";
const telegramViewerUsername = String(telegramUser?.username || "").trim().replace(/^@+/, "");

function getEmptyGroups() {
  return [
    { id: "family", name: "Семья", memberIds: [], members: [] },
    { id: "close", name: "Близкие", memberIds: [], members: [] },
    { id: "friends", name: "Друзья", memberIds: [], members: [] },
    { id: "colleagues", name: "Коллеги", memberIds: [], members: [] }
  ];
}

function getDefaultDemoGroups() {
  const anna = { id: 2002, first_name: "Анна", username: "anna1" };
  const dima = { id: 3003, first_name: "Дима", username: "dima1" };
  return [
    { id: "family", name: "Семья", memberIds: [], members: [] },
    { id: "close", name: "Близкие", memberIds: [2002], members: [anna] },
    { id: "friends", name: "Друзья", memberIds: [3003], members: [dima] },
    { id: "colleagues", name: "Коллеги", memberIds: [2002, 3003], members: [anna, dima] }
  ];
}

function getDefaultDemoOccasions() {
  return [
    { id: "occ_ny2027", title: "Новый год" },
    { id: "occ_bday01", title: "День рождения" }
  ];
}

const state = {
  ownerId: parsedOwnerId,
  viewerId: tgUserId,
  ownerName: parsedOwnerId === tgUserId && isTelegramSession ? telegramViewerName : "Пользователь",
  ownerUsername: parsedOwnerId === tgUserId && isTelegramSession ? telegramViewerUsername : "",
  viewerName: isTelegramSession ? telegramViewerName : DEMO_USERS.owner.name,
  botUsername: "",
  activeRoleKey: "owner",
  activeWorkspace: "wishlist",
  activeTab: "active",
  onlyFreeFilter: false,
  priceFilter: "all",
  categoryFilter: "all",
  occasionFilter: initialOccasionId || "all",
  isLoading: true,
  loadError: "",
  gifts: [],
  occasions: isTelegramSession ? [] : getDefaultDemoOccasions(),
  participations: [],
  participationsLoading: false,
  participationsError: "",
  subscriptions: [],
  groups: isTelegramSession ? getEmptyGroups() : getDefaultDemoGroups(),
  isSubscribed: false,
  socialLoading: false,
  socialError: "",
  selectionBotUsername: "",
  shareOccasionId: "all",
  desireDraft: { add: "medium", edit: "medium" },
  tagDraft: { add: [], edit: [] },
  groupDraft: { add: [], edit: [] },
  occasionDraft: { add: [], edit: [] },
  photoDraft: { add: "", edit: "" },
  copiedGiftIds: new Set(),
  copyingGiftIds: new Set(),
  pendingDeleteId: null,
  pendingDeleteGroupId: null,
  renamingGroupId: null
};

const CATEGORY_STYLES = {
  "Техника": {
    emoji: "🎧",
    gradient: "linear-gradient(135deg, #1d4ed8 0%, #4338ca 50%, #6d28d9 100%)"
  },
  "Дом": {
    emoji: "☕",
    gradient: "linear-gradient(135deg, #047857 0%, #0d9488 100%)"
  },
  "Одежда": {
    emoji: "👟",
    gradient: "linear-gradient(135deg, #be185d 0%, #e11d48 100%)"
  },
  "Хобби": {
    emoji: "🎨",
    gradient: "linear-gradient(135deg, #b45309 0%, #ea580c 100%)"
  },
  "Впечатления": {
    emoji: "🎟",
    gradient: "linear-gradient(135deg, #4f46e5 0%, #0891b2 100%)"
  },
  "default": {
    emoji: "🎁",
    gradient: "linear-gradient(135deg, #334155 0%, #0f172a 100%)"
  }
};

const DEFAULT_TAGS = ["Новый год", "День рождения", "8 Марта", "23 Февраля", "Новоселье", "Свадьба"];
const DESIRE_META = {
  high: { label: "🔥 Очень хочу", className: "pill-priority", rank: 0 },
  medium: { label: "Среднее хочу", className: "pill-desire-medium", rank: 1 },
  wait: { label: "◷ Пока подождёт", className: "pill-desire-wait", rank: 2 }
};

function getGiftDesire(gift) {
  return DESIRE_META[gift?.desire] ? gift.desire : (gift?.priority ? "high" : "medium");
}

function getInitialDemoGifts() {
  return [
    {
      id: 1731672009000,
      title: "Беспроводные наушники Sony WH-1000XM5",
      link: "https://example.com/sony-wh1000xm5",
      image: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=800&q=80",
      price: 29900,
      category: "Техника",
      comment: "Цвет Platinum Silver (платиновый серебристый) или чёрный матовый",
      priority: true,
      desire: "high",
      tags: ["Новый год", "День рождения"],
      group_ids: [],
      occasion_ids: ["occ_ny2027", "occ_bday01"],
      is_crowdfund: true,
      is_reusable: false,
      booked_by: null,
      participants: [2002, 3003],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672008000,
      title: "Кофемолка жерновая электрическая Fellow Ode Brew Gen 2",
      link: "https://example.com/fellow-ode",
      image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80",
      price: 6500,
      category: "Дом",
      comment: "Цвет чёрный матовый, под альтернативу и пуровер V60",
      priority: true,
      desire: "high",
      tags: [],
      group_ids: [],
      occasion_ids: ["occ_bday01"],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: null,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672007000,
      title: "Мастер-класс по гончарному кругу и керамике на двоих",
      link: "https://example.com/pottery-studio",
      image: "",
      price: 4200,
      category: "Впечатления",
      comment: "Сертификат с открытой датой на выходной день, включая обжиг",
      priority: false,
      desire: "medium",
      tags: [],
      group_ids: [],
      occasion_ids: [],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: 2002,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672006000,
      title: "Худи Heavyweight Oversize из плотного хлопка 480 г/м²",
      link: "https://example.com/heavy-hoodie",
      image: "",
      price: 3900,
      category: "Одежда",
      comment: "Размер L, цвет графит или тёмный шалфей, без логотипов",
      priority: false,
      desire: "wait",
      tags: ["Новый год"],
      group_ids: [],
      occasion_ids: ["occ_ny2027"],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: 3003,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672005000,
      title: "Сертификат в книжный магазин «Подписные издания»",
      link: "https://example.com/books-cert",
      image: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=800&q=80",
      price: 2000,
      category: "Хобби",
      comment: "Электронный или бумажный номиналом 2 000 ₽ — можно дарить несколько раз",
      priority: false,
      desire: "medium",
      tags: [],
      group_ids: [],
      occasion_ids: ["occ_ny2027"],
      is_crowdfund: false,
      is_reusable: true,
      booked_by: null,
      participants: [],
      reusable_givers: [3003],
      is_gifted: false
    },
    {
      id: 1731672004000,
      title: "Виниловый проигрыватель Audio-Technica AT-LP60XBT",
      link: "https://example.com/turntable",
      image: "https://images.unsplash.com/photo-1539375665275-f9de415ef9ac?auto=format&fit=crop&w=800&q=80",
      price: 18900,
      category: "Техника",
      comment: "Версия с Bluetooth, цвет корпуса чёрный или орех",
      priority: false,
      desire: "medium",
      tags: [],
      group_ids: [],
      occasion_ids: [],
      is_crowdfund: true,
      is_reusable: false,
      booked_by: null,
      participants: [3003],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672002000,
      title: "Механическая клавиатура Keychron K2 Pro QMK/VIA",
      link: "https://example.com/keychron-k2",
      image: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80",
      price: 9400,
      category: "Техника",
      comment: "Тактильные свитчи Brown, алюминиевая рамка",
      priority: true,
      desire: "high",
      tags: [],
      group_ids: [],
      occasion_ids: [],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: 2002,
      participants: [],
      reusable_givers: [],
      is_gifted: true
    },
    {
      id: 1731672001000,
      title: "Термос Stanley Classic Legendary Bottle 0.75 л",
      link: "https://example.com/stanley",
      image: "",
      price: 3600,
      category: "Дом",
      comment: "Фирменный молотковый зелёный цвет Hammertone Green",
      priority: false,
      desire: "medium",
      tags: [],
      group_ids: [],
      occasion_ids: [],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: 3003,
      participants: [],
      reusable_givers: [],
      is_gifted: true
    }
  ];
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidHttpUrl(string) {
  if (!string) return false;
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function formatPrice(num) {
  if (num === null || num === undefined || num === "" || isNaN(Number(num)) || Number(num) <= 0) {
    return null;
  }
  return new Intl.NumberFormat("ru-RU").format(Math.round(Number(num))) + " ₽";
}

function getAuthHeaders() {
  return {
    "X-Telegram-Init-Data": tg?.initData || ""
  };
}

function resolveImageUrl(url) {
  const value = String(url || "");
  return value.startsWith("/api/img/") && API_ORIGIN
    ? `${API_ORIGIN}${value}`
    : value;
}

function isInternalImageUrl(url) {
  return /^\/api\/img\/[A-Za-z0-9_-]{16,64}$/.test(String(url || ""));
}

const internalImageCache = new Map();
const internalImageObjectUrls = new Set();

async function getInternalImageObjectUrl(url) {
  if (!isTelegramSession || !isInternalImageUrl(url)) return resolveImageUrl(url);
  if (internalImageCache.has(url)) return await internalImageCache.get(url);
  const pending = (async () => {
    try {
      const response = await fetch(resolveImageUrl(url), { headers: getAuthHeaders() });
      if (!response.ok) return "";
      const objectUrl = URL.createObjectURL(await response.blob());
      internalImageObjectUrls.add(objectUrl);
      return objectUrl;
    } catch (error) {
      return "";
    }
  })();
  internalImageCache.set(url, pending);
  const result = await pending;
  if (!result) internalImageCache.delete(url);
  return result;
}

async function hydrateInternalImages(container) {
  if (!container || !isTelegramSession) return;
  const images = [...container.querySelectorAll("img[data-internal-image]")];
  await Promise.all(images.map(async img => {
    const source = img.getAttribute("data-internal-image") || "";
    const objectUrl = await getInternalImageObjectUrl(source);
    if (!img.isConnected || img.getAttribute("data-internal-image") !== source) return;
    img.removeAttribute("data-internal-image");
    const placeholder = img.nextElementSibling?.classList.contains("card-art-placeholder")
      ? img.nextElementSibling
      : null;
    if (objectUrl) {
      img.src = objectUrl;
      img.style.display = "block";
      if (placeholder) placeholder.style.display = "none";
    } else {
      img.style.display = "none";
      if (placeholder) placeholder.style.display = "flex";
    }
  }));
}

window.addEventListener("beforeunload", () => {
  internalImageObjectUrls.forEach(url => URL.revokeObjectURL(url));
});

function applyServerData(data) {
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

async function readApiResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Ошибка сервера (${response.status})`);
  }
  return data;
}

async function loadBotConfig() {
  if (!isTelegramSession || !API_ORIGIN) return;
  try {
    const response = await fetch(`${API_ORIGIN}/api/config`);
    const data = await readApiResponse(response);
    state.botUsername = String(data.botUsername || "").replace(/^@/, "");
  } catch (error) {
    console.warn("Bot config is unavailable:", error);
  }
}

async function fetchGifts() {
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
        { method: "GET", headers: getAuthHeaders() }
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
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.gifts = Array.isArray(parsed) ? parsed : getInitialDemoGifts();
    } catch (error) {
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

function saveLocalGifts() {
  if (isTelegramSession) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.gifts));
  } catch (error) {
    showToast("⚠️ Локальное хранилище переполнено");
  }
}

async function mutateGifts(action, payload) {
  if (isTelegramSession) {
    if (!API_ORIGIN) {
      showToast("❌ Сначала укажите адрес Cloudflare Worker");
      return false;
    }
    try {
      const response = await fetch(`${API_ORIGIN}/api/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
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
      showToast(`❌ ${error.message || "Ошибка синхронизации с сервером"}`);
      return false;
    }
  }

  if (["toggle_book", "toggle_crowdfund"].includes(action)) {
    const gift = state.gifts.find(item => item.id === payload.id);
    if (!gift || !canDemoViewerAccessGift(gift, state.viewerId)) {
      showToast("⚠️ Это желание недоступно для вашей группы");
      return false;
    }
  }

  if (action === "save_occasion") {
    const title = String(payload.title || "").trim().slice(0, 40);
    if (!title) {
      showToast("⚠️ Укажите название повода");
      return false;
    }
    const key = title.toLocaleLowerCase("ru-RU");
    const dup = state.occasions.some(item => item.id !== payload.id && item.title.toLocaleLowerCase("ru-RU") === key);
    if (dup) {
      showToast("⚠️ Повод с таким названием уже есть");
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

async function copyGiftToOwnWishlist(giftId) {
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
          ...getAuthHeaders()
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
    showToast("✓ Добавлено в ваш вишлист");
  } catch (error) {
    showToast(`❌ ${error.message || "Не удалось скопировать желание"}`);
  } finally {
    state.copyingGiftIds.delete(giftId);
    renderAll();
  }
}

async function compressAndUploadImage(file, formPrefix) {
  const progressWrap = document.getElementById(`${formPrefix}UploadProgress`);
  const progressBar = document.getElementById(`${formPrefix}UploadProgressBar`);
  const statusText = document.getElementById(`${formPrefix}UploadStatusText`);
  const percentText = document.getElementById(`${formPrefix}UploadPercentText`);

  const setProgress = (pct, label) => {
    progressWrap.classList.add("active");
    progressBar.style.width = `${pct}%`;
    statusText.textContent = label;
    percentText.textContent = `${pct}%`;
  };

  setProgress(25, "Сжатие через HTML5 Canvas (до 600px)...");

  const { blob, dataUrl, width, height } = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Некорректный файл изображения"));
      img.onload = () => {
        const MAX_SIDE = 600;
        let targetW = img.width;
        let targetH = img.height;

        if (targetW > targetH && targetW > MAX_SIDE) {
          targetH = Math.round((targetH * MAX_SIDE) / targetW);
          targetW = MAX_SIDE;
        } else if (targetH >= targetW && targetH > MAX_SIDE) {
          targetW = Math.round((targetW * MAX_SIDE) / targetH);
          targetH = MAX_SIDE;
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, targetW, targetH);

        let mimeType = "image/webp";
        let outDataUrl = canvas.toDataURL(mimeType, 0.75);
        if (!outDataUrl.startsWith("data:image/webp")) {
          mimeType = "image/jpeg";
          outDataUrl = canvas.toDataURL(mimeType, 0.75);
        }

        canvas.toBlob(
          (resultBlob) => {
            resolve({
              blob: resultBlob,
              dataUrl: outDataUrl,
              width: targetW,
              height: targetH
            });
          },
          mimeType,
          0.75
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  setProgress(70, "Отправка сжатого файла...");

  if (isTelegramSession) {
    if (!API_ORIGIN) throw new Error("Не указан адрес Cloudflare Worker");
    if (!blob) throw new Error("Браузер не смог сжать изображение");
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error("Сжатое изображение всё ещё больше 512 КБ");
    }

    try {
      const formData = new FormData();
      const filename = blob.type === "image/jpeg" ? "gift-photo.jpg" : "gift-photo.webp";
      formData.append("file", blob, filename);
      const response = await fetch(`${API_ORIGIN}/api/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData
      });
      const result = await readApiResponse(response);
      if (!result.url) throw new Error("Сервер не вернул ссылку на изображение");
      setProgress(100, "Загружено в Cloudflare KV!");
      setTimeout(() => progressWrap.classList.remove("active"), 500);
      return {
        url: result.url,
        meta: `${width}×${height}px · Cloudflare KV`
      };
    } catch (error) {
      setProgress(100, "Ошибка загрузки");
      throw new Error(error.message || "Не удалось загрузить изображение");
    }
  }

  const sizeKb = blob ? Math.round(blob.size / 1024) : Math.round((dataUrl.length * 0.75) / 1024);
  setProgress(100, "Сжато успешно!");
  setTimeout(() => progressWrap.classList.remove("active"), 500);

  return {
    url: dataUrl,
    meta: `${width}×${height}px · ~${sizeKb} КБ (WebP/JPEG 0.75)`
  };
}

async function handleFileSelect(event, formPrefix) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await compressAndUploadImage(file, formPrefix);
    state.photoDraft[formPrefix] = result.url;
    updatePhotoPreviewUI(formPrefix, result.url, result.meta);
    triggerHaptic("success");
  } catch (err) {
    showToast(`❌ ${err.message || "Не удалось обработать выбранное изображение"}`);
  }
}

function handleImageUrlInput(formPrefix) {
  const input = document.getElementById(`${formPrefix}ImageUrlInput`);
  const val = input.value.trim();
  if (isValidHttpUrl(val)) {
    state.photoDraft[formPrefix] = val;
    updatePhotoPreviewUI(formPrefix, val, "Прямая веб-ссылка");
  } else if (!val) {
    state.photoDraft[formPrefix] = "";
    updatePhotoPreviewUI(formPrefix, "", "");
  }
}

function updatePhotoPreviewUI(formPrefix, url, metaText) {
  const box = document.getElementById(`${formPrefix}PhotoPreviewBox`);
  const img = document.getElementById(`${formPrefix}PhotoPreviewImg`);
  const meta = document.getElementById(`${formPrefix}PhotoPreviewMeta`);
  const useProtectedImage = isTelegramSession && isInternalImageUrl(url);

  img.removeAttribute("data-internal-image");
  img.removeAttribute("src");
  img.style.display = useProtectedImage ? "none" : "block";

  if (url) {
    if (useProtectedImage) {
      img.setAttribute("data-internal-image", url);
      hydrateInternalImages(box);
    } else {
      img.src = resolveImageUrl(url);
    }
    meta.textContent = metaText || "Фото выбрано";
    box.classList.add("active");
  } else {
    meta.textContent = "Готово к публикации";
    box.classList.remove("active");
  }
}

function clearPhoto(formPrefix) {
  state.photoDraft[formPrefix] = "";
  const fileInput = document.getElementById(`${formPrefix}FileInput`);
  const urlInput = document.getElementById(`${formPrefix}ImageUrlInput`);
  if (fileInput) fileInput.value = "";
  if (urlInput) urlInput.value = "";
  updatePhotoPreviewUI(formPrefix, "", "");
  triggerHaptic("light");
}

function switchPhotoTab(formPrefix, mode) {
  const fileBtn = document.getElementById(`${formPrefix}TabFileBtn`);
  const urlBtn = document.getElementById(`${formPrefix}TabUrlBtn`);
  const fileWrap = document.getElementById(`${formPrefix}PhotoFileWrap`);
  const urlWrap = document.getElementById(`${formPrefix}PhotoUrlWrap`);

  if (mode === "file") {
    fileBtn.classList.add("active");
    urlBtn.classList.remove("active");
    fileWrap.style.display = "block";
    urlWrap.style.display = "none";
  } else {
    urlBtn.classList.add("active");
    fileBtn.classList.remove("active");
    fileWrap.style.display = "none";
    urlWrap.style.display = "block";
  }
  triggerHaptic("light");
}
