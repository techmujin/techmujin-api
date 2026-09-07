const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 現在時刻を +09:00 表記の ISO 8601（秒まで）にする。 */
export function toJstIsoString(date: Date): string {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}
