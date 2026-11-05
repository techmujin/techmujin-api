import { resolveCommunities } from "./communities";
import type { CommunityLedger } from "./communities";
import { normalizeNewlines } from "./parse";
import { nullIfBlank, readSheet, warnSkip } from "./sheet";
import type { Booth, BoothList, Event } from "./types";
import { computeVersion } from "./version";

const REQUIRED_HEADERS = ["number"] as const;

/**
 * ブースシートから Booth の配列を組み立てる。ヘッダーが不正なときだけ例外を投げる。
 *
 * - 並びはシートの行順（会場の動線順などに並べられるよう、番号では並べ替えない）
 * - `number` が重複したときは後の行を採用し、その位置に並べる
 * - `communities` が空のブース（運営受付など）も残す
 */
export function parseBooths(csv: string, ledger: CommunityLedger = new Map()): Booth[] {
  const kept = new Map<string, { booth: Booth; rowNumber: number }>();

  for (const { rowNumber, read } of readSheet(csv, REQUIRED_HEADERS)) {
    const number = read("number");
    if (number === "") {
      warnSkip("empty_booth_number", rowNumber, number);
      continue;
    }

    const description = nullIfBlank(read("description"));
    const booth: Booth = {
      number,
      title: nullIfBlank(read("title")),
      communities: resolveCommunities(read("communities"), ledger, rowNumber),
      descriptionMarkdown: description === null ? null : normalizeNewlines(description),
    };

    const previous = kept.get(number);
    if (previous) {
      warnSkip("duplicate_booth_number", previous.rowNumber, number);
      kept.delete(number);
    }
    kept.set(number, { booth, rowNumber });
  }

  return [...kept.values()].map(({ booth }) => booth);
}

export async function buildBooths(
  csv: string,
  event: Event,
  updatedAt: string,
  ledger: CommunityLedger = new Map(),
): Promise<BoothList> {
  const booths = parseBooths(csv, ledger);
  const version = await computeVersion({ event, booths });
  return { schemaVersion: 1, version, updatedAt, event, booths };
}
