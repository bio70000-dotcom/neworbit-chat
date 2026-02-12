/**
 * AI(Gemini)로 일일 6편 주제 추론 선정 + 선정 이유 생성
 * 전체 풀(20개)에서 각 작가의 영역·관심사에 맞는 키워드를 추론해 작가당 2개씩 선택. 소스별 개수 고정 없음.
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
 * @param {Array} candidatesPool - [{ keyword, source, category }, ...] (writerId 없음, 전체 풀 20개)
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

  const bySource = { seasonal: [], naver_news: [], youtube_popular: [], signal_bz: [] };
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
    return `${i + 1}. ${c.keyword}${vol}`;
  };

  const candidatesText = [
    '## 시즌(seasonal) 후보',
    (bySource.seasonal || []).map(formatCandidate).join('\n') || '(없음)',
    '## 네이버 뉴스(naver_news) 후보',
    (bySource.naver_news || []).map(formatCandidate).join('\n') || '(없음)',
    '## 유튜브 인기(youtube_popular) 후보',
    (bySource.youtube_popular || []).map(formatCandidate).join('\n') || '(없음)',
    '## 시그널 실시간(signal_bz) 후보',
    (bySource.signal_bz || []).map(formatCandidate).join('\n') || '(없음)',
  ].join('\n');

  const prompt = `너는 블로그 편집장이다. 아래 작가 3명이 각각 오늘 2편씩 총 6편을 쓴다. 전체 후보 풀에서 정확히 6개를 골라야 한다.

## 작가
${writersDesc}

## 후보 풀 (반드시 아래 목록에 있는 키워드만 선택. 괄호 안 검색량은 네이버 블로그 검색결과 수 기준)
${candidatesText}

## 규칙
1. 전체 후보 풀에서 각 작가의 전문분야(categories)·관심사(bio)에 가장 잘 맞는 키워드를 추론해, 작가당 정확히 2개씩 총 6개를 선택한다.
2. 소스별 개수는 고정하지 않는다(시즌 2개, 네이버 2개 등 필수 아님). 작가 적합성만 맞으면 어떤 소스에서든 선택 가능.
3. 같은 키워드는 한 번만 선택. 6개 모두 서로 다른 키워드여야 함.
4. 검색량이 높은 주제를 참고하되, 작가와 주제의 적합성을 최우선으로 하라.
5. 각 선택에 대해 "선정 이유"를 한 줄로 한국어로 써줘.

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
