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

  const bySource = { seasonal: [], naver_news: [], google_trends_rss: [], youtube_popular: [], signal_bz: [] };
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
    '## 네이버 뉴스(naver_news) 후보 — 작가별 맞춤 쿼리(여행/전시/힐링, AI/테크 등)로 수집한 주제. 달산책·텍스트리에게 우선 배정 권장.',
    (bySource.naver_news || []).map(formatCandidate).join('\n') || '(없음)',
    '## 구글 트렌드(google_trends_rss) + 유튜브 뉴스(youtube_popular) + 시그널(signal_bz) 후보 — 실시간 트렌드/이슈. 주로 bbittul, 필요 시 textree에 적합. 달산책(감성·힐링)에는 사건/사고·정치성 주제 배정 금지.',
    [
      (bySource.google_trends_rss || []).map(formatCandidate).join('\n'),
      (bySource.youtube_popular || []).map(formatCandidate).join('\n'),
      (bySource.signal_bz || []).map(formatCandidate).join('\n'),
    ].filter(Boolean).join('\n') || '(없음)',
  ].join('\n');

  const prompt = `너는 블로그 편집장이다. 아래 작가 3명이 각각 오늘 2편씩 총 6편을 쓴다. 전체 후보 풀에서 정확히 6개를 골라야 한다.

## 작가
${writersDesc}

## 후보 풀 (반드시 아래 목록에 있는 키워드만 선택. 괄호 안 검색량은 네이버 블로그 검색결과 수 기준)
${candidatesText}

## 규칙
1. **작가의 categories와 bio에 가장 적합한 주제를 우선** 선택한다. 소스별 개수는 고정하지 않는다.
2. **dalsanchek(달산책)**: 라이프스타일·감성·힐링·여행·에세이 전문. **실시간 트렌드 중 사건/사고·정치·자극 이슈는 절대 배정하지 말 것.** 네이버 뉴스(naver_news) 그룹의 여행/전시/힐링/주말 나들이 성격 주제를 우선 배정.
3. **textree(텍스트리)**: IT·테크·경제·생산성·AI 전문. 트렌드·테크 주제 적합.
4. **bbittul(삐뚤빼뚤)**: 트렌드·엔터·맛집·이슈·밈 전문. 구글 트렌드/유튜브/시그널 등 실시간 이슈 배정 적합.
5. 같은 키워드는 한 번만 선택. 6개 모두 서로 다른 키워드.
6. 각 선택에 대해 "선정 이유"를 한 줄로 한국어로 써줘.

## 응답 형식 (JSON만, 다른 텍스트 없이)
source는 후보 풀에 표시된 값 그대로: seasonal | naver_news | google_trends_rss | youtube_popular | signal_bz
{
  "selections": [
    { "writerId": "dalsanchek", "keyword": "후보에 나온 키워드 그대로", "source": "naver_news", "rationale": "한 줄 선정 이유" },
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
