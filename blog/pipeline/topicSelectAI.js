/**
 * AI(Gemini)로 일일 6편 주제 추론 선정 + 선정 이유 생성
 * 전체 풀(~25개, 7소스)에서 각 작가 페르소나에 맞는 주제를 [Source_Tag]와 함께 전달해 작가당 2개씩 선택.
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

/** JSON 파싱 실패 시 selections만 정규식으로 추출 시도 (따옴표/줄바꿈으로 깨진 경우) */
function tryRepairSelectionsJson(jsonStr) {
  const selections = [];
  const blockRe = /\{\s*"writerId"\s*:\s*"([^"]*)"\s*,\s*"keyword"\s*:\s*"((?:[^"\\]|\\.)*?)"\s*,\s*"source"\s*:\s*"([^"]*)"\s*,\s*"rationale"\s*:\s*"((?:[^"\\]|\\.)*?)"\s*\}/g;
  let m;
  while ((m = blockRe.exec(jsonStr)) !== null && selections.length < 6) {
    selections.push({
      writerId: m[1].trim(),
      keyword: (m[2] || '').replace(/\\"/g, '"').trim(),
      source: (m[3] || '').trim(),
      rationale: (m[4] || '').replace(/\\"/g, '"').trim(),
    });
  }
  if (selections.length < 6) {
    const simpleRe = /\{\s*"writerId"\s*:\s*"([^"]*)"\s*,\s*"keyword"\s*:\s*"([^"]*)"\s*,\s*"source"\s*:\s*"([^"]*)"\s*,\s*"rationale"\s*:\s*"([^"]*)"\s*\}/g;
    selections.length = 0;
    while ((m = simpleRe.exec(jsonStr)) !== null && selections.length < 6) {
      selections.push({
        writerId: m[1].trim(),
        keyword: (m[2] || '').trim(),
        source: (m[3] || '').trim(),
        rationale: (m[4] || '').trim(),
      });
    }
  }
  if (selections.length >= 6) {
    console.warn('[TopicSelectAI] JSON 복구로 selections', selections.length, '개 추출');
    return { selections: selections.slice(0, 6) };
  }
  return null;
}

/** AI가 반환한 키워드와 풀 제목 매칭용 정규화 (공백·말줄임 통일) */
function normalizeKeywordForMatch(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\s+/g, ' ')
    .replace(/[.．…]+$/g, '')
    .trim();
}

/** 정확히 일치하지 않을 때 풀 후보 중 가장 비슷한 항목 찾기 (접두사/포함, 미사용만) */
function findBestMatchCandidate(selKeyword, candidatesPool, usedKeywords) {
  const norm = normalizeKeywordForMatch(selKeyword);
  if (!norm) return null;
  for (const c of candidatesPool) {
    if (usedKeywords.has(c.keyword)) continue;
    const poolKey = (c.keyword || '').trim();
    const poolNorm = normalizeKeywordForMatch(poolKey);
    if (poolNorm === norm || poolKey === norm) return c;
    if (poolNorm.startsWith(norm) || norm.startsWith(poolNorm)) return c;
    if (poolKey.length >= 10 && (poolKey.includes(norm) || norm.includes(poolKey))) return c;
  }
  return null;
}

/**
 * 후보 풀과 작가 정보로 AI가 6편 선정 (2 per writer) + 선정 이유
 * @param {Array} candidatesPool - [{ keyword, source, sourceTag, category }, ...] (전체 풀 ~25개)
 * @param {Array} writers - [{ id, nickname, categories, bio }, ...]
 * @returns {Promise<{ plan: Array|null, error?: string }>} plan 성공 시 { plan }, 실패 시 { plan: null, error: '사유' }
 */
async function selectTopicsWithAI(candidatesPool, writers) {
  const writersDesc = writers
    .map(
      (w) =>
        `- ${w.id}: ${w.nickname}, 전문분야 [${(w.categories || []).join(', ')}], 소개: ${(w.bio || '').slice(0, 80)}...`
    )
    .join('\n');

  const SOURCE_TAGS = ['Nate_Trend', 'Naver_Dalsanchek', 'Naver_Textree', 'Naver_Bbittul', 'Seasonal'];
  const byTag = {};
  SOURCE_TAGS.forEach((tag) => { byTag[tag] = []; });
  for (const c of candidatesPool) {
    const tag = c.sourceTag || c.source || 'Seasonal';
    if (byTag[tag]) byTag[tag].push(c);
    else byTag[tag] = [c];
  }

  const formatCandidate = (c, i) => {
    const tag = c.sourceTag || c.source || '';
    const prefix = tag ? `[${tag}] ` : '';
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
    return `${i + 1}. ${prefix}${c.keyword}${vol}`;
  };

  const candidatesText = SOURCE_TAGS.map((tag) => {
    const list = byTag[tag] || [];
    const label = tag === 'Nate_Trend' ? 'Nate_Trend (실시간 이슈)' : tag;
    return `## ${label}\n${list.map(formatCandidate).join('\n') || '(없음)'}`;
  }).join('\n\n');

  const prompt = `너는 블로그 편집장이다. 아래 작가 3명이 각각 오늘 2편씩 총 6편을 쓴다. 전체 후보 풀에서 정확히 6개를 골라야 한다.

## 작가
${writersDesc}

## 후보 풀 (각 항목 앞 [Source_Tag]는 출처·성격 표시. 반드시 아래 목록에 **적힌 키워드를 한 글자도 바꾸지 말고 그대로** 선택)
${candidatesText}

## 규칙
1. **작가의 페르소나(categories, bio)와 가장 적합한 주제를 우선 매칭**한다. keyword 필드에는 반드시 위 후보 목록에 나온 문자열을 **그대로 복사**한다.
2. **dalsanchek(달산책)**: 라이프스타일·감성·힐링·여행·에세이 전문. [Naver_Dalsanchek], [Seasonal] 위주로 배정. [Nate_Trend]는 트렌드성이라 필요 시에만.
3. **textree(텍스트리)**: IT·테크·경제·생산성·AI 전문. [Naver_Textree], [Nate_Trend] 적합.
4. **bbittul(삐뚤빼뚤)**: 트렌드·엔터·맛집·이슈·밈 전문. [Nate_Trend], [Naver_Bbittul] 위주로 배정.
5. 같은 키워드는 한 번만 선택. 6개 모두 서로 다른 키워드.
6. 각 선택에 대해 "선정 이유"를 한 줄로 한국어로 써줘.

## 응답 형식 (JSON만, 다른 텍스트 없이)
source는 위 태그명 그대로: Nate_Trend | Naver_Dalsanchek | Naver_Textree | Naver_Bbittul | Seasonal
keyword와 rationale 값 안에는 큰따옴표(\")나 줄바꿈을 넣지 마라. 제목에 따옴표가 있으면 생략하거나 공백으로 써라.
{
  "selections": [
    { "writerId": "dalsanchek", "keyword": "후보에 나온 키워드 그대로", "source": "Naver_Dalsanchek", "rationale": "한 줄 선정 이유" },
    ...총 6개
  ]
}`;

  let raw;
  try {
    raw = await callGemini(prompt, 2048);
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[TopicSelectAI] Gemini API 오류:', msg);
    return { plan: null, error: `API 오류: ${msg.slice(0, 80)}` };
  }

  let jsonStr = raw
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }
  // AI가 문자열 값 안에 줄바꿈을 넣으면 JSON이 깨지므로 제거
  jsonStr = jsonStr.replace(/\r\n?|\n/g, ' ').replace(/\s+/g, ' ').trim();

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    const repaired = tryRepairSelectionsJson(jsonStr);
    if (repaired) {
      data = repaired;
    } else {
      console.warn('[TopicSelectAI] JSON 파싱 실패:', e.message, '응답 앞 200자:', jsonStr.slice(0, 200));
      return { plan: null, error: `JSON 파싱 실패: ${e.message}` };
    }
  }

  const selections = data?.selections;
  if (!Array.isArray(selections) || selections.length !== 6) {
    console.warn('[TopicSelectAI] selections 개수 이상:', selections?.length);
    return { plan: null, error: `AI가 6개가 아닌 ${selections?.length ?? 0}개 반환` };
  }

  const keywordToCandidate = new Map();
  for (const c of candidatesPool) {
    keywordToCandidate.set((c.keyword || '').trim(), c);
  }

  const plan = writers.map((w) => ({ writer: w, topics: [] }));
  const usedKeywords = new Set();

  for (const sel of selections) {
    const writerIndex = writers.findIndex((w) => w.id === sel.writerId);
    if (writerIndex === -1) continue;
    const k = (sel.keyword || '').trim();
    let candidate =
      keywordToCandidate.get(k) ||
      candidatesPool.find((c) => (c.keyword || '').trim() === k);
    if (!candidate) candidate = findBestMatchCandidate(k, candidatesPool, usedKeywords);
    if (!candidate) {
      console.warn('[TopicSelectAI] 풀에 없는 키워드 스킵:', sel.writerId, k.slice(0, 50));
      continue;
    }
    if (usedKeywords.has(candidate.keyword)) continue;
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
    console.warn('[TopicSelectAI] 선정 결과 6편 미만:', totalTopics, '(키워드 매칭 실패로 일부 스킵됨)');
    return { plan: null, error: `키워드 매칭 실패: 6개 중 ${totalTopics}개만 매칭됨. AI가 풀에 없는 키워드를 반환했을 수 있음.` };
  }

  console.log('[TopicSelectAI] 6편 선정 완료 (AI 추론)');
  return { plan };
}

module.exports = { selectTopicsWithAI };
