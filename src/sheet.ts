import { toTable } from "./csv";
import type { CsvRow } from "./csv";

/** description だけは Markdown の先頭インデントを保つため trim しない。 */
const RAW_COLUMNS = new Set(["description"]);

export class InvalidCsvError extends Error {}

/**
 * 除外した行と、行は残したまま落とした値を、理由・行番号・id を添えて残す。
 * wrangler tail で運営が追えるようにするため。どちらなのかは reason で区別する。
 */
export function warnSkip(reason: string, rowNumber: number, id: string): void {
  console.warn(JSON.stringify({ reason, rowNumber, id }));
}

export type RowReader = (column: string) => string;

export type SheetRow = {
  rowNumber: number;
  read: RowReader;
};

export function nullIfBlank(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function makeRowReader(headers: string[], cells: string[]): RowReader {
  return (column) => {
    const index = headers.indexOf(column);
    if (index === -1) return "";
    const value = cells[index] ?? "";
    return RAW_COLUMNS.has(column) ? value : value.trim();
  };
}

/**
 * CSV を「列名で引ける行」の列に変える。必須列が欠けている CSV は丸ごと不正とし、
 * 1行の不備（§5-6）とは区別して例外にする。
 */
export function readSheet(csv: string, requiredHeaders: readonly string[]): SheetRow[] {
  const table = toTable(csv);
  if (!table) throw new InvalidCsvError("csv_is_empty");

  const missing = requiredHeaders.filter((header) => !table.headers.includes(header));
  if (missing.length > 0) throw new InvalidCsvError(`missing_headers:${missing.join(",")}`);

  return table.rows.map(({ rowNumber, cells }: CsvRow) => ({
    rowNumber,
    read: makeRowReader(table.headers, cells),
  }));
}
