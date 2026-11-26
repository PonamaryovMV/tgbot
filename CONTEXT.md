# Current Context

- **Цель:** Развитие Telegram Mini App (`PonamaryovMV/tgbot`, ветка `main`) — вишлисты и модуль совместных расходов.
- **Репозиторий / ветка:** `PonamaryovMV/tgbot` (`main`)
- **Последнее изменение:** Добавлено необязательное поле «Дата события» (`event_date`, календарь `<input type="date">` с кнопкой очистки) в модалки создания и редактирования события совместных расходов ([index.html](file:///c:/Users/ponam/tgbot/index.html), [src/ui/expenses-modals.js](file:///c:/Users/ponam/tgbot/src/ui/expenses-modals.js), [src/ui/expenses-views.js](file:///c:/Users/ponam/tgbot/src/ui/expenses-views.js)) и на бэкенд D1 ([migrations/0003_events_date.sql](file:///c:/Users/ponam/tgbot/migrations/0003_events_date.sql), [src/expenses/schema.js](file:///c:/Users/ponam/tgbot/src/expenses/schema.js), [src/expenses/queries.js](file:///c:/Users/ponam/tgbot/src/expenses/queries.js), [src/expenses/events-api.js](file:///c:/Users/ponam/tgbot/src/expenses/events-api.js)) с ленивым `ALTER TABLE` фолбэком для существующих БД.
- **Что работает и проверено:**
  - `npm run test:worker` — 20/20 групп тестов воркера + 12/12 тестов расходов пройдено.
  - `npm run test:browser` — все сценарии пройдены (`telegramReport`: 16 проверок, `demoReport`: 22 проверки, 0 JS-ошибок, вёрстка 320–1280px без переполнения).
- **Файлы в фокусе:** `migrations/0003_events_date.sql`, `src/expenses/schema.js`, `src/expenses/queries.js`, `src/expenses/events-api.js`, `index.html`, `styles.css`, `src/ui/expenses-modals.js`, `src/ui/expenses-views.js`, `src/ui/main.js`, `tests/expenses-stage2.test.mjs`, `tests/browser-telegram.js`.
- **Следующий шаг:** Проверить GitHub Actions / деплой в GitHub Pages и Cloudflare Workers.
