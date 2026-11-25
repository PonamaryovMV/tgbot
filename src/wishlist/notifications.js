import {
  MAX_SOCIAL_ITEMS,
  MAX_NEW_GIFT_NOTIFICATIONS,
  NOTIFICATION_BATCH_SIZE,
  ApiError,
  json,
  cleanPlainText,
  normalizeUsername,
  parseId,
  callTelegramApi,
  getBotUsername
} from "./utils.js";
import {
  notifyPrefsKey,
  selectionKey,
  loadProfile,
  upsertUserDirectory,
  addSubscription,
  addExpenseContact,
  readSubscribers,
  loadGroups,
  saveGroups
} from "./storage.js";

export async function readNotificationPrefs(env, userId) {
  const stored = await env.DB.get(notifyPrefsKey(userId), "json");
  return {
    bookings: stored?.bookings !== false,
    new_gifts: stored?.new_gifts !== false
  };
}

export async function saveNotificationPrefs(env, userId, prefs) {
  const normalized = {
    bookings: prefs?.bookings !== false,
    new_gifts: prefs?.new_gifts !== false
  };
  await env.DB.put(notifyPrefsKey(userId), JSON.stringify(normalized));
  return normalized;
}

function isValidChatId(chatId) {
  const id = Number(chatId);
  return Number.isSafeInteger(id) && id > 0;
}

function formatOwnerLabel(ownerProfile) {
  const name = cleanPlainText(ownerProfile?.first_name || "Пользователь", 64) || "Пользователь";
  const username = normalizeUsername(ownerProfile?.username || "", false);
  return username ? `${name} (@${username})` : name;
}

function formatNotificationPrice(price) {
  if (price === null || price === undefined || price === "") return "";
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return "";
  return ` (${new Intl.NumberFormat("ru-RU").format(Math.round(numericPrice))} ₽)`;
}

function buildMiniAppButton(env, startParamValue, label = "Открыть вишлист") {
  const baseUrl = String(env?.WEBAPP_URL || "").trim();
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (startParamValue && startParamValue.startsWith("list_")) {
      url.searchParams.set("list", startParamValue.slice("list_".length));
    } else if (startParamValue) {
      url.searchParams.set("tgWebAppStartParam", startParamValue);
    }
    return {
      inline_keyboard: [[{ text: label, web_app: { url: url.toString() } }]]
    };
  } catch {
    return undefined;
  }
}

async function sendTelegramBotMessage(env, chatId, text, replyMarkup) {
  if (!env?.BOT_TOKEN || !isValidChatId(chatId)) return false;
  const payload = { chat_id: Number(chatId), text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    await callTelegramApi(env, "sendMessage", payload);
    return true;
  } catch (error) {
    console.warn("Failed to send Telegram notification:", error?.stack || error);
    return false;
  }
}

function buildNotificationsKeyboard(prefs) {
  return {
    inline_keyboard: [
      [{
        text: prefs.bookings ? "Брони и сборы: выключить" : "Брони и сборы: включить",
        callback_data: "notify:toggle:bookings"
      }],
      [{
        text: prefs.new_gifts ? "Новые желания: выключить" : "Новые желания: включить",
        callback_data: "notify:toggle:new_gifts"
      }]
    ]
  };
}

function formatNotificationsSettingsText(prefs) {
  const status = value => (value ? "включены" : "выключены");
  return "Настройки уведомлений:\n"
    + `• Брони и совместные сборы: ${status(prefs.bookings)}\n`
    + `• Новые желания друзей: ${status(prefs.new_gifts)}`;
}

export async function notifyGuestAboutGiftChange(env, guestId, ownerId, gift, options = {}) {
  if (!env?.BOT_TOKEN || !isValidChatId(guestId) || Number(guestId) === Number(ownerId)) return;
  const prefs = await readNotificationPrefs(env, guestId);
  if (!prefs.bookings) return;

  const ownerProfile = await loadProfile(env, ownerId);
  const ownerLabel = formatOwnerLabel(ownerProfile);
  const giftTitle = cleanPlainText(gift?.title, 120) || "Подарок";
  const reason = options.reason || "updated";

  let text = "";
  if (reason === "deleted") {
    text = gift?.is_crowdfund
      ? `${ownerLabel} удалил(а) подарок «${giftTitle}». Ваше участие в совместном сборе отменено.`
      : `${ownerLabel} удалил(а) подарок «${giftTitle}». Ваша бронь отменена.`;
  } else if (reason === "gifted") {
    text = `${ownerLabel} отметил(а) подарок «${giftTitle}» как уже подаренный.`;
  } else if (reason === "format_changed") {
    text = `${ownerLabel} изменил(а) формат подарка «${giftTitle}». `
      + "Ваша бронь/участие в сборе сброшены — при желании отметьтесь снова.";
  } else if (reason === "access_revoked") {
    text = `Подарок «${giftTitle}» в вишлисте ${ownerLabel} стал недоступен. `
      + "Ваша бронь/участие отменены.";
  } else {
    const changes = Array.isArray(options.changes) && options.changes.length
      ? options.changes.join(", ")
      : "детали";
    text = `${ownerLabel} обновил(а) забронированный подарок «${giftTitle}» (изменено: ${changes}).`;
  }

  const replyMarkup = buildMiniAppButton(env, `list_${ownerId}`, "Открыть вишлист");
  await sendTelegramBotMessage(env, guestId, text, replyMarkup);
}

export async function notifyGuestsBatch(env, notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return;

  const revokedByGuest = new Map();
  const directItems = [];

  for (const item of notifications) {
    if (!item || !isValidChatId(item.guestId) || Number(item.guestId) === Number(item.ownerId)) continue;
    if (item.reason === "access_revoked" && item.groupRevoke) {
      const key = `${item.guestId}:${item.ownerId}`;
      if (!revokedByGuest.has(key)) revokedByGuest.set(key, []);
      revokedByGuest.get(key).push(item);
    } else {
      directItems.push(item);
    }
  }

  const tasks = [];
  for (const items of revokedByGuest.values()) {
    const first = items[0];
    if (items.length === 1) {
      tasks.push(() => notifyGuestAboutGiftChange(env, first.guestId, first.ownerId, first.gift, {
        reason: "access_revoked"
      }));
    } else {
      tasks.push(async () => {
        const prefs = await readNotificationPrefs(env, first.guestId);
        if (!prefs.bookings) return;
        const ownerProfile = await loadProfile(env, first.ownerId);
        const ownerLabel = formatOwnerLabel(ownerProfile);
        const titles = items.map(i => `«${cleanPlainText(i.gift?.title, 80) || "Подарок"}»`).join(", ");
        const text = `В вишлисте ${ownerLabel} стали недоступны несколько подарков, `
          + `ваши брони/участия отменены: ${titles}.`;
        const replyMarkup = buildMiniAppButton(env, `list_${first.ownerId}`, "Открыть вишлист");
        await sendTelegramBotMessage(env, first.guestId, text, replyMarkup);
      });
    }
  }

  for (const item of directItems) {
    tasks.push(() => notifyGuestAboutGiftChange(env, item.guestId, item.ownerId, item.gift, {
      reason: item.reason,
      changes: item.changes
    }));
  }

  for (let offset = 0; offset < tasks.length; offset += NOTIFICATION_BATCH_SIZE) {
    const chunk = tasks.slice(offset, offset + NOTIFICATION_BATCH_SIZE);
    await Promise.allSettled(chunk.map(run => run()));
  }
}

export async function notifySubscribersAboutNewGift(env, ownerId, gift, groups, canViewerAccessGiftFn) {
  if (!env?.BOT_TOKEN) return;
  const subscribers = await readSubscribers(env, ownerId);
  if (!subscribers.length) return;

  const visibleSubscribers = subscribers.filter(subId =>
    Number(subId) !== Number(ownerId)
    && canViewerAccessGiftFn(gift, ownerId, subId, groups)
  );
  if (!visibleSubscribers.length) return;

  const ownerProfile = await loadProfile(env, ownerId);
  const ownerLabel = formatOwnerLabel(ownerProfile);
  const giftTitle = cleanPlainText(gift?.title, 120) || "Новый подарок";
  const priceSuffix = formatNotificationPrice(gift?.price);
  const text = `У ${ownerLabel} появилось новое желание: «${giftTitle}»${priceSuffix}`;
  const replyMarkup = buildMiniAppButton(env, `list_${ownerId}`, "Посмотреть в вишлисте");

  const targets = visibleSubscribers.slice(0, MAX_NEW_GIFT_NOTIFICATIONS);
  for (let offset = 0; offset < targets.length; offset += NOTIFICATION_BATCH_SIZE) {
    const chunk = targets.slice(offset, offset + NOTIFICATION_BATCH_SIZE);
    await Promise.allSettled(chunk.map(async subscriberId => {
      const prefs = await readNotificationPrefs(env, subscriberId);
      if (!prefs.new_gifts) return;
      await sendTelegramBotMessage(env, subscriberId, text, replyMarkup);
    }));
  }
}

export async function requestTelegramUserSelection(
  env,
  viewerId,
  { purpose, groupId = "", eventId = "", requestedUsername = "" }
) {
  if (!env?.BOT_TOKEN) {
    throw new ApiError(500, "BOT_TOKEN is not configured");
  }
  const numericRequestId = crypto.getRandomValues(new Uint32Array(1))[0] % 2_000_000_000 + 1;

  await env.DB.put(selectionKey(numericRequestId), JSON.stringify({
    viewerId,
    numericRequestId,
    purpose,
    groupId: purpose === "group" ? String(groupId || "") : "",
    eventId: purpose === "expense_member" ? String(eventId || "") : "",
    requestedUsername: normalizeUsername(requestedUsername || "", false),
    createdAt: new Date().toISOString()
  }), { expirationTtl: 900 });

  let text = "Нажмите кнопку ниже и выберите в Telegram человека, которого хотите добавить в группу.";
  if (purpose === "subscribe") {
    text = "Нажмите кнопку ниже и выберите в Telegram человека, на вишлист которого хотите подписаться.";
  } else if (purpose === "expense_member") {
    text = "Нажмите кнопку ниже и выберите в Telegram человека, которого хотите добавить в событие расходов.";
  } else if (purpose === "expense_contact") {
    text = "Нажмите кнопку ниже и выберите в Telegram человека, чтобы сохранить его для добавления в события расходов.";
  }

  try {
    await callTelegramApi(env, "sendMessage", {
      chat_id: viewerId,
      text,
      reply_markup: {
        keyboard: [[{
          text: "Выбрать пользователя",
          request_users: {
            request_id: numericRequestId,
            user_is_bot: false,
            request_name: true,
            request_username: true,
            max_quantity: 1
          }
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  } catch (error) {
    await env.DB.delete(selectionKey(numericRequestId));
    throw error;
  }

  const botUsername = await getBotUsername(env);
  return {
    status: "selection_required",
    requestId: numericRequestId,
    botUsername
  };
}

async function ensureExpenseUserInD1(db, { telegramId, displayName, username }) {
  if (!db || typeof db.prepare !== "function") return null;
  const now = new Date().toISOString();
  const safeName = cleanPlainText(displayName, 64) || "Пользователь";
  const safeUsername = normalizeUsername(username || "", false);
  const existing = await db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(Number(telegramId))
    .first();

  if (!existing) {
    const userId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO users (
          id, telegram_id, username, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, Number(telegramId), safeUsername, safeName, now, now)
      .run();
    return {
      id: userId,
      telegram_id: Number(telegramId),
      username: safeUsername,
      display_name: safeName
    };
  }

  const nextUsername = safeUsername || existing.username || "";
  const nextDisplayName = safeName !== "Пользователь" ? safeName : (existing.display_name || safeName);
  if (nextUsername !== (existing.username || "") || nextDisplayName !== existing.display_name) {
    await db
      .prepare("UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?")
      .bind(nextUsername, nextDisplayName, now, existing.id)
      .run();
  }
  return {
    ...existing,
    username: nextUsername,
    display_name: nextDisplayName
  };
}

export async function handleSharedUserSelection(env, viewerId, chatId, usersShared) {
  const numericRequestId = Number(usersShared?.request_id);
  const sharedUsers = Array.isArray(usersShared?.users) ? usersShared.users : [];
  const selected = sharedUsers[0];

  const matchedKey = selectionKey(numericRequestId);
  const pending = await env.DB.get(matchedKey, "json");

  if (!pending || Number(pending.viewerId) !== Number(viewerId) || !selected) {
    await sendTelegramBotMessage(
      env,
      chatId,
      "Этот запрос выбора уже использован или устарел. Вернитесь в приложение и попробуйте ещё раз.",
      { remove_keyboard: true }
    );
    return;
  }

  await env.DB.delete(matchedKey);
  const selectedId = parseId(selected.user_id, "selected_user_id");
  const firstName = [selected.first_name, selected.last_name].filter(Boolean).join(" ").trim() || undefined;
  const normalizedUsername = selected.username ? normalizeUsername(selected.username, false) : "";
  await upsertUserDirectory(env, {
    id: selectedId,
    first_name: firstName,
    username: normalizedUsername || undefined
  });

  if (selectedId === Number(viewerId)) {
    await sendTelegramBotMessage(
      env,
      chatId,
      "Нужно выбрать другого пользователя Telegram, не собственный аккаунт.",
      { remove_keyboard: true }
    );
    return;
  }

  const storedProfile = await loadProfile(env, selectedId);
  const displayName = cleanPlainText(firstName || storedProfile.first_name, 64) || "Пользователь";

  let messageText = "";
  if (pending.purpose === "subscribe") {
    await addSubscription(env, Number(viewerId), selectedId);
    messageText = `Подписка на ${displayName} сохранена. Вернитесь в Mini App.`;
  } else if (pending.purpose === "group") {
    const groups = await loadGroups(env, Number(viewerId));
    const group = groups.find(item => item.id === String(pending.groupId || ""));
    if (!group) {
      await sendTelegramBotMessage(
        env,
        chatId,
        "Выбранная группа больше не существует.",
        { remove_keyboard: true }
      );
      return;
    }
    if (!group.memberIds.includes(selectedId)) {
      if (group.memberIds.length >= MAX_SOCIAL_ITEMS) {
        throw new ApiError(409, "Group members limit reached");
      }
      group.memberIds.unshift(selectedId);
      await saveGroups(env, Number(viewerId), groups);
    }
    messageText = `${displayName} добавлен в группу «${group.name}». Вернитесь в Mini App.`;
  } else if (pending.purpose === "expense_contact" || pending.purpose === "expense_member") {
    await addExpenseContact(env, Number(viewerId), selectedId);
    const selectedUserRow = await ensureExpenseUserInD1(env.EXPENSES_DB, {
      telegramId: selectedId,
      displayName,
      username: normalizedUsername || storedProfile.username || ""
    });

    if (pending.purpose === "expense_member" && pending.eventId && env.EXPENSES_DB && selectedUserRow) {
      const db = env.EXPENSES_DB;
      const eventRow = await db
        .prepare("SELECT * FROM events WHERE id = ?")
        .bind(String(pending.eventId))
        .first();
      const viewerRow = await db
        .prepare("SELECT * FROM users WHERE telegram_id = ?")
        .bind(Number(viewerId))
        .first();
      const viewerMember = viewerRow
        ? await db
            .prepare("SELECT * FROM event_members WHERE event_id = ? AND user_id = ?")
            .bind(String(pending.eventId), viewerRow.id)
            .first()
        : null;

      if (!eventRow || !viewerMember) {
        await sendTelegramBotMessage(
          env,
          chatId,
          "Событие не найдено или у вас нет прав добавлять в него участников.",
          { remove_keyboard: true }
        );
        return;
      }

      const existingMember = await db
        .prepare("SELECT * FROM event_members WHERE event_id = ? AND user_id = ?")
        .bind(String(pending.eventId), selectedUserRow.id)
        .first();

      if (!existingMember) {
        const now = new Date().toISOString();
        await db
          .prepare(
            `INSERT INTO event_members (
              id, event_id, user_id, member_name, role, default_weight, linked_payer_member_id, joined_at
            ) VALUES (?, ?, ?, ?, 'MEMBER', 1.0, NULL, ?)`
          )
          .bind(crypto.randomUUID(), String(pending.eventId), selectedUserRow.id, displayName, now)
          .run();
        await db
          .prepare("UPDATE events SET updated_at = ? WHERE id = ?")
          .bind(now, String(pending.eventId))
          .run();
        await db
          .prepare(
            `INSERT INTO event_audit_log (id, event_id, actor_user_id, action, details_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            String(pending.eventId),
            viewerRow.id,
            "MEMBER_ADDED",
            JSON.stringify({
              user_id: selectedUserRow.id,
              telegram_id: selectedId,
              names: [displayName],
              text: `Добавлен(а) участник: ${displayName}`
            }),
            now
          )
          .run();
      }
      messageText = `${displayName} добавлен(а) в событие «${eventRow.title}». Вернитесь в Mini App.`;
    } else {
      messageText = `${displayName} сохранён(а) в контакты. Вернитесь в Mini App, чтобы добавить участника в событие.`;
    }
  }

  if (messageText) {
    await sendTelegramBotMessage(env, chatId, messageText, { remove_keyboard: true });
  }
}

async function handleNotificationsCommand(env, message) {
  const userId = Number(message?.from?.id ?? message?.chat?.id);
  if (!isValidChatId(userId)) return json({ ok: true });
  const prefs = await readNotificationPrefs(env, userId);
  await sendTelegramBotMessage(
    env,
    userId,
    formatNotificationsSettingsText(prefs),
    buildNotificationsKeyboard(prefs)
  );
  return json({ ok: true });
}

async function handleNotificationCallback(env, query) {
  const fromUser = query?.from;
  const data = String(query?.data || "");
  try {
    if (data.startsWith("notify:toggle:") && fromUser?.id) {
      const field = data.slice("notify:toggle:".length);
      if (field === "bookings" || field === "new_gifts") {
        const current = await readNotificationPrefs(env, fromUser.id);
        const updated = await saveNotificationPrefs(env, fromUser.id, {
          ...current,
          [field]: !current[field]
        });
        const messageId = Number(query?.message?.message_id);
        const chatId = Number(query?.message?.chat?.id ?? fromUser.id);
        if (Number.isSafeInteger(messageId) && messageId > 0 && isValidChatId(chatId)) {
          try {
            await callTelegramApi(env, "editMessageText", {
              chat_id: chatId,
              message_id: messageId,
              text: formatNotificationsSettingsText(updated),
              reply_markup: buildNotificationsKeyboard(updated)
            });
          } catch (error) {
            console.warn("Failed to update notification settings message:", error?.stack || error);
          }
        }
      }
    }
    if (query?.id) {
      try {
        await callTelegramApi(env, "answerCallbackQuery", { callback_query_id: query.id });
      } catch (error) {
        console.warn("Failed to answer callback query:", error?.stack || error);
      }
    }
  } catch (error) {
    console.warn("Failed to handle notification callback:", error?.stack || error);
  }
  return json({ ok: true });
}

export async function handleTelegramWebhook(request, env) {
  if (env.WEBHOOK_SECRET) {
    const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (receivedSecret !== env.WEBHOOK_SECRET) {
      throw new ApiError(401, "Invalid webhook secret");
    }
  }

  const update = await request.json().catch(() => null);
  if (!update) return json({ ok: true });

  if (update.callback_query) {
    return await handleNotificationCallback(env, update.callback_query);
  }

  const message = update.message;
  if (!message) return json({ ok: true });
  const chatId = message.chat?.id;
  if (!chatId) return json({ ok: true });

  const sharedRaw = message.users_shared || message.user_shared;
  if (sharedRaw && message.from?.id) {
    const shared = Array.isArray(sharedRaw.users)
      ? sharedRaw
      : { request_id: sharedRaw.request_id, users: [sharedRaw] };
    await handleSharedUserSelection(env, message.from.id, chatId, shared);
    return json({ ok: true });
  }

  const text = String(message.text || "").trim();
  if (/^\/notifications(?:@\w+)?\s*$/i.test(text)) {
    return await handleNotificationsCommand(env, message);
  }

  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+list_(\d+)(?:_(occ_[A-Za-z0-9_-]{1,32}))?)?\s*$/);
  if (!startMatch) {
    return json({ ok: true });
  }

  if (!env.WEBAPP_URL) {
    throw new ApiError(500, "WEBAPP_URL is not configured");
  }

  const webAppUrl = new URL(env.WEBAPP_URL);
  if (startMatch[1]) {
    webAppUrl.searchParams.set("list", startMatch[1]);
  }
  if (startMatch[2]) {
    webAppUrl.searchParams.set("occasion", startMatch[2].replace(/^occ_occ_/, "occ_"));
  }

  await callTelegramApi(env, "sendMessage", {
    chat_id: chatId,
    text: "Откройте вишлист, чтобы добавить желание или выбрать подарок для друга.",
    reply_markup: {
      inline_keyboard: [[
        {
          text: "Открыть вишлист",
          web_app: { url: webAppUrl.toString() }
        }
      ]]
    }
  });

  return json({ ok: true });
}
