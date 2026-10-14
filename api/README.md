# 정비사업 담보물 조회 API

주택연금 담보물 주소로 재개발·재건축 진행단계와 취급·담보관리 판정을 돌려주는 REST API입니다.
아티팩트 「정비사업 담보물 조회」 화면의 데이터와 판정 로직을 그대로 옮겼습니다.

- 데이터: 서울시 정비사업 추진현황(2026.6월말, 496개 구역) + 국토교통부 전국 도시정비사업 통합(2026.5.18, 922개 구역) → `data/zones.json`
- 의존성 없음 (Node.js 18 이상)

## 실행

```bash
cd api
npm start            # http://localhost:8080
npm test             # 테스트
PORT=3000 API_KEY=비밀값 CORS_ORIGIN=https://내도메인 npm start
```

`API_KEY`를 지정하면 `/health`, `/openapi.json`을 제외한 모든 요청에 `X-API-Key` 헤더가 필요합니다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/v1/lookup?q=주소&mode=new` | 주소·구역명 조회 + 판정 |
| POST | `/api/v1/lookup/batch` | 담보물 최대 500건 일괄 판정 |
| GET | `/api/v1/zones/{id}?mode=exec` | 구역 단건 (`S-1441`, `M-12`) |
| GET | `/api/v1/areas?region=서울` | 구·시군 목록과 구역 수 |
| GET | `/api/v1/meta` | 출처, 단계, 판정 기준, 유의사항 |
| GET | `/openapi.json` | OpenAPI 3 명세 (Swagger UI 등에 바로 사용) |

**파라미터**: `mode`=`new`(신규 신청·심사) / `exec`(실행 완료·연금수령중), `region`=`all`·`서울`·`경기`·`etc`, `gu`, `kind`=`stop`·`warn`·`check`·`ok`·`na`, `limit`(최대 200), `offset`

### 단건 조회

```bash
curl -G localhost:8080/api/v1/lookup --data-urlencode "q=종로구 신영동 158-2"
```

```jsonc
{
  "total": 1, "strongMatches": 1,
  "summary": { "stop": { "label": "신규 취급불가", "count": 1 }, ... },
  "best": {                       // 대표지번·도로명·본번 일치 시에만, 없으면 null
    "id": "S-1441", "name": "신영1", "gu": "종로구",
    "stage": { "code": "CONST", "label": "착공", "dates": { ... } },
    "match": { "level": 4, "label": "대표지번 일치", "weak": false },
    "verdict": { "code": "stop", "label": "신규 취급불가", "reason": "관리처분인가 이후 ~ 준공 후 등기 전" }
  },
  "results": [ ... ]              // 같은 동 후보 등 전체 목록 (일치도 → 심각도 순)
}
```

### 일괄 조회

```bash
curl -X POST localhost:8080/api/v1/lookup/batch -H 'Content-Type: application/json' -d '{
  "mode": "exec", "candidates": 3,
  "items": [ { "id": "HP-0001", "address": "종로구 신영동 158-2" }, "신월동 941" ]
}'
```

건마다 `id`(호출측 계약번호 등), `best`, `total`, `candidates`를 돌려줍니다. 기존 실행 건 전수 점검에 쓰면 됩니다.

## 판정 코드

| code | 신규(new) | 실행 완료(exec) | 기준 단계 |
|---|---|---|---|
| `stop` | 신규 취급불가 | — | 관리처분인가 ~ 착공 |
| `warn` | 근저당 방식 검토 | 담보물 변경 · 근저당 전환 대상 | 조합설립 이후 |
| `check` | 조합설립 신청 확인 | 조합설립 신청 확인 | 추진위 |
| `ok` | 취급 가능 · 모니터링 | 정기 모니터링 | 구역지정 |
| `na` | 기준 해당 없음 | 기준 해당 없음 | 주거환경개선사업 |

`match.level`: 4 대표지번·도로명 일치 / 3 본번 일치(부번 확인) / 2 구역명 일치 / 1 같은 동 후보 / 0 같은 시군구 후보. `weak: true`면 위치 확인이 필요한 후보입니다.

## 유의사항

- 서울 자료는 구역별 **대표 지번 1개**만 있어 같은 구역 안의 다른 지번은 `best` 없이 '같은 동' 후보로만 나옵니다.
- 국토부 자료는 주소가 없어 구역명·시군구로만 후보를 찾습니다.
- 조합설립인가 **신청일**, 리모델링, 등기 완료 여부는 자료에 없어 판정하지 않습니다.
- 공공데이터 기준 참고자료입니다. 최종 판정 전 구청·시청 고시와 토지이용계획을 확인하세요.
- 데이터 갱신은 `data/zones.json`을 같은 형식으로 교체하고 재시작하면 됩니다.
