import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import runTelegramScenario from "./browser-telegram.js";
import runDemoScenario from "./browser-demo.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app-state.js", { file: "app-state.js", type: "application/javascript; charset=utf-8" }],
  ["/app-social.js", { file: "app-social.js", type: "application/javascript; charset=utf-8" }],
  ["/app-render.js", { file: "app-render.js", type: "application/javascript; charset=utf-8" }],
  ["/expenses-hub.js", { file: "expenses-hub.js", type: "application/javascript; charset=utf-8" }],
  ["/expenses-app.js", { file: "expenses-app.js", type: "application/javascript; charset=utf-8" }]
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const safePath = normalize(url.pathname).replaceAll("\\", "/");
    const entry = STATIC_FILES.get(safePath);
    if (!["GET", "HEAD"].includes(request.method || "") || !entry) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const filePath = fileURLToPath(new URL(`../${entry.file}`, import.meta.url));
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": entry.type,
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Test server error");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ headless: true });

try {
  const telegramContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const telegramPage = await telegramContext.newPage();
  const telegramSummary = await runTelegramScenario(telegramPage, baseUrl);
  await telegramContext.close();

  const demoContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const demoPage = await demoContext.newPage();
  const demoSummary = await runDemoScenario(demoPage, baseUrl);
  await demoContext.close();

  console.log(JSON.stringify({
    ok: true,
    projectRoot,
    telegram: telegramSummary,
    demo: demoSummary
  }, null, 2));
} finally {
  await browser.close();
  server.close();
}
