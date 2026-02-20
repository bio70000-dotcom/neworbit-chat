#!/bin/bash
# Lightsail 서버 환경 수집 스크립트
# 실행: chmod +x lightsail-collect-env.sh && ./lightsail-collect-env.sh
#       (또는: bash lightsail-collect-env.sh)
# 결과: 같은 디렉터리에 lightsail_env_report_YYYYMMDD_HHMMSS.txt 생성
#
# 오류 시 (": not found", "Illegal option -"): Windows 줄바꿈(CRLF) 때문입니다.
# 서버에서 한 번만 실행: sed -i 's/\r$//' lightsail-collect-env.sh
# 그 다음 다시: bash lightsail-collect-env.sh

set -e
REPORT="lightsail_env_report_$(date +%Y%m%d_%H%M%S).txt"
exec > "$REPORT" 2>&1
# 실행 끝에 경로를 터미널에 출력 (stderr로)
trap 'echo ""; echo ">>> 결과 파일: $(pwd)/$REPORT" >&2' EXIT

echo "=============================================="
echo "Lightsail 서버 환경 수집 결과"
echo "실행 시각: $(date -Iseconds 2>/dev/null || date)"
echo "=============================================="

echo ""
echo "=== 1. 기본 정보 ==="
uname -a
echo "---"
cat /etc/os-release 2>/dev/null | head -10 || true

echo ""
echo "=== 2. 현재 디렉터리 및 상위 ==="
pwd
echo "---"
ls -la

echo ""
echo "=== 3. 프로젝트 루트 후보 ==="
PROJ_ROOT=""
for d in /home/ubuntu/neworbit-chat /home/ubuntu/app /var/www/neworbit-chat "$(pwd)"; do
  [ -z "$d" ] && continue
  if [ -d "$d" ] && [ -f "$d/docker-compose.yml" ] 2>/dev/null; then
    echo "발견: $d"
    (cd "$d" && pwd && ls -la)
    echo "---"
    [ -z "$PROJ_ROOT" ] && PROJ_ROOT="$d"
  fi
done
if [ -f "$(pwd)/docker-compose.yml" ]; then
  echo "현재 디렉터리가 프로젝트 루트 (docker-compose.yml 있음)"
  PROJ_ROOT="$(pwd)"
fi
[ -z "$PROJ_ROOT" ] && PROJ_ROOT="$(pwd)"
echo "사용할 프로젝트 루트: $PROJ_ROOT"

echo ""
echo "=== 4. 폴더 구조 (depth 2, 프로젝트 루트 기준) ==="
if [ -n "$PROJ_ROOT" ] && [ -d "$PROJ_ROOT" ]; then
  (cd "$PROJ_ROOT" && find . -maxdepth 2 -type d | sort)
else
  find . -maxdepth 2 -type d | sort
fi

echo ""
echo "=== 5. Docker 상태 ==="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker ps -a
echo "---"
docker volume ls 2>/dev/null || true
echo "---"
(docker compose config --services 2>/dev/null || docker-compose config --services 2>/dev/null) || true

echo ""
echo "=== 6. Docker 이미지 ==="
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" 2>/dev/null | head -30 || docker images | head -30

echo ""
echo "=== 7. 블로그/로그 디렉터리 ==="
for p in ./data/logs ./blog/data /var/log/neworbit "$PROJ_ROOT/data/logs" "$PROJ_ROOT/blog/data"; do
  if [ -d "$p" ] 2>/dev/null; then
    echo "경로: $p"
    ls -la "$p" 2>/dev/null || true
    echo "---"
  fi
done

echo ""
echo "=== 8. SQLite 설치 여부 ==="
which sqlite3 2>/dev/null && sqlite3 --version || echo "sqlite3 미설치"
which sqlite3 2>/dev/null || true

echo ""
echo "=== 9. Node/npm (호스트, 컨테이너 아님) ==="
which node 2>/dev/null && node -v || echo "node 미설치"
which npm 2>/dev/null && npm -v || echo "npm 미설치"

echo ""
echo "=============================================="
echo "결과 저장: $(pwd)/$REPORT"
echo "=============================================="
