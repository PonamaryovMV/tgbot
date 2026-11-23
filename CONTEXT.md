# Current Context

- **Цель:** Поэтапный модульный рефакторинг репозитория `PonamaryovMV/tgbot` на модули по 200–450 строк без изменения логики и контрактов.
- **Репозиторий / ветка:** `PonamaryovMV/tgbot` (`main`)
- **Последний коммит:** `a1f4b0c` — разбиение фронтенда на `src/ui/*`, подключение в `index.html`, обновление `ARCHITECTURE.md` и `tests/browser-runner.mjs`.
- **Что работает:** Модули бэкенда в `src/expenses/` и `src/wishlist/` с сохранением экспортов в `expenses-worker.js` и `worker.js`; ES-модули UI в `src/ui/` подключены через `./src/ui/main.js`.
- **Текущий статус / проверка:** Код запушен в `main` через MCP; локальный запуск `node --test` и Playwright требует запуска в среде с Node.js >= 20 и установленным Chromium.
- **Файлы в фокусе:** `expenses-worker.js`, `worker.js`, `index.html`, `src/expenses/*`, `src/wishlist/*`, `src/ui/*`, `ARCHITECTURE.md`.
- **Следующий шаг:** Выполнить `node --test tests/*.test.mjs` и `npm run test:browser` в рабочей среде для проверки всех сценариев после рефакторинга.
