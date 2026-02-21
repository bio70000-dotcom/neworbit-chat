# 주제 소스 API 키 및 설정

**Topic Pool 구성**: 국내 소스 3종 + 구글 뉴스 RSS 사용. 목표 풀 규모 **35개**. 구글 트렌드/유튜브/시그널은 사용하지 않음.

- **네이트 실시간 이슈** 10개 (공통, 주로 삐뚤빼뚤) — API 키 없음, EUC-KR 디코딩 + 금지어 필터
- **네이버 뉴스** 작가별 고정 쿼리: 달산책 5, 텍스트리 5, 삐뚤빼뚤 3
- **구글 뉴스 RSS** 카테고리별(대한민국, 비즈니스, 과학/기술, 엔터테이먼트, 스포츠, 건강) 약 10개 — API 키 없음
- **시즌/기념일** 2개

---

## 현황 분석 (주제 선정 구조)

- **풀 구성 순서**: 네이트 10 → 네이버(달산책 5, 텍스트리 5, 삐뚤빼뚤 3) → 구글 뉴스 카테고리별 → 시즌 2. 이후 `enrichPoolWithSearchVolume`으로 검색량 보강, **AI(Gemini)**가 풀에서 6개 선정(작가당 2개).
- **네이버 뉴스**: `naverTopics.js`에서 쿼리 검색만 수행. 작가별 고정 시드 + 헤드라인 시드로 5~7회 검색 후 제목에서 주제 추출. 카테고리는 뉴스 제목 키워드로 사후 분류.
- **AI 선정**: `topicSelectAI.js`에서 후보 풀을 `[소스태그] 키워드` 형태로 넘기고, 작가별 적합성 규칙으로 6개 배정. 작가–구글 뉴스 카테고리 매핑(`newsCategories`)으로 카테고리 기반 주제를 작가에 우선 배정.
- **기타**: `googleTrendsRss.js`는 구현되어 있으나 풀 구성에는 미포함.

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

## 구글 뉴스 RSS (카테고리별)

- **용도**: 한국(hl=ko, gl=KR) 구글 뉴스 홈 카테고리별 헤드라인 수집. 풀에 약 10개 추가하여 목표 35개 달성.
- **구현**: `blog/utils/googleNewsRss.js` — 메인 RSS(대한민국 종합) + 토픽별 RSS(비즈니스, 과학/기술, 엔터테이먼트, 스포츠, 건강).
- **URL 형식**: 메인 `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR%3Ako`, 토픽 `https://news.google.com/rss/topics/{주제코드}?hl=ko&gl=KR&ceid=KR%3Ako`. 주제코드는 구글 뉴스 홈에서 카테고리 클릭 시 주소창 URL의 `topics/` 뒤 문자열로 확인 가능.
- **작가–카테고리 매핑**: `blog/writers.js`의 `newsCategories` 필드. 달산책: 건강, 엔터테이먼트 / 텍스트리: 비즈니스, 과학/기술 / 삐뚤빼뚤: 엔터테이먼트, 스포츠, 대한민국. AI 주제 선정 시 `Google_News_카테고리` 소스 태그로 해당 작가 우선 배정.
- **API 키**: 불필요 (RSS 공개).

## 블로그 본문 실사 이미지

- **실사 이미지**: Unsplash 우선, 부족 시 Pexels. 환경 변수: `UNSPLASH_ACCESS_KEY` ( [Unsplash Developers](https://unsplash.com/developers) 에서 Access Key 발급 ), `PEXELS_API_KEY`.

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

# 구글 뉴스 RSS (API 키 없음, 풀 수집 시 자동 사용)
```

- 컨테이너가 안 떠 있으면 `docker-compose up -d blog-scheduler` 로 먼저 띄운 뒤 실행.
