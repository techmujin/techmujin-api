import { buildBooths } from "./booths";
import { CORS_HEADERS, errorResponse, jsonResponse, matchesIfNoneMatch } from "./http";
import { toJstIsoString } from "./time";
import { parseCommunities } from "./communities";
import { InvalidCsvError } from "./sheet";
import { buildEvent, buildTimetable } from "./timetable";
import type { Env, LastGood } from "./types";
import { fetchCommunitiesCsv, fetchSheetCsvs } from "./upstream";

const FRESH_CACHE_CONTROL = "public, max-age=30, s-maxage=60";
const STALE_CACHE_CONTROL = "public, max-age=0, s-maxage=10";
const PREFLIGHT_MAX_AGE_SECONDS = 86400;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const RESOURCE_PATH = /^\/v1\/events\/([^/]+)\/(timetable|booths)$/;

type Payload = { body: string; version: string; stale: boolean };

/**
 * イベント配下の1リソース。取得・保存・フォールバックの流れは共通で、
 * 組み立て方と KV のキー、stale を知らせるヘッダー名だけが違う。
 */
type Resource = {
  /** KV `LAST_GOOD` のキー。リソースごとに1件だけ保持する */
  lastGoodKey: string;
  staleHeader: string;
  build: (env: Env) => Promise<{ version: string }>;
};

const RESOURCES: Record<string, Resource> = {
  timetable: {
    lastGoodKey: "timetable",
    staleHeader: "X-Timetable-Stale",
    async build(env) {
      const csvs = await fetchSheetCsvs(env);
      return buildTimetable(
        csvs.timetable,
        buildEvent(env),
        toJstIsoString(new Date()),
        parseCommunities(csvs.communities),
      );
    },
  },
  booths: {
    lastGoodKey: "booths",
    staleHeader: "X-Booths-Stale",
    async build(env) {
      const csv = await fetchCommunitiesCsv(env);
      return buildBooths(csv, buildEvent(env), toJstIsoString(new Date()));
    },
  },
};

async function loadFresh(env: Env, resource: Resource): Promise<Payload> {
  const built = await resource.build(env);
  return { body: JSON.stringify(built), version: built.version, stale: false };
}

async function loadLastGood(env: Env, resource: Resource): Promise<Payload | null> {
  // 上流が落ちている最中に呼ばれるため、KV 自体の失敗も 502 に落として握らない
  try {
    const stored = await env.LAST_GOOD.get<LastGood>(resource.lastGoodKey, "json");
    if (!stored) return null;
    return { body: stored.body, version: stored.version, stale: true };
  } catch (error) {
    console.error("kv_get_failed", error);
    return null;
  }
}

function saveLastGood(env: Env, resource: Resource, payload: Payload): Promise<void> {
  const record: LastGood = {
    body: payload.body,
    version: payload.version,
    fetchedAt: toJstIsoString(new Date()),
  };
  return env.LAST_GOOD.put(resource.lastGoodKey, JSON.stringify(record)).catch((error: unknown) => {
    console.error("kv_put_failed", error);
  });
}

async function handleResource(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  resource: Resource,
): Promise<Response> {
  let payload: Payload | null;
  try {
    payload = await loadFresh(env, resource);
    ctx.waitUntil(saveLastGood(env, resource, payload));
  } catch (error) {
    if (error instanceof InvalidCsvError) console.warn("invalid_csv", error.message);
    else console.error("upstream_failed", error);
    payload = await loadLastGood(env, resource);
  }

  if (!payload) return errorResponse("upstream_unavailable", 502);

  const etag = `"${payload.version}"`;
  const headers: Record<string, string> = {
    "Cache-Control": payload.stale ? STALE_CACHE_CONTROL : FRESH_CACHE_CONTROL,
    ETag: etag,
  };
  if (payload.stale) headers[resource.staleHeader] = "true";

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

  const match = RESOURCE_PATH.exec(pathname);
  const eventId = match?.[1];
  const resource = match?.[2] === undefined ? undefined : RESOURCES[match[2]];
  if (eventId === undefined || resource === undefined) return errorResponse("not_found", 404);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS) },
    });
  }

  if (safeDecode(eventId) !== env.EVENT_ID) {
    return errorResponse("event_not_found", 404);
  }

  return handleResource(request, env, ctx, resource);
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
