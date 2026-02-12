/**
 * 구글 트렌드 KR RSS 수집만 테스트 (로그/에러 확인용)
 * 사용법: blog 폴더에서
 *   node scripts/test-google-trends.js
 * 또는 프로젝트 루트에서
 *   node blog/scripts/test-google-trends.js
 * API 키 없음. RSS URL만 fetch.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getGoogleTrendsDailyKR } = require('../utils/googleTrendsRss');

async function main() {
  console.log('--- 구글 트렌드 KR RSS 테스트 ---');
  console.log('');

  try {
    const list = await getGoogleTrendsDailyKR(5);
    console.log('결과 개수:', list.length);
    list.forEach((t, i) => console.log(`  ${i + 1}. ${t.keyword}`));
    if (list.length === 0) {
      console.log('(위 [GoogleTrendsRss] 로그에서 원인 확인: URL 실패, 파싱 0건 등)');
    }
  } catch (e) {
    console.error('에러:', e.message);
    console.error(e.stack);
  }
}

main();
