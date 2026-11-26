const rawApiBase = typeof API_BASE_URL === "string"
  ? API_BASE_URL
  : (typeof window !== "undefined" && typeof window.API_BASE_URL === "string" ? window.API_BASE_URL : "");

export const API_ORIGIN = rawApiBase.replace(/\/+$/, "");
export const STORAGE_KEY = "tg_miniapp_wishlist_2026_v2";
export const MAX_IMAGE_BYTES = 512 * 1024;

export const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.colorScheme === "light") {
      document.body.setAttribute("data-theme", "light");
    }
  } catch (err) {
    console.warn("Telegram WebApp init fallback:", err);
  }
}

export function triggerHaptic(type = "light") {
  try {
    if (!tg?.HapticFeedback) return;
    if (type === "success" || type === "warning" || type === "error") {
      tg.HapticFeedback.notificationOccurred(type);
    } else {
      tg.HapticFeedback.impactOccurred(type);
    }
  } catch {
    // Игнорируем в десктопном браузере
  }
}

export const DEMO_USERS = {
  owner: { id: 1001, name: "Максим", username: "maxim", label: "Владелец (Максим)", avatar: "gift", initials: "М" },
  guest1: { id: 2002, name: "Анна", username: "anna1", label: "Гость 1 (Анна)", avatar: "sparkles", initials: "А" },
  guest2: { id: 3003, name: "Дима", username: "dima1", label: "Гость 2 (Дима)", avatar: "rocket", initials: "Д" }
};

export function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseOccasionId(value) {
  const id = String(value || "").trim();
  return /^occ_[A-Za-z0-9_-]{1,32}$/.test(id) ? id : "";
}

export function parseStartParam(rawParam) {
  const match = String(rawParam || "").trim().match(/^list_(\d+)(?:_(occ_[A-Za-z0-9_-]{1,32}))?$/);
  if (!match) return { ownerId: null, occasionId: "" };
  return {
    ownerId: parsePositiveId(match[1]),
    occasionId: parseOccasionId(match[2] || "")
  };
}

export const telegramUser = tg?.initDataUnsafe?.user;
export const telegramUserId = parsePositiveId(telegramUser?.id);
export const isTelegramSession = Boolean(tg?.initData && telegramUserId);
export const tgUserId = isTelegramSession ? telegramUserId : DEMO_USERS.owner.id;
export const startParam = tg?.initDataUnsafe?.start_param || "";
export const queryParams = new URLSearchParams(window.location.search);
export const queryListParam = queryParams.get("list") || "";
export const queryOccasionParam = parseOccasionId(queryParams.get("occasion") || "");
export const isBrowserDemo = !isTelegramSession && queryParams.get("demo") === "1";

const parsedStart = parseStartParam(startParam);
const parsedOwnerId = parsedStart.ownerId || parsePositiveId(queryListParam) || tgUserId;
export const initialOccasionId = parsedStart.occasionId || queryOccasionParam || "";
export const telegramViewerName = String(telegramUser?.first_name || "Пользователь").trim() || "Пользователь";
export const telegramViewerUsername = String(telegramUser?.username || "").trim().replace(/^@+/, "");

export function getEmptyGroups() {
  return [
    { id: "family", name: "Семья", memberIds: [], members: [] },
    { id: "close", name: "Близкие", memberIds: [], members: [] },
    { id: "friends", name: "Друзья", memberIds: [], members: [] },
    { id: "colleagues", name: "Коллеги", memberIds: [], members: [] }
  ];
}

export function getDefaultDemoGroups() {
  const anna = { id: 2002, first_name: "Анна", username: "anna1" };
  const dima = { id: 3003, first_name: "Дима", username: "dima1" };
  return [
    { id: "family", name: "Семья", memberIds: [], members: [] },
    { id: "close", name: "Близкие", memberIds: [2002], members: [anna] },
    { id: "friends", name: "Друзья", memberIds: [3003], members: [dima] },
    { id: "colleagues", name: "Коллеги", memberIds: [2002, 3003], members: [anna, dima] }
  ];
}

export function getDefaultDemoOccasions() {
  return [
    { id: "occ_ny2027", title: "Новый год" },
    { id: "occ_bday01", title: "День рождения" }
  ];
}

export const state = {
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
  renamingGroupId: null,
  superapp: null,
  expenses: null
};

export const CATEGORY_STYLES = {
  "Техника": {
    icon: "phone",
    gradient: "linear-gradient(135deg, #1d4ed8 0%, #4338ca 50%, #6d28d9 100%)"
  },
  "Дом": {
    icon: "home",
    gradient: "linear-gradient(135deg, #047857 0%, #0d9488 100%)"
  },
  "Одежда": {
    icon: "tag",
    gradient: "linear-gradient(135deg, #be185d 0%, #e11d48 100%)"
  },
  "Хобби": {
    icon: "palette",
    gradient: "linear-gradient(135deg, #b45309 0%, #ea580c 100%)"
  },
  "Впечатления": {
    icon: "sparkles",
    gradient: "linear-gradient(135deg, #4f46e5 0%, #0891b2 100%)"
  },
  "default": {
    icon: "gift",
    gradient: "linear-gradient(135deg, #334155 0%, #0f172a 100%)"
  }
};

export const DEFAULT_TAGS = ["Новый год", "День рождения", "8 Марта", "23 Февраля", "Новоселье", "Свадьба"];
export const DESIRE_META = {
  high: { icon: "flame", label: "Очень хочу", className: "pill-priority", rank: 0 },
  medium: { icon: "", label: "Среднее хочу", className: "pill-desire-medium", rank: 1 },
  wait: { icon: "hourglass", label: "Пока подождёт", className: "pill-desire-wait", rank: 2 }
};

export function getGiftDesire(gift) {
  return DESIRE_META[gift?.desire] ? gift.desire : (gift?.priority ? "high" : "medium");
}

export function getInitialDemoGifts() {
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

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isValidHttpUrl(string) {
  if (!string) return false;
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatPrice(num) {
  if (num === null || num === undefined || num === "" || isNaN(Number(num)) || Number(num) <= 0) {
    return null;
  }
  return new Intl.NumberFormat("ru-RU").format(Math.round(Number(num))) + " ₽";
}

export function getAuthHeaders() {
  return {
    "X-Telegram-Init-Data": tg?.initData || ""
  };
}

export function resolveImageUrl(url) {
  const value = String(url || "");
  return value.startsWith("/api/img/") && API_ORIGIN
    ? `${API_ORIGIN}${value}`
    : value;
}

export function isInternalImageUrl(url) {
  return /^\/api\/img\/[A-Za-z0-9_-]{16,64}$/.test(String(url || ""));
}

const internalImageCache = new Map();
const internalImageObjectUrls = new Set();

export async function getInternalImageObjectUrl(url) {
  if (!isTelegramSession || !isInternalImageUrl(url)) return resolveImageUrl(url);
  if (internalImageCache.has(url)) return await internalImageCache.get(url);
  const pending = (async () => {
    try {
      const response = await fetch(resolveImageUrl(url), { headers: getAuthHeaders() });
      if (!response.ok) return "";
      const objectUrl = URL.createObjectURL(await response.blob());
      internalImageObjectUrls.add(objectUrl);
      return objectUrl;
    } catch {
      return "";
    }
  })();
  internalImageCache.set(url, pending);
  const result = await pending;
  if (!result) internalImageCache.delete(url);
  return result;
}

export async function hydrateInternalImages(container) {
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

export function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
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

export async function readApiResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Ошибка сервера (${response.status})`);
  }
  return data;
}

export async function loadBotConfig() {
  if (!isTelegramSession || !API_ORIGIN) return;
  try {
    const response = await fetch(`${API_ORIGIN}/api/config`);
    const data = await readApiResponse(response);
    state.botUsername = String(data.botUsername || "").replace(/^@/, "");
  } catch (error) {
    console.warn("Bot config is unavailable:", error);
  }
}

export function saveLocalGifts() {
  if (isTelegramSession) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.gifts));
  } catch {
    showToast("Локальное хранилище переполнено");
  }
}

export async function compressAndUploadImage(file, formPrefix) {
  const progressWrap = document.getElementById(`${formPrefix}UploadProgress`);
  const progressBar = document.getElementById(`${formPrefix}UploadProgressBar`);
  const statusText = document.getElementById(`${formPrefix}UploadStatusText`);
  const percentText = document.getElementById(`${formPrefix}UploadPercentText`);

  const setProgress = (pct, label) => {
    if (!progressWrap || !progressBar || !statusText || !percentText) return;
    progressWrap.classList.add("active");
    progressBar.style.width = `${pct}%`;
    statusText.textContent = label;
    percentText.textContent = `${pct}%`;
  };

  setProgress(25, "Сжатие через HTML5 Canvas (до 600px)...");

  const { blob, dataUrl, width, height } = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.onload = e => {
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
          resultBlob => {
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
      setTimeout(() => progressWrap?.classList.remove("active"), 500);
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
  setTimeout(() => progressWrap?.classList.remove("active"), 500);

  return {
    url: dataUrl,
    meta: `${width}×${height}px · ~${sizeKb} КБ (WebP/JPEG 0.75)`
  };
}

export async function handleFileSelect(event, formPrefix) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await compressAndUploadImage(file, formPrefix);
    state.photoDraft[formPrefix] = result.url;
    updatePhotoPreviewUI(formPrefix, result.url, result.meta);
    triggerHaptic("success");
  } catch (err) {
    showToast(err.message || "Не удалось обработать выбранное изображение");
  }
}

export function handleImageUrlInput(formPrefix) {
  const input = document.getElementById(`${formPrefix}ImageUrlInput`);
  const val = input?.value.trim() || "";
  if (isValidHttpUrl(val)) {
    state.photoDraft[formPrefix] = val;
    updatePhotoPreviewUI(formPrefix, val, "Прямая веб-ссылка");
  } else if (!val) {
    state.photoDraft[formPrefix] = "";
    updatePhotoPreviewUI(formPrefix, "", "");
  }
}

export function updatePhotoPreviewUI(formPrefix, url, metaText) {
  const box = document.getElementById(`${formPrefix}PhotoPreviewBox`);
  const img = document.getElementById(`${formPrefix}PhotoPreviewImg`);
  const meta = document.getElementById(`${formPrefix}PhotoPreviewMeta`);
  if (!box || !img || !meta) return;
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

export function clearPhoto(formPrefix) {
  state.photoDraft[formPrefix] = "";
  const fileInput = document.getElementById(`${formPrefix}FileInput`);
  const urlInput = document.getElementById(`${formPrefix}ImageUrlInput`);
  if (fileInput) fileInput.value = "";
  if (urlInput) urlInput.value = "";
  updatePhotoPreviewUI(formPrefix, "", "");
  triggerHaptic("light");
}

export function switchPhotoTab(formPrefix, mode) {
  const fileBtn = document.getElementById(`${formPrefix}TabFileBtn`);
  const urlBtn = document.getElementById(`${formPrefix}TabUrlBtn`);
  const fileWrap = document.getElementById(`${formPrefix}PhotoFileWrap`);
  const urlWrap = document.getElementById(`${formPrefix}PhotoUrlWrap`);

  if (mode === "file") {
    fileBtn?.classList.add("active");
    urlBtn?.classList.remove("active");
    if (fileWrap) fileWrap.style.display = "block";
    if (urlWrap) urlWrap.style.display = "none";
  } else {
    urlBtn?.classList.add("active");
    fileBtn?.classList.remove("active");
    if (fileWrap) fileWrap.style.display = "none";
    if (urlWrap) urlWrap.style.display = "block";
  }
  triggerHaptic("light");
}
