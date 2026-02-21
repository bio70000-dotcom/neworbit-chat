/**
 * 구글 뉴스 RSS (한국 hl=ko, gl=KR) 카테고리별 헤드라인 수집
 * 풀 호환 형식: { keyword, category, source: 'google_news_rss', sourceTag }
 * 카테고리: 대한민국, 비즈니스, 과학/기술, 엔터테이먼트, 스포츠, 건강
 */

const KR_PARAMS = 'hl=ko&gl=KR&ceid=KR%3Ako';

// 구글 뉴스 주제 ID (토픽 URL에서 확인 가능. 동일 ID로 hl/gl만 바꿔 한국 뉴스 수신)
const TOPIC_IDS = {
  비즈니스: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
  '과학/기술': 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pIUWlnQVAB',
  엔터테이먼트: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
  스포츠: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
  건강: 'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ',
};

/** 메인 RSS (대한민국 종합) */
const MAIN_RSS_URL = `https://news.google.com/rss?${KR_PARAMS}`;

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

function isBlogFriendlyTitle(title) {
  if (!title || title.length < 6 || title.length > 60) return false;
  for (const p of EXCLUDE_PATTERNS) {
    if (p.test(title)) return false;
  }
  const hasHangul = /[\uAC00-\uD7A3]{2,}/.test(title);
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
      if (!res.ok) return [];
      const xml = await res.text();
      return parseTitlesFromRss(xml, maxPerCategory);
    } catch (e) {
      clearTimeout(timeout);
      return [];
    }
  };

  // 대한민국(메인)
  const mainTitles = await fetchRss(MAIN_RSS_URL);
  for (const title of mainTitles) {
    if (!isBlogFriendlyTitle(title) || seen.has(title)) continue;
    seen.add(title);
    result.push({
      keyword: title,
      category: '대한민국',
      source: 'google_news_rss',
      sourceTag: 'Google_News_대한민국',
    });
    if (result.length >= totalTarget) {
      console.log(`[GoogleNewsRss] 수집 완료: ${result.length}개 (메인 포함)`);
      return result;
    }
  }

  // 카테고리별 토픽 RSS
  for (const [category, topicId] of Object.entries(TOPIC_IDS)) {
    const url = `https://news.google.com/rss/topics/${topicId}?${KR_PARAMS}`;
    const titles = await fetchRss(url);
    for (const title of titles) {
      if (!isBlogFriendlyTitle(title) || seen.has(title)) continue;
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

module.exports = { getGoogleNewsTopicsByCategory, TOPIC_IDS, MAIN_RSS_URL };
