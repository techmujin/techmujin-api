/**
 * `GET /v1/events/{eventId}/timetable` が返す JSON の型。
 *
 * このファイルは API の公開契約であり、フロントエンドや任意のアプリ実装者が
 * そのまま参照できるよう、ランタイムコードも外部依存も持たない。
 * バックエンド内部の型（`Env` など）は `types.ts` に置き、ここには入れないこと。
 */
/** 進行の種別。`break` は休憩・転換、`free` は回遊タイムなどステージ休止中の枠。 */
export type SessionKind = "session" | "break" | "free";
/**
 * 進行の内容による分類。`kind` が「枠の性質」を表すのに対し、こちらは「何をする枠か」を表す。
 * シートに書かれていない、または未知の値のときは null。
 */
export type SessionType = "opening" | "talk" | "lt" | "sponsor" | "closing" | null;
/**
 * トラックの識別子。表示名ではなく機械可読な ID で、`group` の表示文字列とは独立している。
 * 全体進行やトラックを持たない枠、未知の値のときは null。
 */
export type TrackId = "track-a" | "track-b" | null;
/** 登壇者。Session 固有なので ID を持たず、同じ人物が複数の Session に出ても名寄せしない。 */
export type Person = {
    name: string;
    /** `https://` の URL のみ。画像の実在は検証していない */
    iconUrl: string | null;
};
/**
 * コミュニティ。スプレッドシート上は ID 参照だが、レスポンスには内容が展開済みで入る。
 * フロントエンドで別の配列と突き合わせる必要はない。
 */
export type Community = {
    /** コミュニティシート上の ID。`^[a-z0-9][a-z0-9-]*$` */
    id: string;
    name: string;
    /** connpass などの公式サイト。`https://` と `http://` を許容 */
    url: string | null;
    /** `https://` の URL のみ */
    iconUrl: string | null;
    descriptionMarkdown: string | null;
};
export type Link = {
    /** ラベルが指定されていない場合は URL がそのまま入る */
    label: string;
    url: string;
};
export type Session = {
    id: string;
    kind: SessionKind;
    /** `kind` をさらに細分する内容の分類。未設定・未知の値なら null */
    type: SessionType;
    /** トラック名など、画面に出す表示用の文字列。未設定なら null */
    group: string | null;
    /** 機械可読なトラック ID。振り分けや絞り込みにはこちらを使う。未設定・未知の値なら null */
    trackId: TrackId;
    title: string;
    /** ISO 8601（+09:00 固定）。例: `2026-11-22T10:15:00+09:00` */
    startsAt: string;
    /** ISO 8601（+09:00 固定）。`startsAt` より必ず後 */
    endsAt: string;
    /** 同じコミュニティが複数の Session に出れば、その回数だけ現れる */
    communities: Community[];
    speakers: Person[];
    descriptionMarkdown: string | null;
    /** 「中止になりました」などの一言 */
    message: string | null;
    isCancelled: boolean;
    links: Link[];
};
export type Event = {
    id: string;
    title: string;
    /** `YYYY-MM-DD` */
    date: string;
    /** 常に `"Asia/Tokyo"` */
    timezone: string;
    venue: string | null;
    url: string | null;
};
export type Timetable = {
    /**
     * 破壊的変更で上がる。この型定義パッケージのメジャーバージョンと対応させること。
     * レスポンスの `schemaVersion` が型と食い違うときは、型パッケージが古い。
     */
    schemaVersion: 1;
    /**
     * `event` と `sessions` から計算した内容ハッシュ。レスポンスの `ETag` と同じ値。
     * 内容が変わらなければ変わらない（`updatedAt` の違いでは変わらない）。
     */
    version: string;
    /** レスポンスを生成した時刻。ISO 8601、+09:00 */
    updatedAt: string;
    event: Event;
    /** `startsAt` 昇順。時間帯の重なりは無い */
    sessions: Session[];
};
