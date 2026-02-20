# Lightsail 서버 환경 문서

> 이 문서는 Lightsail VM의 폴더 구조, Docker 상태, 환경 정보를 정리합니다.  
> 경로·컨테이너명·볼륨 등은 이 문서의 값을 기준으로 안내합니다.

**기준 리포트**: `docs/lightsail_env_report_20260220_115530.txt`

---

## 1. 서버 기본 정보

| 항목 | 값 |
|------|-----|
| 호스트명 | ip-172-26-14-81 (AWS) |
| OS | Ubuntu 22.04.5 LTS (Jammy Jellyfish) |
| 커널 | Linux 6.8.0-1045-aws x86_64 |
| SSH 사용자 | ubuntu |
| **프로젝트 루트** | **/home/ubuntu/chat-app** |

> 스크립트는 `/home/ubuntu`에서 실행됐으나, docker-compose·소스는 `chat-app` 아래에 있음. 서버 작업 시 `cd /home/ubuntu/chat-app` 사용.

---

## 2. 폴더 구조

```
/home/ubuntu/
├── chat-app/           # 프로젝트 루트 (docker-compose, 소스 전부)
│   ├── .cursor
│   ├── .git
│   ├── ai
│   ├── blog/           # 블로그 에이전트·스케줄러
│   ├── chat
│   ├── data/
│   ├── docs/
│   ├── ghost/
│   ├── landing/
│   ├── lib
│   ├── log-viewer/
│   ├── logs/
│   ├── monitoring/
│   ├── ssl/
│   ├── wave/
│   ├── docker-compose.yml
│   └── ...
├── lightsail-collect-env.sh
├── nginx.conf
├── server.js
└── ...
```

---

## 3. Docker 상태

| 컨테이너명 | 상태 | 포트 (호스트) |
|------------|------|----------------|
| chat-app | Up | 3000 |
| nginx | Up | 80, 443 |
| ghost | Up | 2368 |
| blog-scheduler | Up | - |
| log-viewer | Up | 3010 |
| redis | Up | 6379 (내부) |
| mongo | Up | 27017 (내부) |
| grafana | Up | 3001->3000 |
| prometheus | Up | 9090 |
| daily-report | Up | - |
| nginx-exporter | Up | 9113 |
| node-exporter | Up | 9100 |
| cadvisor | Up (healthy) | 8080 |
| mailpit | Up (healthy) | 1025, 1110, 8025 |

**docker-compose 실행 위치**: `/home/ubuntu/chat-app`  
**볼륨 접두사**: `chat-app_` (예: chat-app_ghost-data, chat-app_neworbit-logs, chat-app_mongo-data)

---

## 4. 블로그 관련 경로 (Lightsail)

| 용도 | 경로 |
|------|------|
| 블로그 소스 | `/home/ubuntu/chat-app/blog` |
| 프로젝트 루트 (compose) | `/home/ubuntu/chat-app` |
| 스케줄러 로그 (호스트) | `/home/ubuntu/chat-app/data/logs` 또는 Docker 볼륨 `chat-app_neworbit-logs` |
| SQLite DB (계획) | `/home/ubuntu/chat-app/blog/data/blog_metadata.db` 또는 `/var/lib/neworbit/blog_metadata.db` |
| Ghost 데이터 | Docker volume `chat-app_ghost-data` |

---

## 5. 환경·설치 상태 (리포트 기준)

| 항목 | 상태 |
|------|------|
| SQLite (호스트) | **설치 불필요** — 블로그 키워드/발행 기록은 기존 MongoDB(`mongo`) 사용 권장. 자세한 이유: [LIGHTSAIL_SQLITE_VS_MONGO_AND_MEMORY.md](LIGHTSAIL_SQLITE_VS_MONGO_AND_MEMORY.md) |
| Node/npm (호스트) | 미설치 (앱·블로그는 Docker에서 실행) |
| MongoDB | 채팅 앱이 `mongo:27017/chat` 사용 중. 블로그 메타는 동일 컨테이너에 `blog` DB 추가로 사용 가능 |

---

## 6. 환경 변수 (서버 기준)

실제 값은 넣지 않고, **설정 위치**만 표기.

| 변수 | 설명 | 설정 위치 |
|------|------|-----------|
| GEMINI_API_KEY | Gemini API | .env 또는 Lightsail 콘솔 |
| GHOST_URL | Ghost 주소 | .env (예: https://blog.neworbit.co.kr) |
| TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID | 텔레그램 봇 | .env |
| REDIS_HOST | Redis 호스트명 | docker-compose (redis) |
| DEBUG_LOG_PATH | 스케줄러 로그 경로 | .env / 볼륨 마운트 |

---

## 7. 이 문서 다시 채우는 방법

환경이 바뀌면 `docs/lightsail-collect-env.sh` 를 서버에 올린 뒤:

```bash
cd /home/ubuntu/chat-app   # 또는 스크립트 올려둔 위치
sed -i 's/\r$//' lightsail-collect-env.sh   # Windows 줄바꿈이면 한 번만
bash lightsail-collect-env.sh
```

생성된 `lightsail_env_report_*.txt` 내용을 이 문서 §1~§5에 반영하면 됩니다.
