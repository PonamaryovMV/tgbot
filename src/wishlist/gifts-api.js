import {
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  MAX_OCCASIONS,
  ApiError,
  json,
  readJsonBody,
  createShortId,
  dispatchBackground,
  cleanPlainText,
  normalizeUsername,
  parseId,
  sanitizeHttpUrl,
  sanitizeImage,
  sanitizePrice,
  sanitizeDesire,
  displayDesire,
  sanitizeTags,
  normalizeOccasionId,
  sanitizeGiftGroupIds,
  sanitizeGiftOccasionIds,
  sanitizeGroupName,
  sanitizeOccasionTitle,
  findGiftIndex,
  createGiftId
} from "./utils.js";
import {
  subscriptionsKey,
  participationsKey,
  loadProfile,
  resolveUserByUsername,
  readSubscriptions,
  addSubscription,
  addSubscriber,
  removeSubscriber,
  loadGroups,
  saveGroups,
  getGroup,
  buildSocialPayload,
  loadWishlist,
  saveWishlist,
  assertInternalImageOwnership,
  cloneInternalImage,
  deleteInternalImage
} from "./storage.js";
import {
  notifyGuestsBatch,
  notifySubscribersAboutNewGift,
  requestTelegramUserSelection
} from "./notifications.js";

export function collectGiftViewerIds(gift) {
  const ids = new Set();
  const bookedBy = Number(gift?.booked_by);
  if (Number.isSafeInteger(bookedBy) && bookedBy > 0) ids.add(bookedBy);
  for (const rawId of Array.isArray(gift?.participants) ? gift.participants : []) {
    const participantId = Number(rawId);
    if (Number.isSafeInteger(participantId) && participantId > 0) ids.add(participantId);
  }
  for (const rawId of Array.isArray(gift?.reusable_givers) ? gift.reusable_givers : []) {
    const giverId = Number(rawId);
    if (Number.isSafeInteger(giverId) && giverId > 0) ids.add(giverId);
  }
  return [...ids];
}

export function canViewerAccessGift(gift, ownerId, viewerId, groups = []) {
  if (Number(ownerId) === Number(viewerId)) return true;
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return true;
  return groupIds.some(groupId => {
    const group = groups.find(item => item.id === groupId);
    return Array.isArray(group?.memberIds) && group.memberIds.includes(Number(viewerId));
  });
}

export function assertGiftVisible(gift, ownerId, viewerId, groups = []) {
  if (!canViewerAccessGift(gift, ownerId, viewerId, groups)) {
    throw new ApiError(404, "Gift not found");
  }
}

function readParticipationEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

export async function syncWishlistParticipation(env, viewerId, ownerId, gift, type) {
  const id = parseId(viewerId, "viewer_id");
  const key = participationsKey(id);
  const raw = await env.DB.get(key, "json");
  const items = readParticipationEntries(raw);
  const giftId = String(gift.id);
  const filtered = items.filter(
    item => !(Number(item.ownerId) === Number(ownerId) && String(item.giftId) === giftId)
  );

  if (type) {
    filtered.unshift({
      ownerId: Number(ownerId),
      giftId: Number(gift.id),
      type,
      updatedAt: new Date().toISOString()
    });
  }

  await env.DB.put(key, JSON.stringify(filtered.slice(0, 200)));
}

export async function restoreParticipationsForOwner(env, viewerId, ownerId, record, groups) {
  if (Number(viewerId) === Number(ownerId)) return;
  const key = participationsKey(viewerId);
  const raw = await env.DB.get(key, "json");
  const existing = readParticipationEntries(raw);
  const kept = existing.filter(item => Number(item.ownerId) !== Number(ownerId));
  const now = new Date().toISOString();

  for (const gift of record.gifts) {
    if (!canViewerAccessGift(gift, ownerId, viewerId, groups)) continue;
    let type = "";
    if (gift.is_crowdfund) {
      if (Array.isArray(gift.participants) && gift.participants.includes(viewerId)) type = "crowdfund";
    } else if (gift.is_reusable) {
      if (Array.isArray(gift.reusable_givers) && gift.reusable_givers.includes(viewerId)) type = "reusable";
    } else if (gift.booked_by === viewerId) {
      type = "book";
    }
    if (!type) continue;
    const prev = existing.find(item =>
      Number(item.ownerId) === Number(ownerId)
      && String(item.giftId) === String(gift.id)
      && item.type === type
    );
    kept.push({
      ownerId: Number(ownerId),
      giftId: gift.id,
      type,
      updatedAt: prev?.updatedAt || now
    });
  }

  kept.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  await env.DB.put(key, JSON.stringify(kept.slice(0, 200)));
}

export async function cleanupGiftAudience(env, ownerId, gift, groups, notifications = null) {
  const groupIds = Array.isArray(gift?.group_ids) ? gift.group_ids : [];
  if (groupIds.length === 0) return [];
  const affectedUsers = [];

  const bookedBy = Number(gift.booked_by);
  if (Number.isSafeInteger(bookedBy) && bookedBy > 0
    && !canViewerAccessGift(gift, ownerId, bookedBy, groups)) {
    gift.booked_by = null;
    affectedUsers.push({ userId: bookedBy, type: "book" });
  }

  if (Array.isArray(gift.participants)) {
    gift.participants = gift.participants.filter(rawId => {
      const participantId = Number(rawId);
      if (!Number.isSafeInteger(participantId) || participantId <= 0) return false;
      if (!canViewerAccessGift(gift, ownerId, participantId, groups)) {
        affectedUsers.push({ userId: participantId, type: "crowdfund" });
        return false;
      }
      return true;
    });
  }

  if (Array.isArray(gift.reusable_givers)) {
    gift.reusable_givers = gift.reusable_givers.filter(rawId => {
      const giverId = Number(rawId);
      if (!Number.isSafeInteger(giverId) || giverId <= 0) return false;
      if (!canViewerAccessGift(gift, ownerId, giverId, groups)) {
        affectedUsers.push({ userId: giverId, type: "reusable" });
        return false;
      }
      return true;
    });
  }

  for (const item of affectedUsers) {
    await syncWishlistParticipation(env, item.userId, ownerId, gift, null);
    if (Array.isArray(notifications) && !gift.is_gifted) {
      notifications.push({
        guestId: item.userId,
        ownerId,
        gift,
        reason: "access_revoked"
      });
    }
  }
  return affectedUsers;
}

export async function cleanupRecordAudience(env, ownerId, record, groups, notifications = null) {
  const affected = [];
  for (const gift of record.gifts) {
    const removed = await cleanupGiftAudience(env, ownerId, gift, groups, notifications);
    affected.push(...removed);
  }
  return affected;
}

function serializeGiftForViewer(gift, ownerId, viewerId) {
  return {
    ...gift,
    category: gift.category || "",
    comment: gift.comment || "",
    priority: Boolean(gift.priority),
    desire: displayDesire(gift),
    tags: Array.isArray(gift.tags) ? gift.tags : [],
    group_ids: Array.isArray(gift.group_ids) ? gift.group_ids : [],
    occasion_ids: Array.isArray(gift.occasion_ids) ? gift.occasion_ids : [],
    is_crowdfund: Boolean(gift.is_crowdfund),
    is_reusable: Boolean(gift.is_reusable),
    is_gifted: Boolean(gift.is_gifted),
    booked_by: gift.booked_by === null || gift.booked_by === undefined
      ? null
      : Number(gift.booked_by) === Number(viewerId) ? Number(viewerId) : -1,
    participants: (Array.isArray(gift.participants) ? gift.participants : [])
      .map(participantId => (Number(participantId) === Number(viewerId) ? Number(viewerId) : -1)),
    reusable_givers: (Array.isArray(gift.reusable_givers) ? gift.reusable_givers : [])
      .map(giverId => (Number(giverId) === Number(viewerId) ? Number(viewerId) : -1))
  };
}

export function serializeWishlist(record, ownerId, viewerId, { groups = [], isSubscribed = false } = {}) {
  const normalizedOwnerId = Number(ownerId ?? record.owner.id);
  const visibleGifts = record.gifts.filter(gift => canViewerAccessGift(gift, normalizedOwnerId, viewerId, groups));
  const allOccasions = Array.isArray(record.occasions) ? record.occasions : [];

  let visibleOccasions;
  if (normalizedOwnerId === Number(viewerId)) {
    visibleOccasions = allOccasions.map(item => ({ id: item.id, title: item.title }));
  } else {
    const usedIds = new Set();
    for (const gift of visibleGifts) {
      if (Array.isArray(gift.occasion_ids)) {
        for (const occId of gift.occasion_ids) usedIds.add(occId);
      }
    }
    visibleOccasions = allOccasions
      .filter(item => usedIds.has(item.id))
      .map(item => ({ id: item.id, title: item.title }));
  }

  const result = {
    owner: {
      id: normalizedOwnerId,
      first_name: record.owner.first_name || "Пользователь",
      username: normalizeUsername(record.owner.username || "", false)
    },
    is_subscribed: Boolean(isSubscribed),
    occasions: visibleOccasions,
    gifts: visibleGifts.map(gift => serializeGiftForViewer(gift, normalizedOwnerId, viewerId))
  };

  if (normalizedOwnerId === Number(viewerId)) {
    result.groups = groups.map(group => ({
      id: group.id,
      name: group.name,
      memberIds: [...group.memberIds]
    }));
  }
  return result;
}

export async function handleParticipationsGet(env, viewer) {
  const key = participationsKey(viewer.id);
  const raw = await env.DB.get(key, "json");
  const stored = readParticipationEntries(raw);
  const records = new Map();
  const recordGroups = new Map();
  const cleanedIndex = [];
  const activeItems = [];

  for (const entry of stored) {
    const ownerId = Number(entry?.ownerId);
    const giftId = Number(entry?.giftId);
    const type = entry?.type;
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0
      || !Number.isSafeInteger(giftId) || giftId <= 0
      || !["book", "crowdfund", "reusable"].includes(type)) continue;

    if (!records.has(ownerId)) {
      records.set(ownerId, await loadWishlist(env, ownerId));
      recordGroups.set(ownerId, await loadGroups(env, ownerId));
    }
    const record = records.get(ownerId);
    const groups = recordGroups.get(ownerId);
    const gift = record.gifts.find(item => Number(item.id) === giftId);
    if (!gift || !canViewerAccessGift(gift, ownerId, viewer.id, groups)) continue;

    let isActive = false;
    if (type === "book") {
      isActive = !gift.is_crowdfund && !gift.is_reusable && Number(gift.booked_by) === viewer.id;
    } else if (type === "crowdfund") {
      isActive = Boolean(gift.is_crowdfund) && Array.isArray(gift.participants)
        && gift.participants.some(id => Number(id) === viewer.id);
    } else if (type === "reusable") {
      isActive = Boolean(gift.is_reusable) && Array.isArray(gift.reusable_givers)
        && gift.reusable_givers.some(id => Number(id) === viewer.id);
    }
    if (!isActive) continue;

    const updatedAt = String(entry.updatedAt || new Date().toISOString());
    cleanedIndex.push({ ownerId, giftId, type, updatedAt });

    const slimGift = serializeGiftForViewer(gift, ownerId, viewer.id);
    delete slimGift.booked_by;
    delete slimGift.participants;
    delete slimGift.reusable_givers;
    slimGift.participantsCount = Array.isArray(gift.participants) ? gift.participants.length : 0;
    slimGift.reusableCount = Array.isArray(gift.reusable_givers) ? gift.reusable_givers.length : 0;

    activeItems.push({
      type,
      updatedAt,
      owner: {
        id: ownerId,
        first_name: record.owner.first_name || "Пользователь",
        username: record.owner.username || ""
      },
      gift: slimGift
    });
  }

  if (cleanedIndex.length !== stored.length) {
    await env.DB.put(key, JSON.stringify(cleanedIndex));
  }
  activeItems.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return json({ items: activeItems });
}

export async function handleGiftsGet(env, viewer, url) {
  const ownerId = parseId(url.searchParams.get("owner_id") || viewer.id, "owner_id");
  const record = await loadWishlist(env, ownerId);
  const groups = await loadGroups(env, ownerId);
  let isSubscribed = false;

  if (ownerId === viewer.id) {
    record.owner = {
      ...record.owner,
      id: ownerId,
      first_name: viewer.first_name,
      username: viewer.username || record.owner.username || ""
    };
  } else {
    await restoreParticipationsForOwner(env, viewer.id, ownerId, record, groups);
    const subscriptions = await readSubscriptions(env, viewer.id);
    isSubscribed = subscriptions.includes(ownerId);
    if (isSubscribed) {
      await addSubscriber(env, ownerId, viewer.id);
    }
  }

  return json(serializeWishlist(record, ownerId, viewer.id, { groups, isSubscribed }));
}

async function handleCopyGift(env, ownerId, viewer, payload, ctx) {
  const sourceRecord = await loadWishlist(env, ownerId);
  const sourceGroups = await loadGroups(env, ownerId);
  const idx = findGiftIndex(sourceRecord.gifts, payload.id);
  if (idx === -1) throw new ApiError(404, "Gift not found");
  const sourceGift = sourceRecord.gifts[idx];
  assertGiftVisible(sourceGift, ownerId, viewer.id, sourceGroups);

  let copiedImage = "";
  const sourceImage = String(sourceGift.image || "");
  if (sourceImage) {
    if (sourceImage.startsWith("/api/img/")) {
      copiedImage = await cloneInternalImage(env, sourceImage, viewer.id);
    } else {
      copiedImage = sanitizeImage(sourceImage);
    }
  }

  const desire = displayDesire(sourceGift);
  const isCrowdfund = Boolean(sourceGift.is_crowdfund);
  const isReusable = !isCrowdfund && Boolean(sourceGift.is_reusable);

  const viewerRecord = await loadWishlist(env, viewer.id);
  viewerRecord.owner = {
    id: viewer.id,
    first_name: viewer.first_name,
    username: viewer.username || viewerRecord.owner.username || ""
  };

  const copiedGift = {
    id: createGiftId(viewerRecord.gifts),
    title: cleanPlainText(sourceGift.title, 120) || "Подарок",
    link: sourceGift.link || "",
    image: copiedImage,
    price: sourceGift.price ?? null,
    category: cleanPlainText(sourceGift.category || "Разное", 40) || "Разное",
    comment: cleanPlainText(sourceGift.comment || "", 300),
    desire,
    tags: Array.isArray(sourceGift.tags) ? [...sourceGift.tags] : [],
    group_ids: [],
    occasion_ids: [],
    priority: desire === "high",
    is_crowdfund: isCrowdfund,
    is_reusable: isReusable,
    booked_by: null,
    participants: [],
    reusable_givers: [],
    is_gifted: false
  };

  viewerRecord.gifts.unshift(copiedGift);
  await saveWishlist(env, viewer.id, viewerRecord);
  const viewerGroups = await loadGroups(env, viewer.id);
  await dispatchBackground(
    ctx,
    notifySubscribersAboutNewGift(env, viewer.id, copiedGift, viewerGroups, canViewerAccessGift)
  );

  return json({ ok: true, gift: copiedGift }, 201);
}

export async function handleGiftsPost(request, env, viewer, ctx) {
  const body = await readJsonBody(request);
  const ownerId = parseId(body?.owner_id || viewer.id, "owner_id");
  const action = String(body?.action || "");
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  const isOwner = viewer.id === ownerId;

  const ownerActions = new Set([
    "add",
    "update",
    "delete",
    "toggle_gifted",
    "save_occasion",
    "delete_occasion"
  ]);
  const guestActions = new Set(["toggle_book", "toggle_crowdfund"]);

  if (action === "copy_gift" && isOwner) {
    throw new ApiError(400, "You cannot copy your own gift");
  }
  if (ownerActions.has(action) && !isOwner) {
    throw new ApiError(403, "Only the wishlist owner can modify gifts");
  }
  if (guestActions.has(action) && isOwner) {
    throw new ApiError(403, "Owner cannot book their own gift");
  }
  if (!ownerActions.has(action) && !guestActions.has(action) && action !== "copy_gift") {
    throw new ApiError(400, "Unsupported action");
  }

  if (action === "copy_gift") {
    return await handleCopyGift(env, ownerId, viewer, payload, ctx);
  }

  const record = await loadWishlist(env, ownerId);
  const groups = await loadGroups(env, ownerId);

  if (action === "save_occasion") {
    const title = sanitizeOccasionTitle(payload.title);
    const requestedId = normalizeOccasionId(payload.id);
    const titleKey = title.toLocaleLowerCase("ru-RU");

    if (requestedId) {
      const existing = record.occasions.find(item => item.id === requestedId);
      if (!existing) throw new ApiError(404, "Occasion not found");
      const duplicate = record.occasions.find(
        item => item.id !== requestedId && item.title.toLocaleLowerCase("ru-RU") === titleKey
      );
      if (duplicate) {
        throw new ApiError(409, "Occasion with this title already exists");
      }
      existing.title = title;
      await saveWishlist(env, ownerId, record);
      return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
    }

    const existingByTitle = record.occasions.find(
      item => item.title.toLocaleLowerCase("ru-RU") === titleKey
    );
    if (existingByTitle) {
      throw new ApiError(409, "Occasion with this title already exists");
    }
    if (record.occasions.length >= MAX_OCCASIONS) {
      throw new ApiError(409, "Occasions limit reached");
    }

    const newOccasion = {
      id: createShortId("occ"),
      title
    };
    record.occasions.push(newOccasion);
    record.owner = {
      ...record.owner,
      id: ownerId,
      first_name: viewer.first_name,
      username: viewer.username || record.owner.username || ""
    };
    await saveWishlist(env, ownerId, record);
    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "delete_occasion") {
    const targetId = normalizeOccasionId(payload.id);
    const idx = record.occasions.findIndex(item => item.id === targetId);
    if (idx === -1) throw new ApiError(404, "Occasion not found");
    record.occasions.splice(idx, 1);
    for (const gift of record.gifts) {
      if (Array.isArray(gift.occasion_ids)) {
        gift.occasion_ids = gift.occasion_ids.filter(id => id !== targetId);
      }
    }
    await saveWishlist(env, ownerId, record);
    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "add") {
    const title = cleanPlainText(payload.title, 120);
    if (!title) throw new ApiError(400, "Gift title is required");

    const link = sanitizeHttpUrl(payload.link || "", "link");
    const image = sanitizeImage(payload.image || "");
    await assertInternalImageOwnership(env, ownerId, image);
    const price = sanitizePrice(payload.price);
    const category = cleanPlainText(payload.category || "Разное", 40) || "Разное";
    const comment = cleanPlainText(payload.comment || "", 300);
    const desire = sanitizeDesire(payload.desire, Boolean(payload.priority));
    const tags = sanitizeTags(payload.tags);
    const groupIds = sanitizeGiftGroupIds(payload.group_ids, groups);
    const occasionIds = sanitizeGiftOccasionIds(payload.occasion_ids, record.occasions);
    const isCrowdfund = Boolean(payload.is_crowdfund);
    const isReusable = Boolean(payload.is_reusable);
    if (isCrowdfund && isReusable) {
      throw new ApiError(400, "Gift cannot be both crowdfund and reusable");
    }

    const newGift = {
      id: createGiftId(record.gifts),
      title,
      link,
      image,
      price,
      category,
      comment,
      desire,
      tags,
      group_ids: groupIds,
      occasion_ids: occasionIds,
      priority: desire === "high",
      is_crowdfund: isCrowdfund,
      is_reusable: isReusable,
      booked_by: null,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    };

    record.owner = {
      ...record.owner,
      id: ownerId,
      first_name: viewer.first_name,
      username: viewer.username || record.owner.username || ""
    };
    record.gifts.unshift(newGift);
    await saveWishlist(env, ownerId, record);
    await dispatchBackground(
      ctx,
      notifySubscribersAboutNewGift(env, ownerId, newGift, groups, canViewerAccessGift)
    );
    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "update") {
    const idx = findGiftIndex(record.gifts, payload.id);
    if (idx === -1) throw new ApiError(404, "Gift not found");
    const existing = record.gifts[idx];
    const previousSnapshot = {
      title: existing.title,
      price: existing.price ?? null,
      comment: existing.comment || "",
      link: existing.link || "",
      is_crowdfund: Boolean(existing.is_crowdfund),
      is_reusable: Boolean(existing.is_reusable)
    };

    const title = cleanPlainText(payload.title, 120);
    if (!title) throw new ApiError(400, "Gift title is required");

    const link = sanitizeHttpUrl(payload.link || "", "link");
    const image = sanitizeImage(payload.image || "");
    await assertInternalImageOwnership(env, ownerId, image);
    const price = sanitizePrice(payload.price);
    const category = cleanPlainText(payload.category || "Разное", 40) || "Разное";
    const comment = cleanPlainText(payload.comment || "", 300);
    const desire = sanitizeDesire(payload.desire, Boolean(payload.priority));
    const tags = sanitizeTags(payload.tags);
    const groupIds = sanitizeGiftGroupIds(payload.group_ids, groups);
    const occasionIds = sanitizeGiftOccasionIds(payload.occasion_ids, record.occasions);
    const isCrowdfund = Boolean(payload.is_crowdfund);
    const isReusable = Boolean(payload.is_reusable);
    if (isCrowdfund && isReusable) {
      throw new ApiError(400, "Gift cannot be both crowdfund and reusable");
    }

    const updated = {
      ...existing,
      title,
      link,
      image,
      price,
      category,
      comment,
      desire,
      tags,
      group_ids: groupIds,
      occasion_ids: occasionIds,
      priority: desire === "high",
      is_crowdfund: isCrowdfund,
      is_reusable: isReusable
    };

    const notifications = [];
    const modeChanged = previousSnapshot.is_crowdfund !== updated.is_crowdfund
      || previousSnapshot.is_reusable !== updated.is_reusable;

    if (modeChanged) {
      const oldViewers = collectGiftViewerIds(existing);
      updated.booked_by = null;
      updated.participants = [];
      updated.reusable_givers = [];
      for (const guestId of oldViewers) {
        await syncWishlistParticipation(env, guestId, ownerId, updated, null);
        if (!updated.is_gifted) {
          notifications.push({
            guestId,
            ownerId,
            gift: updated,
            reason: "format_changed"
          });
        }
      }
    }

    record.gifts[idx] = updated;
    await cleanupGiftAudience(env, ownerId, updated, groups, notifications);

    if (!modeChanged && !updated.is_gifted) {
      const detailChanges = [];
      if (previousSnapshot.title !== updated.title) detailChanges.push("название");
      if (previousSnapshot.price !== updated.price) detailChanges.push("цена");
      if (previousSnapshot.comment !== updated.comment) detailChanges.push("комментарий");
      if (previousSnapshot.link !== updated.link) detailChanges.push("ссылка");

      if (detailChanges.length > 0) {
        for (const guestId of collectGiftViewerIds(updated)) {
          notifications.push({
            guestId,
            ownerId,
            gift: updated,
            reason: "updated",
            changes: detailChanges
          });
        }
      }
    }

    await saveWishlist(env, ownerId, record);

    if (existing.image && existing.image !== updated.image
      && !record.gifts.some(gift => gift.image === existing.image)) {
      await deleteInternalImage(env, existing.image, ownerId);
    }

    if (notifications.length > 0) {
      await dispatchBackground(ctx, notifyGuestsBatch(env, notifications));
    }

    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "delete") {
    const idx = findGiftIndex(record.gifts, payload.id);
    if (idx === -1) throw new ApiError(404, "Gift not found");
    const [removed] = record.gifts.splice(idx, 1);

    if (removed.image && !record.gifts.some(gift => gift.image === removed.image)) {
      await deleteInternalImage(env, removed.image, ownerId);
    }

    const affectedGuestIds = collectGiftViewerIds(removed);
    for (const guestId of affectedGuestIds) {
      await syncWishlistParticipation(env, guestId, ownerId, removed, null);
    }

    await saveWishlist(env, ownerId, record);

    if (!removed.is_gifted && affectedGuestIds.length > 0) {
      await dispatchBackground(
        ctx,
        notifyGuestsBatch(
          env,
          affectedGuestIds.map(guestId => ({
            guestId,
            ownerId,
            gift: removed,
            reason: "deleted"
          }))
        )
      );
    }

    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  if (action === "toggle_gifted") {
    const idx = findGiftIndex(record.gifts, payload.id);
    if (idx === -1) throw new ApiError(404, "Gift not found");
    const targetGift = record.gifts[idx];
    const nextGifted = !targetGift.is_gifted;
    targetGift.is_gifted = nextGifted;

    await saveWishlist(env, ownerId, record);

    if (nextGifted) {
      const guestIds = collectGiftViewerIds(targetGift);
      if (guestIds.length > 0) {
        await dispatchBackground(
          ctx,
          notifyGuestsBatch(
            env,
            guestIds.map(guestId => ({
              guestId,
              ownerId,
              gift: targetGift,
              reason: "gifted"
            }))
          )
        );
      }
    }

    return json(serializeWishlist(record, ownerId, viewer.id, { groups }));
  }

  const idx = findGiftIndex(record.gifts, payload.id);
  if (idx === -1) throw new ApiError(404, "Gift not found");
  const gift = record.gifts[idx];
  assertGiftVisible(gift, ownerId, viewer.id, groups);

  if (action === "toggle_book") {
    if (gift.is_crowdfund) {
      throw new ApiError(409, "This gift uses crowdfund mode");
    }
    if (gift.is_gifted) {
      throw new ApiError(409, "This gift cannot be booked");
    }

    if (gift.is_reusable) {
      if (!Array.isArray(gift.reusable_givers)) gift.reusable_givers = [];
      const pos = gift.reusable_givers.indexOf(viewer.id);
      if (pos >= 0) {
        gift.reusable_givers.splice(pos, 1);
        await syncWishlistParticipation(env, viewer.id, ownerId, gift, null);
      } else {
        gift.reusable_givers.push(viewer.id);
        await syncWishlistParticipation(env, viewer.id, ownerId, gift, "reusable");
      }
    } else if (gift.booked_by === null || gift.booked_by === undefined) {
      gift.booked_by = viewer.id;
      await syncWishlistParticipation(env, viewer.id, ownerId, gift, "book");
    } else if (gift.booked_by === viewer.id) {
      gift.booked_by = null;
      await syncWishlistParticipation(env, viewer.id, ownerId, gift, null);
    } else {
      throw new ApiError(409, "This gift is already booked");
    }
  }

  if (action === "toggle_crowdfund") {
    if (!gift.is_crowdfund) {
      throw new ApiError(409, "This gift does not use crowdfund mode");
    }
    if (gift.is_gifted) {
      throw new ApiError(409, "This gift cannot be booked");
    }
    if (!Array.isArray(gift.participants)) gift.participants = [];
    const pos = gift.participants.indexOf(viewer.id);
    if (pos >= 0) {
      gift.participants.splice(pos, 1);
      await syncWishlistParticipation(env, viewer.id, ownerId, gift, null);
    } else {
      gift.participants.push(viewer.id);
      await syncWishlistParticipation(env, viewer.id, ownerId, gift, "crowdfund");
    }
  }

  await saveWishlist(env, ownerId, record);
  const subscriptions = await readSubscriptions(env, viewer.id);
  const isSubscribed = subscriptions.includes(ownerId);
  return json(serializeWishlist(record, ownerId, viewer.id, { groups, isSubscribed }));
}

export async function handleSocialGet(env, viewer) {
  return json(await buildSocialPayload(env, viewer.id));
}

export async function handleSocialPost(request, env, viewer, ctx) {
  const body = await readJsonBody(request);
  const action = String(body?.action || "");
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  if (action === "create_group") {
    const groups = await loadGroups(env, viewer.id);
    if (groups.length >= MAX_GROUPS) {
      throw new ApiError(409, "Groups limit reached");
    }
    const name = sanitizeGroupName(payload.name);
    const duplicate = groups.find(
      item => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")
    );
    if (duplicate) {
      throw new ApiError(409, "Group with this name already exists");
    }
    groups.push({
      id: createShortId("grp"),
      name,
      memberIds: []
    });
    await saveGroups(env, viewer.id, groups);
    return json({ status: "ok", ...(await buildSocialPayload(env, viewer.id)) });
  }

  if (action === "rename_group") {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    const name = sanitizeGroupName(payload.name);
    const duplicate = groups.find(
      item => item.id !== group.id && item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")
    );
    if (duplicate) {
      throw new ApiError(409, "Group with this name already exists");
    }
    group.name = name;
    await saveGroups(env, viewer.id, groups);
    return json({ status: "ok", ...(await buildSocialPayload(env, viewer.id)) });
  }

  if (action === "delete_group") {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    const nextGroups = groups.filter(item => item.id !== group.id);
    await saveGroups(env, viewer.id, nextGroups);

    const record = await loadWishlist(env, viewer.id);
    let wishlistChanged = false;
    for (const gift of record.gifts) {
      if (Array.isArray(gift.group_ids) && gift.group_ids.includes(group.id)) {
        gift.group_ids = gift.group_ids.filter(id => id !== group.id);
        wishlistChanged = true;
      }
    }
    const notifications = [];
    const affected = await cleanupRecordAudience(env, viewer.id, record, nextGroups, notifications);
    if (wishlistChanged || affected.length > 0) {
      await saveWishlist(env, viewer.id, record);
    }
    if (notifications.length > 0) {
      await dispatchBackground(ctx, notifyGuestsBatch(env, notifications));
    }
    return json({ status: "ok", ...(await buildSocialPayload(env, viewer.id)) });
  }

  if (action === "unsubscribe") {
    const targetId = parseId(payload.user_id, "user id");
    const subscriptions = (await readSubscriptions(env, viewer.id)).filter(id => id !== targetId);
    await env.DB.put(subscriptionsKey(viewer.id), JSON.stringify(subscriptions));
    await removeSubscriber(env, targetId, viewer.id);
    return json({ status: "ok", ...(await buildSocialPayload(env, viewer.id)) });
  }

  if (action === "remove_group_member") {
    const targetId = parseId(payload.user_id, "user id");
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    group.memberIds = group.memberIds.filter(id => id !== targetId);
    await saveGroups(env, viewer.id, groups);

    const record = await loadWishlist(env, viewer.id);
    const notifications = [];
    let wishlistChanged = false;

    for (const gift of record.gifts) {
      const hadAccessBefore = collectGiftViewerIds(gift).includes(targetId);
      if (!hadAccessBefore) continue;
      if (canViewerAccessGift(gift, viewer.id, targetId, groups)) continue;

      if (Number(gift.booked_by) === targetId) {
        gift.booked_by = null;
        wishlistChanged = true;
      }
      if (Array.isArray(gift.participants) && gift.participants.includes(targetId)) {
        gift.participants = gift.participants.filter(id => Number(id) !== targetId);
        wishlistChanged = true;
      }
      if (Array.isArray(gift.reusable_givers) && gift.reusable_givers.includes(targetId)) {
        gift.reusable_givers = gift.reusable_givers.filter(id => Number(id) !== targetId);
        wishlistChanged = true;
      }
      await syncWishlistParticipation(env, targetId, viewer.id, gift, null);
      if (!gift.is_gifted) {
        notifications.push({
          guestId: targetId,
          ownerId: viewer.id,
          gift,
          reason: "access_revoked",
          groupRevoke: true
        });
      }
    }

    if (wishlistChanged) {
      await saveWishlist(env, viewer.id, record);
    }
    if (notifications.length > 0) {
      await dispatchBackground(ctx, notifyGuestsBatch(env, notifications));
    }
    return json({ status: "ok", ...(await buildSocialPayload(env, viewer.id)) });
  }

  if (!["subscribe", "add_group_member"].includes(action)) {
    throw new ApiError(400, "Unknown social action");
  }

  let targetId = 0;
  if (payload.user_id !== undefined && action === "subscribe") {
    targetId = parseId(payload.user_id, "user id");
  } else {
    if (action === "add_group_member") {
      const groups = await loadGroups(env, viewer.id);
      getGroup(groups, payload.group_id);
    }
    const profile = await resolveUserByUsername(env, payload.username || "");
    if (!profile) {
      const selection = await requestTelegramUserSelection(env, viewer.id, {
        purpose: action === "subscribe" ? "subscribe" : "group",
        groupId: payload.group_id,
        requestedUsername: payload.username
      });
      return json(selection, 202);
    }
    targetId = profile.id;
  }

  if (targetId === viewer.id) {
    throw new ApiError(400, "You cannot add yourself");
  }
  if (action === "subscribe") {
    await addSubscription(env, viewer.id, targetId);
  } else {
    const groups = await loadGroups(env, viewer.id);
    const group = getGroup(groups, payload.group_id);
    if (!group.memberIds.includes(targetId)) {
      if (group.memberIds.length >= MAX_SOCIAL_ITEMS) {
        throw new ApiError(409, "Group members limit reached");
      }
      group.memberIds.unshift(targetId);
      await saveGroups(env, viewer.id, groups);
    }
  }

  return json({ status: "ok", ...(await buildSocialPayload(env, viewer.id)) });
}

export async function loadProfileSummary(env, userId) {
  return await loadProfile(env, userId);
}
