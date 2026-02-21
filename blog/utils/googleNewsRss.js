/**
 * 구글 뉴스 RSS (한국 hl=ko, gl=KR) 카테고리별 헤드라인 수집
 * 풀 호환 형식: { keyword, category, source: 'google_news_rss', sourceTag }
 * 카테고리: 대한민국, 비즈니스, 과학/기술, 엔터테이먼트, 스포츠, 건강
 */

const KR_PARAMS = 'hl=ko&gl=KR&ceid=KR%3Ako';

// 구글 뉴스 주제 ID (한국 hl=ko&gl=KR 토픽 URL에서 추출)
const TOPIC_IDS = {
  비즈니스: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtdHZHZ0pMVWlnQVAB',
  '과학/기술': 'CAAqKAgKIiJDQkFTRXdvSkwyMHZNR1ptZHpWbUVnSnJieG9DUzFJb0FBUAE',
  엔터테이먼트: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtdHZHZ0pMVWlnQVAB',
  스포츠: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
  건강: 'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtdHZLQUFQAQ',
};

/** 대한민국 토픽 RSS (메인 대신 토픽 URL 사용) */
const KOREA_TOPIC_ID = 'CAAqIQgKIhtDQkFTRGdvSUwyMHZNRFp4WkRNU0FtdHZLQUFQAQ';
const KOREA_TOPIC_RSS_URL = `https://news.google.com/rss/topics/${KOREA_TOPIC_ID}?${KR_PARAMS}`;

const DEFAULT_MAX_PER_CATEGORY = 3;
const TOTAL_TARGET = 10;

/** RSS XML에서 <item> 또는 <entry> 블록의 <title> 추출 (상위 N개) */
function parseTitlesFromRss(xml, maxN) {
  const out = [];
  const itemBlockRe = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let block;
  while ((block = itemBlockRe.exec(xml)) !== null && out.length < maxN) {
    const itemXml = block[1];
    const titleM = /<title(?:[^>]*)?>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i.exec(itemXml);
    const raw = (titleM ? (titleM[1] ?? titleM[2] ?? '') : '').trim();
    const clean = raw
      .replace(/\s+/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
    if (clean.length >= 4) out.push(clean);
  }
  return out.slice(0, maxN);
}

/** 블로그 주제로 부적합한 제목 필터 (정치/사건/주식 등) */
const EXCLUDE_PATTERNS = [
  /정치|국회|대통령|의원|여당|야당|탄핵/,
  /살인|사망|사고|폭행|체포|구속|재판/,
  /주가|코스피|코스닥|상장|시가총액/,
  /검찰|경찰|수사|기소|판결/,
  /전쟁|군사|미사일|북한/,
  /속보|단독|긴급/,
  /인터뷰|광고|협찬|스폰서|PR\s|특집|기자\s*chat|\[PR\]|\[기자\]/i,
];

/** relaxed 모드에서 통과시킬 블로그 친화 키워드 */
const BLOG_FRIENDLY_PATTERNS = [
  /건강|여행|재테크|AI|트렌드|추천|리뷰|맛집|요리|운동|다이어트|뷰티|패션|취미|교육|영어|책|영화|드라마|음악|게임|앱|IT|기술|스마트폰|노트북/i,
];

/**
 * @param {string} title
 * @param {{ relaxed?: boolean }} [options]
 */
function isBlogFriendlyTitle(title, options = {}) {
  if (!title) return false;
  const relaxed = options.relaxed === true;
  const minLen = relaxed ? 8 : 6;
  const maxLen = 60;
  if (title.length < minLen || title.length > maxLen) return false;
  for (const p of EXCLUDE_PATTERNS) {
    if (p.test(title)) return false;
  }
  const hasHangul = /[\uAC00-\uD7A3]{2,}/.test(title);
  if (relaxed) {
    if (hasHangul && title.length >= 8 && title.length <= 60) return true;
    for (const p of BLOG_FRIENDLY_PATTERNS) {
      if (p.test(title)) return true;
    }
    return false;
  }
  if (!hasHangul) return false;
  return true;
}

/**
 * 카테고리별 구글 뉴스 RSS에서 주제 후보 수집 (풀 호환 형식)
 * @param {{ maxPerCategory?: number, totalTarget?: number }} [options]
 * @returns {Promise<Array<{keyword: string, category: string, source: string, sourceTag: string}>>}
 */
async function getGoogleNewsTopicsByCategory(options = {}) {
  const maxPerCategory = options.maxPerCategory ?? DEFAULT_MAX_PER_CATEGORY;
  const totalTarget = options.totalTarget ?? TOTAL_TARGET;

  const result = [];
  const seen = new Set();

  const fetchRss = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      });
      clearTimeout(timeout);
      if (!res.ok) {
        console.warn('[GoogleNewsRss] fetch 실패:', url, res.status, res.statusText);
        return [];
      }
      const xml = await res.text();
      return parseTitlesFromRss(xml, maxPerCategory);
    } catch (e) {
      clearTimeout(timeout);
      console.warn('[GoogleNewsRss] fetch 실패:', url, e?.message ?? String(e));
      return [];
    }
  };

  // 대한민국(토픽 RSS)
  const koreaTitles = await fetchRss(KOREA_TOPIC_RSS_URL);
  for (const title of koreaTitles) {
    if (!isBlogFriendlyTitle(title, { relaxed: true }) || seen.has(title)) continue;
    seen.add(title);
    result.push({
      keyword: title,
      category: '대한민국',
      source: 'google_news_rss',
      sourceTag: 'Google_News_대한민국',
    });
    if (result.length >= totalTarget) {
      console.log(`[GoogleNewsRss] 수집 완료: ${result.length}개 (대한민국 토픽 포함)`);
      return result;
    }
  }

  // 카테고리별 토픽 RSS
  for (const [category, topicId] of Object.entries(TOPIC_IDS)) {
    const url = `https://news.google.com/rss/topics/${topicId}?${KR_PARAMS}`;
    const titles = await fetchRss(url);
    for (const title of titles) {
      if (!isBlogFriendlyTitle(title, { relaxed: true }) || seen.has(title)) continue;
      seen.add(title);
      const tag = `Google_News_${category.replace(/\//g, '_')}`;
      result.push({
        keyword: title,
        category,
        source: 'google_news_rss',
        sourceTag: tag,
      });
      if (result.length >= totalTarget) break;
    }
    if (result.length >= totalTarget) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[GoogleNewsRss] 카테고리별 수집: ${result.length}개`);
  return result;
}

module.exports = { getGoogleNewsTopicsByCategory, TOPIC_IDS, KOREA_TOPIC_RSS_URL };
