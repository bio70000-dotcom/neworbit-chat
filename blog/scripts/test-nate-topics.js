/**
 * 네이트 실시간 이슈 수집만 테스트 (EUC-KR 디코딩, 금지어 필터 확인)
 * 서버 콘솔(이미 떠 있는 컨테이너에 명령 보내기):
 *   docker-compose exec blog-scheduler node scripts/test-nate-topics.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getNateTrendTopics } = require('../utils/nateTrends');

async function main() {
  console.log('--- 네이트 실시간 이슈 테스트 ---');
  console.log('');

  try {
    const list = await getNateTrendTopics(10);
    console.log('결과 개수:', list.length);
    list.forEach((t, i) => console.log(`  ${i + 1}. ${t.keyword}`));
    if (list.length === 0) {
      console.log('(위 [NateTrends] 로그에서 원인 확인: 인코딩, 파싱, 금지어 등)');
    }
  } catch (e) {
    console.error('에러:', e.message);
    console.error(e.stack);
  }
}

main();
