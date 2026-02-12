/**
 * 네이트(Nate) 실시간 이슈 키워드 수집
 * EUC-KR 응답 → iconv-lite로 UTF-8 디코딩, 금지어 필터 적용
 */

const NATE_URL = 'https://www.nate.com/js/data/jsonLiveKeywordDataV1.js?cp=1';

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

  try {
    const res = await fetch(NATE_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    clearTimeout(timeout);
    const buf = await res.arrayBuffer();
    if (!res.ok) {
      console.warn('[NateTrends] 요청 실패:', res.status);
      return [];
    }
    const decoded = iconv.decode(Buffer.from(buf), 'euc-kr');
    const raw = decoded.trim();

    let list = [];
    const jsonMatch = raw.match(/\b(?:result|data|liveKeywordData|jsonLiveKeywordData)\s*=\s*(\[[\s\S]*?\])\s*;?/);
    if (jsonMatch) {
      try {
        list = JSON.parse(jsonMatch[1]);
      } catch (e) {}
    }
    if (!Array.isArray(list) && /^\s*\[/.test(raw)) {
      try {
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (arrMatch) list = JSON.parse(arrMatch[0]);
      } catch (e) {}
    }

    const out = [];
    for (const item of list) {
      if (out.length >= maxCount) break;
      const keyword = typeof item === 'string' ? item : (item?.keyword ?? item?.word ?? item?.name ?? item?.title ?? '');
      const kw = String(keyword).trim().replace(/\s+/g, ' ');
      if (kw.length < 2) continue;
      if (isBanned(kw)) continue;
      const rank = typeof item === 'object' && item && typeof item.rank === 'number' ? item.rank : out.length + 1;
      out.push({
        keyword: kw,
        category: 'trending',
        source: 'nate_trend',
        rank,
      });
    }
    console.log(`[NateTrends] 실시간 이슈 ${list.length}건 중 금지어 제외 후 ${out.length}개 수집`);
    return out;
  } catch (e) {
    clearTimeout(timeout);
    console.warn('[NateTrends] 수집 실패:', e.message);
    return [];
  }
}

module.exports = { getNateTrendTopics };
