/**
 * AI(Gemini)로 일일 6편 주제 추론 선정 + 선정 이유 생성
 * 전체 풀(~35개)에서 각 작가 페르소나에 맞는 주제를 선정하여 JSON으로 반환.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

/** 주제 선정 응답을 배열로 강제하기 위한 JSON Schema (responseJsonSchema용) */
const TOPIC_SELECTION_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      writerId: { type: 'string', description: 'dalsanchek | textree | bbittul' },
      keyword: { type: 'string', description: '후보 풀의 키워드 그대로' },
      source: { type: 'string', description: '소스 태그' },
      rationale: { type: 'string', description: '선정 이유 한 줄' },
    },
    required: ['writerId', 'keyword', 'source', 'rationale'],
  },
  minItems: 6,
  maxItems: 6,
};

/**
 * @param {string} prompt
 * @param {number} [maxTokens=4096]
 * @param {{ responseJsonSchema?: object }} [extraConfig] - generationConfig에 병합 (예: responseJsonSchema로 배열 출력 강제)
 */
async function callGemini(prompt, maxTokens = 4096, extraConfig = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: 0.3,
    responseMimeType: 'application/json',
    ...extraConfig,
  };

  const url = `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
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

/** trailing comma 제거 ( ] 또는 } 앞의 , 제거) — Gemini가 가끔 넣음 */
function removeTrailingCommas(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') return jsonStr;
  return jsonStr.replace(/,(\s*[}\]])/g, '$1');
}

/** JSON 파싱 헬퍼. 접두 설명문 제거, 마크다운 코드 블록 제거 후 파싱 */
function safeParseJSON(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = s.search(/[\[{]/);
  if (firstBrace > 0) s = s.slice(firstBrace);
  for (const candidate of [s, removeTrailingCommas(s), s.replace(/\r\n/g, '\n')]) {
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }
  console.error('[TopicSelectAI] JSON 파싱 실패 raw 앞 150자:', raw.slice(0, 150));
  return null;
}

/** raw 문자열에서 괄호 균형으로 첫 번째 JSON 배열 구간 추출 (문자열 내 ] 대비) */
function extractArraySliceFromRaw(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let i = raw.indexOf('[');
  while (i !== -1) {
    let depth = 1;
    let inString = false;
    let escape = false;
    let quote = null;
    for (let j = i + 1; j < raw.length; j++) {
      const c = raw[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === quote) inString = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        quote = c;
        continue;
      }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return raw.slice(i, j + 1);
      }
    }
    i = raw.indexOf('[', i + 1);
  }
  return null;
}

/** 객체 트리에서 첫 배열을 재귀 탐색 (최대 깊이 5) */
function findFirstArrayInObject(obj, depth = 0) {
  if (depth > 5 || obj == null) return null;
  if (Array.isArray(obj)) return obj;
  if (typeof obj !== 'object') return null;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v;
    const found = findFirstArrayInObject(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** 파싱 결과 또는 raw에서 선정 배열 추출. 객체 래퍼·다단계 중첩·raw 괄호 균형 대비 */
function extractSelectionsArray(parsedData, rawResponse) {
  if (Array.isArray(parsedData)) return parsedData;
  const objectKeys = [
    'selections',
    'topics',
    'data',
    'choices',
    'result',
    'output',
    'items',
    'topic_selections',
    'topicSelections',
  ];
  if (parsedData && typeof parsedData === 'object') {
    for (const key of objectKeys) {
      const val = parsedData[key];
      if (Array.isArray(val)) return val;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const nested = Object.values(val).find((v) => Array.isArray(v));
        if (nested) return nested;
      }
    }
    if (parsedData.choices?.[0]?.message?.content) {
      const inner = safeParseJSON(parsedData.choices[0].message.content);
      if (Array.isArray(inner)) return inner;
    }
    const firstArray = Object.values(parsedData).find((v) => Array.isArray(v));
    if (firstArray) return firstArray;
    const deepArray = findFirstArrayInObject(parsedData);
    if (deepArray) return deepArray;
  }
  if (rawResponse && typeof rawResponse === 'string') {
    let slice = extractArraySliceFromRaw(rawResponse);
    if (slice) {
      slice = removeTrailingCommas(slice);
      const arr = safeParseJSON(slice);
      if (Array.isArray(arr)) return arr;
    }
  }
  return null;
}

function normalizeKeywordForMatch(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\s+/g, ' ').replace(/[.．…]+$/g, '').trim();
}

/** AI가 반환한 키워드에서 매체명 접미사 제거 (예: "제목 - KBS 뉴스" → "제목") */
function stripMediaSuffix(keyword) {
  if (!keyword || typeof keyword !== 'string') return '';
  const t = keyword.trim();
  const idx = t.lastIndexOf(' - ');
  return idx > 0 ? t.slice(0, idx).trim() : t;
}

/** 따옴표·공백 정규화 후 비교용 문자열 */
function normalizeForCompare(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\s+/g, ' ')
    .replace(/[''"`]/g, "'")
    .replace(/[.．…]+$/g, '')
    .trim();
}

function findBestMatchCandidate(selKeyword, candidatesPool, usedKeywords) {
  const raw = (selKeyword || '').trim();
  const withoutMedia = stripMediaSuffix(raw);
  const norm = normalizeKeywordForMatch(raw);
  const normNoMedia = normalizeKeywordForMatch(withoutMedia);
  const compareSel = normalizeForCompare(raw);
  const compareSelNoMedia = normalizeForCompare(withoutMedia);
  if (!norm && !normNoMedia) return null;

  for (const c of candidatesPool) {
    if (usedKeywords.has(c.keyword)) continue;

    const poolKey = (c.keyword || '').trim();
    const poolNorm = normalizeKeywordForMatch(poolKey);
    const poolCompare = normalizeForCompare(poolKey);

    if (poolNorm === norm || poolKey === norm) return c;
    if (poolNorm === normNoMedia || poolKey === normNoMedia) return c;
    if (poolCompare === compareSel || poolCompare === compareSelNoMedia) return c;
    if (poolKey.length > 2 && (poolNorm.includes(norm) || norm.includes(poolNorm))) return c;
    if (poolKey.length > 2 && (poolNorm.includes(normNoMedia) || normNoMedia.includes(poolNorm))) return c;
    if (poolKey.length > 10 && compareSelNoMedia.length >= 8 && poolCompare.includes(compareSelNoMedia)) return c;
    if (poolKey.length > 10 && compareSel.length >= 8 && poolCompare.includes(compareSel)) return c;
  }
  return null;
}

/**
 * 작가별 배정 가능 소스(태그) 목록 생성. writers.js 단일 정보원 기반.
 * - Naver_ + id 첫 글자 대문자 (dalsanchek → Naver_Dalsanchek)
 * - newsCategories → Google_News_건강 등 (슬래시는 언더스코어로)
 * - dalsanchek: Seasonal 추가, textree/bbittul: Nate_Trend 추가
 */
function getPreferredSourceTagsForWriter(writer) {
  if (!writer || !writer.id) return [];
  const id = (writer.id || '').toLowerCase();
  const tags = new Set();
  const naverTag = 'Naver_' + id.charAt(0).toUpperCase() + id.slice(1);
  tags.add(naverTag);
  const newsCats = writer.newsCategories || [];
  for (const cat of newsCats) {
    if (cat && typeof cat === 'string') {
      tags.add('Google_News_' + String(cat).replace(/\//g, '_'));
    }
  }
  if (id === 'dalsanchek') tags.add('Seasonal');
  if (id === 'textree' || id === 'bbittul') tags.add('Nate_Trend');
  return [...tags];
}

/**
 * 후보 풀과 작가 정보로 AI가 6편 선정 (2 per writer) + 선정 이유
 */
async function selectTopicsWithAI(candidatesPool, writers) {
  const writerPreferredTagsMap = new Map();
  const writerPreferredTagsLines = [];
  for (const w of writers) {
    const tags = getPreferredSourceTagsForWriter(w);
    writerPreferredTagsMap.set((w.id || '').toLowerCase(), new Set(tags));
    writerPreferredTagsLines.push(`- ID "${w.id}": 배정 가능 소스(태그) = ${tags.map((t) => `[${t}]`).join(', ')}`);
  }

  const writersDesc = writers
    .map(
      (w) => {
        const newsCats = (w.newsCategories || []).length ? `, 구글뉴스카테고리: [${w.newsCategories.join(', ')}]` : '';
        return `- ID: "${w.id}", 닉네임: "${w.nickname}", 전문분야: [${(w.categories || []).join(', ')}]${newsCats}, 성향: ${w.bio || ''}`;
      }
    )
    .join('\n');

  const writerTopicFitLines = [
    '달산책(dalsanchek): 라이프스타일·감성·여행·힐링·일상에 맞는 주제만 배정. IT/경제/정치 성격이면 배정 금지.',
    '텍스트리(textree): IT·테크·경제·리뷰·생산성에 맞는 주제만 배정. 연예·먹거리·정치 성격이면 배정 금지.',
    '삐뚤빼뚤(bbittul): 트렌드·엔터·먹거리·꿀팁·리뷰 성격만 배정. 정치·선거·인물 논란 등은 전문영역이 아니므로 배정 금지.',
  ];

  const formattedCandidates = candidatesPool
    .map((c, i) => {
      const tag = c.sourceTag || c.source || 'Seasonal';
      return `${i + 1}. [${tag}] ${c.keyword}`;
    })
    .join('\n');

  const allowedSourcesBlock = writerPreferredTagsLines.join('\n');

  const prompt = `
너는 블로그 편집장이다. 아래 제공된 [후보 풀]에서 오늘 작성할 블로그 주제 6개를 선정하라.
작가 3명에게 각각 2개씩, 총 6개의 주제를 배정해야 한다.

## 작가 정보
${writersDesc}

## 각 작가별 배정 가능 소스(태그) — 이 태그가 붙은 풀 항목만 해당 작가에게 배정 가능
${allowedSourcesBlock}

## 각 작가에게 배정할 주제 성격 (취향·전문영역 준수)
${writerTopicFitLines.join('\n')}

## 후보 풀 (각 항목은 [소스태그] 키워드 형식. 여기 있는 텍스트 그대로 사용)
${formattedCandidates}

## 배정 규칙
1. **소스 + 내용 적합성 둘 다 필수:**
   - (1) 해당 작가의 **배정 가능 소스(태그)**에 해당하는 풀 항목만 선정할 것.
   - (2) **주제 키워드/제목의 성격이 해당 작가의 전문분야(categories)·성향(bio)과 부합하는 항목만** 그 작가에게 배정할 것. 소스 태그가 맞아도, 주제 내용이 작가의 취향·전문영역과 무관하면 그 작가에게 배정하지 말 것.
2. **복사 필수:** 선정된 주제의 'keyword'는 후보 풀에 적힌 텍스트를 **절대 수정하지 말고 그대로** 사용하라.
3. **중복 금지:** 6개의 주제는 모두 달라야 한다.
4. **rationale:** rationale 필드에는 **해당 작가의 전문분야·성향에 이 주제가 맞는 이유**를 한 줄로 구체적으로 작성하라 (예: 달산책의 여행·힐링 성향에 부합, 삐뚤빼뚤의 트렌드·엔터 영역에 맞는 주제).
5. **결과물:** 반드시 JSON 배열만 출력하라. 객체로 감싸지 말고, 설명이나 접두 문장 없이 응답 전체가 \`[\` 로 시작하는 배열 하나만 출력할 것. (마크다운 없이 JSON만)

## 응답 형식 (JSON Array)
[
  { "writerId": "dalsanchek", "keyword": "후보 풀에 있는 키워드 그대로 복사", "source": "Naver_Dalsanchek 또는 Google_News_건강 등", "rationale": "해당 작가 전문분야·성향에 맞는 이유 한 줄" },
  ... (총 6개 객체)
]
`;

  let rawResponse;
  try {
    rawResponse = await callGemini(prompt, 4096, {
      responseJsonSchema: TOPIC_SELECTION_RESPONSE_SCHEMA,
    });
  } catch (e) {
    return { plan: null, error: `Gemini 호출 실패: ${e.message}`, apiError: true };
  }

  // 디버깅용: 매 호출마다 raw 응답 본문 출력
  console.warn('[TopicSelectAI] Gemini raw 응답 본문 (길이 %d):\n%s', rawResponse?.length ?? 0, rawResponse ?? '(null)');

  const parsedData = safeParseJSON(rawResponse);
  const selectionsArray = extractSelectionsArray(parsedData, rawResponse);

  if (!selectionsArray || !Array.isArray(selectionsArray)) {
    console.warn('[TopicSelectAI] 배열 추출 실패. raw 앞 200자:', rawResponse?.slice(0, 200));
    if (parsedData != null) {
      console.warn(
        '[TopicSelectAI] parsedData: typeof=%s, isArray=%s, keys=%s',
        typeof parsedData,
        Array.isArray(parsedData),
        typeof parsedData === 'object' ? Object.keys(parsedData).slice(0, 10).join(',') : '-'
      );
    }
    return { plan: null, error: 'AI 응답이 JSON 배열 형식이 아닙니다.' };
  }

  if (selectionsArray.length < 6) {
    return { plan: null, error: `AI가 ${selectionsArray.length}개만 선정했습니다. (6개 필요)` };
  }

  const plan = writers.map((w) => ({ writer: w, topics: [] }));
  const usedKeywords = new Set();

  for (const item of selectionsArray.slice(0, 6)) {
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

    const sourceTag = (candidate.sourceTag || candidate.source || '').trim();
    const allowedTags = writerPreferredTagsMap.get(writerId);
    if (allowedTags && sourceTag && !allowedTags.has(sourceTag)) {
      console.warn(
        '[TopicSelectAI] 작가 %s에 부적합 소스 "%s" 선정됨 (배정 가능: %s). 키워드: %s',
        writerId,
        sourceTag,
        [...allowedTags].join(', '),
        keywordRaw.slice(0, 60)
      );
    }

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
