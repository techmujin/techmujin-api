import { isValidId, normalizeNewlines, parseHttpUrl, parseIconUrl } from "./parse";
import { InvalidCsvError, nullIfBlank, readSheet, warnSkip } from "./sheet";
import type { Community } from "./types";

const REQUIRED_HEADERS = ["id", "name"] as const;

export type CommunityLedger = Map<string, Community>;

/** コミュニティシートの1行。レスポンスに埋め込む `Community` と、ブース番号を分けて持つ。 */
export type CommunityRow = {
  community: Community;
  /** 空欄ならブースを出さないコミュニティ */
  booth: string | null;
};

/**
 * コミュニティシートを ID 索引の行にする。
 * どの Session やブースからも参照されないエントリは単に使われていないだけで、警告もエラーも出さない。
 */
export function parseCommunityRows(csv: string): Map<string, CommunityRow> {
  const rows = new Map<string, CommunityRow>();

  for (const { rowNumber, read } of readSheet(csv, REQUIRED_HEADERS)) {
    const id = read("id");
    if (!isValidId(id)) {
      warnSkip("invalid_community_id", rowNumber, id);
      continue;
    }
    const name = read("name");
    if (name === "") {
      warnSkip("empty_community_name", rowNumber, id);
      continue;
    }
    if (rows.has(id)) warnSkip("duplicate_community_id", rowNumber, id);

    const description = nullIfBlank(read("description"));
    rows.set(id, {
      community: {
        id,
        name,
        url: parseHttpUrl(read("url")),
        iconUrl: parseIconUrl(read("icon")),
        descriptionMarkdown: description === null ? null : normalizeNewlines(description),
      },
      booth: nullIfBlank(read("booth")),
    });
  }

  return rows;
}

/** コミュニティシートを Session から引くための ID 索引にする。 */
export function parseCommunities(csv: string): CommunityLedger {
  const ledger: CommunityLedger = new Map();
  for (const [id, { community }] of parseCommunityRows(csv)) ledger.set(id, community);
  return ledger;
}

export { InvalidCsvError };
