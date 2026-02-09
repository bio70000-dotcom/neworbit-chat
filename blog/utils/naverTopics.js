/**
 * 네이버 뉴스 기반 주제 선정 모듈
 * 네이버 뉴스 API에서 당일 인기 키워드를 검색하여
 * 블로그에 적합한 주제를 추출
 */

const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';

// 블로그에 적합한 카테고리 검색어 목록
const SEARCH_SEEDS = [
  '추천', '방법', '꿀팁', '후기', '비교',
  '트렌드', '인기', '화제', '핫한', '요즘',
  '건강', '다이어트', '운동', '뷰티',
  '여행', '맛집', '카페', '데이트',
  '재테크', '절약', '부업', '투자',
  'AI', '앱추천', '생산성', '자기계발',
  '심리', 'MBTI', '인간관계', '연애',
];

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

/**
 * 네이버 뉴스에서 블로그 주제 후보 추출
 * @returns {Promise<Array<{keyword: string, category: string}>>}
 */
async function getNaverNewsTopics() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('[NaverTopics] NAVER API 키가 없습니다');
    return [];
  }

  // 랜덤 시드 3개 선택해서 검색
  const seeds = [];
  const shuffled = [...SEARCH_SEEDS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 3 && i < shuffled.length; i++) {
    seeds.push(shuffled[i]);
  }

  const allTopics = [];

  for (const seed of seeds) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const url = `${NAVER_NEWS_URL}?query=${encodeURIComponent(seed)}&display=5&sort=date`;
      const res = await fetch(url, {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        signal: controller.signal,
      });

      if (!res.ok) continue;

      const data = await res.json();
      const items = data?.items || [];

      for (const item of items) {
        const title = stripHtml(item.title);
        // 뉴스 제목에서 블로그 주제로 변환 가능한 키워드 추출
        const topic = extractBlogTopic(title, seed);
        if (topic) {
          allTopics.push(topic);
        }
      }
    } catch (e) {
      // 타임아웃 등 무시
    } finally {
      clearTimeout(timeout);
    }
  }

  // 중복 제거 후 최대 10개
  const unique = [];
  const seen = new Set();
  for (const t of allTopics) {
    if (!seen.has(t.keyword)) {
      seen.add(t.keyword);
      unique.push(t);
    }
  }

  console.log(`[NaverTopics] ${seeds.join(',')} 검색 → ${unique.length}개 주제 후보`);
  return unique.slice(0, 10);
}

/**
 * 뉴스 제목에서 블로그 주제를 추출
 * SEO 친화적이고 일반 독자가 검색할 만한 주제로 변환
 */
function extractBlogTopic(newsTitle, searchSeed) {
  // 너무 짧거나 긴 제목 제외
  if (newsTitle.length < 8 || newsTitle.length > 50) return null;

  // 정치, 사건/사고, 주식 종목 등 부적합한 주제 필터링
  const excludePatterns = [
    /정치|국회|대통령|의원|여당|야당|탄핵/,
    /살인|사망|사고|폭행|체포|구속|재판/,
    /주가|코스피|코스닥|상장|시가총액/,
    /검찰|경찰|수사|기소|판결/,
    /전쟁|군사|미사일|북한/,
    /속보|단독|긴급/,
  ];

  for (const pattern of excludePatterns) {
    if (pattern.test(newsTitle)) return null;
  }

  // 블로그 적합 키워드가 포함된 제목만 선택
  const blogFriendly = [
    /추천|방법|꿀팁|후기|비교|리뷰|정리|모음|가이드/,
    /건강|다이어트|운동|뷰티|피부|헤어/,
    /여행|맛집|카페|핫플|데이트|축제/,
    /재테크|절약|부업|투자|연금|보험/,
    /AI|앱|서비스|플랫폼|기술|출시/,
    /심리|MBTI|스트레스|힐링|명상|수면/,
    /트렌드|인기|화제|MZ|2026/,
    /선물|이벤트|할인|세일|혜택/,
  ];

  const isBlogFriendly = blogFriendly.some((p) => p.test(newsTitle));
  if (!isBlogFriendly) return null;

  // 카테고리 자동 분류
  let category = '일상';
  if (/건강|다이어트|운동|뷰티|피부/.test(newsTitle)) category = '건강/뷰티';
  else if (/여행|맛집|카페|핫플|축제/.test(newsTitle)) category = '여행/맛집';
  else if (/재테크|절약|부업|투자|연금/.test(newsTitle)) category = '재테크';
  else if (/AI|앱|서비스|기술|출시/.test(newsTitle)) category = 'IT/테크';
  else if (/심리|MBTI|스트레스|힐링/.test(newsTitle)) category = '심리/힐링';
  else if (/추천|방법|꿀팁|후기|리뷰/.test(newsTitle)) category = '정보/리뷰';

  return {
    keyword: newsTitle,
    category,
    source: 'naver_news',
  };
}

module.exports = { getNaverNewsTopics };
