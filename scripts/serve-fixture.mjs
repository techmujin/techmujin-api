// fixtures/timetable.csv をローカル HTTP で配信する。
// `wrangler dev` の SHEET_PUB_BASE をこのサーバーに向けて動作確認するためのもの。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8788);
// wrangler.toml の gid と対応させる。Worker は ?gid=<gid>&single=true&output=csv を組み立てる
const FIXTURE_BY_GID = {
  0: "timetable.csv",
  1223957092: "communities.csv",
};

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
    const name = FIXTURE_BY_GID[url.searchParams.get("gid")];
    if (url.pathname !== "/pub" || !name) {
      response.writeHead(404).end("not found");
      return;
    }
    try {
      const csv = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
      response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" }).end(csv);
    } catch (error) {
      console.error(error);
      response.writeHead(500).end("failed to read fixture");
    }
  })();
});

server.listen(PORT, () => {
  console.log(`fixture sheets: http://127.0.0.1:${PORT}/pub?gid=<gid>&single=true&output=csv`);
  for (const [gid, name] of Object.entries(FIXTURE_BY_GID)) console.log(`  gid=${gid} -> ${name}`);
});
