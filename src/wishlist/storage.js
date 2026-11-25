import {
  DEFAULT_GROUPS,
  LEGACY_GROUP_NAMES,
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  MAX_OCCASIONS,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  CORS_HEADERS,
  ApiError,
  json,
  assertContentLength,
  cleanPlainText,
  normalizeUsername,
  parseId,
  normalizeGroupId,
  normalizeOccasionId
} from "./utils.js";

export function directoryKey(userId) {
  return `directory:${userId}`;
}

export function usernameKey(username) {
  return `username:${username}`;
}

export function subscriptionsKey(userId) {
  return `subscriptions:${userId}`;
}

export function subscribersKey(ownerId) {
  return `subscribers:${ownerId}`;
}

export function groupsKey(ownerId) {
  return `groups:${ownerId}`;
}

export function selectionKey(requestId) {
  return `selection:${requestId}`;
}

export function expenseContactsKey(userId) {
  return `exp_contacts:${userId}`;
}

export function notifyPrefsKey(userId) {
  return `notify_prefs:${userId}`;
}

export function participationsKey(viewerId) {
  return `participations:${viewerId}`;
}

export async function upsertUserDirectory(env, profile) {
  const userId = parseId(profile?.id, "user id");
  const key = directoryKey(userId);
  const previous = await env.DB.get(key, "json");

  const hasUsername = profile?.username !== undefined && profile?.username !== null;
  const username = hasUsername
    ? normalizeUsername(profile.username, false)
    : normalizeUsername(previous?.username || "", false);

  const hasFirstName = profile?.first_name !== undefined && profile?.first_name !== null && String(profile.first_name).trim() !== "";
  const firstName = hasFirstName
    ? (cleanPlainText(profile.first_name, 64) || "Пользователь")
    : (cleanPlainText(previous?.first_name || "Пользователь", 64) || "Пользователь");

  if (previous
    && previous.first_name === firstName
    && normalizeUsername(previous.username || "", false) === username) {
    return;
  }

  await env.DB.put(key, JSON.stringify({
    id: userId,
    first_name: firstName,
    username,
    updatedAt: new Date().toISOString()
  }));

  const previousUsername = normalizeUsername(previous?.username || "", false);
  if (previousUsername && previousUsername !== username) {
    const oldMapping = await env.DB.get(usernameKey(previousUsername));
    if (Number(oldMapping) === userId) {
      await env.DB.delete(usernameKey(previousUsername));
    }
  }
  if (username) {
    await env.DB.put(usernameKey(username), String(userId));
  }
}

export async function loadProfile(env, userId) {
  const directory = await env.DB.get(directoryKey(userId), "json");
  if (directory && typeof directory === "object") {
    return {
      id: userId,
      first_name: cleanPlainText(directory.first_name || "Пользователь", 64) || "Пользователь",
      username: normalizeUsername(directory.username || "", false)
    };
  }
  const stored = await env.DB.get(`user:${userId}`, "json");
  return {
    id: userId,
    first_name: cleanPlainText(stored?.owner?.first_name || "Пользователь", 64) || "Пользователь",
    username: normalizeUsername(stored?.owner?.username || "", false)
  };
}

export async function resolveUserByUsername(env, rawUsername) {
  const username = normalizeUsername(rawUsername, true);
  const userId = Number(await env.DB.get(usernameKey(username)));
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return await loadProfile(env, userId);
}

export async function readSubscriptions(env, userId) {
  const stored = await env.DB.get(subscriptionsKey(userId), "json");
  if (!Array.isArray(stored)) return [];
  const ids = [];
  for (const rawId of stored) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || id === userId || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_SOCIAL_ITEMS) break;
  }
  return ids;
}

export async function addSubscription(env, viewerId, targetId) {
  if (viewerId === targetId) {
    throw new ApiError(400, "You cannot subscribe to yourself");
  }
  const subscriptions = await readSubscriptions(env, viewerId);
  if (!subscriptions.includes(targetId)) {
    if (subscriptions.length >= MAX_SOCIAL_ITEMS) {
      throw new ApiError(409, "Subscriptions limit reached");
    }
    subscriptions.unshift(targetId);
    await env.DB.put(subscriptionsKey(viewerId), JSON.stringify(subscriptions));
  }
  await addSubscriber(env, targetId, viewerId);
}

export async function readSubscribers(env, ownerId) {
  const stored = await env.DB.get(subscribersKey(ownerId), "json");
  if (!Array.isArray(stored)) return [];
  const ids = [];
  for (const rawId of stored) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || id === ownerId || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_SOCIAL_ITEMS) break;
  }
  return ids;
}

export async function addSubscriber(env, ownerId, viewerId) {
  if (ownerId === viewerId) return;
  const subscribers = await readSubscribers(env, ownerId);
  if (subscribers.includes(viewerId)) return;
  subscribers.unshift(viewerId);
  if (subscribers.length > MAX_SOCIAL_ITEMS) subscribers.length = MAX_SOCIAL_ITEMS;
  await env.DB.put(subscribersKey(ownerId), JSON.stringify(subscribers));
}

export async function removeSubscriber(env, ownerId, viewerId) {
  const subscribers = (await readSubscribers(env, ownerId)).filter(id => id !== viewerId);
  await env.DB.put(subscribersKey(ownerId), JSON.stringify(subscribers));
}

export async function loadGroups(env, ownerId) {
  const stored = await env.DB.get(groupsKey(ownerId), "json");
  if (!stored || !Array.isArray(stored.items)) {
    return DEFAULT_GROUPS.map(definition => ({ ...definition, memberIds: [] }));
  }

  const groups = [];
  const seenIds = new Set();
  for (const saved of stored.items) {
    const id = normalizeGroupId(saved?.id);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const rawName = typeof saved?.name === "string" ? saved.name.trim().slice(0, 32) : "";
    const name = rawName || LEGACY_GROUP_NAMES[id] || id;
    const memberIds = [];
    for (const rawId of Array.isArray(saved?.memberIds) ? saved.memberIds : []) {
      const memberId = Number(rawId);
      if (!Number.isSafeInteger(memberId) || memberId <= 0
        || memberId === ownerId || memberIds.includes(memberId)) continue;
      memberIds.push(memberId);
      if (memberIds.length >= MAX_SOCIAL_ITEMS) break;
    }
    groups.push({ id, name, memberIds });
    if (groups.length >= MAX_GROUPS) break;
  }
  return groups;
}

export async function saveGroups(env, ownerId, groups) {
  await env.DB.put(groupsKey(ownerId), JSON.stringify({
    items: groups.map(group => ({
      id: group.id,
      name: group.name,
      memberIds: group.memberIds
    })),
    updatedAt: new Date().toISOString()
  }));
}

export function getGroup(groups, rawGroupId) {
  const groupId = String(rawGroupId || "");
  const group = groups.find(item => item.id === groupId);
  if (!group) throw new ApiError(400, "Unknown group");
  return group;
}

export async function readExpenseContacts(env, userId) {
  if (!env?.DB) return [];
  const stored = await env.DB.get(expenseContactsKey(userId), "json");
  if (!Array.isArray(stored)) return [];
  const ids = [];
  for (const rawId of stored) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || id === userId || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_SOCIAL_ITEMS) break;
  }
  return ids;
}

export async function addExpenseContact(env, viewerId, targetId) {
  if (!env?.DB || !viewerId || !targetId || Number(viewerId) === Number(targetId)) return;
  const contacts = await readExpenseContacts(env, viewerId);
  const filtered = contacts.filter(id => id !== Number(targetId));
  filtered.unshift(Number(targetId));
  if (filtered.length > MAX_SOCIAL_ITEMS) filtered.length = MAX_SOCIAL_ITEMS;
  await env.DB.put(expenseContactsKey(viewerId), JSON.stringify(filtered));
}

export async function loadExpenseContactsProfiles(env, viewerId) {
  if (!env?.DB) return [];
  const ids = await readExpenseContacts(env, viewerId);
  const profiles = [];
  for (const id of ids) {
    profiles.push(await loadProfile(env, id));
  }
  return profiles;
}

export async function buildSocialPayload(env, viewerId) {
  const subscriptions = await readSubscriptions(env, viewerId);
  const groups = await loadGroups(env, viewerId);
  const profiles = new Map();
  const getProfile = async userId => {
    if (!profiles.has(userId)) profiles.set(userId, await loadProfile(env, userId));
    return profiles.get(userId);
  };

  const subscriptionItems = [];
  for (const ownerId of subscriptions) subscriptionItems.push(await getProfile(ownerId));
  const groupItems = [];
  for (const group of groups) {
    const members = [];
    for (const memberId of group.memberIds) members.push(await getProfile(memberId));
    groupItems.push({ id: group.id, name: group.name, members });
  }
  return { subscriptions: subscriptionItems, groups: groupItems };
}

function normalizeOccasions(rawOccasions) {
  const occasions = [];
  const seen = new Set();
  for (const rawOcc of Array.isArray(rawOccasions) ? rawOccasions : []) {
    const id = normalizeOccasionId(rawOcc?.id);
    const title = typeof rawOcc?.title === "string" ? rawOcc.title.trim().slice(0, 40) : "";
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    occasions.push({ id, title });
    if (occasions.length >= MAX_OCCASIONS) break;
  }
  return occasions;
}

export async function loadWishlist(env, ownerId) {
  const [raw, directory] = await Promise.all([
    env.DB.get(`user:${ownerId}`, "json"),
    env.DB.get(directoryKey(ownerId), "json")
  ]);
  const fallback = directory && typeof directory === "object" ? directory : null;
  if (!raw || typeof raw !== "object") {
    return {
      owner: {
        id: ownerId,
        first_name: cleanPlainText(fallback?.first_name, 64) || "Пользователь",
        username: fallback?.username ? normalizeUsername(fallback.username, false) : ""
      },
      occasions: [],
      gifts: []
    };
  }
  return {
    owner: {
      id: ownerId,
      first_name:
        cleanPlainText(raw.owner?.first_name, 64) ||
        cleanPlainText(fallback?.first_name, 64) ||
        "Пользователь",
      username:
        (raw.owner?.username ? normalizeUsername(raw.owner.username, false) : "") ||
        (fallback?.username ? normalizeUsername(fallback.username, false) : "")
    },
    occasions: normalizeOccasions(raw.occasions),
    gifts: Array.isArray(raw.gifts) ? raw.gifts : []
  };
}

export async function saveWishlist(env, ownerId, record) {
  await env.DB.put(`user:${ownerId}`, JSON.stringify({
    owner: record.owner,
    occasions: Array.isArray(record.occasions) ? record.occasions : [],
    gifts: record.gifts,
    updatedAt: new Date().toISOString()
  }));
}

export function getInternalImageId(imagePath) {
  const text = String(imagePath || "");
  if (!text.startsWith("/api/img/")) return "";
  const id = text.slice("/api/img/".length);
  return /^[a-z0-9_-]{8,64}$/i.test(id) ? id : "";
}

export function detectImageType(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 12) return "";
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (isJpeg) return "image/jpeg";
  if (isWebp) return "image/webp";
  return "";
}

export async function assertInternalImageOwnership(env, ownerId, imagePath) {
  const imageId = getInternalImageId(imagePath);
  if (!imageId) return;
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, "arrayBuffer");
  if (!value) {
    throw new ApiError(400, "Image not found");
  }
  if (Number(metadata?.ownerId) !== Number(ownerId)) {
    throw new ApiError(403, "This image belongs to another user");
  }
}

export async function cloneInternalImage(env, sourceImagePath, targetOwnerId) {
  const sourceImageId = getInternalImageId(sourceImagePath);
  if (!sourceImageId) return "";
  const { value, metadata } = await env.DB.getWithMetadata(`img:${sourceImageId}`, "arrayBuffer");
  if (!value) return "";
  const newImageId = crypto.randomUUID().replaceAll("-", "");
  const contentType = metadata?.contentType || "image/webp";
  await env.DB.put(`img:${newImageId}`, value, {
    metadata: {
      ownerId: String(targetOwnerId),
      contentType,
      uploadedAt: new Date().toISOString()
    }
  });
  return `/api/img/${newImageId}`;
}

export async function deleteInternalImage(env, imagePath, ownerId) {
  const imageId = getInternalImageId(imagePath);
  if (!imageId) return;
  try {
    const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, "arrayBuffer");
    if (!value || Number(metadata?.ownerId) !== Number(ownerId)) return;
    await env.DB.delete(`img:${imageId}`);
  } catch (error) {
    console.error("Failed to delete unused image:", error?.message || error);
  }
}

export async function handleImageUpload(request, env, viewer) {
  assertContentLength(request, MAX_UPLOAD_REQUEST_BYTES);
  let formData;
  try {
    formData = await request.formData();
  } catch {
    throw new ApiError(400, "Invalid multipart form data");
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new ApiError(400, "Missing image file");
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(413, "Image must be smaller than 512 KB");
  }

  const contentType = detectImageType(buffer);
  if (!contentType) {
    throw new ApiError(415, "Only WebP and JPEG images are supported");
  }

  const imageId = crypto.randomUUID().replaceAll("-", "");
  await env.DB.put(`img:${imageId}`, buffer, {
    metadata: {
      contentType,
      ownerId: String(viewer.id),
      uploadedAt: new Date().toISOString()
    }
  });

  return json({ url: `/api/img/${imageId}` }, 201);
}

export async function handleImageGet(env, viewer, imageId, canViewerAccessGiftFn) {
  if (!/^[a-z0-9_-]{8,64}$/i.test(imageId)) {
    throw new ApiError(400, "Invalid image ID");
  }
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, "arrayBuffer");
  if (!value) {
    return json({ error: "Image not found" }, 404);
  }

  const ownerId = Number(metadata?.ownerId);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    return json({ error: "Image not found" }, 404);
  }

  if (viewer.id !== ownerId) {
    const record = await loadWishlist(env, ownerId);
    const groups = await loadGroups(env, ownerId);
    const imageUrl = `/api/img/${imageId}`;
    const linkedGifts = record.gifts.filter(gift => gift.image === imageUrl);
    const canView = linkedGifts.length > 0 && linkedGifts.some(gift =>
      canViewerAccessGiftFn(gift, ownerId, viewer.id, groups)
    );
    if (!canView) {
      return json({ error: "Image not found" }, 404);
    }
  }

  return new Response(value, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": metadata?.contentType || "application/octet-stream",
      "Content-Length": String(value.byteLength),
      "Cache-Control": "private, max-age=3600",
      "Vary": "X-Telegram-Init-Data",
      "ETag": `"${imageId}"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
