// Vite の ?raw インポートでフィクスチャを文字列として読み込む
// （Workers ランタイム上では fs が使えないため）
declare module "*?raw" {
  const content: string;
  export default content;
}
