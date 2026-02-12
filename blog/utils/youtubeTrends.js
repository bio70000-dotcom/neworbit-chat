/**
 * YouTube Data API v3 기반 한국 인기 뉴스/이슈 키워드 수집
 * videoCategoryId=25 (News & Politics) 로 '뉴스 속보', '사회적 이슈', '논란' 영상만 조회
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const NEWS_CATEGORY_ID = '25'; // News & Politics

/**
 * 한국 인기 영상 중 뉴스/정치 카테고리만 5개 키워드(제목) 수집
 * @returns {Promise<Array<{keyword: string, category: string, source: string}>>}
 */
async function getYoutubePopularTopics(maxCount = 5) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[YoutubeTrends] YOUTUBE_API_KEY가 없습니다. GitHub Secrets 또는 서버 환경변수에 설정했는지 확인하세요.');
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const url = `${YOUTUBE_API_BASE}/videos?part=snippet&chart=mostPopular&regionCode=KR&videoCategoryId=${NEWS_CATEGORY_ID}&maxResults=${Math.max(maxCount, 15)}&key=${apiKey}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const body = await res.text();
    if (!res.ok) {
      console.warn('[YoutubeTrends] API 응답 오류:', res.status, body.slice(0, 300));
      throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      console.warn('[YoutubeTrends] JSON 파싱 실패:', body.slice(0, 200));
      return [];
    }
    const items = data?.items || [];
    if (items.length === 0) {
      console.warn('[YoutubeTrends] API가 영상 0건 반환. videoCategoryId=25(뉴스/정치) quota 또는 regionCode 확인.');
      return [];
    }

    const result = items
      .map((item) => {
        const title = item?.snippet?.title || '';
        const cleanTitle = title.trim().replace(/\s+/g, ' ');
        return cleanTitle.length >= 2 ? { keyword: cleanTitle, category: 'trending', source: 'youtube_popular' } : null;
      })
      .filter(Boolean)
      .slice(0, maxCount);

    console.log(`[YoutubeTrends] 뉴스/정치 카테고리 인기 영상 ${items.length}개 → ${result.length}개 반환`);
    return result;
  } catch (e) {
    clearTimeout(timeout);
    console.warn('[YoutubeTrends] 수집 실패:', e.message, e.code || '');
    return [];
  }
}

module.exports = { getYoutubePopularTopics };
