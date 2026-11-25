# Архитектура проекта

Telegram Mini App состоит из статического клиентского приложения (GitHub Pages), Cloudflare Worker и двух хранилищ:
- **Cloudflare KV (`env.DB`)** — профили вишлистов, желания, подписки, группы доступа, поводы, участия и бинарные изображения.
- **Cloudflare D1 (`env.EXPENSES_DB`, база `tg_expenses`)** — профиль и реквизиты СБП (`users`), события (`events`), участники (`event_members`), операции и доли (`expenses`, `expense_splits`), расчёты (`settlements`, `settlement_allocations`), цели (`event_goals`, `goal_contributions`) и аудит (`event_audit_log`).

## Карта файлов

```text
├── index.html                        # HTML-каркас супераппа, модальные окна и точка входа <script type="module" src="./src/ui/main.js">
├── styles.css                        # Темы (Dark/Light/Amethyst), Bento-сетки и стили компонентов
├── expenses-worker.js                # Тонкий роутер /api/core/*, /api/expenses/* и реэкспорты для тестов/worker.js
├── worker.js                         # Тонкий роутер API вишлистов, KV-изображений, webhook и реэкспорты
├── src/
│   ├── expenses/
│   │   ├── schema.js                 # SQL-схема D1, константы, ExpensesApiError, CORS и санитайзеры
│   │   ├── splits.js                 # Распределение минорных единиц, 5 режимов сплита, кошельки и граф долгов
│   │   ├── queries.js                # D1-запросы, контакты, сериализация событий, кросс-событийные долги и CSV-экспорт
│   │   ├── core-api.js               # Обработчики /api/core/* и клавиатура выбора модулей по /start
│   │   ├── events-api.js             # Маршруты событий, контакты/request_users, инвайты, участники, кошельки, цели и CSV
│   │   └── operations-api.js         # CRUD операций (/operations/*) и 2-шаговые СБП-расчёты (/settlements/*)
│   ├── wishlist/
│   │   ├── utils.js                  # Константы, ApiError, санитайзеры, HMAC verifyTelegramInitData и Telegram API
│   │   ├── storage.js                # KV CRUD (профили, подписки, группы, вишлисты) и загрузка/доступ к /api/img/*
│   │   ├── notifications.js          # Уведомления (/notifications), батч-рассылки, request_users и webhook
│   │   ├── gifts-api.js              # Приватность подарков, /api/participations, CRUD желаний/поводов и копирование
│   │   └── social-api.js             # Подписки и управление группами доступа (/api/social)
│   └── ui/
│       ├── state.js                  # Telegram WebApp SDK, deep links, state, API-клиент, KV-фото, Canvas-сжатие
│       ├── wishlist-social.js        # Группы доступа, подписки, поводы и модалка гибкого шаринга
│       ├── wishlist-render.js        # Формы желаний, теги, фильтры, карточки и раздел «Я участвую»
│       ├── hub.js                    # Главное меню супераппа (Hub), переключение модулей и профиль СБП
│       ├── expenses-state.js         # Состояние модуля расходов, демо-данные и расчёт графа долгов
│       ├── expenses-views.js         # Дашборд событий, карточка события, операции и SVG-граф переводов
│       ├── expenses-modals.js        # Модалки событий, участников/кошельков, операций и СБП-переводов
│       └── main.js                   # Инициализация DOMContentLoaded и привязка обработчиков к window
├── migrations/
│   ├── 0001_expenses_schema.sql      # Базовая SQL-схема модуля расходов в D1
│   └── 0002_expenses_stage3.sql      # Миграция split_meta_json для операций
├── wrangler.toml                     # Конфигурация Cloudflare Worker (KV + D1 + Secrets Store)
├── package.json                      # Скрипты запуска backend- и браузерных тестов
└── tests/
    ├── worker.test.mjs               # Unit-тесты вишлиста, групп, поводов, уведомлений и KV
    ├── expenses-stage1..5.test.mjs   # Unit-тесты модуля расходов по этапам 1–5
    ├── browser-runner.mjs            # Локальный HTTP-сервер статики и запуск Playwright-сценариев
    ├── browser-telegram.js           # E2E-сценарий Telegram-сессии и навигации супераппа
    └── browser-demo.js               # E2E-сценарий демо-режима, групп, поводов и адаптивности
```

## Потоки данных

1. **Авторизация и запуск:** клиент передаёт `X-Telegram-Init-Data`, воркер проверяет HMAC-SHA256 на каждом запросе; `/start` направляет в вишлист (`?module=wishlist`), расходы (`?module=expenses`), событие (`exp_<token>`) или вишлист (`list_<id>`).
2. **Вишлисты (KV):** состояние хранится в `user:<ownerId>`, проверка прав видимости выполняется на сервере для JSON-ответов и `/api/img/<imageId>`.
3. **Совместные расходы (D1):** суммы хранятся в минорных единицах (`*_minor`), участники с общим `linked_payer_member_id` объединяются в расчётные юниты для графа переводов, кросс-событийного зачёта и 2-шагового подтверждения СБП.
