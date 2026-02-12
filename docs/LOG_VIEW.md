# 로그 확인 방법

## 스케줄러 실행 시 로그가 나가는 곳

- **콘솔(stdout/stderr)**: `node scheduler.js` 로 실행하면 터미널에 바로 출력됩니다.
- **서버에서 백그라운드 실행**한 경우:
  - `nohup node scheduler.js > scheduler.log 2>&1 &` → `tail -f scheduler.log`
  - **systemd** 사용 시: `journalctl -u blog-scheduler -f` (서비스 이름에 맞게)
  - **pm2** 사용 시: `pm2 logs`
- **DEBUG_LOG_PATH** 환경 변수를 설정해 두면 `serverLog()` 로 적는 일부 로그는 해당 파일에 추가됩니다.  
  `[YoutubeTrends]`, `[SignalBz]`, `[NaverTopics]` 같은 모듈 로그는 **console.warn / console.log** 이므로 위의 stdout/stderr(또는 그걸 저장한 파일)에서 보면 됩니다.

## 유튜브 인기만 테스트해서 로그/에러 보기

서버에서 아래만 실행하면 유튜브 수집만 돌리면서 원인 확인할 수 있습니다.

```bash
# 프로젝트 루트 또는 blog 폴더에서
cd blog
node scripts/test-youtube-topics.js
```

- **YOUTUBE_API_KEY가 없습니다** → 서버 환경에 `YOUTUBE_API_KEY` 가 안 들어가 있는 상태. (GitHub Secrets 는 보통 CI용이므로, 서버 프로세스가 쓰는 .env 또는 systemd/pm2 환경에 직접 넣어야 함.)
- **API 응답 오류: 403 ...** → API 키 오류 또는 YouTube Data API v3 미사용 설정.
- **API가 영상 0건 반환** → quota 또는 regionCode 문제 가능성.
