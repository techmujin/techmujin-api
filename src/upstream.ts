import type { Env } from "./types";

export class UpstreamError extends Error {}

function toNumber(value: string | number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_SECONDS = 60;

/**
 * 公開スプレッドシートの1シートを CSV で取得する URL。
 * `gid` と `single=true` は必須。省略すると「公開シートが1枚だけ」という状態に暗黙に依存し、
 * シートが増えたときに別のシートを指しうる（§3）。
 */
function csvUrl(base: string, gid: string | number): string {
  return `${base}?gid=${String(gid)}&single=true&output=csv`;
}

async function fetchCsv(url: string, timeoutMs: number, cacheTtl: number): Promise<string> {
  let response: Response;
  try {
    // Google はリダイレクトを挟むことがあるので追従し、エッジキャッシュで到達回数を絞る
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      cf: { cacheTtl, cacheEverything: true },
    });
  } catch (cause) {
    throw new UpstreamError("fetch_failed", { cause });
  }

  if (!response.ok) throw new UpstreamError(`upstream_status_${response.status}`);

  const body = await response.text();
  if (body.trim() === "") throw new UpstreamError("empty_body");
  return body;
}

export type SheetCsvs = {
  timetable: string;
  communities: string;
};

/**
 * 2枚のシートを並行に取得する。片方でも失敗したら全体を上流失敗として扱う。
 * コミュニティ名はタイムテーブルシート側に無いため、片方だけで組み立てた縮退表示が成立しない（§5-1）。
 */
export async function fetchSheetCsvs(env: Env): Promise<SheetCsvs> {
  const timeoutMs = toNumber(env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const cacheTtl = toNumber(env.CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS);
  const get = (gid: string | number) =>
    fetchCsv(csvUrl(env.SHEET_PUB_BASE, gid), timeoutMs, cacheTtl);

  const [timetable, communities] = await Promise.all([
    get(env.SHEET_GID_TIMETABLE),
    get(env.SHEET_GID_COMMUNITIES),
  ]);
  return { timetable, communities };
}
