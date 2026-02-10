# 블로그 에이전트 개발 메모

> 오늘까지 적용한 블로그 관련 개발 내용 정리. (날짜: 2026년 2월 기준)

---

## 1. 작가 말투 고정

- **목적**: 글이나 포스트마다 말투가 들쭉날쭉하던 문제 해결.
- **수정 파일**: `blog/pipeline/humanizer.js`, `blog/writers.js`
- **내용**:
  - humanizer 시스템 프롬프트 맨 앞에 고정 문구 추가: "이 글의 필명은 [닉네임] 한 명뿐이다. 다른 작가 말투가 섞이지 않게 해."
  - 각 작가 `persona`에 `exampleSentences` 추가 후 humanizer에서 "말투 예시" 블록으로 포함.
  - 사용자 메시지에 "반드시 [닉네임] 말투만 사용. 다른 작가 말투 금지." 추가.

---

## 2. 보고 시 소제목(h2) 텔레그램 전송

- **목적**: 제목·발행 시간만으로는 어떤 이미지를 보낼지 모르므로, 각 주제별 소제목(Google SEO용 h2)을 텔레그램으로 보내 이미지 선택·캡션에 활용.
- **수정 파일**: `blog/agent.js`, `blog/scheduler.js`
- **내용**:
  - 각 글의 인간화(humanize) 직후, 본문에서 h2 텍스트 추출 → `N번 글 소제목 (이미지 참고): h2-1, h2-2, ...` 형태로 텔레그램 전송.
  - scheduler가 `processOne` 호출 시 `postIndex: item.index` 전달.

---

## 3. 초안 모델·리서치 강화

- **목적**: 초안 품질 향상.
- **수정 파일**: `blog/pipeline/draftWriter.js`
- **내용**:
  - 초안용 모델을 `gemini-3-pro-preview`로 변경. API 실패 시 `gemini-2.5-flash`로 fallback.
  - 프롬프트에 "리서치 기반 작성 (필수)" 섹션 추가: 네이버 뉴스/블로그 사실·수치 반영, 자료에 없는 주장 금지.

---

## 4. 주제–작가 매칭 (writers.categories 기준)

- **목적**: 주제가 작가의 관심·전문 범위와 맞지 않던 문제 해결.
- **수정 파일**: `blog/pipeline/topicSelector.js`, `blog/utils/naverTopics.js`
- **내용**:
  - topicSelector에서 `getWriterKeywords(writer)`로 `writer.categories` + 카테고리별 확장 키워드 사용. 시즌/트렌드/네이버 소스 모두 writer 객체 기준으로 매칭.
  - naverTopics: `getNaverNewsTopics(writer)`로 변경, `writer.categories` 기반으로 시드·매칭 키워드 생성.

---

## 5. 주제 소스 균형 (시즌 2 / 네이버 2 / 트렌드 2)

- **목적**: 6편 중 5편이 네이버 뉴스로 쏠리던 문제 해결.
- **수정 파일**: `blog/pipeline/topicSelector.js`, `blog/scheduler.js`
- **내용**:
  - 일일 6편을 시즌 2, 네이버 뉴스 2, 구글 트렌드 2로 고정 할당. 슬롯별 소스 셔플 후 작가별로 주제 선정.

---

## 6. 텔레그램 명령: 전체 취소 / 주제 선정 시작

- **목적**: 보고 후 전체 취소, 그리고 09시 대기 없이 주제 선정·스케줄 시작 가능하게.
- **수정 파일**: `blog/utils/telegram.js`, `blog/scheduler.js`
- **내용**:
  - **취소**: 주제 보고 후 "취소", "취소해", "전체 취소", "취소할게" 입력 시 오늘 발행 없이 종료.
  - **시작**: 스케줄러 대기 중 "시작", "주제 선정", "주제선정", "시작해", "오늘 주제" 입력 시 즉시 주제 선정·보고·승인 흐름 실행.
  - 09:00 KST 고정 스케줄은 그대로 유지.

---

## 7. AI 토픽 선정 + 선정 이유

- **목적**: 랜덤이 아닌 AI 추론으로 주제 선정, 선정 이유를 텔레그램 보고에 포함.
- **수정/추가 파일**: `blog/pipeline/topicSelector.js`, `blog/pipeline/topicSelectAI.js`(신규), `blog/utils/telegram.js`
- **내용**:
  - 후보 풀(시즌/네이버/트렌드 각 작가당 2개씩) 수집 후, Gemini로 6편 선정(작가당 2편, 소스 균형 유지) + 각 선택에 대한 "선정 이유"(rationale) 생성.
  - 텔레그램 일일 보고에 주제별로 `→ 선정 이유` 한 줄 표시. AI 실패 시 기존 랜덤 할당 fallback.

---

## 8. 검색량 지표(네이버) 반영

- **목적**: 해당일/전일 기준 검색량을 고려한 주제 선정.
- **수정/추가 파일**: `blog/utils/searchVolume.js`(신규), `blog/pipeline/topicSelector.js`, `blog/pipeline/topicSelectAI.js`, `blog/utils/telegram.js`
- **내용**:
  - 네이버 블로그 검색 API로 키워드별 "총 검색결과 수" 조회 → 검색량 대리 지표로 사용.
  - 후보 풀에 `searchVolume`, `searchVolumeLabel`(높음/보통/낮음) 부여 후 AI 프롬프트에 포함. "검색량이 높은 주제를 우선 고려" 규칙 추가.
  - 텔레그램 보고에 선정된 주제별 검색량(예: 검색량: 높음, 약 8만건) 표시.

---

## 텔레그램 사용 요약

| 입력 | 동작 |
|------|------|
| **ok** / **승인** / **ㅇㅋ** | 전체 승인 → 발행 스케줄 생성·실행 |
| **취소** / **전체 취소** | 오늘 발행 취소 |
| **2,5 다시** | 해당 번호만 재선정 |
| **전체 다시** | 전부 재선정 |
| **시작** / **주제 선정** | 09시 대기 없이 즉시 주제 선정·보고 |

- 매일 **09:00 KST**에는 기존처럼 자동으로 주제 선정·보고가 진행됨.

---

## 서버 테스트 명령

```bash
cd ~/chat-app
docker-compose run --rm blog-scheduler node scheduler.js --test-5min
```

- 주제 보고 → 승인 → 5분 간격 6편 발행 (테스트용).
