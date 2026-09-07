// 公開契約は schema.ts に置き、ここからも引けるように再輸出する
export type * from "./schema";

// ここから下はバックエンド内部の型。Cloudflare のランタイム型に依存するため、
// フロントエンドから参照させない。

export type Env = {
  EVENT_ID: string;
  EVENT_TITLE: string;
  EVENT_DATE: string;
  EVENT_TIMEZONE: string;
  EVENT_VENUE: string;
  EVENT_URL: string;
  SHEET_PUB_BASE: string;
  SHEET_GID_TIMETABLE: string | number;
  SHEET_GID_COMMUNITIES: string | number;
  UPSTREAM_TIMEOUT_MS: string | number;
  CACHE_TTL_SECONDS: string | number;
  LAST_GOOD: KVNamespace;
};

/** KV `LAST_GOOD` に保存する最後に成功したレスポンス。 */
export type LastGood = {
  body: string;
  version: string;
  fetchedAt: string;
};
