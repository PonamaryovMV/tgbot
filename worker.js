import {
  DEFAULT_GROUPS,
  LEGACY_GROUP_NAMES,
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  MAX_OCCASIONS,
  MAX_NEW_GIFT_NOTIFICATIONS,
  NOTIFICATION_BATCH_SIZE,
  CORS_HEADERS,
  ApiError,
  createShortId,
  dispatchBackground,
  json,
  cleanPlainText,
  normalizeUsername,
  parseId,
  sanitizeHttpUrl,
  sanitizeImage,
  sanitizeDesire,
  sanitizeTags,
  sanitizeGiftGroupIds,
  sanitizeGiftOccasionIds,
  sanitizeGroupName,
  sanitizeOccasionTitle,
  findGiftIndex,
  createGiftId,
  verifyTelegramInitData,
  getBotUsername
} from "./src/wishlist/utils.js";
import {
  directoryKey,
  groupsKey,
  upsertUserDirectory,
  removeSubscriber,
  loadGroups,
  saveGroups,
  getGroup,
  buildSocialPayload,
  loadWishlist,
  saveWishlist,
  getInternalImageId,
  assertInternalImageOwnership,
  cloneInternalImage,
  deleteInternalImage,
  handleImageUpload,
  handleImageGet
} from "./src/wishlist/storage.js";
import {
  notifyGuestAboutGiftChange,
  notifyGuestsBatch,
  notifySubscribersAboutNewGift,
  requestTelegramUserSelection,
  handleSharedUserSelection,
  handleTelegramWebhook
} from "./src/wishlist/notifications.js";
import {
  collectGiftViewerIds,
  canViewerAccessGift,
  assertGiftVisible,
  cleanupGiftAudience,
  cleanupRecordAudience,
  syncWishlistParticipation,
  restoreParticipationsForOwner,
  handleParticipationsGet,
  serializeWishlist,
  handleGiftsGet,
  handleGiftsPost
} from "./src/wishlist/gifts-api.js";
import {
  handleSocialGet,
  handleSocialPost
} from "./src/wishlist/social-api.js";

export {
  DEFAULT_GROUPS,
  LEGACY_GROUP_NAMES,
  MAX_SOCIAL_ITEMS,
  MAX_GROUPS,
  MAX_OCCASIONS,
  MAX_NEW_GIFT_NOTIFICATIONS,
  NOTIFICATION_BATCH_SIZE,
  ApiError,
  createShortId,
  dispatchBackground,
  json,
  cleanPlainText,
  normalizeUsername,
  parseId,
  sanitizeHttpUrl,
  sanitizeImage,
  sanitizeDesire,
  sanitizeTags,
  sanitizeGiftGroupIds,
  sanitizeGiftOccasionIds,
  sanitizeGroupName,
  sanitizeOccasionTitle,
  findGiftIndex,
  createGiftId,
  verifyTelegramInitData,
  getInternalImageId,
  assertInternalImageOwnership,
  cloneInternalImage,
  deleteInternalImage,
  loadWishlist,
  saveWishlist,
  directoryKey,
  groupsKey,
  removeSubscriber,
  loadGroups,
  saveGroups,
  getGroup,
  buildSocialPayload,
  requestTelegramUserSelection,
  collectGiftViewerIds,
  canViewerAccessGift,
  assertGiftVisible,
  cleanupGiftAudience,
  cleanupRecordAudience,
  syncWishlistParticipation,
  restoreParticipationsForOwner,
  handleParticipationsGet,
  serializeWishlist,
  notifyGuestAboutGiftChange,
  notifyGuestsBatch,
  notifySubscribersAboutNewGift,
  handleTelegramWebhook,
  handleSharedUserSelection
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (path === "/" && method === "GET") {
        return json({ ok: true, service: "tg_podarki" });
      }
      if ((path === "/" || path === "/webhook") && method === "POST") {
        return await handleTelegramWebhook(request, env);
      }
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true });
      }
      if (path === "/api/config" && method === "GET") {
        const botUsername = await getBotUsername(env);
        return json({ botUsername });
      }

      const imageMatch = path.match(/^\/api\/img\/([A-Za-z0-9_-]{8,64})$/);
      const isWishlistRoute = (
        path === "/api/upload"
        || path === "/api/participations"
        || path === "/api/social"
        || path === "/api/gifts"
        || path === "/api/data"
        || Boolean(imageMatch)
      );

      if (!isWishlistRoute) {
        throw new ApiError(404, "Not found");
      }

      if (!env?.DB) {
        throw new ApiError(500, "KV binding DB is not configured");
      }

      const viewer = await verifyTelegramInitData(
        request.headers.get("X-Telegram-Init-Data") || "",
        env.BOT_TOKEN
      );
      await upsertUserDirectory(env, viewer);

      if (imageMatch && method === "GET") {
        return await handleImageGet(env, viewer, imageMatch[1], canViewerAccessGift);
      }
      if (path === "/api/participations" && method === "GET") {
        return await handleParticipationsGet(env, viewer);
      }
      if (path === "/api/social" && method === "GET") {
        return await handleSocialGet(env, viewer);
      }
      if (path === "/api/social" && method === "POST") {
        return await handleSocialPost(request, env, viewer, ctx);
      }
      if ((path === "/api/gifts" || path === "/api/data") && method === "GET") {
        return await handleGiftsGet(env, viewer, url);
      }
      if ((path === "/api/gifts" || path === "/api/data") && method === "POST") {
        return await handleGiftsPost(request, env, viewer, ctx);
      }
      if (path === "/api/upload" && method === "POST") {
        return await handleImageUpload(request, env, viewer);
      }

      throw new ApiError(404, "Not found");
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message }, error.status);
      }
      console.error("Unhandled worker error:", error?.stack || error);
      return json({ error: "Internal server error" }, 500);
    }
  }
};
