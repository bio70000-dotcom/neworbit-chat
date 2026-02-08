#!/bin/sh
# ============================================
# New Orbit 일일점검 리포트
# 매일 09:00 KST 실행, 결과를 Telegram으로 전송
# ============================================

TELEGRAM_BOT_TOKEN="8532715514:AAEEliO4yYTqpc2ZyeSk165SsGocPqsz7MM"
TELEGRAM_CHAT_ID="6980402785"
PROMETHEUS_URL="http://prometheus:9090"
APP_URL="http://app:3000"

# ---- 현재 시각 (KST) ----
REPORT_TIME=$(TZ="Asia/Seoul" date '+%Y-%m-%d %H:%M KST')

# ---- 1. 서비스 상태 체크 ----
check_service() {
    local name=$1
    local url=$2
    local code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url")
    if [ "$code" = "200" ]; then
        echo "✅ $name"
    else
        echo "❌ $name (HTTP $code)"
    fi
}

SVC_APP=$(check_service "채팅 서버" "$APP_URL/health")
SVC_PROMETHEUS=$(check_service "Prometheus" "$PROMETHEUS_URL/-/healthy")
SVC_NGINX=$(check_service "Nginx" "http://nginx:8081/stub_status")
SVC_GRAFANA=$(check_service "Grafana" "http://grafana:3000/api/health")

# ---- 2. Prometheus에서 메트릭 조회 ----
query_prometheus() {
    local query=$1
    local result=$(curl -s --max-time 5 "${PROMETHEUS_URL}/api/v1/query?query=${query}" | \
        sed -n 's/.*"value":\[.*,"\([^"]*\)"\].*/\1/p')
    echo "${result:-N/A}"
}

# CPU 사용률
CPU_RAW=$(query_prometheus '100%20-%20(avg(rate(node_cpu_seconds_total%7Bmode%3D%22idle%22%7D%5B5m%5D))%20*%20100)')
CPU=$(printf "%.1f" "$CPU_RAW" 2>/dev/null || echo "N/A")

# 메모리 사용률
MEM_RAW=$(query_prometheus '(1%20-%20node_memory_MemAvailable_bytes%20%2F%20node_memory_MemTotal_bytes)%20*%20100')
MEM=$(printf "%.1f" "$MEM_RAW" 2>/dev/null || echo "N/A")

# 디스크 사용률
DISK_RAW=$(query_prometheus '(1%20-%20node_filesystem_avail_bytes%7Bmountpoint%3D%22%2F%22%7D%20%2F%20node_filesystem_size_bytes%7Bmountpoint%3D%22%2F%22%7D)%20*%20100')
DISK=$(printf "%.1f" "$DISK_RAW" 2>/dev/null || echo "N/A")

# 서버 업타임 (초 -> 일)
UPTIME_RAW=$(query_prometheus 'node_time_seconds%20-%20node_boot_time_seconds')
if [ "$UPTIME_RAW" != "N/A" ] && [ -n "$UPTIME_RAW" ]; then
    UPTIME_DAYS=$(echo "$UPTIME_RAW" | awk '{printf "%.1f", $1/86400}')
else
    UPTIME_DAYS="N/A"
fi

# 현재 접속자
CONNECTIONS=$(query_prometheus 'chat_active_connections')

# 대기열
QUEUE=$(query_prometheus 'chat_waiting_queue_length')

# 누적 매칭 (human)
MATCH_HUMAN=$(query_prometheus 'chat_matches_total%7Btype%3D%22human%22%7D')
MATCH_HUMAN=$(printf "%.0f" "$MATCH_HUMAN" 2>/dev/null || echo "0")

# 누적 매칭 (ai)
MATCH_AI=$(query_prometheus 'chat_matches_total%7Btype%3D%22ai%22%7D')
MATCH_AI=$(printf "%.0f" "$MATCH_AI" 2>/dev/null || echo "0")

# 누적 메시지
MESSAGES=$(query_prometheus 'chat_messages_total')
MESSAGES=$(printf "%.0f" "$MESSAGES" 2>/dev/null || echo "0")

# ---- 3. 종합 판정 ----
if echo "$SVC_APP $SVC_PROMETHEUS $SVC_NGINX $SVC_GRAFANA" | grep -q "❌"; then
    STATUS="🔴 이상 감지"
else
    STATUS="🟢 정상"
fi

# CPU/메모리/디스크 경고 판정
WARNINGS=""
if [ "$CPU" != "N/A" ] && [ $(echo "$CPU > 80" | bc -l 2>/dev/null || echo 0) -eq 1 ]; then
    WARNINGS="${WARNINGS}
⚠️ CPU 사용률 높음 (${CPU}%)"
fi
if [ "$MEM" != "N/A" ] && [ $(echo "$MEM > 85" | bc -l 2>/dev/null || echo 0) -eq 1 ]; then
    WARNINGS="${WARNINGS}
⚠️ 메모리 사용률 높음 (${MEM}%)"
fi
if [ "$DISK" != "N/A" ] && [ $(echo "$DISK > 90" | bc -l 2>/dev/null || echo 0) -eq 1 ]; then
    WARNINGS="${WARNINGS}
⚠️ 디스크 사용률 높음 (${DISK}%)"
fi

# ---- 4. 메시지 구성 ----
MESSAGE="📋 <b>New Orbit 일일점검 리포트</b>
━━━━━━━━━━━━━━━━━━
🕐 ${REPORT_TIME}
📊 종합 상태: ${STATUS}

<b>🔧 서비스 상태</b>
${SVC_APP}
${SVC_PROMETHEUS}
${SVC_NGINX}
${SVC_GRAFANA}

<b>💻 서버 자원</b>
• CPU: ${CPU}%
• 메모리: ${MEM}%
• 디스크: ${DISK}%
• 업타임: ${UPTIME_DAYS}일

<b>📈 서비스 지표</b>
• 현재 접속자: ${CONNECTIONS}명
• 대기열: ${QUEUE}명
• 누적 매칭: 👤${MATCH_HUMAN} / 🤖${MATCH_AI}
• 누적 메시지: ${MESSAGES}건${WARNINGS}
━━━━━━━━━━━━━━━━━━
🔗 <a href=\"https://monitor.neworbit.co.kr\">Grafana 대시보드</a>"

# ---- 5. Telegram 전송 ----
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d parse_mode="HTML" \
    -d text="${MESSAGE}" \
    > /dev/null 2>&1

echo "[$(date)] Daily report sent to Telegram"
