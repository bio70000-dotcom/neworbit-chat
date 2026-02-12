/**
 * YouTube Data API v3 기반 한국 인기 뉴스/이슈 키워드 수집
 * mostPopular (regionCode=KR) 후 뉴스 카테고리 또는 제목 [속보]/[이슈] 등 필터해 5개 반환
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const NEWS_CATEGORY_ID = '25';
const TITLE_PATTERNS = [/\[속보\]/, /\[이슈\]/, /\[이슈포커스\]/, /\[뉴스\]/, /\[단독\]/];

/**
 * 한국 인기 영상 중 뉴스/이슈 성격 5개 키워드(제목) 수집
 * @returns {Promise<Array<{keyword: string, category: string, source: string}>>}
 */
async function getYoutubePopularTopics(maxCount = 5) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[YoutubeTrends] YOUTUBE_API_KEY가 없습니다');
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const url = `${YOUTUBE_API_BASE}/videos?part=snippet&chart=mostPopular&regionCode=KR&maxResults=50&key=${apiKey}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`YouTube API ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    const items = data?.items || [];

    const newsOrIssue = [];
    const rest = [];
    for (const item of items) {
      const title = item?.snippet?.title || '';
      const categoryId = item?.snippet?.categoryId || '';
      const cleanTitle = title.trim().replace(/\s+/g, ' ');
      if (!cleanTitle || cleanTitle.length < 2) continue;

      const isNewsCategory = categoryId === NEWS_CATEGORY_ID;
      const hasIssuePattern = TITLE_PATTERNS.some((p) => p.test(title));
      if (isNewsCategory || hasIssuePattern) {
        newsOrIssue.push({ keyword: cleanTitle, category: 'trending', source: 'youtube_popular' });
      } else {
        rest.push({ keyword: cleanTitle, category: 'trending', source: 'youtube_popular' });
      }
    }

    const result = [...newsOrIssue, ...rest].slice(0, maxCount);
    console.log(`[YoutubeTrends] 인기 영상 ${items.length}개 중 뉴스/이슈 ${newsOrIssue.length}개, 총 ${result.length}개 반환`);
    return result;
  } catch (e) {
    clearTimeout(timeout);
    console.warn('[YoutubeTrends] 수집 실패:', e.message);
    return [];
  }
}

module.exports = { getYoutubePopularTopics };
