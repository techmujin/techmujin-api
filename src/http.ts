export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "ETag, X-Timetable-Stale",
};

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function jsonResponse(
  body: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 || status === 304 ? null : body, {
    status,
    headers: { "Content-Type": JSON_CONTENT_TYPE, ...CORS_HEADERS, ...headers },
  });
}

export function errorResponse(error: string, status: number): Response {
  return jsonResponse(JSON.stringify({ error }), status);
}

/**
 * `If-None-Match` が現在の ETag に一致するか。
 * `*` とカンマ区切り、弱い ETag の `W/` 接頭辞も受け付ける。
 */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate.replace(/^W\//, "") === etag);
}
