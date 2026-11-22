export default async page => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const results = [];
  const pageErrors = [];
  const imageAuthHeaders = [];
  const copiedGiftPayloads = [];
  let startParam = 'list_1001_occ_bday01';
  let bookedBy = null;
  let reusableGivers = [];
  let failApi = false;
  const subscriptions = [];
  const groups = [
    { id: 'family', name: 'Семья', members: [] },
    { id: 'close', name: 'Близкие', members: [] },
    { id: 'friends', name: 'Друзья', members: [] },
    { id: 'colleagues', name: 'Коллеги', members: [] }
  ];
  const occasions = [
    { id: 'occ_bday01', title: 'День рождения' },
    { id: 'occ_ny2027', title: 'Новый год' }
  ];
  const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCpRRRX3xxn/9k=';
  page.on('pageerror', error => pageErrors.push(error.message));

  const giftsList = () => ([
    {
      id: 1731672009000,
      title: 'Подарок через боевой API',
      link: 'https://example.com/',
      image: '/api/img/0123456789abcdef',
      price: 5000,
      category: 'Техника',
      comment: '',
      priority: false,
      desire: 'medium',
      tags: [],
      group_ids: [],
      occasion_ids: ['occ_bday01'],
      is_crowdfund: false,
      is_reusable: false,
      booked_by: bookedBy === null ? null : bookedBy === 2002 ? 2002 : -1,
      participants: [],
      reusable_givers: [],
      is_gifted: false
    },
    {
      id: 1731672009050,
      title: 'Многоразовый сертификат',
      link: 'https://example.com/cert',
      image: '',
      price: 3000,
      category: 'Хобби',
      comment: '',
      priority: false,
      desire: 'medium',
      tags: [],
      group_ids: [],
      occasion_ids: ['occ_ny2027'],
      is_crowdfund: false,
      is_reusable: true,
      booked_by: null,
      participants: [],
      reusable_givers: reusableGivers.map(id => (id === 2002 ? 2002 : -1)),
      is_gifted: false
    }
  ]);
  const socialData = () => ({ subscriptions, groups });

  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.Telegram = { WebApp: {
      initData: 'test-signed-init-data',
      initDataUnsafe: { user: { id: 2002, first_name: 'Игорь', username: 'igor' }, start_param: ${JSON.stringify(startParam)} },
      colorScheme: 'dark',
      ready() { window.__tgReady = true; },
      expand() { window.__tgExpanded = true; },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      openTelegramLink(url) { window.__openedTelegramLink = url; },
      openLink() {}
    } };`
  }));
  await page.route(`${baseUrl}/**`, async route => {
    const response = await route.fetch();
    if (route.request().resourceType() !== 'document') return route.fulfill({ response });
    let body = await response.text();
    body = body.replace('const API_BASE_URL = "https://tgbot.ax1ksg94.workers.dev";', 'const API_BASE_URL = "https://worker.test";');
    return route.fulfill({ response, body });
  });
  await page.route('https://worker.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    const fulfillJson = (data, status = 200) => route.fulfill({
      status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data)
    });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/api/config') return fulfillJson({ botUsername: 'wishlist_test_bot' });

    const authorized = request.headers()['x-telegram-init-data'] === 'test-signed-init-data';
    if (url.pathname.startsWith('/api/img/')) {
      imageAuthHeaders.push(request.headers()['x-telegram-init-data'] || '');
      if (!authorized) return fulfillJson({ error: 'Missing test initData' }, 401);
      if (url.pathname.includes('badbadbad')) return fulfillJson({ error: 'Not found' }, 404);
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
        body: Buffer.from(jpeg, 'base64')
      });
    }
    if (!authorized) return fulfillJson({ error: 'Missing test initData' }, 401);

    if (url.pathname === '/api/participations') return fulfillJson({ items: [] });
    if (url.pathname === '/api/social') {
      if (request.method() === 'GET') return fulfillJson(socialData());
      const body = request.postDataJSON();
      const { action, payload } = body;
      if (action === 'subscribe' && payload.username === 'unknown1') {
        return fulfillJson({ status: 'selection_required', requestId: 771, botUsername: 'wishlist_test_bot' }, 202);
      }
      if (action === 'subscribe') {
        if (!subscriptions.some(profile => profile.id === 1001)) {
          subscriptions.push({ id: 1001, first_name: 'Максим', username: 'maxim' });
        }
      } else if (action === 'unsubscribe') {
        const index = subscriptions.findIndex(profile => profile.id === Number(payload.user_id));
        if (index >= 0) subscriptions.splice(index, 1);
      } else if (action === 'add_group_member') {
        const group = groups.find(item => item.id === payload.group_id);
        if (group && !group.members.some(member => member.id === 3003)) {
          group.members.push({ id: 3003, first_name: 'Дима', username: 'dima1' });
        }
      } else if (action === 'create_group') {
        groups.push({ id: 'grp_test0001', name: payload.name, members: [] });
      } else if (action === 'rename_group') {
        const group = groups.find(item => item.id === payload.group_id);
        if (group) group.name = payload.name;
      } else if (action === 'delete_group') {
        const idx = groups.findIndex(item => item.id === payload.group_id);
        if (idx >= 0) groups.splice(idx, 1);
      }
      return fulfillJson(socialData());
    }
    if (url.pathname === '/api/data' || url.pathname === '/api/gifts') {
      if (failApi) return fulfillJson({ error: 'Test outage' }, 500);
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.action === 'copy_gift') {
          copiedGiftPayloads.push(body);
          return fulfillJson({ ok: true, gift: { id: 999999, title: 'Подарок через боевой API' } }, 201);
        }
        if (body.owner_id !== 1001 || body.action !== 'toggle_book') {
          return fulfillJson({ error: 'Unexpected mutation' }, 400);
        }
        if (body.payload.id === 1731672009050) {
          reusableGivers = reusableGivers.includes(2002) ? [] : [2002];
        } else {
          bookedBy = bookedBy === null ? 2002 : null;
        }
      }
      const ownerId = Number(url.searchParams.get('owner_id') || 1001);
      if (ownerId === 2002) {
        return fulfillJson({
          owner: { id: 2002, first_name: 'Анна' },
          gifts: [],
          occasions,
          groups,
          is_subscribed: false
        });
      }
      return fulfillJson({
        owner: { id: 1001, first_name: 'Максим', username: 'maxim' },
        gifts: giftsList(),
        occasions,
        is_subscribed: subscriptions.some(profile => profile.id === 1001)
      });
    }
    return fulfillJson({ error: 'Not found' }, 404);
  });

  await page.goto(`${baseUrl}/`);
  await page.waitForFunction(() => state.isLoading === false);
  assert(await page.evaluate(() => isTelegramSession && state.viewerId === 2002 && state.ownerId === 1001), 'Telegram start_param must open shared list');
  assert(await page.locator('#occasionBanner').isVisible(), 'Occasion banner must be visible for deep link with occasion');
  assert((await page.locator('#occasionBannerTitle').textContent()).includes('День рождения'), 'Occasion title must be rendered');
  assert(await page.locator('#giftsGrid .gift-card').count() === 1, 'Occasion filter must show only matching gift');
  await page.locator('#showAllWishlistBtn').click();
  assert(await page.locator('#occasionBanner').isHidden(), 'Banner must hide after resetting occasion filter');
  assert(await page.locator('#giftsGrid .gift-card').count() === 2, 'All visible gifts must render after clearing occasion');
  results.push('occasion deep link banner and reset');

  assert(await page.locator('.demo-dock-wrapper').isHidden(), 'Demo dock must be hidden in Telegram');
  assert(await page.locator('#ownerAddSection').isHidden(), 'Guest cannot see owner form');
  assert((await page.locator('#headerTitle').textContent()).includes('Максим'), 'Real owner name must be rendered');
  assert((await page.locator('#headerSubtitle').textContent()).includes('@maxim'), 'Owner username must be rendered');
  assert((await page.locator('#roleBadge').textContent()).includes('Вы: Игорь'), 'Guest name must come from Telegram, not demo data');
  assert(await page.evaluate(() => window.__tgReady && window.__tgExpanded), 'Telegram SDK must be initialized');
  results.push('Telegram session, real owner profile, real guest name and start_param');

  await page.evaluate(() => {
    applyServerData({
      owner: { id: 1001, first_name: 'Пользователь', username: 'maxim' },
      gifts: state.gifts,
      occasions: state.occasions,
      is_subscribed: state.isSubscribed
    });
    renderAll();
  });
  assert((await page.locator('#headerTitle').textContent()).includes('@maxim'), 'Username must replace a generic owner name');
  await page.evaluate(() => fetchGifts());
  await page.waitForFunction(() => state.ownerName === 'Максим' && !state.isLoading);
  results.push('generic owner name falls back to Telegram username');

  await page.waitForFunction(() => document.querySelector('.card-media img')?.src.startsWith('blob:'));
  assert(await page.locator('.card-media img[data-internal-image]').count() === 0, 'Protected image must finish hydration');
  assert(await page.locator('img[src^="https://worker.test/api/img/"]').count() === 0, 'Protected image must never use unauthorized img src');
  assert(imageAuthHeaders.length > 0 && imageAuthHeaders.every(value => value === 'test-signed-init-data'), 'Every KV image fetch must include Telegram auth');
  results.push('authorized KV image and Blob URL');

  await page.evaluate(() => updatePhotoPreviewUI('edit', '/api/img/fedcba9876543210', 'Тест защищённого превью'));
  await page.waitForFunction(() => document.getElementById('editPhotoPreviewImg')?.src.startsWith('blob:'));
  assert(await page.locator('#editPhotoPreviewBox').evaluate(box => box.classList.contains('active')), 'Protected preview must be visible');
  results.push('authorized edit preview');

  await page.evaluate(() => {
    const current = state.gifts[0];
    state.gifts = [{ ...current, id: 1731672009100, title: 'Недоступное фото', image: '/api/img/badbadbadbadbad1' }];
    renderAll();
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('.card-media img');
    return img && !img.hasAttribute('data-internal-image') && getComputedStyle(img).display === 'none';
  });
  assert(await page.locator('.card-media .card-art-placeholder').isVisible(), 'Failed protected image must show placeholder');
  assert(await page.locator('img[src^="https://worker.test/api/img/"]').count() === 0, 'Failed image must not fall back to raw URL');
  await page.evaluate(() => fetchGifts());
  await page.waitForFunction(() => state.gifts[0]?.id === 1731672009000 && !state.isLoading);
  results.push('protected image failure placeholder');

  const firstCard = page.locator('#giftsGrid .gift-card', { hasText: 'Подарок через боевой API' });
  await firstCard.locator('.btn-guest-book').click();
  await page.waitForFunction(() => state.gifts[0]?.booked_by === 2002);
  assert(await page.evaluate(() => state.gifts[0]?.is_gifted === false), 'Booking must not mark the gift as gifted');
  const bookedCardText = await firstCard.textContent();
  assert(bookedCardText.includes('Вы забронировали'), 'Booking badge must explicitly describe a reservation');
  assert((await firstCard.locator('.card-actions-footer').textContent()).includes('Отменить бронь'), 'Guest must see the cancellation action');
  results.push('API booking remains a reservation, not a gifted status');

  // Reusable gift mark & cancel
  const reusableCard = page.locator('#giftsGrid .gift-card', { hasText: 'Многоразовый сертификат' });
  await reusableCard.locator('.btn-guest-book').click();
  await page.waitForFunction(() => state.gifts[1]?.reusable_givers?.includes(2002));
  assert((await reusableCard.textContent()).includes('Вы выбрали этот подарок'), 'Reusable badge must confirm guest selection');
  await reusableCard.locator('.btn-guest-unbook').click();
  await page.waitForFunction(() => (state.gifts[1]?.reusable_givers || []).length === 0);
  results.push('reusable gift selection and cancellation');

  // Copy gift to own wishlist
  await firstCard.locator('.btn-guest-copy').click();
  await page.waitForFunction(() => state.copiedGiftIds.has(1731672009000));
  assert(copiedGiftPayloads.length === 1 && copiedGiftPayloads[0].action === 'copy_gift', 'Copy button must send copy_gift action');
  assert((await firstCard.locator('.btn-guest-copy').textContent()).includes('В вашем списке'), 'Copy button must update state after copying');
  results.push('copy gift to own wishlist');

  await page.locator('#subscribeListBtn').click();
  await page.waitForFunction(() => state.isSubscribed && state.subscriptions.length === 1);
  await page.locator('#subscribeListBtn').click();
  await page.waitForFunction(() => !state.isSubscribed && state.subscriptions.length === 0);
  results.push('subscription button with production API');

  await page.locator('#friendsViewBtn').click();
  await page.locator('#subscribeUsernameInput').fill('@unknown1');
  await page.locator('#subscribeSubmitBtn').click();
  await page.locator('#selectionHelp').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => state.subscriptions.length === 0), 'Selection-required must not create early subscription');
  await page.locator('#openBotSelectionBtn').click();
  assert(await page.evaluate(() => window.__openedTelegramLink === 'https://t.me/wishlist_test_bot'), 'Selection help must open the bot');
  results.push('HTTP 202 selection flow and bot opening');

  await page.locator('#subscribeUsernameInput').fill('@maxim');
  await page.locator('#subscribeSubmitBtn').click();
  await page.waitForFunction(() => state.subscriptions.length === 1);
  assert((await page.locator('#subscriptionsList').textContent()).includes('@maxim'), 'Known username subscription must render');
  assert(await page.locator('#selectionHelp').isHidden(), 'Successful action must hide selection help');
  const friendsGroup = page.locator('#groupsList .access-group', { hasText: 'Друзья' });
  await friendsGroup.locator('input').fill('@dima1');
  await friendsGroup.getByRole('button', { name: 'Добавить' }).click();
  await page.waitForFunction(() => state.groups.find(g => g.id === 'friends').members.length === 1);
  results.push('known subscription and group mutation');

  await page.locator('#wishlistViewBtn').click();
  await page.evaluate(() => switchDemoRole('owner'));
  assert(await page.evaluate(() => state.viewerId === 2002 && state.ownerId === 1001), 'Demo role switch must be inert in Telegram');
  results.push('demo roles blocked');

  await page.locator('#backToOwnListBtn').click();
  await page.waitForFunction(() => state.ownerId === 2002 && state.isLoading === false);
  assert((await page.locator('#headerTitle').textContent()).includes('Мой вишлист'), 'Return must open own wishlist');
  assert(await page.locator('#ownerAddSection').isVisible(), 'Own wishlist must show owner form');
  assert(await page.evaluate(() => state.gifts.length === 0), 'Own empty API response must be used');
  results.push('return to own wishlist');

  // Share modal with full list & occasion link
  await page.locator('#shareListBtn').click();
  await page.locator('#shareModalBackdrop.open').waitFor();
  assert((await page.locator('#shareUrlPreview').textContent()).trim() === 'https://t.me/wishlist_test_bot?start=list_2002', 'Default share URL must target full wishlist');
  await page.locator('#shareOccasionOptions [data-share-occ="occ_bday01"]').click();
  assert((await page.locator('#shareUrlPreview').textContent()).trim() === 'https://t.me/wishlist_test_bot?start=list_2002_occ_bday01', 'Occasion share URL must include occasion ID');
  await page.locator('#confirmShareBtn').click();
  await page.waitForFunction(() => {
    const value = window.__openedTelegramLink || '';
    return value.includes('t.me/share/url');
  });
  const shared = await page.evaluate(() => new URL(window.__openedTelegramLink).searchParams.get('url'));
  assert(shared === 'https://t.me/wishlist_test_bot?start=list_2002_occ_bday01', `Unexpected share URL: ${shared}`);
  results.push('flexible share modal with occasion deep link');

  failApi = true;
  await page.evaluate(() => fetchGifts());
  await page.waitForFunction(() => state.isLoading === false && Boolean(state.loadError));
  assert(await page.evaluate(() => state.gifts.length === 0), 'Server failure must not load demo gifts');
  assert((await page.locator('#giftsGrid').textContent()).includes('Не удалось загрузить вишлист'), 'Error state must be visible');
  assert(await page.locator('.demo-dock-wrapper').isHidden(), 'Error state must remain production mode');
  results.push('no demo fallback on API failure');

  failApi = false;
  startParam = '';
  await page.goto(`${baseUrl}/?list=1001`);
  await page.waitForFunction(() => state.isLoading === false);
  assert(await page.evaluate(() => state.ownerId === 1001 && state.viewerId === 2002), 'Query ?list=1001 must open shared list');
  assert((await page.locator('#headerTitle').textContent()).includes('Максим'), 'Query deep link must render owner');
  results.push('query deep link');

  assert(pageErrors.length === 0, `Uncaught browser errors: ${pageErrors.join(' | ')}`);
  results.push('no uncaught JavaScript errors');
  return { results, protectedImageRequests: imageAuthHeaders.length };
};
