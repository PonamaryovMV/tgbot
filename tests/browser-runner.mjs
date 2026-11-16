import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import runTelegramScenario from "./browser-telegram.js";
import runDemoScenario from "./browser-demo.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const indexPath = fileURLToPath(new URL("../index.html", import.meta.url));

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (!["GET", "HEAD"].includes(request.method || "") || !["/", "/index.html"].includes(url.pathname)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const html = await readFile(indexPath);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : html);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Test server error");
    console.error(error);
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server did not start");
process.env.TEST_BASE_URL = `http://127.0.0.1:${address.port}`;

let browser;
let failed = false;
try {
  browser = await chromium.launch({ headless: true });
  const suites = [
    ["Telegram production mock", runTelegramScenario],
    ["Browser demo", runDemoScenario]
  ];
  let passed = 0;

  for (const [name, scenario] of suites) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const result = await scenario(page);
      for (const item of result.results) console.log(`PASS ${name}: ${item}`);
      passed += 1;
    } catch (error) {
      failed = true;
      console.error(`FAIL ${name}`);
      console.error(error);
    } finally {
      await context.close();
    }
  }

  console.log(`\n${passed}/${suites.length} browser suites passed.`);
  console.log(`Test server: ${process.env.TEST_BASE_URL}; project: ${projectRoot}`);
} catch (error) {
  failed = true;
  console.error(error);
  console.error("Если Chromium не установлен, выполните: npx playwright install chromium");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

if (failed) process.exitCode = 1;
