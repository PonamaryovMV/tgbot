import baseWorker, {
  json,
  verifyTelegramInitData
} from "./worker.js";
import {
  EXPENSE_SCHEMA_SQL,
  ExpensesApiError,
  getExpensesDb,
  getExpensesErrorResponse,
  getExpensesCorsHeaders,
  withExpensesCors
} from "./src/expenses/schema.js";
import {
  distributeExactMinor,
  computeOperationSplits,
  buildSettlementUnits,
  computeEventSettlementPlan
} from "./src/expenses/splits.js";
import {
  ensureUserProfile,
  buildEventCsvExport
} from "./src/expenses/queries.js";
import {
  handleCoreApi,
  buildSuperappStartKeyboard,
  tryHandleSuperappStartCommand
} from "./src/expenses/core-api.js";
import { handleEventsRoute } from "./src/expenses/events-api.js";
import { handleOperationsRoute } from "./src/expenses/operations-api.js";

async function dispatchExpensesApi(request, env, viewer, url) {
  const db = getExpensesDb(env);
  const path = url.pathname;
  const method = request.method;
  const user = await ensureUserProfile(db, viewer);

  const eventRes = await handleEventsRoute(request, db, user, path, method);
  if (eventRes) return eventRes;

  const opRes = await handleOperationsRoute(request, db, user, path, method);
  if (opRes) return opRes;

  throw new ExpensesApiError(404, "Not found");
}

export async function handleExpensesApi(request, env, viewer, url) {
  try {
    return await dispatchExpensesApi(request, env, viewer, url);
  } catch (error) {
    const mapped = getExpensesErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

export * from "./worker.js";

export {
  EXPENSE_SCHEMA_SQL,
  handleCoreApi,
  getExpensesErrorResponse,
  distributeExactMinor,
  computeOperationSplits,
  buildSettlementUnits,
  computeEventSettlementPlan,
  buildEventCsvExport,
  buildSuperappStartKeyboard
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/core/") || url.pathname.startsWith("/api/expenses/")) {
      const cors = getExpensesCorsHeaders(request);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      try {
        const viewer = await verifyTelegramInitData(
          request.headers.get("X-Telegram-Init-Data") || "",
          env?.BOT_TOKEN || ""
        );
        const response = url.pathname.startsWith("/api/core/")
          ? await handleCoreApi(request, env, viewer, url)
          : await handleExpensesApi(request, env, viewer, url);
        return withExpensesCors(response, cors);
      } catch (error) {
        const mapped = getExpensesErrorResponse(error);
        if (mapped) return withExpensesCors(mapped, cors);
        const status = Number.isInteger(error?.status) ? error.status : 500;
        return json({ error: error?.message || "Internal server error" }, status, cors);
      }
    }

    const startResponse = await tryHandleSuperappStartCommand(request, env);
    if (startResponse) return startResponse;

    return await baseWorker.fetch(request, env, ctx);
  }
};
