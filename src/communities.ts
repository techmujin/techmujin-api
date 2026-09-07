import { isValidId, normalizeNewlines, parseHttpUrl, parseIconUrl } from "./parse";
import { InvalidCsvError, nullIfBlank, readSheet, warnSkip } from "./sheet";
import type { Community } from "./types";

const REQUIRED_HEADERS = ["id", "name"] as const;

export type CommunityLedger = Map<string, Community>;

/**
 * コミュニティシートを ID 索引にする。
 * どの Session からも参照されないエントリは単に使われていないだけで、警告もエラーも出さない。
 */
export function parseCommunities(csv: string): CommunityLedger {
  const ledger: CommunityLedger = new Map();

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
    if (ledger.has(id)) warnSkip("duplicate_community_id", rowNumber, id);

    const description = nullIfBlank(read("description"));
    ledger.set(id, {
      id,
      name,
      url: parseHttpUrl(read("url")),
      iconUrl: parseIconUrl(read("icon")),
      descriptionMarkdown: description === null ? null : normalizeNewlines(description),
    });
  }

  return ledger;
}

export { InvalidCsvError };
