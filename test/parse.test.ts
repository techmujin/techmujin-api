import { describe, expect, it } from "vitest";
import {
  parseBoolean,
  parseCommunityIds,
  parseHttpUrl,
  parseIconUrl,
  parseKind,
  parseLinks,
  parsePeople,
  parseTimeOfDay,
} from "../src/parse";

describe("parseTimeOfDay", () => {
  it.each([
    ["9:05", "09:05"],
    ["09:05", "09:05"],
    ["09:05:00", "09:05"],
    ["0:00", "00:00"],
    ["23:59", "23:59"],
  ])("%s を受理する", (input, expected) => {
    expect(parseTimeOfDay(input)).toBe(expected);
  });

  it.each(["25:00", "abc", "", "9:5", "12:60", "10:15:99", "10-15"])("%s を除外する", (input) => {
    expect(parseTimeOfDay(input)).toBeNull();
  });
});

describe("parseKind", () => {
  it.each([
    ["session", "session"],
    ["SESSION", "session"],
    ["Break", "break"],
    ["free", "free"],
  ])("%s を正規化する", (input, expected) => {
    expect(parseKind(input)).toBe(expected);
  });

  it("未知の種別は null", () => {
    expect(parseKind("keynote")).toBeNull();
  });
});

describe("parseBoolean", () => {
  it.each(["TRUE", "true", "1", "yes", "Yes"])("%s を true とする", (input) => {
    expect(parseBoolean(input)).toBe(true);
  });

  it.each(["FALSE", "false", "0", "", "no", "はい"])("%s を false とする", (input) => {
    expect(parseBoolean(input)).toBe(false);
  });
});

describe("parsePeople", () => {
  it("アイコン付きと名前のみを混在させられる", () => {
    expect(parsePeople("山田 太郎|https://example.com/a.png\n鈴木 花子")).toEqual([
      { name: "山田 太郎", iconUrl: "https://example.com/a.png" },
      { name: "鈴木 花子", iconUrl: null },
    ]);
  });

  it("https 以外のアイコンは null にする", () => {
    expect(parsePeople("A|http://example.com/a.png\nB|/icons/b.png\nC|例")).toEqual([
      { name: "A", iconUrl: null },
      { name: "B", iconUrl: null },
      { name: "C", iconUrl: null },
    ]);
  });

  it("名前が空の行は捨てる", () => {
    expect(parsePeople("|https://example.com/a.png\n\n  \nA")).toEqual([
      { name: "A", iconUrl: null },
    ]);
  });

  it("CRLF 区切りも扱う", () => {
    expect(parsePeople("A\r\nB")).toEqual([
      { name: "A", iconUrl: null },
      { name: "B", iconUrl: null },
    ]);
  });
});

describe("parseLinks", () => {
  it("ラベル付きと URL のみを扱う", () => {
    expect(parseLinks("資料|https://example.com/a\nhttp://example.com/b")).toEqual([
      { label: "資料", url: "https://example.com/a" },
      { label: "http://example.com/b", url: "http://example.com/b" },
    ]);
  });

  it("http/https 以外のスキームは捨てる", () => {
    expect(parseLinks("x|ftp://example.com/a\n/relative\nhttps://example.com/ok")).toEqual([
      { label: "https://example.com/ok", url: "https://example.com/ok" },
    ]);
  });
});

describe("parseHttpUrl / parseIconUrl", () => {
  it("url は http と https の両方を採用する", () => {
    expect(parseHttpUrl(" https://example.com/a ")).toBe("https://example.com/a");
    expect(parseHttpUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("icon は https のみ採用する", () => {
    expect(parseIconUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(parseIconUrl("http://example.com/a.png")).toBeNull();
  });

  it.each(["", "   ", "/icons/a.png", "example.com/a", "ftp://example.com/a"])(
    "%s はどちらも null",
    (input) => {
      expect(parseHttpUrl(input)).toBeNull();
      expect(parseIconUrl(input)).toBeNull();
    },
  );
});

describe("parseCommunityIds", () => {
  it("改行区切りで読み、前後の空白を除去する", () => {
    expect(parseCommunityIds(" kofu-rb \n houtou-pm ")).toEqual(["kofu-rb", "houtou-pm"]);
  });

  it("CRLF も扱い、空行は捨てる", () => {
    expect(parseCommunityIds("a\r\n\r\n  \r\nb")).toEqual(["a", "b"]);
  });

  it("重複はまとめ、最初に書かれた位置の順序を保つ", () => {
    expect(parseCommunityIds("b\na\nb")).toEqual(["b", "a"]);
  });

  it("空セルは空配列", () => {
    expect(parseCommunityIds("")).toEqual([]);
  });
});
