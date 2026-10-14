// 정비사업 담보물 조회 REST API (의존성 없음, Node 18+)
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const engine = require("./engine");

const { rows, meta } = engine.loadRows();
const byId = new Map(rows.map(r => [r.id, r]));
const openapi = fs.readFileSync(path.join(__dirname, "..", "openapi.json"), "utf8");
const API_KEY = process.env.API_KEY || "";
const MAX_LIMIT = 200;

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

function intParam(v, name, def, min, max) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, "INVALID_PARAM", `${name}은(는) ${min}~${max} 사이 정수여야 합니다`);
  return n;
}

function lookupOpts(p) {
  const mode = p.mode || "new";
  if (!engine.MODES.includes(mode)) throw new HttpError(400, "INVALID_PARAM", "mode는 new 또는 exec 입니다");
  const region = p.region || "all";
  if (!engine.REGIONS.includes(region)) throw new HttpError(400, "INVALID_PARAM", "region은 all, 서울, 경기, etc 중 하나입니다");
  return {
    q: String(p.q ?? p.address ?? "").slice(0, 200),
    mode, region,
    gu: p.gu ? String(p.gu) : "",
    kind: p.kind ? String(p.kind) : "",
    limit: intParam(p.limit, "limit", 40, 1, MAX_LIMIT),
    offset: intParam(p.offset, "offset", 0, 0, 1e6),
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 1e6) { reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new HttpError(400, "INVALID_JSON", "JSON 본문을 해석할 수 없습니다")); } });
    req.on("error", reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = Object.fromEntries(url.searchParams);
  const route = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") return send(res, 204, "");
  if (route === "/health") return send(res, 200, { status: "ok", zones: rows.length });
  if (route === "/openapi.json") return send(res, 200, openapi);
  if (API_KEY && req.headers["x-api-key"] !== API_KEY) throw new HttpError(401, "UNAUTHORIZED", "X-API-Key 헤더가 필요합니다");

  if (req.method === "GET" && route === "/api/v1/lookup") {
    return send(res, 200, engine.search(rows, lookupOpts(p)));
  }
  // 일괄 조회: 담보물 여러 건을 한 번에 판정 (기본은 best 1건만)
  if (req.method === "POST" && route === "/api/v1/lookup/batch") {
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length || items.length > 500) throw new HttpError(400, "INVALID_PARAM", "items는 1~500건 배열이어야 합니다");
    const mode = body.mode || "new";
    const candidates = intParam(body.candidates, "candidates", 3, 0, 20);
    const results = items.map((it, i) => {
      const item = typeof it === "string" ? { address: it } : (it || {});
      const r = engine.search(rows, lookupOpts({ ...item, mode: item.mode || mode, limit: Math.max(candidates, 1) }));
      return { index: i, id: item.id ?? null, address: r.query.q, best: r.best, total: r.total, candidates: candidates ? r.results : [] };
    });
    return send(res, 200, { mode, count: results.length, results });
  }
  if (req.method === "GET" && route.startsWith("/api/v1/zones/")) {
    const id = decodeURIComponent(route.slice("/api/v1/zones/".length));
    const r = byId.get(id);
    if (!r) throw new HttpError(404, "NOT_FOUND", `구역 ${id}을(를) 찾을 수 없습니다`);
    const mode = p.mode || "new";
    if (!engine.MODES.includes(mode)) throw new HttpError(400, "INVALID_PARAM", "mode는 new 또는 exec 입니다");
    return send(res, 200, { ...engine.toZone(r), verdict: engine.toVerdict(engine.verdict(r, mode)) });
  }
  if (req.method === "GET" && route === "/api/v1/areas") {
    const region = p.region || "all";
    if (!engine.REGIONS.includes(region)) throw new HttpError(400, "INVALID_PARAM", "region은 all, 서울, 경기, etc 중 하나입니다");
    return send(res, 200, { region, areas: engine.listAreas(rows, region) });
  }
  if (req.method === "GET" && route === "/api/v1/meta") {
    return send(res, 200, {
      sources: meta.sources, counts: meta.counts,
      stages: engine.STAGES.map(([code, label], order) => ({ code, label, order })),
      verdicts: engine.KINDS, rules: engine.RULES, notes: engine.NOTES,
    });
  }
  throw new HttpError(404, "NOT_FOUND", "없는 경로입니다. /openapi.json 을 참고하세요");
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(err => {
      if (err instanceof HttpError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      console.error(err);
      send(res, 500, { error: { code: "INTERNAL", message: "서버 오류" } });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => console.log(`정비사업 담보물 조회 API — http://localhost:${port} (구역 ${rows.length}개)`));
}

module.exports = { createServer };
