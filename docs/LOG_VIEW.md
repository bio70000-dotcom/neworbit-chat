# 로그 확인 방법

이 프로젝트는 **Docker Compose** 로 서버에 배포됩니다.  
블로그 스케줄러는 **`blog-scheduler`** 컨테이너에서 `node scheduler.js` 로 동작합니다 (docker-compose.yml, blog/Dockerfile 기준).

## 스케줄러 로그 보기

- **컨테이너 stdout/stderr** (실시간): 서버 SSH 접속 후 프로젝트 루트에서  
  `sudo docker compose logs -f blog-scheduler`  
  → `[YoutubeTrends]`, `[SignalBz]`, `[NaverTopics]` 등 모든 console 로그가 여기 나옵니다.
- **파일 로그**: `DEBUG_LOG_PATH=/var/log/neworbit/scheduler.log` 로 컨테이너에 넘기고, 호스트의 `./data/logs` 에 마운트되어 있으므로  
  서버에서 `tail -f /home/ubuntu/chat-app/data/logs/scheduler.log`  
  (단, `serverLog()` 로만 쓰는 항목만 파일에 남고, 모듈 로그는 위 `docker compose logs` 에 나옵니다.)

## 유튜브 인기만 테스트 (서버에서)

Node 는 **컨테이너 안**에만 있으므로, 서버에서 아래처럼 **같은 컨테이너에 들어가서** 실행하면 됩니다.

```bash
cd /home/ubuntu/chat-app
sudo docker compose exec blog-scheduler node scripts/test-youtube-topics.js
```

- **YOUTUBE_API_KEY가 없습니다** 가 나오면: deploy 시 `.env` 에 키가 안 들어간 상태.  
  → GitHub 저장소 **Settings → Secrets** 에 `YOUTUBE_API_KEY` 추가했는지 확인하고,  
  → **.github/workflows/deploy.yml** 에 `YOUTUBE_API_KEY` 를 `.env` 에 쓰는 줄이 있어야 합니다. (없으면 추가 후 푸시해 재배포.)
- **API 응답 오류: 403** 등 → 키 오류 또는 YouTube Data API v3 미사용.
- **API가 영상 0건 반환** → quota 또는 regionCode 확인.

## 배포 시 환경 변수 (참고)

스케줄러 컨테이너가 쓰는 환경 변수는 **docker-compose.yml** 의 `blog-scheduler.environment` 와 **.github/workflows/deploy.yml** 에서 `echo "KEY=..." >> .env` 로 채우는 값입니다.  
유튜브 인기를 쓰려면 `YOUTUBE_API_KEY` 가 둘 다에 있어야 합니다 (deploy.yml 에서 .env 로 쓰고, docker-compose 에서 해당 .env 를 넘기도록 되어 있음).

- **YOUTUBE_API_KEY가 없습니다** → 서버 환경에 `YOUTUBE_API_KEY` 가 안 들어가 있는 상태. (GitHub Secrets 는 보통 CI용이므로, 서버 프로세스가 쓰는 .env 또는 systemd/pm2 환경에 직접 넣어야 함.)
- **API 응답 오류: 403 ...** → API 키 오류 또는 YouTube Data API v3 미사용 설정.
- **API가 영상 0건 반환** → quota 또는 regionCode 문제 가능성.
