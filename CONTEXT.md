# Current Context

- **Цель:** Развитие Telegram Mini App (`PonamaryovMV/tgbot`, ветка `main`) — вишлисты и модуль совместных расходов.
- **Репозиторий / ветка:** `PonamaryovMV/tgbot` (`main`)
- **Последнее изменение:** В модуле «Совместные расходы» полностью убраны незарегистрированные участники (`ghost`) и `Claim Profile`; добавлены выбор/добавление реальных пользователей Telegram (по `@username`, из контактов/подписок или через бота `request_users` с сохранением в D1 `users` и KV `exp_contacts`), модалка редактирования события и исправления модульного импорта в `src/ui/main.js`.
- **Что работает и проверено:**
  - `node --test tests/expenses-stage1.test.mjs tests/expenses-stage2.test.mjs tests/expenses-stage3.test.mjs tests/expenses-stage4.test.mjs tests/expenses-stage5.test.mjs` — 12/12 пройдено.
  - `npm run test:browser` — все сценарии пройдены (`telegramReport`: 16 проверок, `demoReport`: 22 проверки, без ошибок JS).
  - `npm run test:worker` — 11/12 пройдено (1 предсуществующее падение в `tests/worker.test.mjs:913` по тексту ошибки `BOT_TOKEN`).
- **Файлы в фокусе:** `index.html`, `expenses-worker.js`, `worker.js`, `src/expenses/events-api.js`, `src/expenses/queries.js`, `src/wishlist/notifications.js`, `src/wishlist/storage.js`, `src/ui/expenses-state.js`, `src/ui/expenses-modals.js`, `src/ui/main.js`.
- **Следующий шаг:** Проверить GitHub Actions / деплой в GitHub Pages и Cloudflare Workers.
