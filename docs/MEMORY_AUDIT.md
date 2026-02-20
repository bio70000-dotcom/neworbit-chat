# 메모리 사용량 점검 및 절감 가이드

실제 사용량은 서버에서 `docker stats`로 확인하는 것이 정확합니다. 아래는 서비스별 용도·예상 메모리·줄일 수 있는지 정리한 점검표입니다.

**적용된 변경**
- **MongoDB**: `mongo:latest` → `mongo:7-alpine` (이미지·런타임 경량화)
- **모니터링 스택**: Grafana, Prometheus, node-exporter, cadvisor, nginx-exporter, daily-report는 `profiles: [monitoring]`로 분리. 기본 `docker-compose up -d` 시 기동 안 함. 필요 시 `docker-compose --profile monitoring up -d`로 별도 기동 가능.

---

## 1. 서버에서 메모리 점검 명령어

Lightsail SSH 접속 후 프로젝트 루트에서 실행:

```bash
cd /home/ubuntu/chat-app

# 컨테이너별 실시간 메모리 (MB 기준, 5초마다 갱신)
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# 한 번만 출력 (숫자만 보기 좋게)
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}" | column -t
```

**출력 예시 해석**
- `MEM USAGE`: 해당 컨테이너가 쓰는 메모리 (예: 150MiB / 2GiB)
- `MEM %`: 호스트 전체 대비 비율

---

## 2. 서비스별 용도 및 메모리 (점검표)

| 서비스 | 용도 | 예상 메모리(대략) | 줄일 수 있음? |
|--------|------|-------------------|----------------|
| **mongo** | 채팅·블로그 DB | 200~500MB+ | 예 — Alpine 이미지로 교체 |
| **chat-app** | 채팅 앱 (Node) | 100~300MB | 예 — NODE_OPTIONS 힙 상한 |
| **grafana** | 대시보드·그래프 | 150~300MB | 예 — mem_limit 또는 필요 시만 기동 |
| **ghost** | 블로그 CMS | 100~200MB | 이미 alpine, 추가로 mem_limit |
| **prometheus** | 메트릭 수집·저장(30일) | 100~250MB | 예 — mem_limit |
| **cadvisor** | 컨테이너/호스트 메트릭 | 80~150MB | 예 — 중지 또는 mem_limit |
| **blog-scheduler** | 블로그 일일 스케줄·발행 | 50~150MB | 예 — mem_limit |
| **nginx** | 리버스 프록시 | 10~30MB | 낮음 |
| **redis** | 세션·캐시·블로그 dedup | 10~50MB | 이미 alpine |
| **log-viewer** | 로그 조회 UI | 30~80MB | 예 — mem_limit |
| **node-exporter** | 호스트 메트릭 | 20~40MB | 낮음 |
| **nginx-exporter** | nginx 메트릭 | 10~20MB | 낮음 |
| **daily-report** | 일일 리포트 cron | 10~30MB | 낮음 |
| **mailpit** | 메일 테스트 수신 | 20~50MB | 낮음 |

---

## 3. 줄일 수 있는 항목 (우선순위)

### 3.1 효과 큼 — MongoDB Alpine

- **현재**: `mongo:latest` (이미지·런타임 모두 무거움)
- **변경**: `mongo:7-alpine` 또는 `mongo:6-alpine`
- **방법**: `docker-compose.yml`에서 `image: mongo:latest` → `image: mongo:7-alpine` 후 재기동

### 3.2 효과 중간 — mem_limit 부여

한 컨테이너가 폭증하지 않도록 상한만 둠. 아래는 예시 값(서버 메모리에 맞게 조정).

| 서비스 | mem_limit 예시 | 비고 |
|--------|----------------|------|
| mongo | 512m | DB만 사용 시 |
| chat-app | 384m | 채팅 트래픽에 따라 조정 |
| grafana | 256m | 대시보드만 |
| prometheus | 256m | 30일 보관 유지 |
| cadvisor | 128m | 초과 시 재시작 가능 |
| ghost | 256m | |
| blog-scheduler | 256m | |
| log-viewer | 128m | |

### 3.3 선택 — 모니터링 축소

- **cadvisor**: 컨테이너 메트릭만 필요할 때 사용. 안 쓰면 `docker-compose`에서 해당 서비스 주석 처리 또는 프로파일로 빼고 필요할 때만 `up`.
- **grafana**: “가끔 확인할 때만” 쓰면 상시 up 대신 필요할 때만 `docker-compose up -d grafana` 후 사용 후 `stop` 가능.

### 3.4 선택 — Node 앱 힙 상한

- **chat-app**: 메모리 폭증 방지용으로 `NODE_OPTIONS=--max-old-space-size=256` (또는 384) 설정 가능.
- **docker-compose**의 `app` 서비스 `environment`에 추가.

---

## 4. 적용 순서 제안

1. **서버에서 현재 사용량 확인**  
   `docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"` 실행 후 위 표와 비교.
2. **MongoDB Alpine 전환**  
   `docker-compose.yml`에서 mongo 이미지만 `mongo:7-alpine`으로 변경 → `docker-compose up -d mongo` (필요 시 `docker-compose build` 없이 재기동).
3. **mem_limit 추가**  
   무거운 서비스(mongo, chat-app, grafana, prometheus, cadvisor, ghost, blog-scheduler, log-viewer)에 `mem_limit: 256m` 등 추가 후 `docker-compose up -d`로 재기동.
4. **재점검**  
   다시 `docker stats`로 확인해 총 사용량·비율이 줄었는지 확인.

---

## 5. docker-compose에 넣을 예시 (mem_limit + mongo alpine)

아래는 참고용 스니펫입니다. 기존 `services` 안 해당 서비스에만 추가하면 됩니다.

```yaml
# mongo — 이미지 경량화
  mongo:
    image: mongo:7-alpine   # 기존: mongo:latest
    container_name: mongo
    restart: always
    mem_limit: 512m
    volumes:
      - mongo-data:/data/db

# app — Node 힙 상한(선택)
  app:
    environment:
      - NODE_OPTIONS=--max-old-space-size=384
      # ... 기존 환경변수
    mem_limit: 384m

# 모니터링
  prometheus:
    mem_limit: 256m
  grafana:
    mem_limit: 256m
  cadvisor:
    mem_limit: 128m
```

이렇게 적용한 뒤 서버에서 `docker stats`로 “어디서 얼만큼 쓰는지” 다시 확인하면 됩니다.
