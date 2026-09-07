import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCommunities } from "../src/communities";
import { InvalidCsvError } from "../src/sheet";
import { buildTimetable, parseSessions } from "../src/timetable";
import { computeVersion, stableStringify } from "../src/version";
import {
  COMMUNITIES_CSV,
  EVENT,
  SAMPLE_RESPONSE,
  TIMETABLE_CSV,
  withoutVolatileFields,
} from "./helpers";

const LEDGER = () => parseCommunities(COMMUNITIES_CSV);

const HEADER = "id,kind,title,start,end";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";
const ids = (input: string) => parseSessions(input, EVENT.date).map((session) => session.id);

let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("ゴールデン", () => {
  it("fixtures/timetable.csv から sample-response.json を生成する", async () => {
    const timetable = await buildTimetable(
      TIMETABLE_CSV,
      EVENT,
      "2026-11-01T00:00:00+09:00",
      LEDGER(),
    );
    const serialized = JSON.parse(JSON.stringify(timetable)) as Record<string, unknown>;
    expect(withoutVolatileFields(serialized)).toEqual(withoutVolatileFields(SAMPLE_RESPONSE));
  });
});

describe("ヘッダー", () => {
  it("必須列が欠けている CSV は不正とする", () => {
    expect(() => parseSessions("id,kind,title,start\r\na,session,t,10:00\r\n", EVENT.date)).toThrow(
      InvalidCsvError,
    );
  });

  it("空の CSV は不正とする", () => {
    expect(() => parseSessions("", EVENT.date)).toThrow(InvalidCsvError);
  });

  it("列順が入れ替わっていても、余計な列があっても読める", () => {
    const input = "note,end,title,start,kind,id\r\nメモ,11:00,タイトル,10:00,session,a\r\n";
    const [session] = parseSessions(input, EVENT.date);
    expect(session).toMatchObject({
      id: "a",
      title: "タイトル",
      startsAt: "2026-11-22T10:00:00+09:00",
      endsAt: "2026-11-22T11:00:00+09:00",
    });
  });
});

describe("行の除外", () => {
  it("id が不正な行を除外する", () => {
    expect(ids(csv("Bad_ID,session,t,10:00,11:00", "ok,session,t,11:00,12:00"))).toEqual(["ok"]);
  });

  it("kind が不正な行を除外する", () => {
    expect(ids(csv("a,keynote,t,10:00,11:00", "b,SESSION,t,11:00,12:00"))).toEqual(["b"]);
  });

  it("title が空の行を除外する", () => {
    expect(ids(csv("a,session, ,10:00,11:00", "b,session,t,11:00,12:00"))).toEqual(["b"]);
  });

  it("end が start 以前の行を除外する", () => {
    expect(ids(csv("a,session,t,11:00,11:00", "b,session,t,12:00,11:00"))).toEqual([]);
  });

  it("除外した行を reason / rowNumber / id つきで warn する", () => {
    parseSessions(csv("Bad_ID,session,t,10:00,11:00"), EVENT.date);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ reason: "invalid_id", rowNumber: 2, id: "Bad_ID" }),
    );
  });

  it("空行があっても CSV 上の行番号を warn する", () => {
    parseSessions([HEADER, "", "Bad_ID,session,t,10:00,11:00"].join("\r\n"), EVENT.date);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ reason: "invalid_id", rowNumber: 3, id: "Bad_ID" }),
    );
  });

  it("重なりで除外した行も実際の行番号を warn する", () => {
    parseSessions(csv("a,session,t,10:00,12:00", "b,session,t,10:30,11:00"), EVENT.date);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ reason: "overlapping", rowNumber: 3, id: "b" }),
    );
  });
});

describe("整合性", () => {
  it("id が重複したときは後の行を採用する", () => {
    const sessions = parseSessions(
      csv("a,session,古い,10:00,11:00", "a,session,新しい,10:00,11:00"),
      EVENT.date,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe("新しい");
  });

  it("CSV の行順が時間順でなくても startsAt 昇順に並べる", () => {
    expect(
      ids(csv("c,session,t,13:00,14:00", "a,session,t,10:00,11:00", "b,session,t,11:00,12:00")),
    ).toEqual(["a", "b", "c"]);
  });

  it("隣接（前の end == 次の start）は重なりとみなさない", () => {
    expect(ids(csv("a,session,t,10:00,11:00", "b,session,t,11:00,12:00"))).toEqual(["a", "b"]);
  });

  it("重なる Session は startsAt が遅い方を除外する", () => {
    expect(ids(csv("a,session,t,10:00,11:00", "b,session,t,10:30,11:30"))).toEqual(["a"]);
  });

  it("長い Session に重なる行はすべて除外し、その後の隣接行は残す", () => {
    expect(
      ids(
        csv(
          "wide,session,t,10:00,12:00",
          "x,session,t,10:30,11:00",
          "y,session,t,11:45,12:30",
          "z,session,t,12:00,12:30",
        ),
      ),
    ).toEqual(["wide", "z"]);
  });

  it("Session 間の空き時間は埋めない", () => {
    expect(ids(csv("a,session,t,10:00,11:00", "b,session,t,13:00,14:00"))).toEqual(["a", "b"]);
  });
});

describe("version", () => {
  const build = (input: string, updatedAt: string) =>
    buildTimetable(input, EVENT, updatedAt, LEDGER());

  it("同じ CSV からは同じ version になる", async () => {
    const a = await build(TIMETABLE_CSV, "2026-11-01T00:00:00+09:00");
    const b = await build(TIMETABLE_CSV, "2026-11-01T00:00:00+09:00");
    expect(a.version).toBe(b.version);
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it("updatedAt が違っても version は変わらない", async () => {
    const a = await build(TIMETABLE_CSV, "2026-11-01T00:00:00+09:00");
    const b = await build(TIMETABLE_CSV, "2026-11-02T12:34:56+09:00");
    expect(a.version).toBe(b.version);
  });

  it("CSV を1文字変えると version が変わる", async () => {
    const a = await build(TIMETABLE_CSV, "2026-11-01T00:00:00+09:00");
    const b = await build(
      TIMETABLE_CSV.replace("クロージング", "クロージンク"),
      "2026-11-01T00:00:00+09:00",
    );
    expect(a.version).not.toBe(b.version);
  });

  it("キーの順序が違っても同じ version になる", async () => {
    expect(await computeVersion({ a: 1, b: 2 })).toBe(await computeVersion({ b: 2, a: 1 }));
  });

  it("配列の順序は保持する", () => {
    expect(stableStringify([{ b: 1, a: 2 }, 3])).toBe('[{"a":2,"b":1},3]');
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
