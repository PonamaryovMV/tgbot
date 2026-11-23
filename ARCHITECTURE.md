# Архитектура проекта

Telegram Mini App состоит из статического клиентского приложения (GitHub Pages), Cloudflare Worker и двух хранилищ:
- **Cloudflare KV (`env.DB`)** — хранит профили вишлистов, желания, подписки, кастомные группы доступа, подборки по поводам, участия и бинарные изображения.
- **Cloudflare D1 (`env.EXPENSES_DB`, база `tg_expenses`)** — хранит глобальный профиль и реквизиты СБП (`users`), события (`events`), участников и виртуальные профили (`event_members`), операции и доли (`expenses`, `expense_splits`), погашения по СБП (`settlements`, `settlement_allocations`), целевые сборы (`event_goals`, `goal_contributions`) и аудит (`event_audit_log`).

## Карта файлов

```text
├── index.html                        # HTML-каркас супераппа, модальные окна и конфиг API_BASE_URL
├── styles.css                        # Стили, темы (Dark/Light/Amethyst), Bento-сетки и SVG-граф расчётов
├── app-state.js                      # Инициализация Telegram WebApp, deep links, API-запросы, загрузка/кеш KV-изображений
├── app-social.js                     # Кастомные группы приватности, подписки, подборки по поводам и гибкий шаринг
├── app-render.js                     # Отрисовка карточек подарков, фильтров и обработчики форм вишлиста
├── expenses-hub.js                   # Главное меню супераппа (Hub), маршрутизация модулей и профиль СБП
├── expenses-app.js                   # Модуль «Совместные расходы»: события, участники/веса, Единый кошелёк, Claim Profile, 5 режимов сплита, SVG-граф, погашение СБП, целевые сборы и CSV-экспорт
├── expenses-worker.js                # Точка входа Cloudflare Worker: API /api/core/* и /api/expenses/* (D1), /start выбор раздела и делегирование в worker.js
├── worker.js                         # Backend вишлиста и Telegram-бота: проверка initData, права доступа, KV-операции, уведомления
├── migrations/0001_expenses_schema.sql # Базовая SQL-схема 9+ таблиц модуля расходов в D1
├── migrations/0002_expenses_stage3.sql # Миграция Этапа 3 (split_meta_json для редактирования операций)
├── wrangler.toml                     # Конфигурация Cloudflare Worker (main = "expenses-worker.js", KV + D1 bindings)
├── package.json                      # Скрипты запуска backend- и браузерных тестов
└── tests/
    ├── worker.test.mjs               # Unit-тесты вишлиста, групп, поводов, уведомлений и изоляции KV
    ├── expenses-stage1.test.mjs      # Unit-тесты схемы D1, профиля СБП и клавиатуры /start
    ├── expenses-stage2.test.mjs      # Unit-тесты событий, Ghost Profiles, весов, Единого кошелька и Claim Profile
    ├── expenses-stage3.test.mjs      # Unit-тесты операций, 5 режимов сплита, мультивалютности и заморозки трат
    ├── expenses-stage4.test.mjs      # Unit-тесты Simplify Debts, кросс-событийных долгов и 2-шагового погашения по СБП
    ├── expenses-stage5.test.mjs      # Unit-тесты целевых сборов и экспорта ведомости в CSV
    ├── browser-runner.mjs            # Локальный HTTP-сервер и запуск Playwright-тестов
    ├── browser-telegram.js           # E2E-проверка Telegram-сессии, шаринга и навигации супераппа
    └── browser-demo.js               # E2E-проверка демо-режима, групп, тегов, поводов и адаптивности
```

## Потоки данных

1. **Авторизация и запуск:** клиент читает `window.Telegram.WebApp.initData`, передаёт его в заголовке `X-Telegram-Init-Data`, а `expenses-worker.js` / `worker.js` проверяют подпись HMAC-SHA256 на каждом запросе. При команде `/start` бот показывает выбор между вишлистами (`?module=wishlist`), расходами (`?module=expenses`) и главным меню супераппа, либо открывает конкретное событие (`exp_<token>`) или вишлист (`list_<id>`).
2. **Вишлисты (KV):** состояние хранится в ключе `user:<ownerId>` (`owner`, `occasions`, `gifts`), приватность проверяется на сервере до выдачи JSON и при обращении к `/api/img/<imageId>`.
3. **Совместные расходы (D1):** все денежные суммы хранятся в целых минорных единицах (`*_minor`). Расчётные юниты группируют участников с общим `linked_payer_member_id` («Единый кошелёк»), поверх которых движок строит граф упрощённых (`Simplify Debts`) или прямых переводов, агрегирует кросс-событийные балансы и проводит 2-шаговое подтверждение переводов по СБП.
