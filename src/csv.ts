/**
 * RFC 4180 に従う最小限の CSV パーサ。依存を増やさないため自前実装している。
 * 引用符内の改行・カンマ・"" エスケープを扱い、CRLF と LF の両方を行区切りとして受け付ける。
 */

const BOM = "﻿";

/**
 * CSV 本文をレコードに分解する。完全に空の行は落とすが、
 * 警告をシートの行と突き合わせられるよう通し番号は空行の分も進める。
 */
export function parseCsvRows(input: string): CsvRow[] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  let rowNumber = 1;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== "")) rows.push({ rowNumber, cells: row });
    row = [];
    rowNumber += 1;
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      endField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (c === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  // 末尾に改行がない場合の最終行。空行だけの末尾は endRow 側で捨てられる。
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

export type CsvRow = {
  /**
   * CSV レコードの通し番号（1 始まり、ヘッダーが 1）。空行も数えるので
   * セル内改行の有無にかかわらずスプレッドシートの行番号と一致する。
   */
  rowNumber: number;
  cells: string[];
};

export type CsvTable = {
  /** 前後の空白を除去したヘッダー名 */
  headers: string[];
  rows: CsvRow[];
};

/** 引用符やエスケープを解いた行 × セルの二次元配列。 */
export function parseCsv(input: string): string[][] {
  return parseCsvRows(input).map((row) => row.cells);
}

/** 1行目をヘッダーとして表に変換する。列は名前で引くため、以降は順序に依存しない。 */
export function toTable(input: string): CsvTable | null {
  const [header, ...rest] = parseCsvRows(input);
  if (!header) return null;
  return { headers: header.cells.map((h) => h.trim()), rows: rest };
}
