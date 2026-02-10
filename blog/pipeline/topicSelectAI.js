/**
 * AI( Gemini )로 일일 6편 주제 추론 선정 + 선정 이유 생성
 * 후보 풀을 주면 작가 적합성·시의성·소스 균형을 고려해 6개를 골라 rationale 반환
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

async function callGemini(prompt, maxTokens = 2048) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

  const url = `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.3,
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

/**
 * 후보 풀과 작가 정보로 AI가 6편 선정 (2 per writer) + 선정 이유
 * @param {Array} candidatesPool - [{ keyword, source, category, writerId }, ...]
 * @param {Array} writers - [{ id, nickname, categories, bio }, ...]
 * @returns {Promise<Array<{writer, topics: [{keyword, source, category?, rationale}]}>>} plan
 */
async function selectTopicsWithAI(candidatesPool, writers) {
  const writersDesc = writers
    .map(
      (w) =>
        `- ${w.id}: ${w.nickname}, 전문분야 [${(w.categories || []).join(', ')}], 소개: ${(w.bio || '').slice(0, 80)}...`
    )
    .join('\n');

  const bySource = { seasonal: [], naver_news: [], google_trends: [] };
  for (const c of candidatesPool) {
    const list = bySource[c.source] || [];
    list.push(c);
    bySource[c.source] = list;
  }

  const formatCandidate = (c, i) => {
    let vol = '';
    if (c.searchVolumeLabel && c.searchVolumeLabel !== '-') {
      vol = ` (검색량: ${c.searchVolumeLabel}`;
      if (typeof c.searchVolume === 'number' && c.searchVolume >= 10000) {
        vol += `, 약 ${(c.searchVolume / 10000).toFixed(0)}만건`;
      } else if (typeof c.searchVolume === 'number') {
        vol += `, ${c.searchVolume.toLocaleString()}건`;
      }
      vol += ')';
    }
    return `${i + 1}. [${c.writerId}] ${c.keyword}${vol}`;
  };

  const candidatesText = [
    '## 시즌(seasonal) 후보',
    (bySource.seasonal || []).map(formatCandidate).join('\n'),
    '## 네이버 뉴스(naver_news) 후보',
    (bySource.naver_news || []).map(formatCandidate).join('\n'),
    '## 구글 트렌드(google_trends) 후보',
    (bySource.google_trends || []).map(formatCandidate).join('\n'),
  ].join('\n');

  const prompt = `너는 블로그 편집장이다. 아래 작가 3명이 각각 오늘 2편씩 총 6편을 쓴다. 후보 목록에서 정확히 6개를 골라야 한다.

## 작가
${writersDesc}

## 후보 (반드시 아래 목록에 있는 키워드만 선택. 괄호 안 검색량은 네이버 블로그 검색결과 수 기준 대리 지표임)
${candidatesText}

## 규칙
1. 각 작가당 정확히 2편. writerId가 해당 작가의 전문분야·톤과 맞는 주제로 골라.
2. 소스 균형: 시즌 2개, naver_news 2개, google_trends 2개가 되도록 선택.
3. 검색량(네이버 검색결과 수)이 높은 주제를 우선 고려하되, 작가 적합성과 소스 균형을 함께 만족하는 것을 선택하라.
4. 네이버 뉴스는 시의성 있는 이슈로 타이밍 좋은 포스팅용. 아무 뉴스나 고르지 말고, 블로그 주제로 적합하고 검색 수요가 있을 만한 것만.
5. 각 선택에 대해 "선정 이유"를 한 줄로 한국어로 써줘 (검색량·시즌 맞춤·작가 전문분야 등 언급 가능).

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "selections": [
    { "writerId": "dalsanchek", "keyword": "후보에 나온 키워드 그대로", "source": "seasonal", "rationale": "한 줄 선정 이유" },
    ...총 6개
  ]
}`;

  const raw = await callGemini(prompt, 2048);

  let jsonStr = raw
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[TopicSelectAI] JSON 파싱 실패:', e.message);
    return null;
  }

  const selections = data?.selections;
  if (!Array.isArray(selections) || selections.length !== 6) {
    console.warn('[TopicSelectAI] selections 개수 이상:', selections?.length);
    return null;
  }

  const keywordToCandidate = new Map();
  for (const c of candidatesPool) {
    keywordToCandidate.set(c.keyword.trim(), c);
  }

  const plan = writers.map((w) => ({ writer: w, topics: [] }));
  const usedKeywords = new Set();

  for (const sel of selections) {
    const writerIndex = writers.findIndex((w) => w.id === sel.writerId);
    if (writerIndex === -1) continue;
    const k = (sel.keyword || '').trim();
    const candidate = keywordToCandidate.get(k) || candidatesPool.find((c) => (c.keyword || '').trim() === k);
    if (!candidate || usedKeywords.has(candidate.keyword)) continue;
    usedKeywords.add(candidate.keyword);
    const topic = {
      keyword: candidate.keyword,
      source: candidate.source,
      category: candidate.category,
      rationale: (sel.rationale || '').trim() || '선정',
    };
    if (candidate.searchVolumeLabel && candidate.searchVolumeLabel !== '-') {
      topic.searchVolumeLabel = candidate.searchVolumeLabel;
      if (typeof candidate.searchVolume === 'number') topic.searchVolume = candidate.searchVolume;
    }
    plan[writerIndex].topics.push(topic);
  }

  const totalTopics = plan.reduce((sum, p) => sum + p.topics.length, 0);
  if (totalTopics !== 6) {
    console.warn('[TopicSelectAI] 선정 결과 6편 미만:', totalTopics);
    return null;
  }

  console.log('[TopicSelectAI] 6편 선정 완료 (AI 추론)');
  return plan;
}

module.exports = { selectTopicsWithAI };
