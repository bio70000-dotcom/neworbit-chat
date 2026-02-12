/**
 * 구글 트렌드 일일 검색어 RSS (한국 geo=KR) 파싱
 * URL 후보 순서대로 시도 (trending/rss가 공식 문서 기준)
 */

const RSS_URL_CANDIDATES = [
  'https://trends.google.com/trending/rss?geo=KR',
  'https://trends.google.co.kr/trendingsearches/daily/rss?geo=KR',
];
const DEFAULT_TOP = 5;

/**
 * KR 일일 트렌드 RSS에서 상위 N개 키워드 수집 (여러 URL 시도)
 * @param {number} topN - 수집 개수 (기본 5)
 * @returns {Promise<Array<{keyword: string, category: string, source: string}>>}
 */
async function getGoogleTrendsDailyKR(topN = DEFAULT_TOP) {
  for (const url of RSS_URL_CANDIDATES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
      });
      clearTimeout(timeout);
      const xml = await res.text();
      if (!res.ok) {
        console.warn('[GoogleTrendsRss] RSS 요청 실패:', url, res.status, xml.slice(0, 150));
        continue;
      }
      const keywords = parseTrendTitlesFromRss(xml, topN);
      if (keywords.length > 0) {
        console.log(`[GoogleTrendsRss] KR 일일 트렌드 ${keywords.length}개 수집 (${url})`);
        return keywords.map((keyword) => ({
          keyword,
          category: 'trending',
          source: 'google_trends_rss',
        }));
      }
      if (xml.includes('<item>') || xml.includes('<entry>')) {
        console.warn('[GoogleTrendsRss] XML에 item/entry 있으나 파싱 0건:', url, xml.slice(0, 300));
      } else {
        console.warn('[GoogleTrendsRss] RSS 형식 아님:', url, xml.slice(0, 200));
      }
    } catch (e) {
      clearTimeout(timeout);
      console.warn('[GoogleTrendsRss] 수집 실패:', url, e.message);
    }
  }
  console.warn('[GoogleTrendsRss] 모든 URL 시도 후 0건 반환');
  return [];
}

/**
 * RSS <item> 또는 Atom <entry> 블록 내 <title> 추출 (상위 topN개)
 */
function parseTrendTitlesFromRss(xml, topN) {
  const out = [];
  const itemBlockRe = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let block;
  while ((block = itemBlockRe.exec(xml)) !== null && out.length < topN) {
    const itemXml = block[1];
    const titleM = /<title(?:[^>]*)?>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i.exec(itemXml);
    const raw = (titleM ? (titleM[1] ?? titleM[2] ?? '') : '').trim();
    const clean = raw.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (clean.length >= 2) out.push(clean);
  }
  return out.slice(0, topN);
}

module.exports = { getGoogleTrendsDailyKR };
