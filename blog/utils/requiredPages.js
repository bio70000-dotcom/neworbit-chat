/**
 * AdSense 승인 필수 페이지 자동 생성
 * Ghost에 개인정보처리방침, 이용약관, 소개 페이지가 없으면 자동 생성
 */

const jwt = require('jsonwebtoken');

const GHOST_URL = process.env.GHOST_URL || 'http://ghost:2368';

function createGhostToken() {
  const apiKey = process.env.GHOST_ADMIN_API_KEY;
  if (!apiKey) throw new Error('GHOST_ADMIN_API_KEY 없음');

  const [id, secret] = apiKey.split(':');
  const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
    header: { alg: 'HS256', typ: 'JWT', kid: id },
    expiresIn: '5m',
    audience: '/admin/',
  });
  return token;
}

async function ghostGet(endpoint) {
  const token = createGhostToken();
  const res = await fetch(`${GHOST_URL}/ghost/api/admin${endpoint}`, {
    headers: { Authorization: `Ghost ${token}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function ghostPost(endpoint, body) {
  const token = createGhostToken();
  const res = await fetch(`${GHOST_URL}/ghost/api/admin${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Ghost ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ghost API ${res.status}: ${err.slice(0, 200)}`);
  }
  return await res.json();
}

const REQUIRED_PAGES = [
  {
    slug: 'privacy-policy',
    title: '개인정보처리방침',
    html: `
<h2>1. 개인정보의 수집 및 이용 목적</h2>
<p>New Orbit 블로그(이하 "사이트")는 서비스 제공을 위해 필요한 최소한의 개인정보를 수집합니다.</p>
<ul>
<li>서비스 이용 기록, 접속 로그, 쿠키 등 자동 수집 정보</li>
<li>Google Analytics 및 광고 서비스를 통해 수집되는 비식별 정보</li>
</ul>

<h2>2. 개인정보의 보유 및 이용 기간</h2>
<p>수집된 정보는 서비스 이용 기간 동안 보유하며, 목적 달성 후 지체 없이 파기합니다.</p>

<h2>3. 쿠키(Cookie) 사용</h2>
<p>본 사이트는 사용자 경험 개선 및 광고 제공을 위해 쿠키를 사용합니다. 브라우저 설정에서 쿠키를 비활성화할 수 있으나, 일부 서비스 이용이 제한될 수 있습니다.</p>

<h2>4. 제3자 광고 서비스</h2>
<p>본 사이트는 Google AdSense 등 제3자 광고 서비스를 사용하며, 이러한 서비스는 사용자의 관심사에 기반한 광고를 제공하기 위해 쿠키를 사용할 수 있습니다.</p>

<h2>5. 개인정보 보호책임자</h2>
<p>개인정보 관련 문의: contact@neworbit.co.kr</p>

<p><em>시행일: 2026년 2월 9일</em></p>
`,
  },
  {
    slug: 'terms',
    title: '이용약관',
    html: `
<h2>제1조 (목적)</h2>
<p>본 약관은 New Orbit(이하 "사이트")이 제공하는 서비스의 이용 조건 및 절차를 규정합니다.</p>

<h2>제2조 (서비스 내용)</h2>
<p>사이트는 다음의 서비스를 제공합니다:</p>
<ul>
<li>블로그 콘텐츠 제공</li>
<li>실시간 채팅 서비스 (chat.neworbit.co.kr)</li>
<li>전파 메시지 서비스 (wave.neworbit.co.kr)</li>
</ul>

<h2>제3조 (이용자의 의무)</h2>
<p>이용자는 다음 행위를 하여서는 안 됩니다:</p>
<ul>
<li>타인의 개인정보를 침해하는 행위</li>
<li>서비스의 정상적인 운영을 방해하는 행위</li>
<li>불법적이거나 부적절한 콘텐츠를 전송하는 행위</li>
</ul>

<h2>제4조 (면책조항)</h2>
<p>사이트는 천재지변, 기술적 장애 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.</p>

<h2>제5조 (저작권)</h2>
<p>사이트에 게시된 콘텐츠의 저작권은 사이트 운영자에게 있으며, 무단 복제 및 배포를 금합니다.</p>

<p><em>시행일: 2026년 2월 9일</em></p>
`,
  },
  {
    slug: 'about',
    title: '소개',
    html: `
<h2>New Orbit 블로그에 오신 것을 환영합니다</h2>
<p>New Orbit은 일상, 심리, IT, 소통에 관한 다양한 이야기를 나누는 블로그입니다.</p>
<p>바쁜 일상 속에서 잠깐 쉬어가고, 새로운 정보도 얻고, 가끔은 누군가와 대화도 나눌 수 있는 공간을 만들고 싶었습니다.</p>

<h2>이런 글을 씁니다</h2>
<ul>
<li><strong>일상/라이프</strong> - 선물 추천, 여행, 맛집, 트렌드</li>
<li><strong>심리/힐링</strong> - 스트레스 해소, 자존감, 인간관계</li>
<li><strong>IT/테크</strong> - 앱 추천, AI 트렌드, 유용한 서비스</li>
<li><strong>소통</strong> - 대화법, MBTI, 관계 팁</li>
</ul>

<h2>함께 이야기해요</h2>
<p>글을 읽다가 누군가와 이야기하고 싶어지셨다면:</p>
<ul>
<li><a href="https://chat.neworbit.co.kr">채팅 시작하기</a> - 관심사가 비슷한 사람과 대화</li>
<li><a href="https://wave.neworbit.co.kr">전파 보내기</a> - 랜덤한 누군가에게 메시지 보내기</li>
</ul>

<p>궁금한 점이 있으시면 contact@neworbit.co.kr로 연락주세요.</p>
`,
  },
];

/**
 * Ghost에 필수 페이지가 없으면 자동 생성
 */
async function ensureRequiredPages() {
  // 기존 페이지 목록 조회
  const existing = await ghostGet('/pages/?limit=all&fields=slug');
  const existingSlugs = (existing?.pages || []).map((p) => p.slug);

  for (const page of REQUIRED_PAGES) {
    if (existingSlugs.includes(page.slug)) {
      console.log(`[Pages] "${page.title}" 이미 존재 - 스킵`);
      continue;
    }

    console.log(`[Pages] "${page.title}" 생성 중...`);
    await ghostPost('/pages/', {
      pages: [
        {
          title: page.title,
          slug: page.slug,
          html: page.html,
          status: 'published',
        },
      ],
    });
    console.log(`[Pages] "${page.title}" 생성 완료`);
  }
}

module.exports = { ensureRequiredPages };
