# Log Viewer (log.neworbit.co.kr)

서버 중요 로그를 접근 코드로 보호해 조회하는 웹 UI. API 키로 봇/에이전트가 직접 조회 가능.

- **URL**: https://log.neworbit.co.kr
- **웹 인증**: 환경변수 `LOG_VIEWER_ACCESS_CODE`에 설정한 값으로 로그인
- **API 인증**: `LOG_VIEWER_API_KEY`를 쿼리로 넘기면 쿠키 없이 조회 가능 (에이전트/자동화용)
- **로그 소스**: 공유 디렉터리 `data/logs`(컨테이너 내 `/var/log/neworbit`)에 쌓이는 파일 조회

| 파일 | 설명 |
|------|------|
| scheduler.log | 블로그 스케줄러 (주제 보고, 발행, 에러) |
| daily-report.log | 일일점검 (매일 09:00 KST, 서비스 상태·리소스) |
| daily-restart.log | 시스템 정기 재기동 (매일 04:00 KST 앱 재시작) |
| blog-agent.log | 블로그 에이전트 크론 실행 (프로필 blog-run) |

## API (에이전트가 로그 직접 조회)

- **파일 목록**: `GET /api/sources?api_key=YOUR_API_KEY` → `{ "files": ["scheduler.log", ...] }`
- **로그 내용**: `GET /api/logs?source=scheduler.log&lines=500&api_key=YOUR_API_KEY` → `{ "content": "...", "source": "scheduler.log", "lines": 500 }`

로컬에서 에이전트가 이 API를 쓰려면, 서버와 동일한 API 키를 `.cursor/log-viewer-api-key.txt` 한 줄에 넣어 두면 된다. (해당 파일은 .gitignore 대상)

## 배포 시

1. GitHub Secrets에 `LOG_VIEWER_ACCESS_CODE`, `LOG_VIEWER_API_KEY` 추가.
2. 서버 `.env`에 동일 값 추가.
3. DNS에서 `log.neworbit.co.kr`을 서버 IP로 연결.

이후 배포 시 log-viewer·blog-scheduler가 올라가고, 스케줄러는 `scheduler.log`에 JSON 한 줄 단위로 기록한다.
