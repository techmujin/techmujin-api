import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBooths, parseBooths } from "../src/booths";
import { parseCommunities } from "../src/communities";
import { InvalidCsvError } from "../src/sheet";
import {
  BOOTHS_CSV,
  COMMUNITIES_CSV,
  EVENT,
  SAMPLE_BOOTHS,
  withoutVolatileFields,
} from "./helpers";

const LEDGER = () => parseCommunities(COMMUNITIES_CSV);

const HEADER = "number,communities,title,description";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";
const numbers = (input: string) => parseBooths(input, LEDGER()).map((booth) => booth.number);

let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

const warned = (reason: string, rowNumber: number, id: string) =>
  expect(warn).toHaveBeenCalledWith(JSON.stringify({ reason, rowNumber, id }));

describe("ゴールデン", () => {
  it("fixtures/booths.csv から sample-booths.json を生成する", async () => {
    const booths = await buildBooths(BOOTHS_CSV, EVENT, "2026-11-01T00:00:00+09:00", LEDGER());
    const serialized = JSON.parse(JSON.stringify(booths)) as Record<string, unknown>;
    expect(withoutVolatileFields(serialized)).toEqual(withoutVolatileFields(SAMPLE_BOOTHS));
  });
});

describe("parseBooths", () => {
  it("必須列 number が無い CSV は不正とする", () => {
    expect(() => parseBooths("communities,title\r\nkofu-rb,t\r\n")).toThrow(InvalidCsvError);
  });

  it("number 以外の列は無くても読める", () => {
    expect(parseBooths("number\r\n1\r\n")).toEqual([
      { number: "1", title: null, communities: [], descriptionMarkdown: null },
    ]);
  });

  it("番号順ではなくシートの行順に並べる", () => {
    expect(numbers(csv("10,,,", "2,,,", "A-1,,,", "1,,,"))).toEqual(["10", "2", "A-1", "1"]);
  });

  it("number が空の行は除外して warn する", () => {
    expect(numbers(csv("1,,,", "  ,kofu-rb,番号なし,"))).toEqual(["1"]);
    warned("empty_booth_number", 3, "");
  });

  it("number の重複は後の行を採用し、後の行の位置に並べる", () => {
    const booths = parseBooths(csv("1,,古い,", "2,,,", "1,,新しい,"), LEDGER());
    expect(booths.map((b) => [b.number, b.title])).toEqual([
      ["2", null],
      ["1", "新しい"],
    ]);
    warned("duplicate_booth_number", 2, "1");
  });

  it("コミュニティ ID を台帳で解決し、書かれた順に埋め込む", () => {
    const [booth] = parseBooths(csv('1,"yamanashi-js\nkofu-rb",,'), LEDGER());
    expect(booth?.communities.map((c) => c.id)).toEqual(["yamanashi-js", "kofu-rb"]);
    expect(booth?.communities[1]?.name).toBe("甲府.rb");
  });

  it("未知の ID はその1件だけ落とし、ブースは残す", () => {
    const [booth] = parseBooths(csv('1,"no-such\nkofu-rb",,'), LEDGER());
    expect(booth?.communities.map((c) => c.id)).toEqual(["kofu-rb"]);
    warned("unknown_community_id", 2, "no-such");
  });

  it("同一セル内の重複 ID はまとめる", () => {
    const [booth] = parseBooths(csv('1,"kofu-rb\n kofu-rb ",,'), LEDGER());
    expect(booth?.communities.map((c) => c.id)).toEqual(["kofu-rb"]);
  });

  it("コミュニティが空のブースも残す", () => {
    expect(parseBooths(csv("受付,,総合受付,"), LEDGER())).toEqual([
      { number: "受付", title: "総合受付", communities: [], descriptionMarkdown: null },
    ]);
  });

  it("description の改行を \\n に正規化し、title が空なら null", () => {
    const [booth] = parseBooths(csv('1,,,"a\r\n\r\nb"'));
    expect(booth).toMatchObject({ title: null, descriptionMarkdown: "a\n\nb" });
  });
});

describe("version", () => {
  const build = (input: string, updatedAt = "2026-11-01T00:00:00+09:00") =>
    buildBooths(input, EVENT, updatedAt, LEDGER());

  it("同じ CSV からは同じ version、updatedAt が違っても変わらない", async () => {
    const a = await build(BOOTHS_CSV);
    const b = await build(BOOTHS_CSV, "2026-11-02T00:00:00+09:00");
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(b.version).toBe(a.version);
  });

  it("内容が1文字変われば version も変わる", async () => {
    const a = await build(csv("1,,title,"));
    const b = await build(csv("1,,titlE,"));
    expect(b.version).not.toBe(a.version);
  });
});
