/**
 * 네이트(Nate) 실시간 이슈 키워드 수집
 * EUC-KR 응답 → iconv-lite로 UTF-8 디코딩, 금지어 필터 적용
 * 참고: 응답은 JSON 배열 또는 [순위, 키워드] 배열의 배열 형태
 */

const NATE_BASE = 'https://www.nate.com/js/data/jsonLiveKeywordDataV1.js';

function getNateUrls() {
  const v = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return [
    `${NATE_BASE}?cp=1&v=${v}`,
    `${NATE_BASE}?cp=1`,
  ];
}

/** 블로그 품질을 위해 수집 단계에서 제외할 키워드 (포함 시 제외) */
const BAN_KEYWORDS = [
  '대통령', '정당', '더불어민주당', '국민의힘', '탄핵', '검찰', '속보', '사망', '살인', '구속',
];

function isBanned(keyword) {
  if (!keyword || typeof keyword !== 'string') return true;
  const k = keyword.trim();
  return BAN_KEYWORDS.some((b) => k.includes(b));
}

/**
 * 네이트 실시간 이슈 상위 N개 수집 (금지어 제외)
 * @param {number} maxCount - 수집 목표 개수 (기본 10)
 * @returns {Promise<Array<{keyword: string, category: string, source: string, rank?: number}>>}
 */
async function getNateTrendTopics(maxCount = 10) {
  let iconv;
  try {
    iconv = require('iconv-lite');
  } catch (e) {
    console.warn('[NateTrends] iconv-lite 미설치:', e.message);
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const urls = getNateUrls();
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': 'https://www.nate.com/',
        },
      });
      clearTimeout(timeout);
      const buf = await res.arrayBuffer();
      if (!res.ok) {
        console.warn('[NateTrends] 요청 실패:', url, res.status);
        continue;
      }
    const buffer = Buffer.from(buf);
    let raw = '';
    try {
      raw = iconv.decode(buffer, 'euc-kr').trim();
    } catch (e) {
      try {
        raw = iconv.decode(buffer, 'cp949').trim();
      } catch (e2) {
        raw = buffer.toString('utf-8').trim();
      }
    }
    let list = [];
    const tryParse = (str) => {
      let out = [];
      const toParse = str.trim().startsWith('[') ? str.trim() : str.replace(/^[\s\S]*?(\[[\s\S]*\])\s*;?\s*$/, '$1');
      try {
        out = JSON.parse(toParse);
      } catch (e) {}
      return Array.isArray(out) ? out : [];
    };
    list = tryParse(raw);
    if (list.length === 0 && raw.length > 20) {
      raw = buffer.toString('utf-8').trim();
      list = tryParse(raw);
    }
    if (raw.length < 10) {
      console.warn('[NateTrends] 응답 본문 너무 짧음:', raw.length);
      continue;
    }
    if (list.length === 0) {
      const jsonMatch = raw.match(/\b(?:result|data|liveKeywordData|jsonLiveKeywordData)\s*=\s*(\[[\s\S]*\])\s*;?\s*$/m)
        || raw.match(/\b(?:result|data|liveKeywordData|jsonLiveKeywordData)\s*=\s*(\[[\s\S]*?\])\s*;?/);
      if (jsonMatch) {
        try {
          list = JSON.parse(jsonMatch[1]);
        } catch (e) {}
      }
      if (list.length === 0 && raw.includes('[')) {
        const firstBracket = raw.indexOf('[');
        const lastBracket = raw.lastIndexOf(']');
        if (lastBracket > firstBracket) {
          try {
            list = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
          } catch (e) {}
        }
      }
    }
    if (!Array.isArray(list) || list.length === 0) {
      console.warn('[NateTrends] 배열 파싱 실패. 응답 앞 400자:', raw.slice(0, 400));
      continue;
    }

    const out = [];
    for (const item of list) {
      if (out.length >= maxCount) break;
      let keyword = '';
      let rank = out.length + 1;
      // 네이트 형식: ["1", "법원, 이상민 단전·단수 인정", "n", "0", "짧은키워드"] → item[1]이 키워드
      if (Array.isArray(item)) {
        keyword = (item[1] ?? item[0] ?? '').toString().trim();
        const r = item[0];
        if (r != null) rank = typeof r === 'number' ? r : parseInt(String(r), 10) || rank;
      } else if (typeof item === 'string') {
        keyword = item.trim();
      } else if (item && typeof item === 'object') {
        keyword = (item.keyword ?? item.word ?? item.name ?? item.title ?? item.text ?? '').toString().trim();
        if (typeof item.rank === 'number') rank = item.rank;
      }
      const kw = keyword.replace(/\s+/g, ' ');
      if (kw.length < 2) continue;
      if (isBanned(kw)) continue;
      out.push({
        keyword: kw,
        category: 'trending',
        source: 'nate_trend',
        rank,
      });
    }
      console.log(`[NateTrends] 실시간 이슈 ${list.length}건 중 금지어 제외 후 ${out.length}개 수집 (${url})`);
      return out;
    } catch (e) {
      clearTimeout(timeout);
      console.warn('[NateTrends] 수집 실패:', url, e.message);
    }
  }
  return [];
}

module.exports = { getNateTrendTopics };
