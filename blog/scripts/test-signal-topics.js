/**
 * 시그널(signal.bz) 실시간 검색어 수집만 테스트 (로그/에러 확인용)
 * 사용법: blog 폴더에서
 *   node scripts/test-signal-topics.js
 * 또는 프로젝트 루트에서
 *   node blog/scripts/test-signal-topics.js
 * cheerio 필요: npm install cheerio (blog/package.json)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getSignalTopics } = require('../utils/signalBz');

async function main() {
  console.log('--- 시그널(signal.bz) 실시간 검색어 테스트 ---');
  console.log('');

  try {
    const list = await getSignalTopics(5);
    console.log('결과 개수:', list.length);
    list.forEach((t, i) => console.log(`  ${i + 1}. ${t.keyword}`));
    if (list.length === 0) {
      console.log('(위 [SignalBz] 로그에서 원인 확인: HTML 구조, __NEXT_DATA__ 등)');
    }
  } catch (e) {
    console.error('에러:', e.message);
    console.error(e.stack);
  }
}

main();
