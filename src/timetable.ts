import type { CommunityLedger } from "./communities";
import {
  isValidId,
  normalizeNewlines,
  parseBoolean,
  parseCommunityIds,
  parseKind,
  parseLinks,
  parsePeople,
  parseSessionType,
  parseTimeOfDay,
  parseTrackId,
  toIsoDateTime,
} from "./parse";
import { nullIfBlank, readSheet, warnSkip } from "./sheet";
import type { RowReader } from "./sheet";
import type { Community, Event, Session, SessionType, Timetable, TrackId } from "./types";
import { computeVersion } from "./version";

const REQUIRED_HEADERS = ["id", "kind", "title", "start", "end"] as const;

/**
 * `communities` セルの ID を台帳で解決する。
 * 引けない ID はその1件だけ落とし、Session 自体は残す（§5-5）。
 */
function resolveCommunities(cell: string, ledger: CommunityLedger, rowNumber: number): Community[] {
  return parseCommunityIds(cell).flatMap((id) => {
    const community = ledger.get(id);
    if (!community) {
      warnSkip("unknown_community_id", rowNumber, id);
      return [];
    }
    return [community];
  });
}

/**
 * `type` セルを SessionType にする。必須ではないので、読めなくても行は落とさず null にする。
 * 空欄は「指定なし」で正常だが、書いてあるのに読めない値は打ち間違いを疑えるよう warn する。
 */
function resolveType(cell: string, rowNumber: number, id: string): SessionType {
  const type = parseSessionType(cell);
  if (type === null && cell !== "") warnSkip("unknown_session_type", rowNumber, id);
  return type;
}

/** `track` セルを TrackId にする。扱いは `type` と同じで、未知の値でも行は残す。 */
function resolveTrackId(cell: string, rowNumber: number, id: string): TrackId {
  const trackId = parseTrackId(cell);
  if (trackId === null && cell !== "") warnSkip("unknown_track_id", rowNumber, id);
  return trackId;
}

/** CSV 1行を Session にする。行として成立しないときは理由を warn して null を返す。 */
function toSession(
  read: RowReader,
  rowNumber: number,
  eventDate: string,
  ledger: CommunityLedger,
): Session | null {
  const id = read("id");
  if (!isValidId(id)) {
    warnSkip("invalid_id", rowNumber, id);
    return null;
  }
  const kind = parseKind(read("kind"));
  if (kind === null) {
    warnSkip("invalid_kind", rowNumber, id);
    return null;
  }
  const title = read("title");
  if (title === "") {
    warnSkip("empty_title", rowNumber, id);
    return null;
  }
  const start = parseTimeOfDay(read("start"));
  if (start === null) {
    warnSkip("invalid_start", rowNumber, id);
    return null;
  }
  const end = parseTimeOfDay(read("end"));
  if (end === null) {
    warnSkip("invalid_end", rowNumber, id);
    return null;
  }
  if (end <= start) {
    warnSkip("end_not_after_start", rowNumber, id);
    return null;
  }

  const description = nullIfBlank(read("description"));

  return {
    id,
    kind,
    type: resolveType(read("type"), rowNumber, id),
    group: nullIfBlank(read("group")),
    trackId: resolveTrackId(read("track"), rowNumber, id),
    title,
    startsAt: toIsoDateTime(eventDate, start),
    endsAt: toIsoDateTime(eventDate, end),
    communities: resolveCommunities(read("communities"), ledger, rowNumber),
    speakers: parsePeople(read("speakers")),
    descriptionMarkdown: description === null ? null : normalizeNewlines(description),
    message: nullIfBlank(read("message")),
    isCancelled: parseBoolean(read("isCancelled")),
    links: parseLinks(read("links")),
  };
}

type Entry = { session: Session; rowNumber: number };

/** id 重複は後の行を採用する。 */
function dedupeById(entries: Entry[]): Entry[] {
  const kept = new Map<string, Entry>();
  for (const entry of entries) {
    const previous = kept.get(entry.session.id);
    if (previous) warnSkip("duplicate_id", previous.rowNumber, previous.session.id);
    kept.set(entry.session.id, entry);
  }
  return [...kept.values()];
}

/**
 * 時間帯の重なりを解消する。比較対象は直前の行ではなく「直前に採用した Session」。
 * 長いセッションに複数の行が重なる場合、そのすべてを落とす必要があるため。
 */
function dropOverlaps(entries: Entry[]): Session[] {
  const kept: Session[] = [];
  let lastEndsAt: string | null = null;
  for (const { session, rowNumber } of entries) {
    if (lastEndsAt !== null && session.startsAt < lastEndsAt) {
      warnSkip("overlapping", rowNumber, session.id);
      continue;
    }
    kept.push(session);
    lastEndsAt = session.endsAt;
  }
  return kept;
}

export function buildEvent(env: {
  EVENT_ID: string;
  EVENT_TITLE: string;
  EVENT_DATE: string;
  EVENT_TIMEZONE: string;
  EVENT_VENUE: string;
  EVENT_URL: string;
}): Event {
  return {
    id: env.EVENT_ID,
    title: env.EVENT_TITLE,
    date: env.EVENT_DATE,
    timezone: env.EVENT_TIMEZONE,
    venue: nullIfBlank(env.EVENT_VENUE ?? ""),
    url: nullIfBlank(env.EVENT_URL ?? ""),
  };
}

/** CSV から Session の配列を組み立てる。ヘッダーが不正なときだけ例外を投げる。 */
export function parseSessions(
  csv: string,
  eventDate: string,
  ledger: CommunityLedger = new Map(),
): Session[] {
  const parsed = readSheet(csv, REQUIRED_HEADERS).flatMap(({ rowNumber, read }) => {
    const session = toSession(read, rowNumber, eventDate, ledger);
    return session ? [{ session, rowNumber }] : [];
  });

  // 重複解消 → 開始時刻昇順 → 重なり解消 の順。重なりの判定は最終的な並び順に依存する。
  const sorted = dedupeById(parsed)
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) =>
      a.session.startsAt === b.session.startsAt
        ? a.index - b.index
        : a.session.startsAt < b.session.startsAt
          ? -1
          : 1,
    );

  return dropOverlaps(sorted);
}

export async function buildTimetable(
  csv: string,
  event: Event,
  updatedAt: string,
  ledger: CommunityLedger = new Map(),
): Promise<Timetable> {
  const sessions = parseSessions(csv, event.date, ledger);
  const version = await computeVersion({ event, sessions });
  return { schemaVersion: 1, version, updatedAt, event, sessions };
}
