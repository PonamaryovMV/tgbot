const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const AUTH_TTL_SECONDS = 600;
const IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_GIFT_AUDIENCE_GROUPS = new Set(["contacts", "family", "girlfriend", "friends"]);
const SOCIAL_GROUPS = [
  { id: "contacts", name: "Контакты" },
  { id: "family", name: "Семья" },
  { id: "girlfriend", name: "Девушка" },
  { id: "friends", name: "Друзья" }
];
const MAX_SOCIAL_MEMBERS = 200;
const MAX_SUBSCRIPTIONS = 200;
const USER_SELECTION_TTL_SECONDS = 900;
const MAX_SHARED_USER_SELECTIONS = 10;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (path === "/" || path === "/health") {
      return json({ ok: true, service: "tg_podarki" });
    }
    if (path === "/api/config" && method === "GET") {
      try {
        return json({ botUsername: await getBotUsername(env) });
      } catch (error) {
        return json({ error: error.message || "Bot config is unavailable" }, error.status || 500);
      }
    }
    if (path === "/telegram/webhook" && method === "POST") {
      const update = await safeJson(request);
      queueWebhookUpdate(env, update);
      return json({ ok: true });
    }

    try {
      const imageMatch = path.match(/^\/api\/img\/([A-Za-z0-9_-]{16,64})$/);
      if (imageMatch && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return await handleImageRequest(env, imageMatch[1], user);
      }
      if (path === "/api/upload" && method === "POST") {
        const user = await authenticateTelegram(request, env);
        return await handleUpload(request, env, user);
      }
      if (path === "/api/social" && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return await handleSocialGet(env, user);
      }
      if (path === "/api/social" && method === "POST") {
        const user = await authenticateTelegram(request, env);
        return await handleSocialPost(request, env, user);
      }
      if (path === "/api/gifts" && method === "GET") {
        const user = await authenticateTelegram(request, env);
        const ownerId = parseId(url.searchParams.get("owner_id") || user.id, "owner_id");
        const wishlist = await loadWishlist(env, ownerId, user);
        const isOwner = ownerId === user.id;
        const groups = await getGroups(env, ownerId);
        const isSubscribed = isOwner ? false : await isViewerSubscribed(env, user.id, ownerId);
        return json({
          ...serializeWishlist(wishlist, user.id, groups),
          is_owner: isOwner,
          is_subscribed: isSubscribed
        });
      }
      if (path === "/api/participations" && method === "GET") {
        const user = await authenticateTelegram(request, env);
        return json({ items: await loadParticipations(env, user) });
      }
      if (path === "/api/gifts" && method === "POST") {
        const user = await authenticateTelegram(request, env);
        return await handleGiftMutation(request, env, user);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Worker request failed", { method, path, error: String(error?.stack || error) });
      const status = error.status || 500;
      return json({ error: status === 500 ? "Internal server error" : error.message }, status);
    }
  }
};

async function loadWishlist(env, ownerId, viewer) {
  const stored = await env.DB.get(`user:${ownerId}`, { type: "json" });
  const directory = await env.DB.get(directoryKey(ownerId), { type: "json" });
  const isOwner = ownerId === viewer.id;
  const ownerProfile = directory || stored?.owner || {};
  return {
    owner: {
      id: ownerId,
      first_name: cleanPlainText(isOwner ? viewer.first_name : ownerProfile.first_name || "", 64),
      username: normalizeUsername(isOwner ? viewer.username : ownerProfile.username || "", false)
    },
    gifts: Array.isArray(stored?.gifts) ? stored.gifts : []
  };
}

function serializeWishlist(wishlist, viewerId, groups = []) {
  const isOwner = wishlist.owner.id === viewerId;
  return {
    owner: wishlist.owner,
    gifts: wishlist.gifts
      .filter(gift => canViewerAccessGift(gift, groups, wishlist.owner.id, viewerId))
      .map(gift => serializeGift(gift, viewerId, isOwner))
  };
}

function canViewerAccessGift(gift, groups, ownerId, viewerId) {
  if (ownerId === viewerId) return true;
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return true;
  return groupIds.some(groupId => {
    const group = groups.find(item => item.id === groupId);
    return group?.memberIds.includes(viewerId);
  });
}

function assertGiftVisible(gift, groups, ownerId, viewerId) {
  if (!canViewerAccessGift(gift, groups, ownerId, viewerId)) {
    throw new HttpError(404, "Gift not found");
  }
}

function serializeGift(gift, viewerId, isOwner = false) {
  const contributors = new Set(Array.isArray(gift.contributor_ids) ? gift.contributor_ids : []);
  const bookerId = gift.booked_by || null;
  const isBooker = bookerId === viewerId;
  const isContributor = contributors.has(viewerId);
  return {
    id: gift.id,
    title: gift.title,
    image: gift.image || "",
    price: gift.price || "",
    price_value: Number.isFinite(Number(gift.price_value)) ? Number(gift.price_value) : 0,
    shop: gift.shop || "",
    desire: gift.desire || "medium",
    tags: Array.isArray(gift.tags) ? gift.tags : [],
    group_ids: Array.isArray(gift.group_ids) ? gift.group_ids : [],
    crowdfund: Boolean(gift.crowdfund),
    booked: Boolean(bookerId),
    contributors: contributors.size,
    viewer_booked: isBooker,
    viewer_contributes: isContributor,
    booked_by: !isOwner && isBooker ? viewerId : null,
    contributor_ids: !isOwner && isContributor ? [viewerId] : []
  };
}

async function handleGiftMutation(request, env, viewer) {
  const body = await safeJson(request);
  if (!body) throw new HttpError(400, "JSON body required");
  const action = String(body.action || "");
  const targetOwnerId = parseId(body.owner_id || viewer.id, "owner_id");
  const isOwnerMutation = ["create", "update", "delete"].includes(action);
  if (isOwnerMutation && targetOwnerId !== viewer.id) throw new HttpError(403, "Owner access required");
  if (!["create", "update", "delete", "toggle_book", "toggle_crowdfund"].includes(action)) {
    throw new HttpError(400, "Unknown action");
  }
  const wishlist = await loadWishlist(env, targetOwnerId, viewer);
  const groups = await getGroups(env, targetOwnerId);
  let changedGift = null;
  let shouldDeleteGift = false;

  if (action === "create") {
    const gift = validateGift({ ...body.gift, id: randomId() });
    wishlist.gifts.push(gift);
    changedGift = gift;
  } else {
    const giftId = parseId(body.id, "gift id");
    const gift = wishlist.gifts.find(item => item.id === giftId);
    if (!gift) throw new HttpError(404, "Gift not found");
    if (!isOwnerMutation) assertGiftVisible(gift, groups, targetOwnerId, viewer.id);
    changedGift = gift;

    if (action === "delete") {
      await cleanupImage(env, gift.image, viewer.id);
      wishlist.gifts = wishlist.gifts.filter(item => item.id !== giftId);
      shouldDeleteGift = true;
    } else if (action === "update") {
      const previousImage = gift.image;
      const validated = validateGift({ ...gift, ...body.gift, id: gift.id });
      const previousBooker = gift.booked_by || null;
      const previousContributors = new Set(gift.contributor_ids || []);
      Object.assign(gift, validated);
      gift.booked_by = previousBooker;
      gift.contributor_ids = [...previousContributors];
      await cleanupAudienceParticipations(env, targetOwnerId, gift, groups);
      if (previousImage && previousImage !== gift.image) await cleanupImage(env, previousImage, viewer.id);
    } else if (action === "toggle_book") {
      if (gift.crowdfund) throw new HttpError(400, "This gift uses crowdfund");
      if (gift.booked_by === viewer.id) {
        gift.booked_by = null;
      } else if (gift.booked_by) {
        throw new HttpError(409, "Gift is already booked");
      } else {
        gift.booked_by = viewer.id;
      }
    } else if (action === "toggle_crowdfund") {
      if (!gift.crowdfund) throw new HttpError(400, "Crowdfund is disabled");
      const contributors = new Set(gift.contributor_ids || []);
      if (contributors.has(viewer.id)) contributors.delete(viewer.id);
      else contributors.add(viewer.id);
      gift.contributor_ids = [...contributors];
    }
  }

  await saveWishlist(env, wishlist);
  await syncParticipationIndex(env, targetOwnerId, changedGift, shouldDeleteGift ? "delete" : action);
  return json({
    ok: true,
    ...serializeWishlist(wishlist, viewer.id, groups)
  });
}

function validateGift(input) {
  const title = cleanPlainText(input.title, 120);
  if (!title) throw new HttpError(400, "Title is required");
  const desire = ["high", "medium", "low"].includes(input.desire) ? input.desire : "medium";
  const price = cleanPlainText(input.price, 64);
  const priceValue = Number(input.price_value);
  const shop = cleanUrl(input.shop || "", 2048);
  const image = cleanImageUrl(input.image || "", 2048);
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : [])
    .map(tag => cleanPlainText(tag, 32))
    .filter(Boolean))].slice(0, 8);
  const groupIds = [...new Set((Array.isArray(input.group_ids) ? input.group_ids : [])
    .map(value => String(value))
    .filter(value => ALLOWED_GIFT_AUDIENCE_GROUPS.has(value)))];
  return {
    id: parseId(input.id || randomId(), "gift id"),
    title,
    image,
    price,
    price_value: Number.isFinite(priceValue) ? Math.max(0, Math.min(priceValue, 1e12)) : 0,
    shop,
    desire,
    tags,
    group_ids: groupIds,
    crowdfund: Boolean(input.crowdfund),
    booked_by: null,
    contributor_ids: []
  };
}

function participationKey(userId) {
  return `participations:${userId}`;
}

function subscriptionsKey(userId) {
  return `subscriptions:${userId}`;
}

function groupsKey(ownerId) {
  return `groups:${ownerId}`;
}

function directoryKey(userId) {
  return `directory:${userId}`;
}

function usernameKey(username) {
  return `username:${normalizeUsername(username)}`;
}

function selectionKey(requestId) {
  return `selection:${requestId}`;
}

function normalizeUsername(value, required = true) {
  const username = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  if (!username && !required) return "";
  if (!/^[a-z0-9_]{5,32}$/.test(username)) {
    throw new HttpError(400, "Enter a valid Telegram @username");
  }
  return username;
}

async function rememberTelegramUser(env, profile) {
  const userId = parseId(profile?.id, "user id");
  const username = normalizeUsername(profile?.username || "", false);
  const firstName = cleanPlainText(profile?.first_name || "Пользователь", 64) || "Пользователь";
  const key = directoryKey(userId);
  const previous = await env.DB.get(key, { type: "json" });
  if (previous && previous.first_name === firstName
    && normalizeUsername(previous.username || "", false) === username) return;

  await env.DB.put(key, JSON.stringify({
    id: userId,
    first_name: firstName,
    username,
    updatedAt: new Date().toISOString()
  }));

  const previousUsername = normalizeUsername(previous?.username || "", false);
  if (previousUsername && previousUsername !== username) {
    const oldMapping = await env.DB.get(usernameKey(previousUsername));
    if (Number(oldMapping) === userId) await env.DB.delete(usernameKey(previousUsername));
  }
  if (username) await env.DB.put(usernameKey(username), String(userId));
}

async function resolveUserIdByUsername(env, username) {
  const normalized = normalizeUsername(username);
  const value = await env.DB.get(usernameKey(normalized));
  return value ? parseId(value, "user id") : null;
}

async function loadDirectoryProfile(env, userId) {
  const profile = await env.DB.get(directoryKey(userId), { type: "json" });
  return profile && parseId(profile.id, "user id") === userId ? profile : null;
}

async function getSubscriptions(env, viewerId) {
  const value = await env.DB.get(subscriptionsKey(viewerId), { type: "json" });
  return [...new Set(Array.isArray(value) ? value.map(Number).filter(id => Number.isSafeInteger(id) && id > 0) : [])];
}

async function saveSubscriptions(env, viewerId, ownerIds) {
  await env.DB.put(subscriptionsKey(viewerId), JSON.stringify([...new Set(ownerIds)].slice(0, MAX_SUBSCRIPTIONS)));
}

async function isViewerSubscribed(env, viewerId, ownerId) {
  return (await getSubscriptions(env, viewerId)).includes(ownerId);
}

function emptyGroups() {
  return SOCIAL_GROUPS.map(group => ({ ...group, memberIds: [] }));
}

async function getGroups(env, ownerId) {
  const stored = await env.DB.get(groupsKey(ownerId), { type: "json" });
  return SOCIAL_GROUPS.map(group => {
    const source = stored?.find?.(item => item.id === group.id);
    const memberIds = [...new Set((Array.isArray(source?.memberIds) ? source.memberIds : [])
      .map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id !== ownerId))]
      .slice(0, MAX_SOCIAL_MEMBERS);
    return { ...group, memberIds };
  });
}

async function saveGroups(env, ownerId, groups) {
  await env.DB.put(groupsKey(ownerId), JSON.stringify(groups.map(group => ({
    id: group.id,
    memberIds: group.memberIds.slice(0, MAX_SOCIAL_MEMBERS)
  }))));
}

function serializeGroup(group, subscriptions = []) {
  return {
    id: group.id,
    name: group.name,
    members: group.memberIds.map(userId => ({
      id: userId,
      display_name: `Telegram ID: ${userId}`
    })),
    nonMembers: subscriptions.filter(id => !group.memberIds.includes(id))
  };
}

async function handleSocialGet(env, viewer) {
  const [subscriptionIds, groups] = await Promise.all([
    getSubscriptions(env, viewer.id),
    getGroups(env, viewer.id)
  ]);
  const subscriptions = [];
  for (const ownerId of subscriptionIds) {
    const [profile, stored] = await Promise.all([
      loadDirectoryProfile(env, ownerId),
      env.DB.get(`user:${ownerId}`, { type: "json" })
    ]);
    const owner = stored?.owner || profile || {};
    subscriptions.push({
      id: ownerId,
      name: cleanPlainText(profile?.first_name || owner.first_name || "Пользователь", 64) || "Пользователь",
      username: normalizeUsername(profile?.username || owner.username || "", false)
    });
  }
  return json({
    subscriptions,
    groups: groups.map(group => serializeGroup(group, subscriptionIds))
  });
}

async function handleSocialPost(request, env, viewer) {
  const body = await safeJson(request);
  if (!body) throw new HttpError(400, "JSON body required");
  const action = String(body.action || "");

  if (["subscribe", "add_group_member"].includes(action)) {
    const requestedUsername = normalizeUsername(body.username || "", false);
    let targetId = body.user_id ? parseId(body.user_id, "user id") : null;
    if (!targetId && requestedUsername) targetId = await resolveUserIdByUsername(env, requestedUsername);
    if (!targetId && action === "subscribe") {
      if (!requestedUsername) throw new HttpError(400, "Enter @username");
      return await requestTelegramUserSelection(env, viewer, {
        action,
        requestedUsername
      });
    }
    if (!targetId) throw new HttpError(404, "User must open this Mini App first");
    if (targetId === viewer.id) throw new HttpError(400, "Choose another Telegram user");
    if (action === "subscribe") {
      const result = await completeSubscription(env, viewer.id, targetId);
      return json({ ok: true, ...result });
    }
    const groupId = String(body.group_id || "");
    const result = await completeGroupMemberAddition(env, viewer.id, groupId, targetId);
    return json({ ok: true, ...result });
  }

  if (action === "unsubscribe") {
    const ownerId = parseId(body.user_id, "user id");
    const subscriptions = await getSubscriptions(env, viewer.id);
    await saveSubscriptions(env, viewer.id, subscriptions.filter(id => id !== ownerId));
    return json({ ok: true });
  }

  if (action === "remove_group_member") {
    const groupId = String(body.group_id || "");
    const targetId = parseId(body.user_id, "user id");
    if (!SOCIAL_GROUPS.some(group => group.id === groupId)) throw new HttpError(400, "Unknown group");
    const groups = await getGroups(env, viewer.id);
    const group = groups.find(item => item.id === groupId);
    group.memberIds = group.memberIds.filter(id => id !== targetId);
    await saveGroups(env, viewer.id, groups);
    await revokeInaccessibleParticipations(env, viewer.id, targetId, groups);
    return json({ ok: true, group: serializeGroup(group, await getSubscriptions(env, viewer.id)) });
  }

  throw new HttpError(400, "Unknown social action");
}

async function completeSubscription(env, viewerId, ownerId) {
  if (viewerId === ownerId) throw new HttpError(400, "Choose another Telegram user");
  const subscriptions = await getSubscriptions(env, viewerId);
  if (!subscriptions.includes(ownerId)) {
    if (subscriptions.length >= MAX_SUBSCRIPTIONS) throw new HttpError(400, "Subscription limit reached");
    subscriptions.push(ownerId);
    await saveSubscriptions(env, viewerId, subscriptions);
  }
  const [profile, stored] = await Promise.all([
    loadDirectoryProfile(env, ownerId),
    env.DB.get(`user:${ownerId}`, { type: "json" })
  ]);
  const owner = stored?.owner || profile || {};
  return {
    subscription: {
      id: ownerId,
      name: cleanPlainText(profile?.first_name || owner.first_name || "Пользователь", 64) || "Пользователь",
      username: normalizeUsername(profile?.username || owner.username || "", false)
    }
  };
}

async function completeGroupMemberAddition(env, ownerId, groupId, targetId) {
  if (!SOCIAL_GROUPS.some(group => group.id === groupId)) throw new HttpError(400, "Unknown group");
  if (targetId === ownerId) throw new HttpError(400, "Choose another Telegram user");
  const groups = await getGroups(env, ownerId);
  const group = groups.find(item => item.id === groupId);
  if (!group.memberIds.includes(targetId)) {
    if (group.memberIds.length >= MAX_SOCIAL_MEMBERS) throw new HttpError(400, "Group member limit reached");
    group.memberIds.push(targetId);
    await saveGroups(env, ownerId, groups);
  }
  return { group: serializeGroup(group, await getSubscriptions(env, ownerId)) };
}

async function requestTelegramUserSelection(env, viewer, pending) {
  const botUsername = await getBotUsername(env);
  const requestId = randomRequestId();
  await env.DB.put(selectionKey(requestId), JSON.stringify({
    requesterId: viewer.id,
    action: pending.action,
    requestedUsername: pending.requestedUsername,
    createdAt: new Date().toISOString()
  }), { expirationTtl: USER_SELECTION_TTL_SECONDS });
  return json({
    status: "selection_required",
    requestId,
    botUsername
  }, 202);
}

async function loadParticipations(env, viewer) {
  const key = participationKey(viewer.id);
  const stored = await env.DB.get(key, { type: "json" });
  if (!Array.isArray(stored)) return [];
  const validEntries = stored.filter(entry =>
    Number.isSafeInteger(Number(entry?.ownerId)) && Number(entry.ownerId) > 0
    && Number.isSafeInteger(Number(entry?.giftId)) && Number(entry.giftId) > 0
  );
  const items = [];
  const activeEntries = [];
  let changed = validEntries.length !== stored.length;

  for (const entry of validEntries) {
    const ownerId = Number(entry.ownerId);
    const giftId = Number(entry.giftId);
    const wishlist = await loadWishlist(env, ownerId, viewer);
    const groups = await getGroups(env, ownerId);
    const gift = wishlist.gifts.find(item => item.id === giftId);
    if (!gift || !canViewerAccessGift(gift, groups, ownerId, viewer.id)) {
      changed = true;
      continue;
    }
    const isBooker = !gift.crowdfund && gift.booked_by === viewer.id;
    const isContributor = Boolean(gift.crowdfund) && (gift.contributor_ids || []).includes(viewer.id);
    if (!isBooker && !isContributor) {
      changed = true;
      continue;
    }
    items.push({
      ownerId,
      ownerName: wishlist.owner.first_name,
      gift: serializeGift(gift, viewer.id),
      type: isBooker ? "booked" : "crowdfund"
    });
    activeEntries.push({ ownerId, giftId });
    if (entry.type && entry.type !== (isBooker ? "booked" : "crowdfund")) changed = true;
  }
  if (changed) {
    if (activeEntries.length) await env.DB.put(key, JSON.stringify(activeEntries));
    else await env.DB.delete(key);
  }
  return items;
}

async function syncParticipationIndex(env, ownerId, gift, action) {
  if (!gift) return;
  if (["create", "update", "delete"].includes(action)) {
    const previousBooker = gift.booked_by || null;
    const previousContributors = new Set(gift.contributor_ids || []);
    if (action === "update" && gift.crowdfund && previousBooker) {
      await removeParticipation(env, previousBooker, ownerId, gift.id);
      gift.booked_by = null;
    }
    if (action === "update" && !gift.crowdfund && previousContributors.size) {
      for (const userId of previousContributors) await removeParticipation(env, userId, ownerId, gift.id);
      gift.contributor_ids = [];
      await saveWishlist(env, await loadWishlist(env, ownerId, { id: ownerId }));
    }
  }
  if (action === "delete") {
    await removeGiftFromAllParticipants(env, ownerId, gift);
    return;
  }
  if (gift.booked_by) await addParticipation(env, gift.booked_by, ownerId, gift.id);
  for (const userId of gift.contributor_ids || []) await addParticipation(env, userId, ownerId, gift.id);
  if (action === "toggle_book") {
    const entries = await getParticipationEntries(env, ownerId, gift.id);
    for (const userId of entries) {
      if (userId !== gift.booked_by) await removeParticipation(env, userId, ownerId, gift.id);
    }
  }
  if (action === "toggle_crowdfund") {
    const current = new Set(gift.contributor_ids || []);
    const entries = await getParticipationEntries(env, ownerId, gift.id);
    for (const userId of entries) {
      if (!current.has(userId)) await removeParticipation(env, userId, ownerId, gift.id);
    }
  }
}

async function cleanupAudienceParticipations(env, ownerId, gift, groups) {
  const participantIds = new Set([
    ...(gift.booked_by ? [gift.booked_by] : []),
    ...(Array.isArray(gift.contributor_ids) ? gift.contributor_ids : [])
  ]);
  let changed = false;
  if (gift.booked_by && !canViewerAccessGift(gift, groups, ownerId, gift.booked_by)) {
    await removeParticipation(env, gift.booked_by, ownerId, gift.id);
    gift.booked_by = null;
    changed = true;
  }
  const contributors = [];
  for (const userId of gift.contributor_ids || []) {
    if (canViewerAccessGift(gift, groups, ownerId, userId)) contributors.push(userId);
    else {
      await removeParticipation(env, userId, ownerId, gift.id);
      changed = true;
    }
  }
  gift.contributor_ids = contributors;
  for (const userId of participantIds) {
    if (!canViewerAccessGift(gift, groups, ownerId, userId)) {
      await removeParticipation(env, userId, ownerId, gift.id);
    }
  }
  return changed;
}

async function revokeInaccessibleParticipations(env, ownerId, viewerId, groups) {
  const stored = await env.DB.get(`user:${ownerId}`, { type: "json" });
  if (!stored || !Array.isArray(stored.gifts)) return;
  const entries = await env.DB.get(participationKey(viewerId), { type: "json" });
  if (!Array.isArray(entries)) return;
  const giftIds = new Set(entries
    .filter(entry => Number(entry.ownerId) === ownerId)
    .map(entry => Number(entry.giftId)));
  if (!giftIds.size) return;
  let changed = false;
  for (const gift of stored.gifts) {
    if (!giftIds.has(gift.id) || canViewerAccessGift(gift, groups, ownerId, viewerId)) continue;
    if (gift.booked_by === viewerId) {
      gift.booked_by = null;
      changed = true;
    }
    const before = (gift.contributor_ids || []).length;
    gift.contributor_ids = (gift.contributor_ids || []).filter(id => id !== viewerId);
    if (gift.contributor_ids.length !== before) changed = true;
  }
  if (changed) {
    await env.DB.put(`user:${ownerId}`, JSON.stringify(stored));
    await removeParticipation(env, viewerId, ownerId, null, giftIds);
  }
}

async function getParticipationEntries(env, ownerId, giftId) {
  // Participation keys are maintained incrementally; this function only needs users
  // already attached to the gift, plus stale bookers removed by the current mutation.
  const wishlist = await env.DB.get(`user:${ownerId}`, { type: "json" });
  const gift = wishlist?.gifts?.find(item => item.id === giftId);
  return [...new Set([
    ...(gift?.booked_by ? [gift.booked_by] : []),
    ...(gift?.contributor_ids || [])
  ])];
}

async function addParticipation(env, userId, ownerId, giftId) {
  if (!userId) return;
  const key = participationKey(userId);
  const entries = await env.DB.get(key, { type: "json" }) || [];
  if (!entries.some(entry => Number(entry.ownerId) === ownerId && Number(entry.giftId) === giftId)) {
    entries.push({ ownerId, giftId });
    await env.DB.put(key, JSON.stringify(entries));
  }
}

async function removeParticipation(env, userId, ownerId, giftId, giftIds = null) {
  const key = participationKey(userId);
  const entries = await env.DB.get(key, { type: "json" });
  if (!Array.isArray(entries)) return;
  const next = entries.filter(entry => {
    if (Number(entry.ownerId) !== ownerId) return true;
    if (giftIds) return !giftIds.has(Number(entry.giftId));
    return Number(entry.giftId) !== giftId;
  });
  if (next.length === entries.length) return;
  if (next.length) await env.DB.put(key, JSON.stringify(next));
  else await env.DB.delete(key);
}

async function removeGiftFromAllParticipants(env, ownerId, gift) {
  const ids = new Set(gift.contributor_ids || []);
  if (gift.booked_by) ids.add(gift.booked_by);
  for (const userId of ids) await removeParticipation(env, userId, ownerId, gift.id);
}

async function saveWishlist(env, wishlist) {
  await env.DB.put(`user:${wishlist.owner.id}`, JSON.stringify(wishlist));
}

async function handleUpload(request, env, user) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) throw new HttpError(413, "Request is too large");
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "Image file required");
  if (!ALLOWED_IMAGE_MIME.has(file.type)) throw new HttpError(400, "Only JPEG, PNG, WEBP or GIF");
  const maxBytes = Number(env.MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES);
  if (file.size > maxBytes) throw new HttpError(413, "Image exceeds 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasValidImageSignature(bytes, file.type)) {
    throw new HttpError(400, "Invalid image content");
  }
  const imageId = randomImageId();
  await env.DB.put(`img:${imageId}`, bytes, {
    metadata: {
      ownerId: user.id,
      mime: file.type,
      size: file.size,
      createdAt: new Date().toISOString()
    }
  });
  return json({ ok: true, url: `/api/img/${imageId}`, maxEdge: MAX_IMAGE_EDGE });
}

async function handleImageRequest(env, imageId, user) {
  if (!IMAGE_ID_PATTERN.test(imageId)) throw new HttpError(404, "Image not found");
  const { value, metadata } = await env.DB.getWithMetadata(`img:${imageId}`, { type: "arrayBuffer" });
  if (!value) throw new HttpError(404, "Image not found");
  const ownerId = Number(metadata?.ownerId);
  const isOwner = Number.isSafeInteger(ownerId) && ownerId > 0 && ownerId === user.id;
  if (!isOwner) {
    const allowed = await canViewerAccessImage(env, ownerId, imageId, user.id);
    if (!allowed) throw new HttpError(404, "Image not found");
  }
  const mime = ALLOWED_IMAGE_MIME.has(metadata?.mime) ? metadata.mime : "application/octet-stream";
  return new Response(value, {
    headers: {
      ...corsHeaders(),
      "Content-Type": mime,
      "Content-Length": String(value.byteLength),
      "Cache-Control": "private, max-age=3600",
      "Vary": "X-Telegram-Init-Data",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function canViewerAccessImage(env, ownerId, imageId, viewerId) {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return false;
  const wishlist = await loadWishlist(env, ownerId, { id: viewerId, first_name: "", username: "" });
  const groups = await getGroups(env, ownerId);
  const internalUrl = `/api/img/${imageId}`;
  return wishlist.gifts.some(gift => gift.image === internalUrl
    && canViewerAccessGift(gift, groups, ownerId, viewerId));
}

async function cleanupImage(env, imageUrl, ownerId) {
  const match = String(imageUrl || "").match(/^\/api\/img\/([A-Za-z0-9_-]{16,64})$/);
  if (!match) return;
  const key = `img:${match[1]}`;
  const { metadata } = await env.DB.getWithMetadata(key);
  if (Number(metadata?.ownerId) === ownerId) await env.DB.delete(key);
}

function hasValidImageSignature(bytes, mime) {
  const starts = (...signature) => signature.every((byte, index) => bytes[index] === byte);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mime === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)));
  return false;
}

async function authenticateTelegram(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data") || "";
  if (!initData) throw new HttpError(401, "Telegram initData required");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new HttpError(401, "Telegram hash required");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > AUTH_TTL_SECONDS) {
    throw new HttpError(401, "Telegram session expired");
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const token = await getBotToken(env);
  const secretKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secretBytes = await crypto.subtle.sign("HMAC", secretKey, new TextEncoder().encode(token));
  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataCheckString));
  const expectedHash = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (!timingSafeEqual(expectedHash, receivedHash)) throw new HttpError(401, "Invalid Telegram signature");
  let payload;
  try { payload = JSON.parse(params.get("user") || "{}"); }
  catch { throw new HttpError(401, "Invalid Telegram user"); }
  const userId = parseId(payload.id, "Telegram user");
  const user = {
    id: userId,
    first_name: cleanPlainText(payload.first_name || "Пользователь", 64) || "Пользователь",
    username: normalizeUsername(payload.username || "", false)
  };
  await rememberTelegramUser(env, user);
  return user;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function queueWebhookUpdate(env, update) {
  // Webhook work is deliberately isolated from the HTTP acknowledgement. Telegram
  // must receive 200 even if the bot token is temporarily misconfigured.
  try {
    if (!update || typeof update !== "object") return;
    if (typeof globalThis.caches === "undefined") {
      // Keeps local unit tests deterministic; deployed Workers always provide caches.
    }
    const task = handleUpdate(env, update).catch(error => {
      console.error("Telegram update failed", String(error?.stack || error));
    });
    // In a deployed Worker the request-scoped execution context keeps this promise
    // alive. The handler itself is synchronous from Telegram's point of view.
    if (env && env.__executionCtx && typeof env.__executionCtx.waitUntil === "function") {
      env.__executionCtx.waitUntil(task);
    }
  } catch (error) {
    console.error("Unable to queue Telegram update", String(error));
  }
}

async function handleUpdate(env, update) {
  const sharedUsers = update.message?.users_shared?.users
    || (update.message?.user_shared ? [update.message.user_shared] : []);
  if (sharedUsers.length) {
    await handleSharedUserSelection(env, update.message, sharedUsers);
    return;
  }
  const message = update.message || update.edited_message;
  const text = message?.text || "";
  const chatId = message?.chat?.id;
  if (!chatId || !text.startsWith("/start")) return;
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/);
  const payload = match?.[1]?.trim() || "";
  const ownerMatch = payload.match(/^list_(\d{1,20})$/);
  const ownerId = ownerMatch ? parseId(ownerMatch[1], "owner id") : message.from.id;
  await rememberTelegramUser(env, message.from);
  const baseUrl = String(env.WEBAPP_URL || "").replace(/\/$/, "");
  if (!baseUrl) return;
  const webAppUrl = `${baseUrl}/?list=${ownerId}`;
  const label = ownerId === message.from.id ? "🎁 Открыть мой вишлист" : "🎁 Открыть вишлист";
  await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text: ownerId === message.from.id
      ? "Добавляйте желания, делитесь вишлистом и управляйте группами доступа."
      : "Откройте вишлист: можно забронировать подарок или присоединиться к совместному сбору.",
    reply_markup: {
      inline_keyboard: [[{ text: label, web_app: { url: webAppUrl } }]]
    }
  });
}

async function handleSharedUserSelection(env, message, sharedUsers) {
  const requestId = String(
    message.users_shared?.request_id ?? message.user_shared?.request_id ?? ""
  );
  const requesterId = parseId(message.from?.id, "requester id");
  const chatId = message.chat?.id;
  if (!requestId || !chatId) return;
  const key = selectionKey(requestId);
  const pending = await env.DB.get(key, { type: "json" });
  if (!pending) {
    await telegramApi(env, "sendMessage", {
      chat_id: chatId,
      text: "Срок этого запроса истёк. Вернитесь в приложение и начните действие заново."
    });
    return;
  }
  if (parseId(pending.requesterId, "requester id") !== requesterId) {
    throw new HttpError(403, "This selection belongs to another user");
  }
  if (!sharedUsers.length || sharedUsers.length > MAX_SHARED_USER_SELECTIONS) {
    throw new HttpError(400, "Choose between 1 and 10 users");
  }
  const uniqueIds = new Set(sharedUsers.map(user => String(user.user_id)));
  if (uniqueIds.size !== sharedUsers.length) throw new HttpError(400, "Duplicate users selected");

  const selected = sharedUsers[0];
  const targetId = parseId(selected.user_id, "selected user id");
  if (targetId === requesterId) throw new HttpError(400, "Choose another Telegram user");
  const selectedProfile = {
    id: targetId,
    first_name: cleanPlainText(selected.first_name || "Пользователь", 64) || "Пользователь",
    username: normalizeUsername(selected.username || "", false)
  };
  await rememberTelegramUser(env, selectedProfile);

  if (pending.action === "subscribe") {
    await completeSubscription(env, requesterId, targetId);
  } else if (pending.action === "add_group_member") {
    await completeGroupMemberAddition(env, requesterId, pending.groupId, targetId);
  } else {
    throw new HttpError(400, "Unknown pending selection");
  }
  await env.DB.delete(key);

  const baseUrl = String(env.WEBAPP_URL || "").replace(/\/$/, "");
  const text = pending.action === "subscribe"
    ? "Готово: пользователь добавлен в ваши подписки."
    : "Готово: пользователь добавлен в выбранную группу.";
  await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text: `${text} Вернитесь в Mini App и обновите экран.`,
    ...(baseUrl ? {
      reply_markup: {
        inline_keyboard: [[{
          text: "Вернуться в приложение",
          web_app: { url: `${baseUrl}/` }
        }]]
      }
    } : {})
  });
}

async function getBotUsername(env) {
  const cached = await env.DB.get("config:bot", { type: "json" });
  if (cached?.username) return cached.username;
  const data = await telegramApi(env, "getMe", {});
  if (!data.ok || !data.result?.username) throw new HttpError(500, "Cannot get bot username");
  await env.DB.put("config:bot", JSON.stringify({ username: data.result.username }), { expirationTtl: 86400 });
  return data.result.username;
}

async function telegramApi(env, method, payload) {
  const token = await getBotToken(env);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new HttpError(502, data.description || "Telegram API error");
  return data;
}

async function getBotToken(env) {
  if (!env.BOT_TOKEN) throw new HttpError(500, "BOT_TOKEN is not configured");
  const value = typeof env.BOT_TOKEN === "object" && typeof env.BOT_TOKEN.get === "function"
    ? await env.BOT_TOKEN.get()
    : env.BOT_TOKEN;
  const token = String(value || "").trim();
  if (!token) throw new HttpError(500, "BOT_TOKEN is not configured");
  return token;
}

async function safeJson(request) {
  try { return await request.json(); }
  catch { return null; }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `Invalid ${label}`);
  return id;
}

function cleanPlainText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, maxLength);
}

function cleanUrl(value, maxLength) {
  const url = String(value || "").trim().slice(0, maxLength);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
    return parsed.toString();
  } catch {
    throw new HttpError(400, "Only valid http(s) links are allowed");
  }
}

function cleanImageUrl(value, maxLength) {
  const url = String(value || "").trim().slice(0, maxLength);
  if (!url || /^\/api\/img\/[A-Za-z0-9_-]{16,64}$/.test(url)) return url;
  return cleanUrl(url, maxLength);
}

function randomId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function randomImageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomRequestId() {
  return [...crypto.getRandomValues(new Uint8Array(18))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}
