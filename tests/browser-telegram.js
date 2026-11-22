import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const BOT_TOKEN = "123456789:TEST_BOT_TOKEN_FOR_BROWSER_E2E_123456";

function buildSignedInitData(user, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAG_browser_test_query");
  params.set("user", JSON.stringify(user));

  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

function createInitialDbState() {
  const ownerId = 1001;
  const guest1Id = 2002;
  const guest2Id = 3003;
  const makeUrl = (slug) => `${"http"}${"s://"}item.local/${slug}`;

  const ownerGifts = [
    {
      id: "gift_initial_1",
      title: "Механическая клавиатура 75%",
      price: 9500,
      link: makeUrl("keyboard"),
      image: "",
      comment: "Тихие тактильные переключатели",
      desire: "high",
      category: "Техника",
      tags: ["для дома", "настольный сетап"],
      occasionIds: ["occ_birthday"],
      groupIds: ["grp_close"],
      crowdfund: false,
      reusable: false,
      gifted: false,
      takenBy: [],
      createdAt: "2026-04-01T10:00:00.000Z"
    },
    {
      id: "gift_initial_2",
      title: "Сертификат на мастер-класс керамики",
      price: 4200,
      link: makeUrl("ceramics"),
      image: "",
      comment: "На двоих в выходные",
      desire: "medium",
      category: "Впечатления",
      tags: ["на выходные"],
      occasionIds: ["occ_new_year"],
      groupIds: [],
      crowdfund: true,
      reusable: false,
      gifted: false,
      takenBy: [{ id: guest1Id, name: "Анна Волкова", username: "anna_v" }],
      createdAt: "2026-04-02T10:00:00.000Z"
    }
  ];

  const guest1Gifts = [
    {
      id: "gift_guest1_1",
      title: "Книга по архитектуре систем",
      price: 2800,
      link: makeUrl("book"),
      image: "",
      comment: "Твёрдый переплёт",
      desire: "high",
      category: "Хобби",
      tags: ["чтение"],
      occasionIds: [],
      groupIds: [],
      crowdfund: false,
      reusable: false,
      gifted: false,
      takenBy: [],
      createdAt: "2026-04-02T12:00:00.000Z"
    }
  ];

  const wishlists = {
    [ownerId]: {
      userId: ownerId,
      ownerName: "Максим Соколов",
      ownerUsername: "max_sokolov",
      occasions: [
        { id: "occ_birthday", title: "День рождения" },
        { id: "occ_new_year", title: "Новый год" }
      ],
      gifts: ownerGifts
    },
    [guest1Id]: {
      userId: guest1Id,
      ownerName: "Анна Волкова",
      ownerUsername: "anna_v",
      occasions: [{ id: "occ_spring", title: "Весна" }],
      gifts: guest1Gifts
    },
    [guest2Id]: {
      userId: guest2Id,
      ownerName: "Илья Морозов",
      ownerUsername: "ilya_m",
      occasions: [],
      gifts: []
    }
  };

  const groupsByOwner = {
    [ownerId]: [
      { id: "grp_close", name: "Близкие", memberIds: [guest1Id] },
      { id: "grp_uni", name: "Универ", memberIds: [] }
    ],
    [guest1Id]: [],
    [guest2Id]: []
  };

  const subscriptionsByUser = {
    [ownerId]: [
      { userId: guest1Id, name: "Анна Волкова", username: "anna_v" }
    ],
    [guest1Id]: [
      { userId: ownerId, name: "Максим Соколов", username: "max_sokolov" }
    ],
    [guest2Id]: []
  };

  const usersById = {
    [ownerId]: { id: ownerId, name: "Максим Соколов", username: "max_sokolov" },
    [guest1Id]: { id: guest1Id, name: "Анна Волкова", username: "anna_v" },
    [guest2Id]: { id: guest2Id, name: "Илья Морозов", username: "ilya_m" }
  };

  return {
    wishlists,
    groupsByOwner,
    subscriptionsByUser,
    usersById,
    images: {},
    nextGiftNum: 10,
    nextGroupNum: 10,
    nextOccasionNum: 10
  };
}

function getActorFromInitData(initData, db) {
  const params = new URLSearchParams(initData);
  const rawUser = params.get("user");
  const parsed = rawUser ? JSON.parse(rawUser) : { id: 1001, first_name: "Максим", username: "max_sokolov" };
  const id = Number(parsed.id);
  if (!db.usersById[id]) {
    db.usersById[id] = {
      id,
      name: [parsed.first_name, parsed.last_name].filter(Boolean).join(" ") || "Пользователь",
      username: String(parsed.username || "").toLowerCase()
    };
  }
  if (!db.wishlists[id]) {
    db.wishlists[id] = {
      userId: id,
      ownerName: db.usersById[id].name,
      ownerUsername: db.usersById[id].username,
      occasions: [],
      gifts: []
    };
  }
  if (!db.groupsByOwner[id]) db.groupsByOwner[id] = [];
  if (!db.subscriptionsByUser[id]) db.subscriptionsByUser[id] = [];
  return db.usersById[id];
}

function canViewGift(gift, ownerId, viewerId, db) {
  if (Number(ownerId) === Number(viewerId)) return true;
  const groupIds = Array.isArray(gift.groupIds) ? gift.groupIds : [];
  if (!groupIds.length) return true;
  const ownerGroups = db.groupsByOwner[ownerId] || [];
  return groupIds.some((gid) => {
    const grp = ownerGroups.find((g) => g.id === gid);
    return grp && Array.isArray(grp.memberIds) && grp.memberIds.includes(Number(viewerId));
  });
}

function serializeWishlistForViewer(ownerId, viewerId, db, occasionId = "") {
  const wl = db.wishlists[ownerId] || {
    userId: ownerId,
    ownerName: "Пользователь",
    ownerUsername: "",
    occasions: [],
    gifts: []
  };
  const isOwner = Number(ownerId) === Number(viewerId);
  const visibleGifts = wl.gifts
    .filter((g) => canViewGift(g, ownerId, viewerId, db))
    .filter((g) => (!occasionId ? true : Array.isArray(g.occasionIds) && g.occasionIds.includes(occasionId)))
    .map((g) => {
      const takenBy = Array.isArray(g.takenBy) ? g.takenBy : [];
      const isMine = takenBy.some((t) => Number(t.id) === Number(viewerId));
      if (isOwner) {
        return {
          ...g,
          isMine,
          takenCount: takenBy.length,
          takenBy: g.crowdfund || g.reusable ? takenBy : []
        };
      }
      return {
        ...g,
        isMine,
        takenCount: takenBy.length,
        takenBy
      };
    });

  return {
    ownerId: Number(ownerId),
    ownerName: wl.ownerName,
    ownerUsername: wl.ownerUsername,
    isOwner,
    occasions: wl.occasions || [],
    gifts: visibleGifts
  };
}

function attachMockBackend(page, db) {
  const tgAppUrl = `${"http"}${"s://"}t.me/test_wishlist_bot/app`;
  return page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isLocalOrigin = url.hostname === "127.0.0.1" || url.hostname === "localhost";

    if (!isLocalOrigin) {
      await route.fulfill({
        status: 204,
        contentType: "text/plain; charset=utf-8",
        body: ""
      });
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      try {
        const response = await route.fetch();
        const body = await response.body();
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body
        });
      } catch {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: ""
        });
      }
      return;
    }

    const initData = request.headers()["x-telegram-init-data"] || "";
    if (!initData.includes("hash=")) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Missing Telegram initData" })
      });
      return;
    }

    const actor = getActorFromInitData(initData, db);
    const method = request.method();
    const path = url.pathname;

    const sendJson = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(payload)
      });

    if (path === "/api/wishlist" && method === "GET") {
      const targetId = Number(url.searchParams.get("ownerId") || actor.id);
      const occasionId = url.searchParams.get("occasionId") || "";
      return sendJson(serializeWishlistForViewer(targetId, actor.id, db, occasionId));
    }

    if (path === "/api/gifts" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const wl = db.wishlists[actor.id];
      const newGift = {
        id: `gift_e2e_${db.nextGiftNum++}`,
        title: String(body.title || "").trim(),
        price: Number(body.price || 0),
        link: String(body.link || "").trim(),
        image: String(body.image || "").trim(),
        comment: String(body.comment || "").trim(),
        desire: body.desire || "medium",
        category: String(body.category || "").trim(),
        tags: Array.isArray(body.tags) ? body.tags : [],
        occasionIds: Array.isArray(body.occasionIds) ? body.occasionIds : [],
        groupIds: Array.isArray(body.groupIds) ? body.groupIds : [],
        crowdfund: Boolean(body.crowdfund),
        reusable: Boolean(body.reusable),
        gifted: false,
        takenBy: [],
        createdAt: new Date().toISOString()
      };
      wl.gifts.unshift(newGift);
      return sendJson({ gift: newGift, wishlist: serializeWishlistForViewer(actor.id, actor.id, db) }, 201);
    }

    const giftMatch = path.match(/^\/api\/gifts\/([^/]+)$/);
    if (giftMatch && method === "PATCH") {
      const giftId = giftMatch[1];
      const body = JSON.parse(request.postData() || "{}");
      const wl = db.wishlists[actor.id];
      const gift = wl.gifts.find((g) => g.id === giftId);
      if (!gift) return sendJson({ error: "Not found" }, 404);
      Object.assign(gift, {
        ...(body.title !== undefined ? { title: String(body.title).trim() } : {}),
        ...(body.price !== undefined ? { price: Number(body.price || 0) } : {}),
        ...(body.link !== undefined ? { link: String(body.link).trim() } : {}),
        ...(body.image !== undefined ? { image: String(body.image).trim() } : {}),
        ...(body.comment !== undefined ? { comment: String(body.comment).trim() } : {}),
        ...(body.desire !== undefined ? { desire: body.desire } : {}),
        ...(body.category !== undefined ? { category: String(body.category).trim() } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.occasionIds !== undefined ? { occasionIds: body.occasionIds } : {}),
        ...(body.groupIds !== undefined ? { groupIds: body.groupIds } : {}),
        ...(body.crowdfund !== undefined ? { crowdfund: Boolean(body.crowdfund) } : {}),
        ...(body.reusable !== undefined ? { reusable: Boolean(body.reusable) } : {}),
        ...(body.gifted !== undefined ? { gifted: Boolean(body.gifted) } : {})
      });
      return sendJson({ gift, wishlist: serializeWishlistForViewer(actor.id, actor.id, db) });
    }

    if (giftMatch && method === "DELETE") {
      const giftId = giftMatch[1];
      const wl = db.wishlists[actor.id];
      wl.gifts = wl.gifts.filter((g) => g.id !== giftId);
      return sendJson({ ok: true, wishlist: serializeWishlistForViewer(actor.id, actor.id, db) });
    }

    const takeMatch = path.match(/^\/api\/gifts\/([^/]+)\/take$/);
    if (takeMatch && method === "POST") {
      const giftId = takeMatch[1];
      const ownerId = Number(url.searchParams.get("ownerId") || 1001);
      const wl = db.wishlists[ownerId];
      const gift = wl?.gifts.find((g) => g.id === giftId);
      if (!gift) return sendJson({ error: "Gift not found" }, 404);
      const exists = gift.takenBy.some((t) => Number(t.id) === Number(actor.id));
      if (exists) {
        gift.takenBy = gift.takenBy.filter((t) => Number(t.id) !== Number(actor.id));
      } else if (gift.crowdfund || gift.reusable) {
        gift.takenBy.push({ id: actor.id, name: actor.name, username: actor.username });
      } else {
        gift.takenBy = [{ id: actor.id, name: actor.name, username: actor.username }];
      }
      return sendJson({ gift, wishlist: serializeWishlistForViewer(ownerId, actor.id, db) });
    }

    if (path === "/api/participations" && method === "GET") {
      const items = [];
      for (const [oidStr, wl] of Object.entries(db.wishlists)) {
        const oid = Number(oidStr);
        for (const g of wl.gifts) {
          const takenBy = Array.isArray(g.takenBy) ? g.takenBy : [];
          if (takenBy.some((t) => Number(t.id) === Number(actor.id))) {
            items.push({
              ...g,
              ownerId: oid,
              ownerName: wl.ownerName,
              ownerUsername: wl.ownerUsername,
              isMine: true,
              takenCount: takenBy.length,
              takenBy
            });
          }
        }
      }
      return sendJson({ items });
    }

    if (path === "/api/social" && method === "GET") {
      return sendJson({
        subscriptions: db.subscriptionsByUser[actor.id] || [],
        groups: db.groupsByOwner[actor.id] || []
      });
    }

    if (path === "/api/subscriptions" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const cleanHandle = String(body.username || "").replace(/^@+/, "").trim().toLowerCase();
      const targetUser = Object.values(db.usersById).find((u) => u.username.toLowerCase() === cleanHandle);
      if (!targetUser) {
        return sendJson({ error: "User not found", code: "USER_NOT_FOUND" }, 404);
      }
      const list = db.subscriptionsByUser[actor.id] || [];
      if (!list.some((item) => Number(item.userId) === Number(targetUser.id))) {
        list.push({ userId: targetUser.id, name: targetUser.name, username: targetUser.username });
      }
      db.subscriptionsByUser[actor.id] = list;
      return sendJson({ subscriptions: list }, 201);
    }

    const subDeleteMatch = path.match(/^\/api\/subscriptions\/(\d+)$/);
    if (subDeleteMatch && method === "DELETE") {
      const targetId = Number(subDeleteMatch[1]);
      db.subscriptionsByUser[actor.id] = (db.subscriptionsByUser[actor.id] || []).filter(
        (item) => Number(item.userId) !== targetId
      );
      return sendJson({ subscriptions: db.subscriptionsByUser[actor.id] });
    }

    if (path === "/api/groups" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const name = String(body.name || "").trim();
      const groups = db.groupsByOwner[actor.id] || [];
      const created = { id: `grp_${db.nextGroupNum++}`, name, memberIds: [] };
      groups.push(created);
      db.groupsByOwner[actor.id] = groups;
      return sendJson({ group: created, groups }, 201);
    }

    const groupMatch = path.match(/^\/api\/groups\/([^/]+)$/);
    if (groupMatch && method === "PATCH") {
      const groupId = groupMatch[1];
      const body = JSON.parse(request.postData() || "{}");
      const groups = db.groupsByOwner[actor.id] || [];
      const grp = groups.find((g) => g.id === groupId);
      if (!grp) return sendJson({ error: "Group not found" }, 404);
      if (body.name !== undefined) grp.name = String(body.name).trim();
      if (Array.isArray(body.memberIds)) grp.memberIds = body.memberIds.map(Number);
      return sendJson({ group: grp, groups });
    }

    if (groupMatch && method === "DELETE") {
      const groupId = groupMatch[1];
      db.groupsByOwner[actor.id] = (db.groupsByOwner[actor.id] || []).filter((g) => g.id !== groupId);
      for (const g of db.wishlists[actor.id]?.gifts || []) {
        g.groupIds = (g.groupIds || []).filter((id) => id !== groupId);
      }
      return sendJson({ groups: db.groupsByOwner[actor.id] });
    }

    if (path === "/api/occasions" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const title = String(body.title || "").trim();
      const wl = db.wishlists[actor.id];
      const created = { id: `occ_${db.nextOccasionNum++}`, title };
      wl.occasions.push(created);
      return sendJson({ occasion: created, occasions: wl.occasions }, 201);
    }

    const occasionMatch = path.match(/^\/api\/occasions\/([^/]+)$/);
    if (occasionMatch && method === "DELETE") {
      const occId = occasionMatch[1];
      const wl = db.wishlists[actor.id];
      wl.occasions = (wl.occasions || []).filter((o) => o.id !== occId);
      for (const g of wl.gifts || []) {
        g.occasionIds = (g.occasionIds || []).filter((id) => id !== occId);
      }
      return sendJson({ occasions: wl.occasions });
    }

    if (path === "/api/share" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const occ = body.occasionId ? `?startapp=list_1001__${body.occasionId}` : "?startapp=list_1001";
      return sendJson({ ok: true, shareUrl: `${tgAppUrl}${occ}` });
    }

    if (path === "/api/images" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      const id = `img_e2e_${Object.keys(db.images).length + 1}`;
      db.images[id] = { ownerId: actor.id, dataUrl: body.dataUrl };
      return sendJson({ id, url: `${url.origin}/api/images/${id}` }, 201);
    }

    const imageMatch = path.match(/^\/api\/images\/([^/]+)$/);
    if (imageMatch && method === "GET") {
      const rec = db.images[imageMatch[1]];
      if (!rec) return sendJson({ error: "Image not found" }, 404);
      const base64 = String(rec.dataUrl).split(",")[1] || "";
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(base64, "base64")
      });
    }

    return sendJson({ error: "Unhandled mock route" }, 404);
  });
}

async function openMiniAppWithTelegramSdk(page, baseUrl, user, startParam = "") {
  const initData = buildSignedInitData(user);
  await page.addInitScript(
    ({ signedInitData, tgUser, startParamValue }) => {
      const listeners = new Map();
      const sentMessages = [];
      let copiedText = "";

      window.__tgTestState = {
        sentMessages,
        getCopiedText: () => copiedText,
        triggerEvent: (eventName, payload) => {
          const handlers = listeners.get(eventName) || [];
          for (const fn of handlers) fn(payload);
        }
      };

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (txt) => {
            copiedText = String(txt);
          }
        }
      });

      window.Telegram = {
        WebApp: {
          initData: signedInitData,
          initDataUnsafe: {
            user: tgUser,
            start_param: startParamValue
          },
          version: "7.10",
          platform: "android",
          colorScheme: "dark",
          themeParams: {
            bg_color: "#0f172a",
            text_color: "#f8fafc",
            hint_color: "#94a3b8",
            button_color: "#6366f1",
            button_text_color: "#ffffff",
            secondary_bg_color: "#1e293b"
          },
          isExpanded: true,
          viewportHeight: 844,
          viewportStableHeight: 844,
          ready: () => {},
          expand: () => {},
          sendData: (data) => {
            sentMessages.push(data);
          },
          openTelegramLink: (url) => {
            sentMessages.push(url);
          },
          onEvent: (eventName, cb) => {
            if (!listeners.has(eventName)) listeners.set(eventName, []);
            listeners.get(eventName).push(cb);
          },
          offEvent: (eventName, cb) => {
            const list = listeners.get(eventName) || [];
            listeners.set(eventName, list.filter((item) => item !== cb));
          },
          HapticFeedback: {
            impactOccurred: () => {},
            notificationOccurred: () => {},
            selectionChanged: () => {}
          },
          showPopup: (_params, cb) => {
            if (typeof cb === "function") cb("ok");
          },
          showAlert: (_msg, cb) => {
            if (typeof cb === "function") cb();
          },
          showConfirm: (_msg, cb) => {
            if (typeof cb === "function") cb(true);
          }
        }
      };
    },
    { signedInitData: initData, tgUser: user, startParamValue: startParam }
  );

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#giftsGrid .gift-card, #giftsGrid .empty-state-card", { timeout: 10000 });
}

export default async function runTelegramScenario(page, baseUrl) {
  const db = createInitialDbState();
  await attachMockBackend(page, db);

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });

  const ownerUser = { id: 1001, first_name: "Максим", last_name: "Соколов", username: "max_sokolov" };
  const guest1User = { id: 2002, first_name: "Анна", last_name: "Волкова", username: "anna_v" };
  const guest2User = { id: 3003, first_name: "Илья", last_name: "Морозов", username: "ilya_m" };

  await openMiniAppWithTelegramSdk(page, baseUrl, ownerUser);

  const demoDockVisible = await page.locator(".demo-dock-wrapper").isVisible();
  assert.equal(demoDockVisible, false, "Demo Studio dock must be hidden inside Telegram WebApp session");

  await page.fill("#addTitleInput", "Беспроводная колонка");
  await page.click("#addSubmitBtn");
  await page.waitForSelector('#giftsGrid .gift-card:has-text("Беспроводная колонка")');

  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await page.click("#toggleDetailsBtn");
  await page.fill("#addTitleInput", "Портативный проектор");
  await page.setInputFiles("#addFileInput", {
    name: "projector.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPngBase64, "base64")
  });
  await page.waitForSelector("#addPhotoPreviewBox.visible", { timeout: 10000 });
  await page.click('#addDetailsPanel button[type="submit"]');
  await page.waitForSelector('#giftsGrid .gift-card:has-text("Портативный проектор")');

  const projectorCard = page.locator('#giftsGrid .gift-card:has-text("Портативный проектор")');
  await projectorCard.locator(".btn-card-edit").click();
  await page.waitForSelector("#editModalBackdrop.open");
  await page.fill("#editTitleInput", "Портативный проектор 4K");
  await page.click('#editGiftForm button[type="submit"]');
  await page.waitForSelector('#giftsGrid .gift-card:has-text("Портативный проектор 4K")');

  const cardToDelete = page.locator('#giftsGrid .gift-card:has-text("Беспроводная колонка")');
  await cardToDelete.locator(".btn-card-delete").click();
  await page.waitForSelector("#deleteConfirmBackdrop.open");
  await page.click("#confirmDeleteBtn");
  await page.waitForFunction(() => !document.body.innerText.includes("Беспроводная колонка"));

  await page.click("#friendsViewBtn");
  await page.waitForSelector("#friendsWorkspace:not([hidden])");
  await page.fill("#newGroupNameInput", "Коллеги");
  await page.click("#createGroupSubmitBtn");
  await page.waitForSelector('#groupsList .social-card:has-text("Коллеги")');

  await page.click("#wishlistViewBtn");
  await page.waitForSelector("#wishlistWorkspace:not([hidden])");

  const guest1Context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const guest1Page = await guest1Context.newPage();
  await attachMockBackend(guest1Page, db);
  await openMiniAppWithTelegramSdk(guest1Page, baseUrl, guest1User, "list_1001");

  const guest1CanSeeKeyboard = await guest1Page
    .locator('#giftsGrid .gift-card:has-text("Механическая клавиатура 75%")')
    .isVisible();
  assert.equal(guest1CanSeeKeyboard, true, "Guest 1 (in Близкие) should see restricted gift");

  const guest1ProjectorCard = guest1Page.locator('#giftsGrid .gift-card:has-text("Портативный проектор 4K")');
  await guest1ProjectorCard.locator(".btn-take-gift").click();
  await guest1Page.waitForTimeout(300);

  await guest1Page.click("#participationsViewBtn");
  await guest1Page.waitForSelector("#participationsWorkspace:not([hidden])");
  const participationVisible = await guest1Page
    .locator('#participationsGrid .gift-card:has-text("Портативный проектор 4K")')
    .isVisible();
  assert.equal(participationVisible, true, "Taken gift should appear in Guest 1 participations tab");
  await guest1Context.close();

  const guest2Context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const guest2Page = await guest2Context.newPage();
  await attachMockBackend(guest2Page, db);
  await openMiniAppWithTelegramSdk(guest2Page, baseUrl, guest2User, "list_1001");

  const guest2RestrictedCount = await guest2Page
    .locator('#giftsGrid .gift-card:has-text("Механическая клавиатура 75%")')
    .count();
  assert.equal(guest2RestrictedCount, 0, "Guest 2 (outside Близкие) must not see restricted gift");
  await guest2Context.close();

  assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join("; ")}`);
  assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join("; ")}`);

  return {
    scenario: "telegram-e2e",
    demoDockHidden: !demoDockVisible,
    verifiedFlows: [
      "telegram-session-init",
      "create-edit-delete-gift-with-upload",
      "custom-groups",
      "deep-link-and-privacy-filtering",
      "take-gift-and-participations"
    ]
  };
}
