export default async page => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const results = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
  await page.route('https://images.unsplash.com/**', route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  }));
  await page.goto(`${baseUrl}/?demo=1`);
  await page.waitForFunction(() => state.isLoading === false, { timeout: 10000 });
  assert(await page.evaluate(() => state.gifts.length === 8), 'Initial demo must contain 8 gifts');
  assert(await page.locator('#giftsGrid .gift-card').count() === 6, 'Active tab must render 6 gifts');
  results.push('initial render');

  await page.evaluate(() => {
    window.__demoOpenedUrls = [];
    window.open = url => { window.__demoOpenedUrls.push(String(url)); };
  });
  await page.locator('#shareListBtn').click();
  await page.locator('.toast-item', { hasText: 'Это демо-вишлист' }).waitFor();
  await page.evaluate(() => openBotForSelection());
  await page.locator('.toast-item', { hasText: 'Выбор реального пользователя' }).waitFor();
  assert(await page.evaluate(() => state.botUsername === '' && window.__demoOpenedUrls.length === 0), 'Demo must not create or open fake bot links');
  results.push('demo share and user selection never create fake bot links');

  await page.locator('#addTitleInput').fill('Подарок из браузерного теста');
  await page.locator('#addGiftForm button[type="submit"]').first().click();
  await page.waitForFunction(() => state.gifts.some(g => g.title === 'Подарок из браузерного теста'));
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)).some(g => g.title === 'Подарок из браузерного теста')), 'Added gift must persist locally');
  const addedCard = page.locator('#giftsGrid .gift-card', { hasText: 'Подарок из браузерного теста' });
  await addedCard.locator('.btn-owner-edit').click();
  await page.locator('#editModalBackdrop.open').waitFor();
  await page.locator('#editTitleInput').fill('Обновлённый подарок из теста');
  await page.locator('#editGiftForm button[type="submit"]').click();
  await page.waitForFunction(() => state.gifts.some(g => g.title === 'Обновлённый подарок из теста'));
  const updatedCard = page.locator('#giftsGrid .gift-card', { hasText: 'Обновлённый подарок из теста' });
  await updatedCard.locator('.btn-owner-delete').click();
  await page.locator('#deleteConfirmBackdrop.open').waitFor();
  await page.locator('#confirmDeleteBtn').click();
  await page.waitForFunction(() => !state.gifts.some(g => g.title === 'Обновлённый подарок из теста'));
  results.push('legacy add, edit and delete');

  await page.locator('[data-role="guest1"]').click();
  await page.locator('.btn-guest-book').first().click();
  await page.waitForFunction(() => state.gifts.some(g => g.booked_by === 2002));
  const bookedTitle = await page.evaluate(() => state.gifts.find(g => g.booked_by === 2002).title);
  assert(await page.evaluate(title => state.gifts.find(g => g.title === title).is_gifted === false, bookedTitle), 'Booking must not mark the gift as gifted');
  const guestBookedCardText = await page.locator('#giftsGrid .gift-card', { hasText: bookedTitle }).textContent();
  assert(guestBookedCardText.includes('Вы забронировали'), 'Guest booking badge must be explicit');
  assert(!guestBookedCardText.includes('Подарено') && !guestBookedCardText.includes('уже вручён'), 'Guest booking must not look gifted');
  await page.locator('.btn-guest-crowdfund').first().click();
  await page.waitForFunction(() => state.gifts.some(g => g.is_crowdfund && g.participants.includes(2002)));
  await page.locator('#backToOwnListBtn').click();
  assert(await page.evaluate(() => state.ownerId === 1001 && state.viewerId === 1001), 'Return must restore owner role');
  const ownerBookedCard = page.locator('#giftsGrid .gift-card', { hasText: bookedTitle });
  const ownerBookedCardText = await ownerBookedCard.textContent();
  assert(ownerBookedCardText.includes('Забронировано'), 'Owner must see a reservation status');
  assert(ownerBookedCardText.includes('Отметить вручение'), 'Gifted action must be clearly separated from reservation status');
  assert(!ownerBookedCardText.includes('Подарено'), 'Owner card must not show a gifted status after booking');
  assert(await page.evaluate(title => state.gifts.find(g => g.title === title).is_gifted === false, bookedTitle), 'Owner booking view must keep is_gifted false');
  results.push('legacy booking and crowdfund');
  results.push('booking and actual gift delivery stay separate for guest and owner');

  await page.locator('#friendsViewBtn').click();
  await page.locator('#friendsWorkspace').waitFor({ state: 'visible' });
  await page.locator('#subscribeUsernameInput').fill('@anna1');
  await page.locator('#subscribeSubmitBtn').click();
  await page.waitForFunction(() => state.subscriptions.some(profile => profile.id === 2002));
  assert(await page.locator('#subscriptionsList').textContent().then(text => text.includes('@anna1')), 'Subscription must render username');
  results.push('subscribe by username');

  await page.locator('#subscribeUsernameInput').fill('@unknown1');
  await page.locator('#subscribeSubmitBtn').click();
  await page.locator('.toast-item', { hasText: 'В демо доступны' }).waitFor();
  assert(await page.evaluate(() => state.subscriptions.filter(profile => profile.id === 2002).length === 1), 'Unknown username must not create subscription');
  results.push('unknown demo username rejected');

  const annaSubscription = page.locator('#subscriptionsList .social-person-row', { hasText: '@anna1' });
  await annaSubscription.getByRole('button', { name: 'Открыть' }).click();
  await page.waitForFunction(() => state.ownerId === 2002 && !state.isLoading);
  assert((await page.locator('#headerTitle').textContent()).includes('Анна'), 'Subscription must open the selected person');
  await page.locator('#backToOwnListBtn').click();
  assert(await page.evaluate(() => state.ownerId === 1001 && !new URL(location.href).searchParams.has('list')), 'Return must clear shared-list URL');
  results.push('open subscription and return');

  await page.locator('#friendsViewBtn').click();
  const annaRowAgain = page.locator('#subscriptionsList .social-person-row', { hasText: '@anna1' });
  await annaRowAgain.getByRole('button', { name: 'Отписаться' }).click();
  await page.waitForFunction(() => !state.subscriptions.some(profile => profile.id === 2002));
  results.push('unsubscribe');

  const familyGroup = page.locator('#groupsList .access-group', { hasText: 'Семья' });
  await familyGroup.locator('input').fill('@dima1');
  await familyGroup.getByRole('button', { name: 'Добавить' }).click();
  await page.waitForFunction(() => state.groups.find(g => g.id === 'family').memberIds.includes(3003));
  await familyGroup.getByRole('button', { name: 'Удалить' }).click();
  await page.waitForFunction(() => !state.groups.find(g => g.id === 'family').memberIds.includes(3003));
  results.push('group add and remove');

  await page.locator('#wishlistViewBtn').click();
  await page.locator('[data-role="guest1"]').click();
  await page.locator('#subscribeListBtn').click();
  await page.waitForFunction(() => state.isSubscribed && state.subscriptions.some(profile => profile.id === 1001));
  await page.locator('#subscribeListBtn').click();
  await page.waitForFunction(() => !state.isSubscribed && !state.subscriptions.some(profile => profile.id === 1001));
  await page.locator('#backToOwnListBtn').click();
  results.push('subscription button inside guest wishlist');

  await page.locator('#addTitleInput').fill('Общее желание — тест');
  await page.locator('#addGiftForm button[type="submit"]').first().click();
  await page.waitForFunction(() => state.gifts.some(g => g.title === 'Общее желание — тест'));
  assert(await page.evaluate(() => state.gifts.find(g => g.title === 'Общее желание — тест').group_ids.length === 0), 'Default audience must be public');

  await page.locator('#addTitleInput').fill('Только для девушки — тест');
  if (!await page.locator('#addDetailsPanel').evaluate(panel => panel.classList.contains('open'))) {
    await page.locator('#toggleDetailsBtn').click();
  }
  await page.locator('#addAudienceControl [data-group="girlfriend"]').click();
  await page.locator('#addGiftForm button[type="submit"]').first().click();
  await page.waitForFunction(() => state.gifts.some(g => g.title === 'Только для девушки — тест'));
  const restrictedId = await page.evaluate(() => state.gifts.find(g => g.title === 'Только для девушки — тест').id);
  assert(await page.evaluate(() => state.groupDraft.add.length === 0), 'Audience draft must reset after add');
  results.push('public and restricted gifts');

  await page.locator('[data-role="guest1"]').click();
  const restrictedForAnna = page.locator('#giftsGrid .gift-card', { hasText: 'Только для девушки — тест' });
  assert(await restrictedForAnna.count() === 1, 'Girlfriend must see restricted gift');
  await restrictedForAnna.locator('.btn-guest-book').click();
  await page.waitForFunction(id => state.gifts.find(g => g.id === id)?.booked_by === 2002, restrictedId);
  await page.locator('#participationsViewBtn').click();
  await page.waitForFunction(() => state.participations.some(item => item.gift.id === state.gifts.find(g => g.title === 'Только для девушки — тест')?.id));
  assert((await page.locator('#participationsGrid').textContent()).includes('Только для девушки — тест'), 'Visible booking must appear in participations');
  results.push('girlfriend visibility, booking and participation');

  await page.locator('#wishlistViewBtn').click();
  await page.locator('[data-role="guest2"]').click();
  assert(await page.locator('#giftsGrid .gift-card', { hasText: 'Только для девушки — тест' }).count() === 0, 'Other guest must not see restricted gift');
  const hiddenMutationResult = await page.evaluate(id => mutateGifts('toggle_book', { id }), restrictedId);
  assert(hiddenMutationResult === false, 'Hidden gift mutation must be rejected in demo');
  assert(await page.evaluate(id => state.gifts.find(g => g.id === id).booked_by !== 3003, restrictedId), 'Hidden gift must not be booked by other guest');
  results.push('restricted gift hidden and mutation blocked');

  await page.locator('[data-role="owner"]').click();
  const ownerRestricted = page.locator('#giftsGrid .gift-card', { hasText: 'Только для девушки — тест' });
  await ownerRestricted.locator('.btn-owner-edit').click();
  await page.locator('#editAudienceControl [data-group="friends"]').click();
  await page.locator('#editGiftForm button[type="submit"]').click();
  await page.waitForFunction(id => {
    const ids = state.gifts.find(g => g.id === id)?.group_ids || [];
    return ids.includes('girlfriend') && ids.includes('friends');
  }, restrictedId);
  const restrictedAfterMulti = page.locator('#giftsGrid .gift-card', { hasText: 'Только для девушки — тест' });
  await restrictedAfterMulti.locator('.btn-owner-edit').click();
  await page.locator('#editAudienceControl [data-group="friends"]').click();
  await page.locator('#editGiftForm button[type="submit"]').click();
  await page.waitForFunction(id => (state.gifts.find(g => g.id === id)?.group_ids || []).join(',') === 'girlfriend', restrictedId);
  results.push('edit and multi-group audience');

  const publicCard = page.locator('#giftsGrid .gift-card', { hasText: 'Общее желание — тест' });
  await publicCard.locator('.btn-owner-edit').click();
  await page.locator('#editAudienceControl [data-group="family"]').click();
  await page.locator('#editAudienceControl [data-group="friends"]').click();
  await page.locator('#editGiftForm button[type="submit"]').click();
  await page.waitForFunction(() => (state.gifts.find(g => g.title === 'Общее желание — тест')?.group_ids || []).length === 2);
  const publicAgain = page.locator('#giftsGrid .gift-card', { hasText: 'Общее желание — тест' });
  await publicAgain.locator('.btn-owner-edit').click();
  await page.locator('#editAudienceControl [data-group="all"]').click();
  await page.locator('#editGiftForm button[type="submit"]').click();
  await page.waitForFunction(() => (state.gifts.find(g => g.title === 'Общее желание — тест')?.group_ids || []).length === 0);
  results.push('all-audience reset');

  await page.locator('#friendsViewBtn').click();
  const girlfriendGroup = page.locator('#groupsList .access-group', { hasText: 'Девушка' });
  await girlfriendGroup.getByRole('button', { name: 'Удалить' }).click();
  await page.waitForFunction(id => state.gifts.find(g => g.id === id)?.booked_by === null, restrictedId);
  assert(await page.evaluate(() => !state.groups.find(g => g.id === 'girlfriend').memberIds.includes(2002)), 'Anna must be removed from girlfriend group');
  results.push('group removal cancels inaccessible booking');

  await page.locator('#wishlistViewBtn').click();
  await page.locator('[data-role="guest1"]').click();
  assert(await page.locator('#giftsGrid .gift-card', { hasText: 'Только для девушки — тест' }).count() === 0, 'Removed member must lose gift visibility');
  await page.locator('#participationsViewBtn').click();
  await page.waitForFunction(() => !state.participationsLoading);
  assert(await page.evaluate(() => !state.participations.some(item => item.gift.title === 'Только для девушки — тест')), 'Removed member must lose stale participation');
  await page.locator('#wishlistViewBtn').click();
  await page.locator('[data-role="owner"]').click();
  results.push('visibility and participation cleanup after removal');

  await page.locator('#friendsViewBtn').click();
  const dimensions = [];
  for (const width of [320, 375, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const size = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      navRight: document.querySelector('.workspace-nav').getBoundingClientRect().right,
      friendsVisible: !document.getElementById('friendsWorkspace').hidden
    }));
    assert(size.document <= size.viewport + 1 && size.body <= size.viewport + 1, `Horizontal overflow at ${width}: ${JSON.stringify(size)}`);
    assert(size.navRight <= size.viewport + 1 && size.friendsVisible, `Navigation or friends layout failed at ${width}`);
    dimensions.push({ width, ...size });
  }
  await page.evaluate(() => { document.getElementById('toastContainer').innerHTML = ''; window.scrollTo(0, 0); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 1280, height: 900 });
  results.push('responsive friends and navigation layouts');

  await page.route('https://t.me/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Telegram redirect test</title>'
  }));
  await page.goto(`${baseUrl}/?list=987654321`);
  await page.waitForURL('https://t.me/testpmvbot_bot?start=list_987654321');
  assert(!(await page.locator('body').textContent()).includes('Анна'), 'Shared browser link must never render demo guest Anna');
  await page.goto(`${baseUrl}/`);
  await page.waitForURL('https://t.me/testpmvbot_bot');
  results.push('ordinary browser and shared links open the real bot, not demo identities');

  assert(pageErrors.length === 0, `Uncaught browser errors: ${pageErrors.join(' | ')}`);
  results.push('no uncaught JavaScript errors');
  return { results, dimensions };
}
