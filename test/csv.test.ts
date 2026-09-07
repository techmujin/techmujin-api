import { describe, expect, it } from "vitest";
import { parseCsv, toTable } from "../src/csv";

describe("parseCsv", () => {
  it("先頭の BOM を取り除く", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("CRLF と LF の両方を行区切りとして受け付ける", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("引用符内の改行とカンマを保持する", () => {
    expect(parseCsv('a,b\r\n"1行目\r\n2行目, カンマ",x')).toEqual([
      ["a", "b"],
      ["1行目\r\n2行目, カンマ", "x"],
    ]);
  });

  it('"" を引用符として復元する', () => {
    expect(parseCsv('a\r\n"彼は""はい""と言った"')).toEqual([["a"], ['彼は"はい"と言った']]);
  });

  it("完全に空の行は無視する", () => {
    expect(parseCsv("a,b\r\n\r\n1,2\r\n,\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("末尾に改行がなくても最終行を落とさない", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("toTable", () => {
  it("ヘッダー名の前後の空白を除去する", () => {
    const table = toTable("kind, id ,title\r\nsession,a,タイトル\r\n");
    expect(table?.headers).toEqual(["kind", "id", "title"]);
  });

  it("空行を飛ばしても CSV 上の物理行番号を保つ", () => {
    const table = toTable("a\r\nx\r\n\r\ny\r\n");
    expect(table?.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  });

  it("空文字列は null を返す", () => {
    expect(toTable("")).toBeNull();
  });
});
