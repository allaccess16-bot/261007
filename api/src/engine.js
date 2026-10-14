// 정비사업 담보물 조회 엔진
// 아티팩트(정비사업 담보물 조회)의 주소 파싱·매칭·판정 로직을 그대로 옮긴 모듈. DOM 의존 없음.
"use strict";

const path = require("path");
const fs = require("fs");

const STAGES = [
  ["ZONE", "구역지정"], ["COMM", "추진위"], ["UNION", "조합설립"], ["REVIEW", "건축심의"],
  ["PERMIT", "사업시행인가"], ["MGMT", "관리처분인가"], ["CONST", "착공"],
];
const IDX = Object.fromEntries(STAGES.map((s, i) => [s[0], i]));
const LABEL = Object.fromEntries(STAGES);

const MODES = ["new", "exec"];
const REGIONS = ["all", "서울", "경기", "etc"];
const KINDS = {
  new: [["stop", "신규 취급불가", "관리처분·착공"], ["warn", "변경·전환 대상", "조합설립 ~ 사업시행"], ["check", "신청 여부 확인", "추진위"], ["ok", "모니터링", "구역지정"]],
  exec: [["warn", "변경·전환 대상", "조합설립 이후 전 단계"], ["check", "신청 여부 확인", "추진위"], ["ok", "정기 모니터링", "구역지정"], ["na", "기준 해당 없음", "주거환경개선"]],
};
const RULES = [
  { rule: "신규 취급불가", when: "재개발·재건축 관리처분인가 ~ 준공 후 등기 전 / 리모델링 조합설립인가신청 이후" },
  { rule: "담보물 변경 또는 신탁→근저당 전환", when: "재개발·재건축·리모델링 조합설립인가신청 이후" },
  { rule: "원 담보물 복귀 또는 근저당→신탁 전환", when: "소유권이전등기 완료 후" },
];
const NOTES = [
  "자료에는 조합설립인가 신청일이 없습니다. 추진위 단계는 신청 여부를 구청에 확인해야 합니다.",
  "국토부 자료의 '사업시행자지정'은 조합설립인가와 같은 단계로 봅니다.",
  "리모델링과 등기 완료 여부는 두 자료에 없어 판정하지 않습니다.",
  "서울 자료는 구역별 대표 지번 1개만 담고 있어 같은 구역 안의 다른 지번은 '같은 동' 후보로만 표시됩니다.",
  "공공데이터는 작성 시점 기준의 참고자료입니다. 최종 판정 전 구청·시청 고시와 토지이용계획을 확인하세요.",
];

// 주소 파싱: "수송동146-12", "인현동1가31", "신월7동941번지일대"
const JIBUN_RE = /([가-힣0-9]+?(?:동\d+가|로\d+가|동|가|리))\s*(?:산\s*)?(\d+)(?:\s*-\s*(\d+))?/;
function normDong(d) { return d.replace(/(\D)\d+동$/, "$1동"); }
function parseJibun(s) {
  const str = (s || "").replace(/\s+/g, "");
  const m = str.match(JIBUN_RE);
  if (!m) {
    // "서소문58-7", "가리봉87-177"처럼 '동'이 빠진 표기
    const f = str.match(/^([가-힣]{2,})(\d+)(?:-(\d+))?/);
    if (!f) return null;
    const dong = /로$/.test(f[1]) ? f[1] : f[1] + "동";
    return { dong, dongRaw: f[1], bun: f[2], ji: f[3] || "" };
  }
  return { dong: normDong(m[1]), dongRaw: m[1], bun: m[2], ji: m[3] || "" };
}
const squash = s => (s || "").replace(/[\s,·()\-]/g, "");

function loadRows(file = path.join(__dirname, "..", "data", "zones.json")) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = [
    ...data.S.map(r => ({ ...r, id: `S-${r.code}`, sido: "서울특별시", region: "서울", isUrban: true })),
    ...data.M.map((r, i) => ({ ...r, id: `M-${i + 1}`, region: r.sido.startsWith("경기") ? "경기" : "etc", isUrban: r.type !== "주거환경개선" })),
  ];
  rows.forEach(r => {
    if (r.src === "S") { r.p = parseJibun(r.jibun); r.roadK = squash(r.road); }
    r.nameK = squash(r.name);
  });
  return { rows, meta: data.meta };
}

function verdict(r, mode) {
  if (!r.isUrban) return { k: "na", t: "기준 해당 없음", why: "주거환경개선사업은 판정 기준 대상이 아닙니다" };
  const i = IDX[r.stage];
  if (mode === "new") {
    if (i >= IDX.MGMT) return { k: "stop", t: "신규 취급불가", why: "관리처분인가 이후 ~ 준공 후 등기 전" };
    if (i >= IDX.UNION) return { k: "warn", t: "근저당 방식 검토", why: "조합설립인가 이후로 신탁 방식 담보제공 대상이 아닙니다" };
    if (i === IDX.COMM) return { k: "check", t: "조합설립 신청 확인", why: "신청 이후면 근저당 방식 검토 대상입니다" };
    return { k: "ok", t: "취급 가능 · 모니터링", why: "정비구역 지정 단계" };
  }
  if (i >= IDX.UNION) return { k: "warn", t: "담보물 변경 · 근저당 전환 대상", why: "조합설립인가 이후 (소유권이전등기 완료 시 원복 가능)" };
  if (i === IDX.COMM) return { k: "check", t: "조합설립 신청 확인", why: "신청 이후면 담보물 변경 또는 근저당 전환 대상입니다" };
  return { k: "ok", t: "정기 모니터링", why: "정비구역 지정 단계" };
}

const SIDO = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)/;
const isSido = t => SIDO.test(t) && (/(시|도)$/.test(t) || t.length <= 4);

// 질의는 행마다 같으므로 한 번만 분해한다
function parseQuery(q) {
  const qs = squash(q);
  const tokens = q.trim().split(/\s+/);
  const areaToks = tokens.filter(t => !isSido(t) && /^[가-힣]{1,6}(구|시|군)$/.test(t));
  const rest = tokens.filter(t => !isSido(t) && !areaToks.includes(t)).join("");
  const p = parseJibun(rest) || (tokens.length === 1 ? parseJibun(qs) : null);
  return { q, qs, areaToks, rest, p };
}

function matchRow(r, pq) {
  if (!pq) return { lv: 0 };
  const { qs, areaToks, rest, p } = pq;
  if (areaToks.length && r.gu) {
    const gu = r.gu;
    if (!areaToks.every(t => gu.includes(t.replace(/(구|시|군)$/, "")))) return null;
  }
  if (areaToks.length && !rest) return { lv: 0, t: "" };
  if (r.src === "S") {
    if (p && r.p && p.dong === r.p.dong) {
      if (p.bun === r.p.bun && p.ji === r.p.ji) return { lv: 4, t: "대표지번 일치" };
      if (p.bun === r.p.bun) return { lv: 3, t: "본번 일치 · 부번 확인" };
      return { lv: 1, t: "같은 동 · 구역 범위 확인", weak: true };
    }
    if (qs.length >= 4 && r.roadK && (r.roadK === qs || (qs.length >= 6 && r.roadK.startsWith(qs)))) return { lv: 4, t: "도로명주소 일치" };
  }
  if (qs.length >= 2 && r.nameK.includes(qs)) return { lv: 2, t: "구역명 일치" };
  if (r.src === "M" && p) {
    const dongBase = p.dong.replace(/(동|가|리)$/, "").replace(/\d+$/, "");
    if (dongBase.length >= 2 && r.nameK.includes(dongBase)) return { lv: 1, t: "구역명에 동 이름 포함 · 위치 확인", weak: true };
  }
  // 국토부 자료는 주소가 없어 같은 시·군·구 구역을 후보로 보여줌
  if (r.src === "M" && areaToks.length) return { lv: 0, t: "같은 시·군·구 · 위치 확인 필요", weak: true };
  return null;
}

const SEV = { stop: 0, warn: 1, check: 2, ok: 3, na: 4 };

function toZone(r) {
  const isS = r.src === "S";
  return {
    id: r.id,
    source: isS ? "seoul" : "molit",
    name: r.name,
    sido: r.sido,
    gu: r.gu,
    address: isS ? { jibun: r.jibun, road: r.road || null } : null,
    type: r.type,
    operator: isS ? `${r.pp}·${r.gen}` : r.op,
    supplyHouseholds: r.sup || null,
    stage: {
      code: r.stage,
      label: isS ? LABEL[r.stage] : r.stageLabel,
      order: IDX[r.stage],
      dates: isS ? Object.fromEntries(STAGES.map(([k]) => [k, r.dt[k] || null])) : null,
      moveStart: isS && r.dt.MOVE && r.dt.MOVE !== "-" ? r.dt.MOVE : null,
    },
  };
}

function toVerdict(v) { return { code: v.k, label: v.t, reason: v.why }; }

function search(rows, opts = {}) {
  const q = (opts.q || "").trim();
  const mode = opts.mode || "new";
  const region = opts.region || "all";
  const gu = opts.gu || "";
  const kinds = KINDS[mode];
  const kind = opts.kind && kinds.some(k => k[0] === opts.kind) ? opts.kind : "";
  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;

  const pq = q ? parseQuery(q) : null;
  const all = [];
  for (const r of rows) {
    if (region !== "all" && r.region !== region) continue;
    if (gu && r.gu !== gu) continue;
    const m = matchRow(r, pq);
    if (!m) continue;
    all.push({ r, m, v: verdict(r, mode) });
  }
  const summary = Object.fromEntries(kinds.map(([k, t, s]) => [k, { label: t, stages: s, count: 0 }]));
  all.forEach(x => { if (summary[x.v.k]) summary[x.v.k].count++; });

  const list = kind ? all.filter(x => x.v.k === kind) : all;
  list.sort((a, b) => (b.m.lv - a.m.lv) || (SEV[a.v.k] - SEV[b.v.k]) || (IDX[b.r.stage] - IDX[a.r.stage]) || a.r.name.localeCompare(b.r.name, "ko"));

  const items = list.slice(offset, offset + limit).map(({ r, m, v }) => ({
    ...toZone(r),
    match: q ? { level: m.lv, label: m.t || null, weak: !!m.weak } : null,
    verdict: toVerdict(v),
  }));
  // 대표지번·도로명 일치(lv≥3)가 있으면 그 구역을 단일 판정으로 내준다
  const top = list[0];
  const best = q && top && top.m.lv >= 3
    ? { ...toZone(top.r), match: { level: top.m.lv, label: top.m.t, weak: false }, verdict: toVerdict(top.v) }
    : null;

  return {
    query: { q, mode, region, gu: gu || null, kind: kind || null, limit, offset },
    total: list.length,
    strongMatches: q ? list.filter(x => !x.m.weak).length : null,
    summary,
    best,
    results: items,
  };
}

function listAreas(rows, region = "all") {
  const map = new Map();
  for (const r of rows) {
    if (region !== "all" && r.region !== region) continue;
    const key = `${r.sido}|${r.gu}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map].map(([k, count]) => { const [sido, gu] = k.split("|"); return { sido, gu, count }; })
    .sort((a, b) => a.sido.localeCompare(b.sido, "ko") || a.gu.localeCompare(b.gu, "ko"));
}

module.exports = { STAGES, MODES, REGIONS, KINDS, RULES, NOTES, parseJibun, loadRows, verdict, search, listAreas, toZone, toVerdict };
