import {
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  ApiError,
  json,
  readJsonBody,
  createShortId,
  dispatchBackground,
  parseId,
  sanitizeGroupName
} from "./utils.js";
import {
  subscriptionsKey,
  resolveUserByUsername,
  readSubscriptions,
  addSubscription,
  removeSubscriber,
  loadGroups,
  saveGroups,
  getGroup,
  buildSocialPayload,
  loadWishlist,
  saveWishlist
} from "./storage.js";
import {
  notifyGuestsBatch,
  requestTelegramUserSelection
} from "./notifications.js";
import {
  collectGiftViewerIds,
  canViewerAccessGift,
  cleanupRecordAudience,
  syncWishlistParticipation
} from "./gifts-api.js";

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
