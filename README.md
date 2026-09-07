# techmujin-api

テック無尽 2026 のタイムテーブル配信 API。Google スプレッドシートを編集元とし、Cloudflare Workers が検証・整形した JSON を配信する。

同じスプレッドシート内の2枚のシート（タイムテーブル / コミュニティ）を読む。タイムテーブルはコミュニティを **ID で参照**し、Worker 側で連結してから返すので、**フロントで結合処理をする必要はない**。

仕様: [`doc/timetable/SPEC.md`](doc/timetable/SPEC.md)

## エンドポイント

| メソッド  | パス                             | 説明                                                                |
| --------- | -------------------------------- | ------------------------------------------------------------------- |
| `GET`     | `/v1/events/{eventId}/timetable` | タイムテーブル JSON。`eventId` が `EVENT_ID` と一致しないときは 404 |
| `OPTIONS` | `/v1/events/{eventId}/timetable` | CORS プリフライト。204                                              |
| `GET`     | `/healthz`                       | 死活確認。`{"ok":true}`                                             |

- 認証なし・公開情報のみ。`Access-Control-Allow-Origin: *`
- `ETag` は本文の `version` と同じ値。`If-None-Match` が一致すれば 304
- 上流が落ちている間は KV に保存した最後の成功分を `X-Timetable-Stale: true` 付きで返す

レスポンスの形は [`fixtures/sample-response.json`](fixtures/sample-response.json) が実例になっている。

## 型定義を使う（フロントエンド・その他のクライアント）

レスポンスの型をこのリポジトリから直接インストールできる。ランタイムコードは含まれない型定義だけのパッケージなので、依存は増えない。

```sh
pnpm add -D github:techmujin/techmujin-api
```

```ts
import type { Community, Session, Timetable } from "techmujin-api";

const response = await fetch(
  "https://timetable.<subdomain>.workers.dev/v1/events/techmujin-2026/timetable",
);
const timetable = (await response.json()) as Timetable;

// communities は連結済み。別の配列を引く必要はない
const names: string[] = timetable.sessions.flatMap((s: Session) =>
  s.communities.map((c: Community) => c.name),
);
```

公開される型は [`src/schema.ts`](src/schema.ts) に定義されている（`SessionKind` / `Person` / `Community` / `Link` / `Session` / `Event` / `Timetable`）。`Env` などバックエンド内部の型は含まれない。

値としての import はできない（型しか無い）。必ず `import type` を使うこと。

### バージョンの固定

特定の時点に固定したいときはコミットやタグを指定する。

```sh
pnpm add -D github:techmujin/techmujin-api#v1.0.0
```

> **`schemaVersion` との対応**: `Timetable.schemaVersion` はリテラル型 `1` で、破壊的変更のときだけ上がる。型定義を古いまま固定していると、**型は「1 だ」と主張し続けるのに実際のレスポンスは 2**、という食い違いが起きる。`schemaVersion` が 1 のうちは型定義も `1.x` に留める運用にすること。実行時に確認したい場合は `timetable.schemaVersion === 1` を検査する。

## セットアップ

```sh
pnpm install
```

## スプレッドシートを公開する

1. 対象のスプレッドシートを開く
2. **ファイル → 共有 → ウェブに公開**
3. 「リンク」タブで **ドキュメント全体** を選び、形式に **カンマ区切り形式 (.csv)** を選ぶ
4. **公開** を押し、表示された URL の `?` より前をコピーする
   - `https://docs.google.com/spreadsheets/d/e/<pubid>/pub` の形になる
5. それを `wrangler.toml` の `SHEET_PUB_BASE` に設定する

シートは `gid` で選ぶ。1冊を公開すれば、同じ `<pubid>` のまま各シートに届く。

### gid の調べ方

スプレッドシートで対象のシートのタブをクリックすると、ブラウザの URL 末尾が `#gid=1223957092` に変わる。その数字が `gid`。`wrangler.toml` の `SHEET_GID_TIMETABLE` / `SHEET_GID_COMMUNITIES` に設定する。

Worker は `<SHEET_PUB_BASE>?gid=<gid>&single=true&output=csv` を組み立てて取得する。`gid` と `single=true` を省略した URL は「公開シートが1枚だけ」という状態に暗黙に依存するので、必ず `gid` を指定すること。

「ウェブに公開」を止めると API は上流失敗として扱い、KV の最後の成功分を返し続ける。**2枚のうち片方でも取得に失敗すると全体が stale になる**（コミュニティ名はタイムテーブルシート側に無いため、片方だけでは組み立てられない）。

## シートの列

どちらのシートも1行目をヘッダーとし、**列は名前で引く**ので順序は自由。知らない列は無視される。

### タイムテーブルシート

| 列            | 必須 | 書き方                                                                         |
| ------------- | ---- | ------------------------------------------------------------------------------ |
| `id`          | ○    | 半角英小文字・数字・ハイフン。先頭はハイフン不可（例: `session-a`）            |
| `kind`        | ○    | `session` / `break` / `free`。大文字小文字は問わない                           |
| `group`       |      | トラック名など。空なら `null`                                                  |
| `title`       | ○    | 空だとその行は配信されない                                                     |
| `start`       | ○    | `9:05` / `09:05` / `09:05:00`。日付は `EVENT_DATE`、タイムゾーンは +09:00 固定 |
| `end`         | ○    | 同上。`end` が `start` 以前だとその行は配信されない                            |
| `communities` |      | セル内改行で1件ずつ、コミュニティシートの `id` を書く                          |
| `speakers`    |      | 「登壇者の書き方」を参照                                                       |
| `description` |      | Markdown。セル内改行をそのまま書ける（先頭の空白は保持される）                 |
| `message`     |      | 「中止になりました」などの一言                                                 |
| `isCancelled` |      | `TRUE` / `true` / `1` / `yes` で true。それ以外は false                        |
| `links`       |      | セル内改行で1件ずつ `ラベル\|URL`。`\|` がなければ URL のみとみなす            |

### コミュニティシート

| 列            | 必須 | 書き方                                                                     |
| ------------- | ---- | -------------------------------------------------------------------------- |
| `id`          | ○    | 半角英小文字・数字・ハイフン。`kofu-rb` のように読んで分かるスラッグにする |
| `name`        | ○    | 表示名。空だとその行は配信されない                                         |
| `url`         |      | 公式サイト。`https://` または `http://` で始まるものだけ採用               |
| `icon`        |      | アイコン画像。**`https://` で始まるものだけ**採用                          |
| `description` |      | Markdown。セル内改行をそのまま書ける                                       |

タイムテーブルシートの `communities` 列にこの `id` を書くと、API が中身を連結して返す。

```
kofu-rb
houtou-pm
```

- 同じセルに同じ `id` を複数回書いても1つにまとめられる
- コミュニティシートに無い `id` はその1件だけ落ち、セッション自体は残る（`wrangler tail` に `unknown_community_id` が出る）
- どのセッションからも参照されないコミュニティがあっても、警告もエラーも出ない

`id` は連番ではなくスラッグにすること。連番は行の挿入で意味がずれるうえ、ログを読んでも何のことか分からない（コードは連番も受け付けてしまうので、運用上の取り決めとして守る）。

### 登壇者の書き方

`speakers` はセル内改行で1人ずつ書く。

```
山田 太郎|https://example.com/icons/yamada.png
鈴木 花子
```

コミュニティと違って登壇者は台帳を持たない。セッション固有で再利用が無いためで、この非対称は意図的なもの。

- `|` の後ろはアイコン画像の URL。**`https://` で始まるものだけ**採用し、それ以外（`http://`、相対パス、Google Drive の共有リンク等）は無視して `null` になる
- `|` がなければ名前のみ
- 名前が空の行は捨てられる
- 画像が実在するかは確認しない

### 行が配信されないとき

`id` が不正、`kind` が未知、`title` が空、時刻が読めない、`end` が `start` 以前、`id` が重複（後の行が勝つ）、前のセッションと時間帯が重なる（開始が遅い方を落とす）——これらの行は**その行だけ**除外され、API はエラーにならない。コミュニティシートも同様に、`id` が不正・`name` が空の行だけが落ちる。除外理由は `wrangler tail` で確認できる。

```sh
pnpm exec wrangler tail --format pretty
```

セル内改行は Google スプレッドシートでは <kbd>Alt</kbd>+<kbd>Enter</kbd>（macOS は <kbd>Option</kbd>+<kbd>Enter</kbd>）で入れる。

## `wrangler.toml` の変更点

デプロイ前に次の2箇所を実際の値に差し替える。

1. `[vars]` の `SHEET_PUB_BASE` と `SHEET_GID_TIMETABLE` / `SHEET_GID_COMMUNITIES`
2. `[[kv_namespaces]]` の `id` — 下のコマンドで作った KV namespace の id

```sh
pnpm exec wrangler kv namespace create LAST_GOOD
```

イベント情報（`EVENT_ID` / `EVENT_TITLE` / `EVENT_DATE` / `EVENT_VENUE` / `EVENT_URL`）も `[vars]` にある。`EVENT_VENUE` と `EVENT_URL` は空文字にすると `null` として配信される。

`[vars]` を変更したら型定義を作り直す。

```sh
pnpm exec wrangler types
```

## ローカルで動かす

```sh
pnpm dev
```

`wrangler.toml` の `SHEET_PUB_BASE`、つまり本物の公開シートを見に行く。

```sh
curl -i http://127.0.0.1:8787/v1/events/techmujin-2026/timetable

# ETag が一致すれば 304
curl -i -H 'If-None-Match: "<version>"' http://127.0.0.1:8787/v1/events/techmujin-2026/timetable
```

### シートを触らずに試す

`fixtures/*.csv` をローカル HTTP で配信し、上流をそちらに向ける。オフラインでの動作確認や、フォールバックの検証に使う。

```sh
cp .dev.vars.example .dev.vars
# .dev.vars の SHEET_PUB_BASE の行のコメントを外す

# ターミナル1
pnpm run serve:fixture

# ターミナル2
pnpm dev
```

ターミナル1 を止めてからもう一度叩くと、KV の最後の成功分が `X-Timetable-Stale: true` 付きで返る。

> `.dev.vars` は `wrangler dev` でのみ読まれ、`wrangler.toml` の `[vars]` を**上書きする**。実シートに戻すときは `.dev.vars` を消すか、`SHEET_PUB_BASE` の行をコメントアウトする。デプロイ先には影響しない。

## テストと静的チェック

```sh
pnpm test    # vitest（@cloudflare/vitest-pool-workers）
pnpm check   # tsc --noEmit + eslint + prettier --check + 型定義の乖離チェック
```

`dist/schema.d.ts` は `src/schema.ts` から生成した成果物だが、**コミットする**。利用側に devDependencies（wrangler や workerd）を入れさせないためで、`pnpm check` が乖離を検出する。`src/schema.ts` を変更したら `pnpm run build:types` を実行すること。

`src/schema.ts` は Cloudflare のランタイム型も DOM 型も参照できない設定（`tsconfig.schema.json`）でビルドされる。バックエンド内部の型が公開契約に紛れ込むと、この時点で失敗する。

`fixtures/timetable.csv` + `fixtures/communities.csv` → `fixtures/sample-response.json` のゴールデンテストが CSV の解釈全体を守っている。仕様を変えるときは、実装より先にこれらのフィクスチャを更新する。

## デプロイ

```sh
pnpm exec wrangler login
pnpm exec wrangler kv namespace create LAST_GOOD   # 初回のみ。id を wrangler.toml に書く
pnpm check && pnpm test
pnpm deploy
```

公開先は `https://timetable.<subdomain>.workers.dev`。カスタムドメインは後回し。

## 反映されるまでの時間

Worker から Google への取得はエッジキャッシュで `CACHE_TTL_SECONDS`（既定60秒）に絞り、Worker 自身のレスポンスは `s-maxage=60` で配信する。

エッジから Google への取得は2割程度の頻度で応答が返らずタイムアウトするため、シートごとに**最大3回まで張り直す**（1回あたり `UPSTREAM_TIMEOUT_MS` = 3秒）。成功時は1秒未満で返るので、大半のリクエストは1回目で終わる。リトライが起きたときは `wrangler tail` に `upstream_retry` が出る。シートを編集してから API に反映されるまで、最大で概ね60秒程度かかる。どちらのシートを編集しても同じ。

ただし `version`（= ETag）は**レスポンス本文から計算する**ので、どのセッションからも参照されていないコミュニティを編集した場合は変わらない。本文が変わっていないので正しい挙動だが、「シートを直したのに `version` が動かない」ことは起こりうる。
