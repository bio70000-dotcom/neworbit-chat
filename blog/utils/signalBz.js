/**
 * 시그널(signal.bz) 실시간 검색어 크롤링
 * 공식 API 없음. HTML 또는 __NEXT_DATA__ 등에서 키워드 추출
 */

const SIGNAL_URLS = ['https://www.signal.bz/', 'https://signal.bz/'];

/**
 * HTML에서 실시간 검색어 후보 추출 (여러 셀렉터 시도)
 */
function extractKeywordsFromHtml($, maxCount) {
  const keywords = [];
  const seen = new Set();

  const push = (text) => {
    const t = (text || '').trim();
    if (t.length >= 2 && t.length <= 80 && !seen.has(t) && !/^\d+$/.test(t) && !/^[\d.]+\s*$/.test(t)) {
      seen.add(t);
      keywords.push(t);
    }
  };

  $('li').each((i, el) => { push($(el).text()); });
  if (keywords.length < maxCount) {
    $('[class*="rank"]').each((i, el) => { push($(el).text()); });
    $('[class*="keyword"]').each((i, el) => { push($(el).text()); });
    $('[class*="search"]').each((i, el) => { push($(el).text()); });
  }
  if (keywords.length < maxCount) {
    $('a').each((i, el) => { push($(el).text()); });
  }
  return keywords.slice(0, maxCount);
}

/**
 * __NEXT_DATA__ 스크립트에서 키워드 배열 추출 시도
 */
function extractFromNextData(html, maxCount) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const json = JSON.parse(match[1]);
    const props = json?.props?.pageProps || json?.props || {};
    const list = props.realtimeKeywords || props.keywords || props.list || [];
    if (Array.isArray(list)) {
      return list.slice(0, maxCount).map((x) => (typeof x === 'string' ? x : x?.keyword || x?.word || x?.text || '')).filter((t) => t.length >= 2 && t.length <= 80);
    }
    if (typeof list === 'object' && list.items) {
      return list.items.slice(0, maxCount).map((x) => x?.keyword || x?.word || x?.text || '').filter(Boolean);
    }
  } catch (e) {}
  return [];
}

/**
 * 시그널 실시간 검색어 상위 maxCount개 수집
 * @param {number} maxCount
 * @returns {Promise<Array<{keyword: string, category: string, source: string}>>}
 */
async function getSignalTopics(maxCount = 5) {
  let cheerio;
  try {
    cheerio = require('cheerio');
  } catch (e) {
    console.warn('[SignalBz] cheerio 미설치:', e.message);
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  };

  for (const url of SIGNAL_URLS) {
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const html = await res.text();
      if (html.length < 500) {
        console.warn('[SignalBz] 응답 본문 짧음:', url, html.length);
        continue;
      }

      let keywords = extractFromNextData(html, maxCount);
      if (keywords.length === 0) {
        const $ = cheerio.load(html);
        keywords = extractKeywordsFromHtml($, maxCount);
      }
      if (keywords.length > 0) {
        const result = keywords.map((keyword) => ({ keyword, category: 'trending', source: 'signal_bz' }));
        console.log(`[SignalBz] 실시간 검색어 ${result.length}개 수집 (${url})`);
        return result;
      }
      console.warn('[SignalBz] 키워드 0건 추출, HTML 샘플:', html.slice(0, 400).replace(/\s+/g, ' '));
    } catch (e) {
      clearTimeout(timeout);
      console.warn('[SignalBz] 수집 실패:', url, e.message);
    }
  }
  return [];
}

module.exports = { getSignalTopics };
