import type { Link, Person, SessionKind, SessionType, TrackId } from "./types";

const HTTPS_PREFIX = "https://";
const HTTP_PREFIX = "http://";
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const KINDS: SessionKind[] = ["session", "break", "free"];
const TYPES: Exclude<SessionType, null>[] = ["opening", "talk", "lt", "sponsor", "closing"];
const TRACK_IDS: Exclude<TrackId, null>[] = ["track-a", "track-b"];
const TRUTHY = new Set(["true", "1", "yes"]);

/** セル内の改行表記を LF に揃える。CSV 側の CRLF がそのまま値に残るため。 */
export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** 大文字小文字を無視して SessionKind に正規化する。未知の値は null。 */
export function parseKind(value: string): SessionKind | null {
  const normalized = value.toLowerCase();
  return KINDS.find((kind) => kind === normalized) ?? null;
}

/**
 * 大文字小文字を無視して SessionType に正規化する。空欄も未知の値も null。
 * `kind` と違い必須ではないので、読めなくても行は落とさない（呼び出し側で warn する）。
 */
export function parseSessionType(value: string): SessionType {
  const normalized = value.toLowerCase();
  return TYPES.find((type) => type === normalized) ?? null;
}

/**
 * 大文字小文字を無視して TrackId に正規化する。空欄も未知の値も null。
 * 表示用の `group`（「Aトラック」など自由記述）とは別の列で、こちらは ID の閉じた集合。
 */
export function parseTrackId(value: string): TrackId {
  const normalized = value.toLowerCase();
  return TRACK_IDS.find((trackId) => trackId === normalized) ?? null;
}

/**
 * `H:mm` / `HH:mm` を `HH:mm` に正規化する。
 * Google スプレッドシートが時刻型のセルを `10:15:00` と書き出すため、末尾の `:ss` は許容して捨てる。
 */
export function parseTimeOfDay(value: string): string | null {
  const matched = TIME_PATTERN.exec(value);
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  const seconds = matched[3] === undefined ? 0 : Number(matched[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` と `HH:mm` を固定オフセット +09:00 の ISO 8601 に組み立てる。 */
export function toIsoDateTime(date: string, timeOfDay: string): string {
  return `${date}T${timeOfDay}:00+09:00`;
}

export function parseBoolean(value: string): boolean {
  return TRUTHY.has(value.trim().toLowerCase());
}

/** `https://` または `http://` で始まるときだけ URL として採用する。 */
export function parseHttpUrl(value: string): string | null {
  const url = value.trim();
  return url.startsWith(HTTPS_PREFIX) || url.startsWith(HTTP_PREFIX) ? url : null;
}

/** アイコンは `https://` のみ。相対パスや Drive の共有リンクは採らない。 */
export function parseIconUrl(value: string): string | null {
  const url = value.trim();
  return url.startsWith(HTTPS_PREFIX) ? url : null;
}

function splitLines(cell: string): string[] {
  return normalizeNewlines(cell)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** 改行区切りのコミュニティ ID。書かれた順序を保ち、同一セル内の重複はまとめる。 */
export function parseCommunityIds(cell: string): string[] {
  return [...new Set(splitLines(cell))];
}

/** `名前|アイコンURL` 記法。アイコンは https:// のみ採用し、実在は確認しない。 */
export function parsePeople(cell: string): Person[] {
  return splitLines(cell).flatMap((line) => {
    const separator = line.indexOf("|");
    const name = (separator === -1 ? line : line.slice(0, separator)).trim();
    if (name === "") return [];
    const rawIcon = separator === -1 ? "" : line.slice(separator + 1);
    return [{ name, iconUrl: parseIconUrl(rawIcon) }];
  });
}

/** `ラベル|URL` 記法。`|` がなければ URL のみとみなし、ラベルは URL と同じにする。 */
export function parseLinks(cell: string): Link[] {
  return splitLines(cell).flatMap((line) => {
    const separator = line.indexOf("|");
    const url = parseHttpUrl(separator === -1 ? line : line.slice(separator + 1));
    if (url === null) return [];
    const label = separator === -1 ? "" : line.slice(0, separator).trim();
    return [{ label: label === "" ? url : label, url }];
  });
}
