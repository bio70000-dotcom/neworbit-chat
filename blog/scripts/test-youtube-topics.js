/**
 * 유튜브 인기 주제 수집만 테스트 (로그/에러 확인용)
 * 서버 콘솔(이미 떠 있는 컨테이너에 명령 보내기):
 *   docker-compose exec blog-scheduler node scripts/test-youtube-topics.js
 * YOUTUBE_API_KEY 필요.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getYoutubePopularTopics } = require('../utils/youtubeTrends');

async function main() {
  console.log('--- 유튜브 인기 주제 테스트 ---');
  console.log('YOUTUBE_API_KEY 존재:', !!process.env.YOUTUBE_API_KEY);
  console.log('YOUTUBE_API_KEY 앞 8자:', process.env.YOUTUBE_API_KEY ? process.env.YOUTUBE_API_KEY.slice(0, 8) + '...' : '(없음)');
  console.log('');

  try {
    const list = await getYoutubePopularTopics(5);
    console.log('결과 개수:', list.length);
    list.forEach((t, i) => console.log(`  ${i + 1}. ${t.keyword}`));
    if (list.length === 0) {
      console.log('(위 [YoutubeTrends] 로그에서 원인 확인)');
    }
  } catch (e) {
    console.error('에러:', e.message);
    console.error(e.stack);
  }
}

main();
