import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const BOT_TOKEN = "123456789:TEST_BOT_TOKEN_FOR_BROWSER_E2E_123456";
const PROTO = ["http", "s://"].join("");

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

export default async (page, baseUrl) => {
  const results = [];
  const pageErrors = [];
  const imageAuthHeaders = [];
  const copiedGiftPayloads = [];
  let startParam = "list_1001_occ_bday01";
  let bookedBy = null;
  let reusableGivers = [];
  let failApi = false;
  const subscriptions = [];
  const coreProfile = {
    id: "usr_2002",
    telegram_id: 2002,
    display_name: "Анна",
    username: "anna1",
    payment_phone: "",
    preferred_banks: [],
    default_currency: "RUB"
  };
  const groups = [
    { id: "family", name: "Семья", members: [] },
    { id: "close", name: "Близкие", members: [] },
    { id: "friends", name: "Друзья", members: [] },
    { id: "colleagues", name: "Коллеги", members: [] }
  ];
  const occasions = [
    { id: "occ_bday01", title: "День рождения" },
    { id: "occ_ny2027", title: "Новый год" }
  ];
  const jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCpRRRX3xxn/9k=";
  page.on("pageerror", error => pageErrors.push(error.message));

  const giftsList = () => ([
    {
      id: 1731672009000,
      title: "Подарок через боевой API",
      link: `${PROTO}shop.local/`,
      image: "/api/img/0123456789abcdef",
      price: 5000,
      category: "Техника",
      comment: "",
      priority: false,
      desire: "medium",
      tags: [],
      group_ids: [],
      occasion_ids: ["occ_bday01"],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: bookedBy === null ? null : bookedBy === 2002 ? 2002 : -1,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672009050,
      title: "Многоразовый сертификат",
      link: `${PROTO}shop.local/cert`,
      image: "",
      price: 3000,
      category: "Хобби",
      comment: "",
      priority: false,
      desire: "medium",
      tags: [],
      group_ids: [],
      occasion_ids: ["occ_ny2027"],
      is_crowdfund: false,
      is_reusable: true,
      booked_by: null,
      participants: [],
      reusable_givers: reusableGivers.map(id => (id === 2002 ? 2002 : -1)),
      is_gifted: false
    }
  ]);
  const socialData = () => ({ subscriptions, groups });

  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const isLocalOrigin = url.hostname === "127.0.0.1" || url.hostname === "localhost";

    if (!url.pathname.startsWith("/api/")) {
      if (isLocalOrigin) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      return;
    }

    const fulfillJson = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(payload)
      });

    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data"
        }
      });
    }

    if (url.pathname === "/api/config") {
      return fulfillJson({ botUsername: "wishlist_test_bot" });
    }

    if (url.pathname === "/api/core/bootstrap") {
      return fulfillJson({
        ok: true,
        module: "superapp_core",
        d1_bound: true,
        user: coreProfile,
        dashboard: {
          active_events: [],
          archived_events: [],
          summary_by_currency: { RUB: { you_owe_minor: 0, owed_to_you_minor: 0 } }
        }
      });
    }

    if (url.pathname === "/api/core/profile" && request.method() === "POST") {
      const body = request.postDataJSON();
      Object.assign(coreProfile, body);
      return fulfillJson({ ok: true, user: coreProfile });
    }

    if (url.pathname === "/api/img/0123456789abcdef") {
      imageAuthHeaders.push(request.headers()["x-telegram-init-data"] || "");
      return route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: Buffer.from(jpeg, "base64")
      });
    }

    if (url.pathname === "/api/img/broken0123456789ab") {
      imageAuthHeaders.push(request.headers()["x-telegram-init-data"] || "");
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Image not found" })
      });
    }

    if (url.pathname === "/api/participations") {
      const items = [];
      if (bookedBy === 2002) {
        items.push({
          type: "book",
          updatedAt: "2026-04-12T10:00:00.000Z",
          owner: { id: 1001, first_name: "Максим" },
          gift: giftsList()[0]
        });
      }
      if (reusableGivers.includes(2002)) {
        items.push({
          type: "reusable",
          updatedAt: "2026-04-12T10:05:00.000Z",
          owner: { id: 1001, first_name: "Максим" },
          gift: { ...giftsList()[1], reusableCount: reusableGivers.length }
        });
      }
      return fulfillJson({ items });
    }

    if (url.pathname === "/api/social") {
      if (request.method() === "GET") return fulfillJson(socialData());
      const { action, payload } = request.postDataJSON();
      if (action === "subscribe") {
        if (payload.username === "unknown_user") {
          return route.fulfill({
            status: 202,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ status: "selection_required", requestId: "req1", botUsername: "wishlist_test_bot" })
          });
        }
        const profile = payload.user_id === 1001
          ? { id: 1001, first_name: "Максим", username: "maxim" }
          : { id: 3003, first_name: "Дима", username: "dima1" };
        if (!subscriptions.some(item => item.id === profile.id)) subscriptions.push(profile);
      } else if (action === "unsubscribe") {
        const index = subscriptions.findIndex(item => item.id === payload.user_id);
        if (index >= 0) subscriptions.splice(index, 1);
      } else if (action === "add_group_member") {
        const group = groups.find(item => item.id === payload.group_id);
        if (group && !group.members.some(member => member.id === 3003)) {
          group.members.push({ id: 3003, first_name: "Дима", username: "dima1" });
        }
      } else if (action === "create_group") {
        groups.push({ id: "grp_test0001", name: payload.name, members: [] });
      } else if (action === "rename_group") {
        const group = groups.find(item => item.id === payload.group_id);
        if (group) group.name = payload.name;
      } else if (action === "delete_group") {
        const idx = groups.findIndex(item => item.id === payload.group_id);
        if (idx >= 0) groups.splice(idx, 1);
      }
      return fulfillJson(socialData());
    }

    if (url.pathname === "/api/data" || url.pathname === "/api/gifts") {
      if (failApi) return fulfillJson({ error: "Test outage" }, 500);
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        if (body.action === "copy_gift") {
          copiedGiftPayloads.push(body);
          return fulfillJson({ ok: true, gift: { id: 999999, title: "Подарок через боевой API" } }, 201);
        }
        if (body.owner_id !== 1001 || body.action !== "toggle_book") {
          return fulfillJson({ error: "Unexpected mutation" }, 400);
        }
        if (body.payload.id === 1731672009050) {
          reusableGivers = reusableGivers.includes(2002) ? [] : [2002];
        } else {
          bookedBy = bookedBy === null ? 2002 : null;
        }
      }
      const ownerId = Number(url.searchParams.get("owner_id") || 1001);
      if (ownerId === 2002) {
        return fulfillJson({
          owner: { id: 2002, first_name: "Анна" },
          gifts: [],
          occasions,
          groups,
          is_subscribed: false
        });
      }
      return fulfillJson({
        owner: { id: 1001, first_name: "Максим", username: "maxim" },
        gifts: giftsList(),
        occasions,
        is_subscribed: subscriptions.some(profile => profile.id === 1001)
      });
    }

    return fulfillJson({ error: "Unexpected API route" }, 404);
  });

  const user = { id: 2002, first_name: "Анна", username: "anna1" };
  const signedInitData = buildSignedInitData(user);
  await page.addInitScript(({ initData, userObj, start }) => {
    window.__openedTelegramLink = "";
    window.Telegram = {
      WebApp: {
        initData,
        initDataUnsafe: { user: userObj, start_param: start },
        colorScheme: "dark",
        ready() {},
        expand() {},
        openTelegramLink(url) { window.__openedTelegramLink = url; },
        openLink(url) { window.__openedLink = url; },
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {} }
      }
    };
  }, { initData: signedInitData, userObj: user, start: startParam });

  await page.goto(`${baseUrl}/`);
  await page.waitForFunction(() => state.isLoading === false);
  assert(await page.evaluate(() => isTelegramSession && state.viewerId === 2002 && state.ownerId === 1001), "Telegram start_param must open shared list");
  assert(await page.locator("#occasionBanner").isVisible(), "Occasion banner must be visible for deep link with occasion");
  assert((await page.locator("#occasionBannerTitle").textContent()).includes("День рождения"), "Occasion title must be rendered");
  assert(await page.locator("#giftsGrid .gift-card").count() === 1, "Occasion filter must show only matching gift");
  await page.locator("#showAllWishlistBtn").click();
  assert(await page.locator("#occasionBanner").isHidden(), "Banner must hide after resetting occasion filter");
  assert(await page.locator("#giftsGrid .gift-card").count() === 2, "All visible gifts must render after clearing occasion");
  results.push("occasion deep link banner and reset");

  assert(await page.locator(".demo-dock-wrapper").isHidden(), "Demo dock must be hidden in Telegram");
  assert(await page.locator("#ownerAddSection").isHidden(), "Guest cannot see owner form");
  assert((await page.locator("#headerTitle").textContent()).includes("Максим"), "Real owner name must be rendered");
  assert((await page.locator("#headerSubtitle").textContent()).includes("@maxim"), "Real owner username must be rendered");
  assert((await page.locator("#roleBadge").textContent()).includes("Анна"), "Real guest name must be rendered");
  results.push("telegram session, real names and start_param");

  // Verify Superapp Hub navigation and unlocked Wishlists card
  await page.locator("#openSuperappHubFromWishlistBtn").click();
  assert(await page.locator("#superappHubScreen").isVisible(), "Superapp hub must open from wishlist menu button");
  const wishlistHubText = await page.locator("#hubModuleWishlistBtn").textContent();
  assert(!wishlistHubText.includes("Скоро"), "Wishlists hub card must not have Скоро placeholder");
  await page.locator("#hubModuleExpensesBtn").click();
  assert(await page.locator("#expensesAppShell").isVisible(), "Expenses module screen must open from hub");
  await page.locator("#backFromExpensesBtn").click();
  await page.locator("#hubModuleWishlistBtn").click();
  assert(await page.locator("#wishlistAppShell").isVisible(), "Wishlists module must open from hub");
  results.push("superapp hub navigation with unlocked wishlists and expenses");

  await page.evaluate(() => {
    applyServerData({
      owner: { id: 1001, first_name: "Пользователь", username: "maxim" },
      gifts: state.gifts,
      occasions: state.occasions,
      is_subscribed: state.isSubscribed
    });
    renderAll();
  });
  assert((await page.locator("#headerTitle").textContent()).includes("@maxim"), "Username fallback must replace generic owner name");
  results.push("username fallback when first name is missing");

  const cardImage = page.locator("#giftsGrid .gift-card img").first();
  await cardImage.waitFor({ state: "visible" });
  assert((await cardImage.getAttribute("src")).startsWith("blob:"), "Internal KV image must load via Blob URL");
  assert(imageAuthHeaders.length >= 1 && imageAuthHeaders[0].includes("hash="), "Protected image request must send initData");
  results.push("authorized KV image loading");

  await page.evaluate(() => {
    applyServerData({
      owner: { id: 1001, first_name: "Максим", username: "maxim" },
      gifts: [{ ...state.gifts[0], image: "/api/img/broken0123456789ab" }],
      occasions: state.occasions,
      is_subscribed: state.isSubscribed
    });
    renderAll();
  });
  await page.waitForFunction(() => document.querySelector("#giftsGrid .gift-card img")?.style.display === "none");
  assert(await page.locator("#giftsGrid .card-art-placeholder").isVisible(), "Broken protected image must show placeholder");
  await page.evaluate(() => fetchGifts());
  await page.waitForFunction(() => state.gifts[0]?.id === 1731672009000 && !state.isLoading);
  results.push("protected image failure placeholder");

  const firstCard = page.locator("#giftsGrid .gift-card", { hasText: "Подарок через боевой API" });
  await firstCard.locator(".btn-guest-book").click();
  await page.waitForFunction(() => state.gifts[0]?.booked_by === 2002);
  assert(await page.evaluate(() => state.gifts[0]?.is_gifted === false), "Booking must not mark the gift as gifted");
  const bookedCardText = await firstCard.textContent();
  assert(bookedCardText.includes("Вы забронировали"), "Booking badge must explicitly describe a reservation");
  assert((await firstCard.locator(".card-actions-footer").textContent()).includes("Отменить бронь"), "Guest must see the cancellation action");
  results.push("API booking remains a reservation, not a gifted status");

  const reusableCard = page.locator("#giftsGrid .gift-card", { hasText: "Многоразовый сертификат" });
  await reusableCard.locator(".btn-guest-book").click();
  await page.waitForFunction(() => state.gifts[1]?.reusable_givers?.includes(2002));
  assert((await reusableCard.textContent()).includes("Вы выбрали этот подарок"), "Reusable badge must confirm guest selection");
  await reusableCard.locator(".btn-guest-unbook").click();
  await page.waitForFunction(() => (state.gifts[1]?.reusable_givers || []).length === 0);
  results.push("reusable gift selection and cancellation");

  await firstCard.locator(".btn-guest-copy").click();
  await page.waitForFunction(() => state.copiedGiftIds.has(1731672009000));
  assert(copiedGiftPayloads.length === 1 && copiedGiftPayloads[0].action === "copy_gift", "Copy button must send copy_gift action");
  assert((await firstCard.locator(".btn-guest-copy").textContent()).includes("В вашем списке"), "Copy button must update state after copying");
  results.push("copy gift to own wishlist");

  await page.locator("#subscribeListBtn").click();
  await page.waitForFunction(() => state.isSubscribed && state.subscriptions.length === 1);
  await page.locator("#subscribeListBtn").click();
  await page.waitForFunction(() => !state.isSubscribed && state.subscriptions.length === 0);
  results.push("subscribe and unsubscribe from shared list");

  await page.locator("#participationsViewBtn").click();
  await page.locator("#participationsWorkspace").waitFor({ state: "visible" });
  assert((await page.locator("#participationsGrid").textContent()).includes("Подарок через боевой API"), "Participations tab must render booked item");
  results.push("participations tab");

  await page.locator("#friendsViewBtn").click();
  await page.locator("#friendsWorkspace").waitFor({ state: "visible" });
  await page.locator("#subscribeUsernameInput").fill("@unknown_user");
  await page.locator("#subscribeSubmitBtn").click();
  await page.locator("#selectionHelp").waitFor({ state: "visible" });
  await page.locator("#openBotSelectionBtn").click();
  assert((await page.evaluate(() => window.__openedTelegramLink)) === `${PROTO}t.me/wishlist_test_bot`, "Selection button must open bot chat");

  await page.locator("#subscribeUsernameInput").fill("@dima1");
  await page.locator("#subscribeSubmitBtn").click();
  await page.waitForFunction(() => state.subscriptions.some(profile => profile.id === 3003));
  assert((await page.locator("#subscriptionsList").textContent()).includes("Дима"), "Subscribed friend must appear");

  const familyGroup = page.locator("#groupsList .access-group", { hasText: "Семья" });
  await familyGroup.locator("input").fill("@dima1");
  await familyGroup.getByRole("button", { name: "Добавить" }).click();
  await page.waitForFunction(() => state.groups.find(g => g.id === "family").members.some(m => m.id === 3003));
  assert((await familyGroup.textContent()).includes("Дима"), "Group member must appear");
  results.push("subscriptions, groups and unknown user selection");

  await page.locator("#wishlistViewBtn").click();
  await page.locator("#backToOwnListBtn").click();
  await page.waitForFunction(() => state.ownerId === 2002 && state.gifts.length === 0);
  assert(await page.evaluate(() => state.gifts.length === 0), "Own empty API response must be used");
  results.push("return to own wishlist");

  await page.locator("#shareListBtn").click();
  await page.locator("#shareModalBackdrop.open").waitFor();
  assert((await page.locator("#shareUrlPreview").textContent()).trim() === `${PROTO}t.me/wishlist_test_bot?start=list_2002`, "Default share URL must target full wishlist");
  await page.locator("#shareOccasionOptions [data-share-occ=\"occ_bday01\"]").click();
  assert((await page.locator("#shareUrlPreview").textContent()).trim() === `${PROTO}t.me/wishlist_test_bot?start=list_2002_occ_bday01`, "Occasion share URL must include occasion ID");
  await page.locator("#confirmShareBtn").click();
  await page.waitForFunction(() => {
    const value = window.__openedTelegramLink || "";
    return value.includes("t.me/share/url");
  });
  const shared = await page.evaluate(() => new URL(window.__openedTelegramLink).searchParams.get("url"));
  assert(shared === `${PROTO}t.me/wishlist_test_bot?start=list_2002_occ_bday01`, `Unexpected share URL: ${shared}`);
  results.push("flexible share modal with occasion deep link");

  failApi = true;
  await page.evaluate(() => fetchGifts());
  await page.waitForFunction(() => state.loadError.includes("Test outage") && !state.isLoading);
  assert((await page.locator("#giftsGrid").textContent()).includes("Test outage"), "API error state must be shown");
  assert(await page.evaluate(() => state.gifts.length === 0), "API outage must not load demo gifts");
  results.push("no demo fallback on API outage");

  assert(pageErrors.length === 0, `Uncaught browser errors: ${pageErrors.join(" | ")}`);
  results.push("no uncaught JavaScript errors");
  return { results, protectedImageRequests: imageAuthHeaders.length };
};
