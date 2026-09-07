import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCommunities } from "../src/communities";
import { InvalidCsvError } from "../src/sheet";
import { parseSessions } from "../src/timetable";
import { COMMUNITIES_CSV, EVENT } from "./helpers";

const HEADER = "id,kind,title,start,end,communities";
const timetableCsv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";

let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parseCommunities", () => {
  it("フィクスチャから有効なエントリだけを索引にする", () => {
    const ledger = parseCommunities(COMMUNITIES_CSV);
    expect([...ledger.keys()]).toEqual([
      "techmujin-committee",
      "kofu-rb",
      "yamanashi-js",
      "http-icon",
      "unused-community",
      "dup",
    ]);
  });

  it("url は http も採用するが、icon は https のみ採用する", () => {
    const ledger = parseCommunities(COMMUNITIES_CSV);
    expect(ledger.get("http-icon")).toMatchObject({
      url: "http://example.com/insecure",
      iconUrl: null,
    });
  });

  it("url と description が空なら null にする", () => {
    expect(parseCommunities(COMMUNITIES_CSV).get("yamanashi-js")).toMatchObject({
      url: null,
      descriptionMarkdown: null,
    });
  });

  it("description の改行を \\n に正規化し、引用符を復元する", () => {
    expect(parseCommunities(COMMUNITIES_CSV).get("kofu-rb")?.descriptionMarkdown).toBe(
      '## 甲府.rb\n\n- Ruby, その周辺\n- "毎月"開催',
    );
  });

  it("id が重複したときは後の行を採用する", () => {
    expect(parseCommunities(COMMUNITIES_CSV).get("dup")?.name).toBe("新しい名前（差し替え後）");
  });

  it("必須列が欠けている CSV は不正とする", () => {
    expect(() => parseCommunities("id,icon\r\na,x\r\n")).toThrow(InvalidCsvError);
  });

  it("列順が入れ替わっていても、余計な列があっても読める", () => {
    const ledger = parseCommunities("note,name,id\r\nメモ,甲府.rb,kofu-rb\r\n");
    expect(ledger.get("kofu-rb")).toEqual({
      id: "kofu-rb",
      name: "甲府.rb",
      url: null,
      iconUrl: null,
      descriptionMarkdown: null,
    });
  });
});

describe("ID による連結", () => {
  const ledger = () => parseCommunities(COMMUNITIES_CSV);
  const communitiesOf = (cell: string) =>
    parseSessions(timetableCsv(`s,session,t,10:00,11:00,${cell}`), EVENT.date, ledger())[0]
      ?.communities;

  it("ID を台帳の内容に解決して埋め込む", () => {
    expect(communitiesOf("kofu-rb")).toEqual([
      {
        id: "kofu-rb",
        name: "甲府.rb",
        url: "https://example.com/kofurb",
        iconUrl: "https://example.com/icons/kofurb.png",
        descriptionMarkdown: '## 甲府.rb\n\n- Ruby, その周辺\n- "毎月"開催',
      },
    ]);
  });

  it("未知の ID はその1件だけ落とし、Session は残す", () => {
    expect(communitiesOf('"no-such\nkofu-rb"')?.map((c) => c.id)).toEqual(["kofu-rb"]);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ reason: "unknown_community_id", rowNumber: 2, id: "no-such" }),
    );
  });

  it("すべての ID が未知でも Session は残る", () => {
    const sessions = parseSessions(
      timetableCsv("s,session,t,10:00,11:00,no-such"),
      EVENT.date,
      ledger(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.communities).toEqual([]);
  });

  it("同一セル内の重複 ID はまとめ、書かれた順序を保つ", () => {
    expect(communitiesOf('"kofu-rb\nyamanashi-js\n kofu-rb "')?.map((c) => c.id)).toEqual([
      "kofu-rb",
      "yamanashi-js",
    ]);
  });

  it("複数の Session から参照されても、それぞれに独立して埋め込む", () => {
    const sessions = parseSessions(
      timetableCsv("a,session,t,10:00,11:00,kofu-rb", "b,session,t,11:00,12:00,kofu-rb"),
      EVENT.date,
      ledger(),
    );
    expect(sessions.map((s) => s.communities[0]?.id)).toEqual(["kofu-rb", "kofu-rb"]);
  });

  it("どの Session からも参照されない台帳エントリでは warn しない", () => {
    parseSessions(timetableCsv("s,session,t,10:00,11:00,kofu-rb"), EVENT.date, ledger());
    const warned = warn.mock.calls.map((call) => String(call[0]));
    expect(warned.filter((line) => line.includes("unused-community"))).toEqual([]);
  });

  it("communities が空なら空配列", () => {
    expect(communitiesOf("")).toEqual([]);
  });
});
