# 주제 소스 API 키 및 설정

일일 블로그 주제 선정에 사용하는 소스별 API 키 발급 방법.  
**개발/운영은 서버에서 하므로 로컬 `.env` 는 건드리지 않아도 됨.** 서버 환경에는 GitHub Secrets 에 넣어 둔 값을 배포 시 주입하면 됨.

## YouTube Data API v3 (유튜브 인기 뉴스/이슈)

- **용도**: 한국 인기 영상 중 뉴스·이슈 성격 키워드 5개 수집
- **발급**: [Google Cloud Console](https://console.cloud.google.com/) → API 및 서비스 → 사용자 인증 정보 → API 키 생성 → **YouTube Data API v3** 사용 설정
- **환경 변수**: `YOUTUBE_API_KEY`
- **참고**: 일일 할당량(quota) 확인 권장. `videos.list` 1회 = 1 유닛.

## 네이버 검색(뉴스) API

- **용도**: 헤드라인 위주 뉴스 키워드 수집 (언론사 화이트리스트 적용)
- **발급**: [네이버 개발자센터](https://developers.naver.com/) → 애플리케이션 등록 → **검색** API 사용 설정
- **환경 변수**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **언론사 목록**: `blog/config/publisherDomains.json` 에서 도메인 추가/삭제로 관리. 제거할 매체는 해당 파일에서 삭제하면 됨.

## 시그널(signal.bz) 실시간 검색어

- **용도**: 실시간 검색어 키워드 5개 수집
- **API**: 없음. HTML 크롤링 사용. **별도 API 키 불필요.**

## GitHub Secrets 추가 안내

서버에서 사용할 값은 **GitHub 저장소 → Settings → Secrets and variables → Actions** 에서 Secret 으로 추가하면 됨. (배포/CI 에서 환경 변수로 주입하는 용도)

| Secret 이름 | 필수 | 설명 |
|-------------|------|------|
| `YOUTUBE_API_KEY` | 유튜브 사용 시 | Google Cloud에서 발급한 API 키 |
| `NAVER_CLIENT_ID` | 네이버 뉴스 사용 시 | 네이버 개발자센터 Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 뉴스 사용 시 | 네이버 개발자센터 Client Secret |

- **추가 방법**: Repository → Settings → Secrets and variables → Actions → New repository secret → Name/Value 입력.
- 배포 워크플로에서 위 Secret 을 서버의 환경 변수로 넘기도록 설정해 두면 됨.
