// dist/ はコミットする成果物なので、src/schema.ts との乖離を検出する。
// git の追跡状態に依存させたくないので、一時ディレクトリへ生成し直して突き合わせる。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "dist/schema.d.ts";
const work = mkdtempSync(join(tmpdir(), "techmujin-types-"));

try {
  execFileSync(
    "node",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.schema.json", "--outDir", work],
    { stdio: "inherit" },
  );
  const fresh = readFileSync(join(work, "schema.d.ts"), "utf8");
  const committed = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return null;
    }
  })();

  if (committed === null) {
    console.error(`${OUT} がありません。pnpm run build:types を実行してください。`);
    process.exit(1);
  }
  if (committed !== fresh) {
    console.error(
      `${OUT} が src/schema.ts と一致しません。pnpm run build:types を実行してください。`,
    );
    process.exit(1);
  }
  console.log(`${OUT} は src/schema.ts と一致しています。`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
