"use strict";
const test = require("node:test");
const assert = require("node:assert");
const engine = require("../src/engine");
const { createServer } = require("../src/server");

const { rows } = engine.loadRows();

test("주소 파싱", () => {
  assert.deepStrictEqual(engine.parseJibun("신영동 158-2"), { dong: "신영동", dongRaw: "신영동", bun: "158", ji: "2" });
  assert.strictEqual(engine.parseJibun("인현동1가31").dong, "인현동1가");
  assert.strictEqual(engine.parseJibun("신월7동941번지일대").dong, "신월동");
});

test("대표지번 일치 → best로 단일 판정", () => {
  const r = engine.search(rows, { q: "서울 종로구 신영동 158-2" });
  assert.strictEqual(r.best.id, "S-1441");
  assert.strictEqual(r.best.match.level, 4);
  assert.strictEqual(r.best.stage.code, "CONST");
  assert.strictEqual(r.best.verdict.code, "stop");
});

test("업무 구분에 따라 판정이 바뀜", () => {
  const r = engine.search(rows, { q: "신영동 158-2", mode: "exec" });
  assert.strictEqual(r.best.verdict.code, "warn");
});

test("도로명주소 일치", () => {
  const r = engine.search(rows, { q: "세검정로6길62-2" });
  assert.strictEqual(r.best.id, "S-1441");
});

test("구역명 검색은 best 없이 후보만", () => {
  const r = engine.search(rows, { q: "미아" });
  assert.strictEqual(r.best, null);
  assert.ok(r.total > 0);
  assert.ok(r.results.every(x => x.match.level === 2));
});

test("질의 없이 전체 + kind 필터", () => {
  const all = engine.search(rows, {});
  assert.strictEqual(all.total, rows.length);
  const stop = engine.search(rows, { kind: "stop", limit: 5 });
  assert.strictEqual(stop.total, all.summary.stop.count);
  assert.ok(stop.results.every(x => x.verdict.code === "stop"));
});

test("주거환경개선은 판정 대상 아님", () => {
  const r = rows.find(x => x.type === "주거환경개선");
  assert.ok(r);
  assert.strictEqual(engine.verdict(r, "new").k, "na");
});

test("HTTP 엔드포인트", async t => {
  const server = createServer().listen(0);
  t.after(() => server.close());
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/v1/lookup?q=${encodeURIComponent("종로구 신영동 158-2")}&mode=exec`);
  assert.strictEqual(res.status, 200);
  let body = await res.json();
  assert.strictEqual(body.best.verdict.code, "warn");

  res = await fetch(`${base}/api/v1/lookup?mode=bad`);
  assert.strictEqual(res.status, 400);

  res = await fetch(`${base}/api/v1/zones/S-1441`);
  body = await res.json();
  assert.strictEqual(body.name, "신영1");

  res = await fetch(`${base}/api/v1/zones/S-0`);
  assert.strictEqual(res.status, 404);

  res = await fetch(`${base}/api/v1/lookup/batch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "new", items: [{ id: "HP-1", address: "신영동 158-2" }, "없는동 999"] }),
  });
  body = await res.json();
  assert.strictEqual(body.count, 2);
  assert.strictEqual(body.results[0].id, "HP-1");
  assert.strictEqual(body.results[0].best.verdict.code, "stop");
  assert.strictEqual(body.results[1].best, null);

  res = await fetch(`${base}/api/v1/areas?region=서울`);
  body = await res.json();
  assert.ok(body.areas.some(a => a.gu === "종로구"));

  res = await fetch(`${base}/openapi.json`);
  assert.strictEqual((await res.json()).openapi, "3.0.3");
});
