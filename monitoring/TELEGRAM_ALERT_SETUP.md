# Telegram + Grafana 알림 설정 가이드

## 1단계: Telegram Bot 생성

1. Telegram에서 **@BotFather** 검색 후 대화 시작
2. `/newbot` 명령어 입력
3. 봇 이름 입력 (예: `NewOrbit Monitor`)
4. 봇 유저네임 입력 (예: `neworbit_monitor_bot`)
5. **Bot Token**이 발급됨 → 복사해 둘 것 (예: `7123456789:AAH...`)

## 2단계: Chat ID 확인

1. 생성된 봇에게 아무 메시지나 보내기 (예: "hello")
2. 브라우저에서 아래 URL 접속 (TOKEN을 실제 토큰으로 교체):
   ```
   https://api.telegram.org/bot{TOKEN}/getUpdates
   ```
3. JSON 응답에서 `"chat":{"id": 123456789}` 부분의 숫자가 **Chat ID**

> **그룹 알림**을 원하면: 봇을 그룹에 초대 → 그룹에서 메시지 전송 → 위 URL에서 음수 Chat ID 확인 (예: `-100123456789`)

## 3단계: Grafana에서 Contact Point 설정

1. Grafana 접속: `http://{서버IP}:3001` (기본 계정: `admin` / `.env`의 `GRAFANA_ADMIN_PASSWORD`)
2. 좌측 메뉴 → **Alerting** → **Contact points**
3. **+ Add contact point** 클릭
4. 설정:
   - **Name**: `Telegram`
   - **Integration**: `Telegram` 선택
   - **BOT API Token**: 1단계에서 받은 토큰 입력
   - **Chat ID**: 2단계에서 확인한 Chat ID 입력
5. **Test** 버튼으로 메시지 수신 확인 → **Save**

## 4단계: Notification Policy 설정

1. **Alerting** → **Notification policies**
2. Default policy의 Contact point를 **Telegram**으로 변경
3. **Save**

## 5단계: Alert Rule 생성 (권장 규칙)

**Alerting** → **Alert rules** → **+ New alert rule**

### 규칙 1: 서비스 다운 감지
- **Query**: `up{job="node-app"} == 0`
- **Condition**: 1분 동안 지속
- **Summary**: `[긴급] 채팅 서버가 다운되었습니다!`

### 규칙 2: CPU 사용률 높음
- **Query**: `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80`
- **Condition**: 5분 동안 지속
- **Summary**: `[경고] CPU 사용률이 80%를 초과했습니다.`

### 규칙 3: 메모리 사용률 높음
- **Query**: `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 85`
- **Condition**: 5분 동안 지속
- **Summary**: `[경고] 메모리 사용률이 85%를 초과했습니다.`

### 규칙 4: 디스크 사용률 높음
- **Query**: `(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 > 90`
- **Condition**: 5분 동안 지속
- **Summary**: `[경고] 디스크 사용률이 90%를 초과했습니다.`

### 규칙 5: 컨테이너 재시작 감지
- **Query**: `increase(container_restart_count[5m]) > 0`
- **Condition**: 즉시
- **Summary**: `[알림] Docker 컨테이너가 재시작되었습니다.`

## 배포 후 확인 체크리스트

- [ ] `http://{서버IP}:9090/targets` 에서 Prometheus 타겟 모두 UP 확인
- [ ] `http://{서버IP}:3001` 에서 Grafana 로그인 확인
- [ ] Grafana → Explore → Prometheus 데이터소스에서 `up` 쿼리 실행 확인
- [ ] Telegram Test 메시지 수신 확인
- [ ] Alert Rule 5개 생성 완료
