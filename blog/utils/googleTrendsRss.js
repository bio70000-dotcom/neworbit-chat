/**
 * 구글 트렌드 일일 검색어 RSS (한국 geo=KR) 파싱
 * npm 패키지 없이 해당 URL만 사용
 */

const DAILY_RSS_URL = 'https://trends.google.co.kr/trendingsearches/daily/rss?geo=KR';
const DEFAULT_TOP = 5;

/**
 * KR 일일 트렌드 RSS에서 상위 N개 키워드 수집
 * @param {number} topN - 수집 개수 (기본 5)
 * @returns {Promise<Array<{keyword: string, category: string, source: string}>>}
 */
async function getGoogleTrendsDailyKR(topN = DEFAULT_TOP) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(DAILY_RSS_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timeout);
    const xml = await res.text();
    if (!res.ok) {
      console.warn('[GoogleTrendsRss] RSS 요청 실패:', res.status);
      return [];
    }

    const keywords = parseTrendTitlesFromRss(xml, topN);
    console.log(`[GoogleTrendsRss] KR 일일 트렌드 ${keywords.length}개 수집`);
    return keywords.map((keyword) => ({
      keyword,
      category: 'trending',
      source: 'google_trends_rss',
    }));
  } catch (e) {
    clearTimeout(timeout);
    console.warn('[GoogleTrendsRss] 수집 실패:', e.message);
    return [];
  }
}

/**
 * RSS XML에서 <item> 블록 내 <title>만 추출 (채널 title 제외, 상위 topN개)
 */
function parseTrendTitlesFromRss(xml, topN) {
  const out = [];
  const itemBlockRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let block;
  while ((block = itemBlockRe.exec(xml)) !== null && out.length < topN) {
    const itemXml = block[1];
    const titleM = /<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/i.exec(itemXml);
    const raw = (titleM ? (titleM[1] ?? titleM[2] ?? '') : '').trim();
    const clean = raw.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (clean.length >= 2) out.push(clean);
  }
  return out.slice(0, topN);
}

module.exports = { getGoogleTrendsDailyKR };
