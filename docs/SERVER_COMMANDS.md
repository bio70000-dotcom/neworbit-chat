# 서버에서 수행할 작업 — 명령어 안내

Lightsail 서버 구조는 [LIGHTSAIL_SERVER.md](LIGHTSAIL_SERVER.md) 기준입니다.  
**프로젝트 루트**: `/home/ubuntu/chat-app`  
**Compose 명령**: 이 서버는 `docker-compose`(하이픈) 사용. `docker compose`(공백)는 미지원.

---

## 1. SSH 접속 및 프로젝트 이동

```bash
# SSH 접속 (Lightsail 고정 IP 또는 인스턴스 주소 사용)
ssh ubuntu@<LIGHTSAIL_IP>

# 프로젝트 루트로 이동 (아래 모든 명령은 여기서 실행)
cd /home/ubuntu/chat-app
pwd
# /home/ubuntu/chat-app
```

---

## 2. 배포 후 — 블로그 스택 반영 (MongoDB·키워드 DB·관련글)

코드 푸시 후 서버에서 이미지 재빌드 및 블로그 스케줄러 재시작.

```bash
cd /home/ubuntu/chat-app

# blog 이미지 재빌드 (mongodb 의존성 포함)
docker-compose build blog-scheduler blog-agent

# blog-scheduler만 재시작 (상시 실행 중인 컨테이너)
docker-compose up -d blog-scheduler

# 상태 확인
docker ps --filter name=blog-scheduler
docker logs blog-scheduler --tail 50
```

MongoDB는 이미 `mongo` 컨테이너로 떠 있으므로 별도 설치·기동 없음.  
블로그는 `mongodb://mongo:27017/blog` 에 접속하며, `blog` DB·컬렉션은 최초 사용 시 자동 생성됨.

---

## 2-1. MongoDB 이미지만 갱신 (예: mongo:7 → mongo:8)

`docker-compose.yml`에서 mongo 이미지 태그만 바뀐 경우(FCV 호환 등). 프로젝트 루트에서 실행.

```bash
cd /home/ubuntu/chat-app

# 최신 코드 반영 (이미지 태그가 바뀌었으면)
git pull

# mongo 이미지 받고 컨테이너만 재생성
docker-compose pull mongo
docker-compose up -d mongo

# 기동 확인
docker ps --filter name=mongo
docker logs mongo --tail 20
```

---

## 3. Docker 전체 재시작 (필요 시)

```bash
cd /home/ubuntu/chat-app

docker-compose down
docker-compose up -d
```

**참고**: Grafana·Prometheus·cadvisor·node-exporter·nginx-exporter·daily-report는 `monitoring` 프로파일로 분리되어 있어 기본 `up -d` 시 기동되지 않습니다. 필요 시:

```bash
docker-compose --profile monitoring up -d
```

---

## 4. 로그 확인

```bash
cd /home/ubuntu/chat-app

# 블로그 스케줄러 로그 (stdout)
docker logs blog-scheduler --tail 200

# 실시간 로그
docker logs -f blog-scheduler

# 호스트에 마운트된 로그 파일 (DEBUG_LOG_PATH 사용 시)
ls -la /home/ubuntu/chat-app/data/logs/
tail -100 /home/ubuntu/chat-app/data/logs/scheduler.log
```

---

## 5. MongoDB 상태 확인 (블로그 DB)

```bash
cd /home/ubuntu/chat-app

# mongo 컨테이너 접속 후 shell
docker exec -it mongo mongosh

# mongosh 내부
show dbs
use blog
show collections
db.published_posts.find().limit(5)
exit
```

---

## 6. 환경 수집 스크립트 (서버 정보 리포트)

```bash
# 스크립트가 프로젝트 docs에 있는 경우
cd /home/ubuntu/chat-app
cp docs/lightsail-collect-env.sh .
sed -i 's/\r$//' lightsail-collect-env.sh
chmod +x lightsail-collect-env.sh
bash lightsail-collect-env.sh

# 결과 파일 확인 (같은 디렉터리에 생성됨)
ls -la lightsail_env_report_*.txt
```

---

## 7. 메모리 사용량 점검

```bash
cd /home/ubuntu/chat-app
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"
```

서비스별 용도·절감 방법은 [MEMORY_AUDIT.md](MEMORY_AUDIT.md) 참고.

---

## 8. 자주 쓰는 명령 요약

| 목적 | 명령 |
|------|------|
| 프로젝트 이동 | `cd /home/ubuntu/chat-app` |
| MongoDB 이미지만 갱신 | `cd /home/ubuntu/chat-app` 후 `docker-compose pull mongo` → `docker-compose up -d mongo` |
| 메모리 사용량 확인 | `docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"` |
| 블로그 스케줄러 재시작 | `docker-compose up -d blog-scheduler` |
| 블로그 로그 보기 | `docker logs blog-scheduler --tail 100` |
| 전체 컨테이너 상태 | `docker ps -a` |
| blog 이미지 재빌드 | `docker-compose build blog-scheduler` |
| MongoDB 접속 | `docker exec -it mongo mongosh` |

---

## 9. 참고 경로 (LIGHTSAIL_SERVER.md 기준)

| 용도 | 경로 |
|------|------|
| 프로젝트 루트 | `/home/ubuntu/chat-app` |
| 블로그 소스 | `/home/ubuntu/chat-app/blog` |
| 스케줄러 로그 디렉터리 | `/home/ubuntu/chat-app/data/logs` |
| docker-compose 파일 | `/home/ubuntu/chat-app/docker-compose.yml` |

Git으로 배포하는 경우, 서버에서 `git pull` 후 위 2번(빌드·재시작)만 수행하면 됨.
