import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the Xianjian product and deployable worker", async () => {
  const [page, layout, client] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/xianjian-app.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../dist/.openai/hosting.json", import.meta.url)),
  ]);
  assert.match(page, /XianjianApp/);
  assert.match(layout, /先鉴｜先判断值不值得看/);
  assert.match(client, /InfiniSynapse Agent/);
  assert.match(client, /学习库/);
  assert.match(client, /时间码笔记/);
  assert.doesNotMatch(`${page}${layout}${client}`, /codex-preview|SkeletonPreview|Starter Project/);
});
