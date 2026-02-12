# 주제 소스 API 키 및 설정

**Topic Pool 구성**: 국내 소스 3종만 사용 (총 ~25개). 구글 트렌드/유튜브/시그널은 사용하지 않음.

- **네이트 실시간 이슈** 10개 (공통, 주로 삐뚤빼뚤) — API 키 없음, EUC-KR 디코딩 + 금지어 필터
- **네이버 뉴스** 작가별 고정 쿼리: 달산책 5, 텍스트리 5, 삐뚤빼뚤 3
- **시즌/기념일** 2개

---

## 네이트(Nate) 실시간 이슈

- **용도**: 한국 실시간 검색어 상위 10개 (Topic Pool Main)
- **URL**: `https://www.nate.com/js/data/jsonLiveKeywordDataV1.js?cp=1`
- **인코딩**: EUC-KR → `iconv-lite`로 UTF-8 디코딩
- **금지어 필터**: 대통령, 정당, 탄핵, 검찰, 속보, 사망, 살인, 구속 등 수집 제외
- **API 키**: 불필요

## 네이버 검색(뉴스) API

- **용도**: 작가별 고정 쿼리로 뉴스 검색 (달산책: 주말 여행/힐링 에세이/전시회 추천, 텍스트리: AI 트렌드/테크 신제품/경제 전망, 삐뚤빼뚤: 팝업스토어/편의점 신상/MZ 핫플)
- **발급**: [네이버 개발자센터](https://developers.naver.com/) → 애플리케이션 등록 → **검색** API 사용 설정
- **환경 변수**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **언론사 목록**: `blog/config/publisherDomains.json` 에서 도메인 추가/삭제로 관리.

## GitHub Secrets 추가 안내

| Secret 이름 | 필수 | 설명 |
|-------------|------|------|
| `NAVER_CLIENT_ID` | 네이버 뉴스 사용 시 | 네이버 개발자센터 Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 뉴스 사용 시 | 네이버 개발자센터 Client Secret |

- 배포 워크플로에서 위 Secret 을 서버의 환경 변수로 넘기도록 설정.

---

## 서버 콘솔에서 주제 소스 테스트 (실행 중인 컨테이너에 명령 보내기)

프로젝트 홈 `~/chat-app` 에서:

```bash
cd ~/chat-app

# 네이트 실시간 이슈 (API 키 없음, 금지어 제외)
docker-compose exec blog-scheduler node scripts/test-nate-topics.js

# 네이버 뉴스 (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 필요)
# → 주제 테스트(텔레그램) 또는 풀 수집 시 자동 사용
```

- 컨테이너가 안 떠 있으면 `docker-compose up -d blog-scheduler` 로 먼저 띄운 뒤 실행.
