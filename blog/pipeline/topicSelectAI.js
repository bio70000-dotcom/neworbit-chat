/**
 * AI(Gemini)로 일일 6편 주제 추론 선정 + 선정 이유 생성
 * 전체 풀(~35개)에서 각 작가 페르소나에 맞는 주제를 선정하여 JSON으로 반환.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

async function callGemini(prompt, maxTokens = 4096) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

  const url = `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 응답이 비어있습니다');

    return text.trim();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/** JSON 파싱 헬퍼. 마크다운 코드 블록이 있어도 벗겨내고 파싱 */
function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error('[TopicSelectAI] JSON 파싱 실패 raw:', raw.slice(0, 100));
      return null;
    }
  }
}

function normalizeKeywordForMatch(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\s+/g, ' ').replace(/[.．…]+$/g, '').trim();
}

function findBestMatchCandidate(selKeyword, candidatesPool, usedKeywords) {
  const norm = normalizeKeywordForMatch(selKeyword);
  if (!norm) return null;

  for (const c of candidatesPool) {
    if (usedKeywords.has(c.keyword)) continue;

    const poolKey = (c.keyword || '').trim();
    const poolNorm = normalizeKeywordForMatch(poolKey);

    if (poolNorm === norm || poolKey === norm) return c;
    if (poolKey.length > 2 && (poolNorm.includes(norm) || norm.includes(poolNorm))) return c;
  }
  return null;
}

/**
 * 후보 풀과 작가 정보로 AI가 6편 선정 (2 per writer) + 선정 이유
 */
async function selectTopicsWithAI(candidatesPool, writers) {
  const writersDesc = writers
    .map(
      (w) => {
        const newsCats = (w.newsCategories || []).length ? `, 구글뉴스카테고리: [${w.newsCategories.join(', ')}]` : '';
        return `- ID: "${w.id}", 닉네임: "${w.nickname}", 전문분야: [${(w.categories || []).join(', ')}]${newsCats}, 성향: ${w.bio || ''}`;
      }
    )
    .join('\n');

  const formattedCandidates = candidatesPool
    .map((c, i) => {
      const tag = c.sourceTag || c.source || 'Seasonal';
      return `${i + 1}. [${tag}] ${c.keyword}`;
    })
    .join('\n');

  const prompt = `
너는 블로그 편집장이다. 아래 제공된 [후보 풀]에서 오늘 작성할 블로그 주제 6개를 선정하라.
작가 3명에게 각각 2개씩, 총 6개의 주제를 배정해야 한다.

## 작가 정보
${writersDesc}

## 후보 풀 (여기 있는 텍스트 그대로 사용)
${formattedCandidates}

## 배정 규칙
1. **적합성 최우선:** 작가의 '전문분야', '구글뉴스카테고리', '성향'에 가장 잘 어울리는 소스의 주제를 매칭하라.
   - dalsanchek: 감성, 힐링, 여행 -> [Naver_Dalsanchek], [Seasonal], [Google_News_건강], [Google_News_엔터테이먼트] 우선
   - textree: IT, 경제, 분석 -> [Naver_Textree], [Nate_Trend], [Google_News_비즈니스], [Google_News_과학_기술] 우선
   - bbittul: 트렌드, 이슈, 재미 -> [Nate_Trend], [Naver_Bbittul], [Google_News_엔터테이먼트], [Google_News_스포츠], [Google_News_대한민국] 우선
2. **복사 필수:** 선정된 주제의 'keyword'는 후보 풀에 적힌 텍스트를 **절대 수정하지 말고 그대로** 사용하라.
3. **중복 금지:** 6개의 주제는 모두 달라야 한다.
4. **결과물:** 반드시 아래 JSON 형식의 배열만 출력하라. (마크다운 없이 JSON만)

## 응답 형식 (JSON Array)
[
  { "writerId": "dalsanchek", "keyword": "후보 풀에 있는 키워드 그대로 복사", "source": "Naver_Dalsanchek 또는 Google_News_건강 등", "rationale": "선정 이유 한 줄" },
  ... (총 6개 객체)
]
`;

  let rawResponse;
  try {
    rawResponse = await callGemini(prompt);
  } catch (e) {
    return { plan: null, error: `Gemini 호출 실패: ${e.message}` };
  }

  // 디버깅용: 매 호출마다 raw 응답 본문 출력
  console.warn('[TopicSelectAI] Gemini raw 응답 본문 (길이 %d):\n%s', rawResponse?.length ?? 0, rawResponse ?? '(null)');

  const parsedData = safeParseJSON(rawResponse);

  if (!parsedData || !Array.isArray(parsedData)) {
    console.warn('[TopicSelectAI] 응답이 배열이 아님:', rawResponse?.slice(0, 200));
    return { plan: null, error: 'AI 응답이 JSON 배열 형식이 아닙니다.' };
  }

  if (parsedData.length < 6) {
    return { plan: null, error: `AI가 ${parsedData.length}개만 선정했습니다. (6개 필요)` };
  }

  const plan = writers.map((w) => ({ writer: w, topics: [] }));
  const usedKeywords = new Set();

  for (const item of parsedData.slice(0, 6)) {
    const writerId = (item.writerId || '').toLowerCase().trim();
    const keywordRaw = (item.keyword || '').trim();

    const writerIndex = writers.findIndex((w) => (w.id || '').toLowerCase() === writerId);
    if (writerIndex === -1) {
      console.warn('[TopicSelectAI] 알 수 없는 작가 ID:', writerId);
      continue;
    }

    let candidate = candidatesPool.find((c) => (c.keyword || '').trim() === keywordRaw);
    if (!candidate) {
      candidate = findBestMatchCandidate(keywordRaw, candidatesPool, usedKeywords);
    }

    if (!candidate) {
      console.warn('[TopicSelectAI] 풀에 없는 키워드 스킵:', keywordRaw.slice(0, 50));
      continue;
    }

    if (usedKeywords.has(candidate.keyword)) continue;
    usedKeywords.add(candidate.keyword);

    const topic = {
      keyword: candidate.keyword,
      source: candidate.source || item.source,
      category: candidate.category,
      rationale: (item.rationale || '').trim() || 'AI 선정',
    };
    if (candidate.searchVolumeLabel && candidate.searchVolumeLabel !== '-') {
      topic.searchVolumeLabel = candidate.searchVolumeLabel;
      if (typeof candidate.searchVolume === 'number') topic.searchVolume = candidate.searchVolume;
    } else {
      topic.searchVolumeLabel = '-';
    }
    plan[writerIndex].topics.push(topic);
  }

  const totalTopics = plan.reduce((sum, p) => sum + p.topics.length, 0);
  if (totalTopics < 6) {
    return {
      plan: null,
      error: `매칭 실패: AI는 6개를 줬으나 유효한 매칭은 ${totalTopics}개입니다. (키워드 불일치)`,
    };
  }

  console.log('[TopicSelectAI] 성공적으로', totalTopics, '개 주제 선정 완료.');
  return { plan };
}

module.exports = { selectTopicsWithAI };
