# SQLite vs MongoDB 검토 + 메모리 절감

## 1. 키워드/발행 기록 저장: SQLite 불필요 → MongoDB 사용

**결론: 서버에 SQLite를 새로 설치할 필요 없음. 이미 떠 있는 MongoDB를 쓰면 됨.**

- **현재**
  - 채팅 앱: `MONGO_URL=mongodb://mongo:27017/chat` 로 MongoDB 사용 (mongoose).
  - 블로그: Redis(dedup) + 로컬 파일만 사용, MongoDB 미사용.
- **키워드 DB 계획** (확정 주제 저장, 연도별 시즌 제외, 관련글 추천)
  - **SQLite**: 블로그용 DB 파일·경로 관리 필요, 호스트에 sqlite3 설치, Node에서는 `better-sqlite3` 등 추가 의존성.
  - **MongoDB**: 이미 `mongo` 컨테이너가 동일 docker 네트워크에 있음. 블로그 스케줄러/에이전트에 `MONGO_URL`만 넘겨서(예: `mongodb://mongo:27017/blog`) 새 DB에 `published_posts` 컬렉션으로 저장하면 됨. mongoose 또는 `mongodb` 드라이버 추가.

**권장**
- 키워드·발행 메타(확정일, 연도, source, ghost_post_id, post_url, title, excerpt)는 **MongoDB `blog` DB**에 저장.
- 블로그 이미지/컨테이너에는 SQLite·better-sqlite3 넣지 않음.
- Lightsail 호스트에는 **SQLite 설치하지 않음**.

---

## 2. 메모리 사용 (~1.13GB) 줄일 수 있는 요소

리포트 기준 Docker 이미지 크기·서비스 구성을 기준으로 정리. 실제 런타임 메모리는 `docker stats`로 확인하는 것이 정확함.

### 2.1 무거운 이미지·서비스

| 서비스 | 이미지 크기 | 비고 |
|--------|-------------|------|
| mongo | 923MB (mongo:latest) | **가장 큰 후보** |
| chat-app | 683MB | Node 앱 |
| grafana | 747MB | 모니터링 |
| ghost | 634MB (alpine) | 이미 경량 |
| prometheus | 367MB | 30d 보관 |
| redis | 94MB (alpine) | 이미 경량 |

### 2.2 줄일 수 있는 것

**A. MongoDB 이미지 경량화 (효과 큼)**  
- `mongo:latest` 대신 **`mongo:7-alpine`** 또는 **`mongo:6-alpine`** 사용.  
- Alpine 이미지는 보통 수백 MB 정도 더 작고, 메모리 사용도 낮은 편.

**B. 컨테이너 메모리 상한**  
- `docker-compose.yml`에 `mem_limit` 설정해 한 컨테이너가 폭증하지 않게 함.  
- 예: prometheus 256MB, grafana 256MB, cadvisor 128MB, mongo 512MB 등 (서비스 중요도에 맞게 조정).

**C. 모니터링 스택 선택**  
- prometheus, grafana, cadvisor, node-exporter, nginx-exporter, daily-report 가 모두 상주.  
- 1.13GB가 부담이면:  
  - **cadvisor**는 컨테이너 메트릭용으로 메모리를 꽤 씀. 필요 없으면 중지하거나 프로파일로 분리.  
  - **grafana**는 “가끔만 볼 때”는 중지해 두고 필요할 때만 올리는 방식 가능.  
  - **daily-report**는 cron 용도라 상주해도 메모리는 작은 편.

**D. Node(chat-app) 메모리**  
- `NODE_OPTIONS=--max-old-space-size=256` 같은 식으로 힙 상한을 두면 예기치 않은 증가를 막을 수 있음 (필요 시 적용).

### 2.3 적용 순서 제안

1. **MongoDB만 Alpine으로 변경**  
   - `docker-compose.yml`의 mongo 이미지를 `mongo:7-alpine`으로 변경 후 재기동.  
   - 호스트에서 SQLite 설치/사용은 하지 않음.
2. **필요 시 `mem_limit` 추가**  
   - prometheus, grafana, cadvisor, mongo 등에 적당한 상한 부여.
3. **모니터링 축소**  
   - cadvisor 중지 또는 프로파일 분리, grafana는 필요할 때만 기동 등.

---

## 3. 요약

- **SQLite**: 블로그용으로 새로 쓰지 말고, **키워드/발행 메타는 MongoDB `blog` DB로** 저장. 서버에 SQLite 설치 불필요.
- **메모리**: MongoDB Alpine 전환 + 필요 시 `mem_limit`·모니터링 서비스 정리가 1.13GB 줄이기에 유효함.
