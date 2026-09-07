# テック無尽 2026 タイムテーブル配信API 仕様

Google スプレッドシート1冊を編集元とし、Cloudflare Workers が検証・整形した JSON を配信するバックエンドの実装仕様。フロント（Vercel 上の SPA、別担当）は本APIを単純な GET で取得し、localStorage に保存して描画する。

同じスプレッドシート内の2枚のシートを読む。タイムテーブルはコミュニティを **ID で参照**し、Worker 側で連結してから返す。**フロントに結合処理をさせない**ことを設計の前提とする。

関連ファイル

- `fixtures/timetable.csv` — タイムテーブルシートを「ウェブに公開 → CSV」した想定の入力。テストの正となる
- `fixtures/communities.csv` — コミュニティシートの同上
- `fixtures/sample-response.json` — 上記2つの CSV から生成されるべきレスポンス（`version` と `updatedAt` を除いて完全一致）

---

## 1. 目的と範囲

- 運営がスプレッドシートを編集すると、約60秒以内に API のレスポンスに反映される
- 認証なし。公開情報のみを扱う
- 配信するのは T1 ステージの進行（`sessions[]`）と、そこから参照されるコミュニティの情報。ブースやコミュニケーションスペースの時間割、登壇者のプロフィール、画像のホスティングは範囲外
- コミュニティの情報は各 Session に**埋め込んで**返す。同じコミュニティが複数の Session に出れば、その回数だけ本文に現れる（重複を許容する）
- 言語は日本語のみ

## 2. 技術スタック

| 項目           | 選定                                                        |
| -------------- | ----------------------------------------------------------- |
| ランタイム     | Cloudflare Workers                                          |
| 言語           | TypeScript（strict）                                        |
| パッケージ管理 | pnpm（バージョンは完全固定）                                |
| ツール         | wrangler                                                    |
| テスト         | vitest + `@cloudflare/vitest-pool-workers`                  |
| 依存           | 極力ゼロ。CSV パーサは自前実装（要件 §5）。zod は使ってよい |
| ストレージ     | Workers KV（最終成功レスポンスの保持用、1キーのみ）         |

## 3. 設定（`wrangler.toml` の `[vars]`）

| 変数                    | 例                                                     | 説明                                         |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `EVENT_ID`              | `techmujin-2026`                                       | パスと `event.id` に使う                     |
| `EVENT_TITLE`           | `テック無尽 2026`                                      |                                              |
| `EVENT_DATE`            | `2026-11-22`                                           | `HH:mm` を ISO 8601 に組み立てるときの日付   |
| `EVENT_TIMEZONE`        | `Asia/Tokyo`                                           | 固定。オフセットは `+09:00` として扱う       |
| `EVENT_VENUE`           | `山梨大学 甲府キャンパス 共創環境棟 治ホール`          | 空なら null                                  |
| `EVENT_URL`             |                                                        | 空なら null                                  |
| `SHEET_PUB_BASE`        | `https://docs.google.com/spreadsheets/d/e/<pubid>/pub` | 「ウェブに公開」で得られる URL の `?` より前 |
| `SHEET_GID_TIMETABLE`   | `0`                                                    | タイムテーブルシートの `gid`                 |
| `SHEET_GID_COMMUNITIES` | `1223957092`                                           | コミュニティシートの `gid`                   |
| `UPSTREAM_TIMEOUT_MS`   | `5000`                                                 | Google への fetch タイムアウト               |
| `CACHE_TTL_SECONDS`     | `60`                                                   | エッジキャッシュの TTL                       |

各シートの CSV URL は `${SHEET_PUB_BASE}?gid=${gid}&single=true&output=csv` で組み立てる。

- スプレッドシート1冊を「ウェブに公開」すると、同一の `<pubid>` のまま `gid` でシートを選べる（実測で確認済み）。データセットが増えても `gid` を1つ足すだけで済む
- `gid` と `single=true` は**必ず付ける**。省略した URL は「公開されているシートが1枚だけ」という状態に暗黙に依存しており、シートが増えたときに別のシートを指しうる。その場合 API は必須列が無い CSV を受け取り、シートが正常なまま §7 のフォールバックに落ちて古い内容を配信し続ける
- 存在しない `gid` は Google が 400 を返す

KV バインディング: `LAST_GOOD`（namespace は任意名）。

これらは秘匿情報ではない。ローカルで別の上流に向けたいときだけ `.dev.vars` に `SHEET_PUB_BASE` を置いて上書きする（`.dev.vars` は `wrangler.toml` の `[vars]` を上書きするため、置きっぱなしにすると実シートを見に行かなくなる）。

## 4. エンドポイント

### `GET /v1/events/{eventId}/timetable`

- `{eventId}` が `EVENT_ID` と一致しないとき、`404` と `{"error":"event_not_found"}` を返す
- 成功時 `200`、本文は §6 のスキーマ
- レスポンスヘッダー

| ヘッダー                        | 値                                                           |
| ------------------------------- | ------------------------------------------------------------ |
| `Content-Type`                  | `application/json; charset=utf-8`                            |
| `Cache-Control`                 | `public, max-age=30, s-maxage=60`                            |
| `ETag`                          | `"<version>"`（弱い ETag ではなく強い ETag、二重引用符付き） |
| `Access-Control-Allow-Origin`   | `*`                                                          |
| `Access-Control-Allow-Methods`  | `GET, OPTIONS`                                               |
| `Access-Control-Allow-Headers`  | `Content-Type, If-None-Match`                                |
| `Access-Control-Expose-Headers` | `ETag, X-Timetable-Stale`                                    |
| `X-Timetable-Stale`             | `true`（§7 のフォールバック時のみ付与）                      |

- リクエストに `If-None-Match` があり、現在の `version` と一致するとき、`304` を本文なしで返す（`ETag` と `Cache-Control` は付ける）

### `OPTIONS /v1/events/{eventId}/timetable`

- `204`、CORS ヘッダーのみ。`Access-Control-Max-Age: 86400`

### `GET /healthz`

- `200` と `{"ok":true}`。上流には触らない

### それ以外

- `404` と `{"error":"not_found"}`。`GET` `OPTIONS` `HEAD` 以外のメソッドは `405`

すべてのエラーレスポンスも `Content-Type: application/json` と CORS ヘッダーを持つ。

## 5. 入力（CSV）の仕様

### 5-1. 取得

- タイムテーブルシートとコミュニティシートの CSV を**並行に** `fetch` する。それぞれ `cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }` を付け、`AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` で打ち切る
- Google はリダイレクトを返すことがある。`redirect: "follow"` で追従する
- 非 2xx、タイムアウト、本文が空、または先頭行に必須列が揃っていないとき、上流失敗として扱う（§7）
- **どちらか一方でも失敗したら全体を上流失敗とする。**片方だけで組み立てたレスポンスは返さない（コミュニティ名はタイムテーブルシート側に無いため、コミュニティシートを欠いた縮退表示が成立しない）

### 5-2. パース

- UTF-8。先頭の BOM（`﻿`）は除去する
- RFC 4180 に従う。二重引用符で囲まれたフィールド内の改行・カンマ・`""` エスケープを正しく扱う。改行は `\r\n` と `\n` の両方を受け付ける
- 1行目をヘッダーとし、列は**名前で**引く（順序に依存しない）。ヘッダーは前後の空白を除去して比較する
- 完全に空の行は無視する
- 列の値はすべて前後の空白を除去する（`description` は除去しない。Markdown の先頭インデントを保つため）

### 5-3. タイムテーブルシートの列

| 列            | 必須 | 解釈                                                                                                                                                                   |
| ------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | 必須 | `^[a-z0-9][a-z0-9-]*$`。不一致は行を除外                                                                                                                               |
| `kind`        | 必須 | `session` / `break` / `free`。大文字小文字は無視して正規化。それ以外は行を除外                                                                                         |
| `group`       |      | 空なら null                                                                                                                                                            |
| `title`       | 必須 | 空なら行を除外                                                                                                                                                         |
| `start`       | 必須 | `H:mm` または `HH:mm`。`EVENT_DATE` と `+09:00` を組み合わせて ISO 8601 にする。Google が時刻型として `10:15:00` を出すことがあるので、末尾の `:ss` は許容して無視する |
| `end`         | 必須 | 同上。`end <= start` なら行を除外                                                                                                                                      |
| `communities` |      | 改行区切りのコミュニティ ID。§5-5 で解決する                                                                                                                           |
| `speakers`    |      | §5-4 の Person 記法                                                                                                                                                    |
| `description` |      | 空なら null。それ以外は文字列のまま（Markdown）。改行は `\n` に正規化する                                                                                              |
| `message`     |      | 空なら null                                                                                                                                                            |
| `isCancelled` |      | `TRUE` / `true` / `1` / `yes` を true、それ以外を false                                                                                                                |
| `links`       |      | 改行区切りで `ラベル\|URL`。`\|` がない行は URL のみとみなしラベル = URL。URL が `https://` または `http://` で始まらない行は捨てる                                    |

ヘッダーに `id` `kind` `title` `start` `end` のいずれかが無い場合は CSV 全体を不正とし、上流失敗として扱う。

### 5-4. Person 記法（`speakers` のみ）

`speakers` はセル内を改行で区切り、各行を `名前|アイコンURL` と読む。

- `|` がなければ名前のみ。`iconUrl` は null
- `iconUrl` は `https://` で始まる場合のみ採用し、それ以外（`http://`、相対パス、Drive の共有リンク等）は null にする。画像の実在は確認しない
- 名前が空の行は捨てる
- 同じ名前が複数の Session に出ても名寄せしない。行ごとにそのまま返す

登壇者は Session 固有で、台帳を作るほどの再利用が無いため、コミュニティと異なりインライン記法のまま据え置く。この非対称は意図的なもの。

### 5-5. コミュニティシートと ID 参照

コミュニティシート（`SHEET_GID_COMMUNITIES`）の列。パース規則は §5-2 と共通。

| 列            | 必須 | 解釈                                                                                        |
| ------------- | ---- | ------------------------------------------------------------------------------------------- |
| `id`          | 必須 | `^[a-z0-9][a-z0-9-]*$`。不一致は行を除外。重複したときは**後の行を採用**                    |
| `name`        | 必須 | 空なら行を除外                                                                              |
| `url`         |      | コミュニティの公式サイト。`https://` または `http://` で始まる場合のみ採用。それ以外は null |
| `icon`        |      | `https://` で始まる場合のみ採用。それ以外は null。画像の実在は確認しない                    |
| `description` |      | 空なら null。それ以外は文字列のまま（Markdown）。改行は `\n` に正規化する                   |

ヘッダーに `id` `name` のいずれかが無い場合は CSV 全体を不正とし、上流失敗として扱う。

ID は人が読めるスラッグ（`kofu-rb`、`jawsug-yamanashi` など）を推奨する。`1` のような連番も上のパターンは通るため**コードは弾かない**が、行の挿入で意味がずれるうえログを読んでも何のことか分からない。運用上の取り決めとして守る。

タイムテーブルシートの `communities` セルは、セル内を改行で区切り、各行を1つの ID として読む。

- 前後の空白を除去する。空行は捨てる
- コミュニティシートに存在する ID は、その内容を Session に**埋め込む**
- 存在しない ID は warn（`unknown_community_id`）してその1件だけ落とす。Session 自体は残す
- 同じ Session 内に同じ ID が複数回書かれていたら1つにまとめる。書かれた順序は保つ
- どの Session からも参照されていないコミュニティは、単に使われていないだけ。エラーでも warn でもない

### 5-6. 除外した行の扱い

除外した行は `console.warn` に `{ reason, rowNumber, id }` の形で出す（wrangler tail で確認できるようにする）。レスポンスには含めず、エラーにもしない。**1行の不備で全体が落ちないこと**を優先する。

## 6. 出力（JSON）の仕様

### 6-1. 型

```ts
export type Timetable = {
  schemaVersion: 1;
  version: string; // event と sessions の正規化 JSON の SHA-256 先頭12桁（16進）
  updatedAt: string; // Worker が生成した時刻。ISO 8601、+09:00
  event: Event;
  sessions: Session[]; // startsAt 昇順
};

export type Event = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  timezone: string; // "Asia/Tokyo"
  venue: string | null;
  url: string | null;
};

export type Person = {
  name: string;
  iconUrl: string | null;
};

export type Community = {
  id: string;
  name: string;
  url: string | null; // connpass / meetup などの公式サイト
  iconUrl: string | null;
  descriptionMarkdown: string | null;
};

export type SessionKind = "session" | "break" | "free";

export type Session = {
  id: string;
  kind: SessionKind;
  group: string | null;
  title: string;
  startsAt: string; // ISO 8601 with offset, e.g. "2026-11-22T10:15:00+09:00"
  endsAt: string;
  communities: Community[]; // コミュニティシートから連結済み。フロントでの結合は不要
  speakers: Person[];
  descriptionMarkdown: string | null;
  message: string | null;
  isCancelled: boolean;
  links: { label: string; url: string }[];
};
```

### 6-2. 整合性の保証

- `id` は一意。重複したときは**後の行を採用**し、前の行を除外して warn
- `sessions` は `startsAt` 昇順（同時刻は CSV の行順）に並べる。CSV の行順が時間順でなくても並べ替える
- 時間帯が重なる Session があるとき、`startsAt` が遅い方を除外して warn。隣接（前の `endsAt` == 次の `startsAt`）は重なりではない
- Session 間の空き時間は許容する（埋めない）
- コミュニティは Session ごとに独立した値として埋め込む。同じコミュニティが複数の Session に出れば、その回数だけ本文に現れる
- `version` の計算: `{ event, sessions }` を **キーをソートした JSON**（`JSON.stringify` に replacer を渡すか、安定化関数を通す）にシリアライズし、SHA-256（`crypto.subtle.digest`）の16進先頭12桁。`updatedAt` は含めない。同じシート内容なら常に同じ `version` になること
- 逆は成り立たない。コミュニティシートを編集しても、そのコミュニティがどの Session からも参照されていなければ `version` は変わらない。レスポンス本文が変わっていないので正しい挙動だが、「シートを直したのに `version` が動かない」ことは起こりうる
- `updatedAt` はレスポンス生成時刻。`+09:00` 表記で秒まで

### 6-3. 期待値

`fixtures/timetable.csv` と `fixtures/communities.csv` を入力にしたとき、`version` と `updatedAt` を除いて `fixtures/sample-response.json` と一致すること。

フィクスチャは実装より先に用意する。少なくとも次を含めること。

- 解決できる ID、解決できない ID、どの Session からも参照されない台帳エントリ
- 同一 Session 内での ID の重複
- 複数の Session から参照される同じコミュニティ

## 7. キャッシュとフォールバック

処理順:

1. 2枚のシートを取得してパースし、コミュニティを連結して `Timetable` を組み立てる
2. 成功したら KV `LAST_GOOD` に `{ body: string, version: string, fetchedAt: string }` を書く（`expirationTtl` なし。書き込み失敗はログに出して無視）
3. 失敗（上流失敗、または CSV 不正）したら KV から最後の成功分を読み、それを返す。`X-Timetable-Stale: true` を付け、`Cache-Control` は `public, max-age=0, s-maxage=10` に短縮する
4. KV にも無ければ `502` と `{"error":"upstream_unavailable"}`

- エッジキャッシュは `fetch` の `cf.cacheTtl` で Google への到達を絞る。Worker 自身のレスポンスは `Cache-Control` の `s-maxage` に任せ、Cache API を別途使わない
- KV への書き込みは `ctx.waitUntil` で行い、レスポンスを待たせない
- KV に保持するのは組み立て済みのレスポンス本文1件のみ（キーは1つ）。生の CSV は保持しない。フォールバックは保存済み本文をそのまま返すだけで、再パースも再連結もしない

**ID 参照にしたことの代償**: 上流の単一障害点が2つになる。コミュニティシートだけが落ちてもタイムテーブルが stale になり、コミュニティ名がタイムテーブルシートに無いため「コミュニティ欄だけ空で他は最新」という縮退はできない。KV のフォールバックがあるので許容するが、これは ID 参照を選んだことの直接の代償である。

## 8. ログと観測

- 上流失敗、CSV 不正、行の除外、KV 失敗は `console.warn` / `console.error`。正常系はログを出さない
- レスポンスに内部エラーの詳細（スタック、URL）を含めない

## 9. テスト

vitest（workers pool）で以下を最低限カバーする。上流はテスト内で `fetch` をモックする。

- **ゴールデン**: `fixtures/timetable.csv` + `fixtures/communities.csv` → `fixtures/sample-response.json` と一致（`version` `updatedAt` を除く）
- **CSV パース**: BOM 付き、CRLF、引用符内の改行とカンマ、`""` エスケープ、列順の入れ替え、余計な列、空行
- **時刻**: `9:05` / `09:05` / `09:05:00` を受理、`25:00` と `abc` を除外、`end <= start` を除外
- **Person**: `名前|https://…` と `名前` の混在、`http://` を null に、空行を捨てる
- **コミュニティ**: ID が解決されて埋め込まれる、未知の ID は落として Session は残す、同一 Session 内の重複 ID はまとまる、参照されない台帳エントリで warn が出ない、`icon` の `http://` は null、コミュニティシートに必須列が無ければ上流失敗
- **整合性**: `id` 重複は後勝ち、重なりは遅い方を除外、隣接は許容、行順が時間順でなくても並ぶ
- **version**: 同じ CSV から2回生成しても同じ、1文字変えると変わる、`updatedAt` の違いで変わらない
- **HTTP**: `If-None-Match` 一致で 304、CORS ヘッダー、OPTIONS が 204、未知パスが 404、eventId 不一致が 404、`POST` が 405
- **フォールバック**: 上流 500 → KV から返して `X-Timetable-Stale: true`、KV も空 → 502、**コミュニティシートだけ 500 でも全体が stale になる**

## 10. 開発・デプロイ

- `pnpm dev` = `wrangler dev`、`pnpm test` = `vitest run`、`pnpm deploy` = `wrangler deploy`
- 型チェックと lint（ESLint + typescript-eslint、Prettier）を `pnpm check` にまとめる
- KV namespace は `wrangler kv namespace create LAST_GOOD` で作り、id を `wrangler.toml` に書く
- 本番 URL は `https://timetable.<subdomain>.workers.dev`。カスタムドメインは後回し

## 11. 範囲外（やらない）

- 管理画面、認証、書き込み系エンドポイント
- 時刻の自動補完・自動採番（シートに全行 `start` / `end` を書く運用）
- 画像のホスティング、リサイズ、存在確認
- 登壇者のプロフィール、登壇者の ID による参照
- コミュニティ単体を返すエンドポイント（`/v1/events/{id}/communities`）。コミュニティ一覧ページやブース情報が必要になった時点で、独立したリソースとして足す。タイムテーブルのレスポンスに台帳全体を同梱することはしない
- 多言語

## 12. 受け入れ条件

- [ ] §9 のテストがすべて通る
- [ ] `wrangler dev` で `fixtures/*.csv` を配信するローカル HTTP サーバーを `SHEET_PUB_BASE` に向けると、`curl` で §6 のレスポンスが得られる
- [ ] `curl -H 'If-None-Match: "<version>"'` で 304
- [ ] `SHEET_PUB_BASE` を存在しない URL に向けても、直前に成功していれば `X-Timetable-Stale: true` 付きで 200
- [ ] レスポンスの `sessions[].communities[]` が `name` と `descriptionMarkdown` まで含んでおり、フロントが別の配列を引かずに描画できる
- [ ] `README.md` にシートの公開手順（ファイル → 共有 → ウェブに公開 → シート選択 → CSV）、2枚のシートの列の書き方、`gid` の調べ方、`wrangler.toml` の変更点、デプロイ手順が書かれている
