import { CORS_HEADERS, errorResponse, jsonResponse, matchesIfNoneMatch } from "./http";
import { toJstIsoString } from "./time";
import { parseCommunities } from "./communities";
import { InvalidCsvError } from "./sheet";
import { buildEvent, buildTimetable } from "./timetable";
import type { Env, LastGood } from "./types";
import { fetchSheetCsvs } from "./upstream";

const LAST_GOOD_KEY = "timetable";
const FRESH_CACHE_CONTROL = "public, max-age=30, s-maxage=60";
const STALE_CACHE_CONTROL = "public, max-age=0, s-maxage=10";
const PREFLIGHT_MAX_AGE_SECONDS = 86400;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const TIMETABLE_PATH = /^\/v1\/events\/([^/]+)\/timetable$/;

type Payload = { body: string; version: string; stale: boolean };

async function loadFresh(env: Env): Promise<Payload> {
  const csvs = await fetchSheetCsvs(env);
  const ledger = parseCommunities(csvs.communities);
  const timetable = await buildTimetable(
    csvs.timetable,
    buildEvent(env),
    toJstIsoString(new Date()),
    ledger,
  );
  return { body: JSON.stringify(timetable), version: timetable.version, stale: false };
}

async function loadLastGood(env: Env): Promise<Payload | null> {
  // 上流が落ちている最中に呼ばれるため、KV 自体の失敗も 502 に落として握らない
  try {
    const stored = await env.LAST_GOOD.get<LastGood>(LAST_GOOD_KEY, "json");
    if (!stored) return null;
    return { body: stored.body, version: stored.version, stale: true };
  } catch (error) {
    console.error("kv_get_failed", error);
    return null;
  }
}

function saveLastGood(env: Env, payload: Payload): Promise<void> {
  const record: LastGood = {
    body: payload.body,
    version: payload.version,
    fetchedAt: toJstIsoString(new Date()),
  };
  return env.LAST_GOOD.put(LAST_GOOD_KEY, JSON.stringify(record)).catch((error: unknown) => {
    console.error("kv_put_failed", error);
  });
}

async function handleTimetable(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let payload: Payload | null;
  try {
    payload = await loadFresh(env);
    ctx.waitUntil(saveLastGood(env, payload));
  } catch (error) {
    if (error instanceof InvalidCsvError) console.warn("invalid_csv", error.message);
    else console.error("upstream_failed", error);
    payload = await loadLastGood(env);
  }

  if (!payload) return errorResponse("upstream_unavailable", 502);

  const etag = `"${payload.version}"`;
  const headers: Record<string, string> = {
    "Cache-Control": payload.stale ? STALE_CACHE_CONTROL : FRESH_CACHE_CONTROL,
    ETag: etag,
  };
  if (payload.stale) headers["X-Timetable-Stale"] = "true";

  if (matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
    return jsonResponse("", 304, headers);
  }
  return jsonResponse(payload.body, 200, headers);
}

/** `%` 単体のような不正なパーセントエンコードでも例外にしない。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) return errorResponse("method_not_allowed", 405);

  const { pathname } = new URL(request.url);

  if (pathname === "/healthz") {
    return jsonResponse(JSON.stringify({ ok: true }), 200);
  }

  const eventId = TIMETABLE_PATH.exec(pathname)?.[1];
  if (eventId === undefined) return errorResponse("not_found", 404);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS) },
    });
  }

  if (safeDecode(eventId) !== env.EVENT_ID) {
    return errorResponse("event_not_found", 404);
  }

  return handleTimetable(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // どのエラーでも JSON と CORS ヘッダーを保つ（内部の詳細は返さない）
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error("unhandled_error", error);
      return errorResponse("internal_error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
