import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LastGood } from "../src/types";
import { COMMUNITIES_CSV, SAMPLE_RESPONSE, TIMETABLE_CSV, withoutVolatileFields } from "./helpers";

const BASE = "https://timetable.example.com";
const TIMETABLE_URL = `${BASE}/v1/events/techmujin-2026/timetable`;
const LAST_GOOD_KEY = "timetable";

const request = (url: string, init?: RequestInit) => exports.default.fetch(new Request(url, init));

const GID_COMMUNITIES = "gid=1223957092";

const csv = (body: string) => new Response(body, { headers: { "Content-Type": "text/csv" } });

/**
 * 上流はシートごとに別 URL なので、gid でどちらのシートかを見分けて応答する。
 * `sheets` に無い gid は 500 を返し、片方だけ落ちた状況を作れるようにする。
 */
function stubUpstream(sheets: { timetable?: () => Response; communities?: () => Response }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const make = url.includes(GID_COMMUNITIES) ? sheets.communities : sheets.timetable;
      if (!make) return Promise.resolve(new Response("boom", { status: 500 }));
      return Promise.resolve(make());
    }),
  );
}

const bothSheets = {
  timetable: () => csv(TIMETABLE_CSV),
  communities: () => csv(COMMUNITIES_CSV),
};

/** 最初の `failures` 回だけ 500 を返し、以降は `body` を返す。リトライの検証用。 */
function flaky(body: string, failures: number): () => Response {
  let seen = 0;
  return () => (seen++ < failures ? new Response("boom", { status: 500 }) : csv(body));
}

/** KV への書き込みは ctx.waitUntil 経由なので、反映されるまで待つ。 */
async function waitForLastGood(): Promise<LastGood> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const stored = await env.LAST_GOOD.get<LastGood>(LAST_GOOD_KEY, "json");
    if (stored) return stored;
    await scheduler.wait(10);
  }
  throw new Error("LAST_GOOD が書き込まれなかった");
}

beforeEach(async () => {
  await env.LAST_GOOD.delete(LAST_GOOD_KEY);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /v1/events/{eventId}/timetable", () => {
  beforeEach(() => stubUpstream(bothSheets));

  it("200 とスキーマどおりの本文を返す", async () => {
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30, s-maxage=60");
    expect(response.headers.get("X-Timetable-Stale")).toBeNull();

    const body = await response.json<Record<string, unknown>>();
    expect(withoutVolatileFields(body)).toEqual(withoutVolatileFields(SAMPLE_RESPONSE));
    expect(response.headers.get("ETag")).toBe(`"${String(body.version)}"`);
  });

  it("CORS ヘッダーを付ける", async () => {
    const response = await request(TIMETABLE_URL);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, If-None-Match",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("ETag, X-Timetable-Stale");
  });

  it("If-None-Match が一致すれば 304 を本文なしで返す", async () => {
    const first = await request(TIMETABLE_URL);
    const etag = first.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{12}"$/);

    const second = await request(TIMETABLE_URL, { headers: { "If-None-Match": etag } });
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe("public, max-age=30, s-maxage=60");
    expect(await second.text()).toBe("");
  });

  it("If-None-Match が一致しなければ 200 を返す", async () => {
    const response = await request(TIMETABLE_URL, { headers: { "If-None-Match": '"deadbeef"' } });
    expect(response.status).toBe(200);
  });

  it("eventId が一致しなければ 404 event_not_found", async () => {
    const response = await request(`${BASE}/v1/events/other-event/timetable`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "event_not_found" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("その他のルーティング", () => {
  beforeEach(() => stubUpstream(bothSheets));

  it("OPTIONS は 204 と CORS ヘッダーのみ", async () => {
    const response = await request(TIMETABLE_URL, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toBe("");
  });

  it("GET /healthz は上流に触れずに 200 を返す", async () => {
    const response = await request(`${BASE}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("未知のパスは 404 not_found", async () => {
    const response = await request(`${BASE}/v1/unknown`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("HEAD は 200 を本文なしで返す", async () => {
    const response = await request(TIMETABLE_URL, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]{12}"$/);
    expect(await response.text()).toBe("");
  });

  it("eventId が不正なパーセントエンコードでも JSON と CORS を保って 404", async () => {
    const response = await request(`${BASE}/v1/events/%/timetable`);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({ error: "event_not_found" });
  });

  it("POST は 405", async () => {
    const response = await request(TIMETABLE_URL, { method: "POST" });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("上流のリトライ", () => {
  it("1回失敗しても、やり直して成功すれば fresh を返す", async () => {
    stubUpstream({ ...bothSheets, timetable: flaky(TIMETABLE_CSV, 1) });
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Timetable-Stale")).toBeNull();
    await waitForLastGood();
  });

  it("2回失敗しても3回目で成功すれば fresh を返す", async () => {
    stubUpstream({ ...bothSheets, timetable: flaky(TIMETABLE_CSV, 2) });
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Timetable-Stale")).toBeNull();
    await waitForLastGood();
  });

  it("3回とも失敗したら上流失敗として扱う", async () => {
    stubUpstream({ ...bothSheets, timetable: flaky(TIMETABLE_CSV, 3) });
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(502);
  });

  it("シートごとに3回まで試行する", async () => {
    stubUpstream({});
    await request(TIMETABLE_URL);
    // 2シート × 3回
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(6);
  });

  it("成功したシートは張り直さない", async () => {
    stubUpstream({ ...bothSheets, timetable: flaky(TIMETABLE_CSV, 1) });
    await request(TIMETABLE_URL);
    // timetable が 2 回、communities が 1 回
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
    await waitForLastGood();
  });
});

describe("フォールバック", () => {
  it("上流が 500 のとき KV の最後の成功分を X-Timetable-Stale つきで返す", async () => {
    stubUpstream(bothSheets);
    const fresh = await request(TIMETABLE_URL);
    const freshBody = await fresh.text();
    const stored = await waitForLastGood();
    expect(stored.body).toBe(freshBody);

    stubUpstream({});
    const stale = await request(TIMETABLE_URL);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("X-Timetable-Stale")).toBe("true");
    expect(stale.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=10");
    expect(stale.headers.get("ETag")).toBe(`"${stored.version}"`);
    expect(await stale.text()).toBe(freshBody);
  });

  it("フォールバック時も If-None-Match が一致すれば 304", async () => {
    stubUpstream(bothSheets);
    await request(TIMETABLE_URL);
    const stored = await waitForLastGood();

    stubUpstream({});
    const response = await request(TIMETABLE_URL, {
      headers: { "If-None-Match": `"${stored.version}"` },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("X-Timetable-Stale")).toBe("true");
  });

  it("コミュニティシートだけ 500 でも全体が stale になる", async () => {
    stubUpstream(bothSheets);
    await request(TIMETABLE_URL);
    const stored = await waitForLastGood();

    stubUpstream({ timetable: () => csv(TIMETABLE_CSV) });
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Timetable-Stale")).toBe("true");
    expect(await response.text()).toBe(stored.body);
  });

  it("コミュニティシートに必須列が無ければ全体が stale になる", async () => {
    stubUpstream(bothSheets);
    await request(TIMETABLE_URL);
    await waitForLastGood();

    stubUpstream({ ...bothSheets, communities: () => csv("id,icon\r\na,x\r\n") });
    const response = await request(TIMETABLE_URL);
    expect(response.headers.get("X-Timetable-Stale")).toBe("true");
  });

  it("タイムテーブルの CSV が不正でもフォールバックする", async () => {
    stubUpstream(bothSheets);
    await request(TIMETABLE_URL);
    await waitForLastGood();

    stubUpstream({ ...bothSheets, timetable: () => csv("foo,bar\r\n1,2\r\n") });
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Timetable-Stale")).toBe("true");
  });

  it("KV の読み出しが失敗しても 502 upstream_unavailable", async () => {
    stubUpstream(bothSheets);
    await request(TIMETABLE_URL);
    await waitForLastGood();

    stubUpstream({});
    const get = vi.spyOn(env.LAST_GOOD, "get").mockRejectedValue(new Error("kv down"));
    const response = await request(TIMETABLE_URL);
    expect(get).toHaveBeenCalled();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("KV も空なら 502 upstream_unavailable", async () => {
    stubUpstream({});
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("上流の本文が空なら失敗として扱う", async () => {
    stubUpstream({ ...bothSheets, timetable: () => csv("   ") });
    const response = await request(TIMETABLE_URL);
    expect(response.status).toBe(502);
  });
});
