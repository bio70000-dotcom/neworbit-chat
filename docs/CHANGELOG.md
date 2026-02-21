# 개발사항 정리 (Changelog)

Neworbit Chat + 자동 블로그 스택의 주요 개발·변경 사항 요약. 상세는 각 항목 링크 참고.

---

## 2026-02-21

- **스케줄러**: topicSelector `plan` 중복 선언 제거(SyntaxError 수정), formatDailyReport·보고 전송 방어/예외 처리.
- **MongoDB**: FCV 8.2 데이터 호환을 위해 이미지 `mongo:7` → `mongo:8`. [SERVER_COMMANDS.md](SERVER_COMMANDS.md)에 MongoDB 이미지 갱신 절차 및 `docker-compose`(하이푈) 안내 추가.
- **AI 주제 선정**: JSON 파싱·raw 배열 우선 추출 강화, maxOutputTokens 8192, 실패 로그 보강. ([2026-02-21.md](2026-02-21.md))
- **본문 이미지**: docker-compose에 `UNSPLASH_ACCESS_KEY` 전달 추가 → Unsplash 우선, 부족분 Pexels 동작.

---

## 인프라·운영

### 메모리 절감 (Lightsail 2GB → 1GB 대비)

- **MongoDB**: `mongo:latest` → `mongo:7` (버전 고정). 공식 이미지에 `mongo:7-alpine` 없음.
- **모니터링 스택**: Grafana, Prometheus, node-exporter, cadvisor, nginx-exporter, daily-report를 `profiles: [monitoring]`으로 분리. 기본 `docker-compose up -d` 시 기동하지 않음. 필요 시 `docker-compose --profile monitoring up -d`.
- **문서**: [MEMORY_AUDIT.md](MEMORY_AUDIT.md) (메모리 점검·절감), [SERVER_COMMANDS.md](SERVER_COMMANDS.md) (서버 명령어·배포).

---

## 블로그·스케줄러

### MongoDB 연동

- 블로그용 DB 연결 및 `published_posts` 등 헬퍼.
- 스케줄러 승인 직후 확정 주제 DB 저장.
- TopicSelector: DB에 이미 사용한 키워드 제외 후 주제 선정.
- Agent 발행 후 DB 업데이트 (excerpt 등).
- 관련글 AI 추천 + 본문 하단 링크.

### 주제 선정·보고

- AI 토픽 선정 (Gemini), 선정 이유 텔레그램 보고.
- 주제 소스 균형: 시즌 2 / 네이버 2 / 트렌드 2.
- 검색량 지표(네이버) 반영, 주제 재선정(2,5 다시 / 전체 다시) 지원.
- JSON 모드 + raw 응답 로그로 파싱 안정화.

### 파이프라인·운영

- 작가 말투 고정, 소제목(h2) 텔레그램 전송.
- 초안 1편씩 순차 생성 + 편당 대기·완료 알림.
- 1~6번 고정 순서: 소제목 보고 → 사진 수집 → 스케줄 생성.
- 텔레그램 명령: 승인/취소/시작/재선정 ([TELEGRAM_COMMANDS.md](TELEGRAM_COMMANDS.md)).

**상세**: [BLOG_DEVELOPMENT_MEMO.md](BLOG_DEVELOPMENT_MEMO.md), [BLOG_STRUCTURE.md](BLOG_STRUCTURE.md), [2026-02-12.md](2026-02-12.md) 등.
