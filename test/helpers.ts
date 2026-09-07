import communitiesCsv from "../fixtures/communities.csv?raw";
import sampleResponse from "../fixtures/sample-response.json";
import timetableCsv from "../fixtures/timetable.csv?raw";

export const TIMETABLE_CSV = timetableCsv;
export const COMMUNITIES_CSV = communitiesCsv;
export const SAMPLE_RESPONSE = sampleResponse as unknown as Record<string, unknown>;

export const EVENT = {
  id: "techmujin-2026",
  title: "テック無尽 2026",
  date: "2026-11-22",
  timezone: "Asia/Tokyo",
  venue: "山梨大学 甲府キャンパス 共創環境棟 治ホール",
  url: null,
};

/** `version` と `updatedAt` は生成のたびに変わるので、比較の対象から外す。 */
export function withoutVolatileFields(value: Record<string, unknown>): Record<string, unknown> {
  const { version: _version, updatedAt: _updatedAt, ...rest } = value;
  return rest;
}
