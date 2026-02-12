/**
 * 시그널(signal.bz) 실시간 검색어 크롤링
 * 공식 API 없음. HTML에서 목록(li 등) 파싱해 키워드 추출
 */

const SIGNAL_URL = 'https://www.signal.bz/';

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
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(SIGNAL_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const keywords = [];
    $('li').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length >= 2 && text.length <= 80 && !keywords.includes(text)) {
        keywords.push(text);
      }
    });
    if (keywords.length === 0) {
      $('a').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length >= 2 && text.length <= 80 && !keywords.includes(text) && !/^\d+$/.test(text)) {
          keywords.push(text);
        }
      });
    }

    const result = keywords.slice(0, maxCount).map((keyword) => ({
      keyword,
      category: 'trending',
      source: 'signal_bz',
    }));
    console.log(`[SignalBz] 실시간 검색어 ${result.length}개 수집`);
    return result;
  } catch (e) {
    clearTimeout(timeout);
    console.warn('[SignalBz] 수집 실패:', e.message);
    return [];
  }
}

module.exports = { getSignalTopics };
