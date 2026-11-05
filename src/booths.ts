import { parseCommunityRows } from "./communities";
import type { Booth, BoothList, Community, Event } from "./types";
import { computeVersion } from "./version";

/** `2` < `10` < `A-1` < `A-2` の順にする（数字部分を数値として比べる）。 */
const BOOTH_ORDER = new Intl.Collator("ja", { numeric: true });

/**
 * コミュニティシートの `booth` 列からブースの一覧を組み立てる。
 * 同じブース番号を書いたコミュニティは1つのブースにまとめ、シートの行順で並べる。
 * `booth` が空のコミュニティはブースを出さないものとして含めない。
 */
export function parseBooths(csv: string): Booth[] {
  const byNumber = new Map<string, Community[]>();
  for (const { community, booth } of parseCommunityRows(csv).values()) {
    if (booth === null) continue;
    const communities = byNumber.get(booth);
    if (communities) communities.push(community);
    else byNumber.set(booth, [community]);
  }

  return [...byNumber]
    .sort(([a], [b]) => BOOTH_ORDER.compare(a, b))
    .map(([number, communities]) => ({ number, communities }));
}

export async function buildBooths(
  csv: string,
  event: Event,
  updatedAt: string,
): Promise<BoothList> {
  const booths = parseBooths(csv);
  const version = await computeVersion({ event, booths });
  return { schemaVersion: 1, version, updatedAt, event, booths };
}
