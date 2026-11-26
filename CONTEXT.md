# Current Context

- **Цель:** Развитие Telegram Mini App (`PonamaryovMV/tgbot`, ветка `main`) — вишлисты и модуль совместных расходов.
- **Репозиторий / ветка:** `PonamaryovMV/tgbot` (`main`)
- **Последнее изменение:** Все UI-эмодзи в модулях «Совместные расходы», «Вишлист», «Главное меню (Hub)» и Demo Studio заменены на единый векторный SVG-набор в стиле Lucide (`src/ui/icons.js`, `styles.css`, `index.html`, `src/ui/*`) с мягкими цветными бейджами и сохранением совместимости с `sanitizeEventIcon` в D1 и текстовыми строками Telegram-бота. В `tests/browser-runner.mjs` добавлен `/src/ui/icons.js` в `STATIC_FILES`.
- **Что работает и проверено:**
  - `npm run test:expenses` — 12/12 пройдено.
  - `npm run test:worker` — 20/20 групп тестов воркера + 12/12 тестов расходов пройдено.
  - `npm run test:browser` — все сценарии пройдены (`telegramReport`: 16 проверок, `demoReport`: 22 проверки, 0 JS-ошибок, вёрстка 320–1280px без переполнения).
- **Файлы в фокусе:** `index.html`, `styles.css`, `src/ui/icons.js`, `src/ui/main.js`, `src/ui/hub.js`, `src/ui/state.js`, `src/ui/wishlist-render.js`, `src/ui/wishlist-social.js`, `src/ui/expenses-state.js`, `src/ui/expenses-views.js`, `src/ui/expenses-modals.js`, `tests/browser-runner.mjs`.
- **Следующий шаг:** Проверить GitHub Actions / деплой в GitHub Pages и Cloudflare Workers.
