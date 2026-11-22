# Архитектура проекта Telegram Wishlist Mini App и Супераппа расходов

Документ описывает модульную структуру репозитория, ответственность каждого файла и потоки данных между клиентом, Cloudflare Workers, Cloudflare KV и Cloudflare D1 (`tg_expenses`, `d3e17054-e5c6-4f3d-b6fb-eee6cae0cb63`).

---

## 1. Общая схема взаимодействия

```text
Telegram Mini App / Telegram Bot
              |
              v
    GitHub Pages (статический фронтенд)
    ├── index.html        (HTML-каркас, формы, модальные окна, конфиг API_BASE_URL)
    ├── styles.css        (дизайн-токены, темы Dark / Light / Amethyst, адаптивная сетка)
    ├── app-state.js      (SDK Telegram, роутинг deep links, API-клиент, KV-фото, копирование)
    ├── app-social.js     (кастомные группы приватности, подписки, поводы, гибкий шаринг)
    ├── app-render.js     (формы, переключатели, фильтрация и рендеринг карточек)
    └── expenses-hub.js   (хаб супераппа и профиль СБП для Этапа 1)
              |
              | HTTPS + X-Telegram-Init-Data
              v
    Cloudflare Workers
    ├── worker.js         (HMAC-SHA256 initData, вишлист, группы, поводы, webhook, уведомления)
    └── expenses-worker.js (маршрутизация /api/core/* и /api/expenses/*, работа с D1)
              |
              +---> Cloudflare KV (env.DB) — вишлисты, профили, группы, поводы, участия, подписки, фото
              +---> Cloudflare D1 (env.EXPENSES_DB, d3e17054-e5c6-4f3d-b6fb-eee6cae0cb63) — траты и расчёты
```

---

## 2. Назначение файлов репозитория

### Конфигурация и миграции D1
- `wrangler.toml` — привязка KV `DB` и базы D1 `EXPENSES_DB` (`tg_expenses`, `d3e17054-e5c6-4f3d-b6fb-eee6cae0cb63`).
- `migrations/0001_expenses_schema.sql` — SQL-миграция схемы D1 (`users`, `events`, `event_members`, `expenses`, `expense_splits`, `settlements`, `settlement_allocations`, `event_goals`, `goal_contributions`, `event_audit_log`).

### Фронтенд и воркеры
- `index.html`, `styles.css`, `app-state.js`, `app-social.js`, `app-render.js`, `expenses-hub.js` — интерфейс вишлистов и хаб супераппа с профилем СБП.
- `worker.js` и `expenses-worker.js` — логика вишлистов, проверка `initData` и эндпоинты `/api/core/*` и `/api/expenses/*`.

### Тестирование
- `tests/worker.test.mjs` — базовые тесты вишлиста и вебхука.
- `tests/expenses-stage1.test.mjs` — unit-тесты миграции D1 и эндпоинтов Этапа 1.
- `tests/browser-runner.mjs`, `tests/browser-telegram.js`, `tests/browser-demo.js` — браузерные сценарии Playwright.
