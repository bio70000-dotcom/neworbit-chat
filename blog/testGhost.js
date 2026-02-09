/**
 * Ghost API 연결 테스트 (상세 디버깅)
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');

const GHOST_URL = process.env.GHOST_URL || 'http://ghost:2368';
const apiKey = process.env.GHOST_ADMIN_API_KEY;

console.log('=== Ghost API 테스트 (v2) ===');
console.log('GHOST_URL:', GHOST_URL);
console.log('API Key 전체:', apiKey);

if (!apiKey) {
  console.error('GHOST_ADMIN_API_KEY가 없습니다');
  process.exit(1);
}

const [id, secret] = apiKey.split(':');
console.log('Key ID:', id);
console.log('Secret:', secret);
console.log('Secret length:', secret?.length);

// JWT 생성
const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
  keyid: id,
  algorithm: 'HS256',
  expiresIn: '5m',
  audience: `/admin/`,
});

// JWT 디코딩해서 내용 확인
const decoded = jwt.decode(token, { complete: true });
console.log('\nJWT Header:', JSON.stringify(decoded.header));
console.log('JWT Payload:', JSON.stringify(decoded.payload));
console.log('JWT Full:', token);

async function test(name, url, headers = {}) {
  console.log(`\n--- ${name} ---`);
  console.log('URL:', url);
  try {
    const res = await fetch(url, { headers });
    console.log('Status:', res.status);
    const body = await res.text();
    console.log('Response:', body.slice(0, 500));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

async function run() {
  // Test 1: No auth
  await test('1. /site/ (no auth)',
    `${GHOST_URL}/ghost/api/admin/site/`);

  // Test 2: Standard Ghost auth
  await test('2. /users/ (Ghost auth)',
    `${GHOST_URL}/ghost/api/admin/users/`,
    { 'Authorization': `Ghost ${token}` });

  // Test 3: With Accept-Version header
  await test('3. /users/ (Ghost auth + Accept-Version)',
    `${GHOST_URL}/ghost/api/admin/users/`,
    { 'Authorization': `Ghost ${token}`, 'Accept-Version': 'v5.0' });

  // Test 4: Bearer auth instead of Ghost
  await test('4. /users/ (Bearer auth)',
    `${GHOST_URL}/ghost/api/admin/users/`,
    { 'Authorization': `Bearer ${token}` });

  // Test 5: Content API with content key
  const contentKey = '8ac4a734f12b8b24e0c9e5ef42';
  await test('5. Content API /posts/ (content key)',
    `${GHOST_URL}/ghost/api/content/posts/?key=${contentKey}`);

  // Test 6: Try /session/ endpoint
  await test('6. /session/ (Ghost auth)',
    `${GHOST_URL}/ghost/api/admin/session/`,
    { 'Authorization': `Ghost ${token}` });

  // Test 7: Try creating a post directly
  console.log('\n--- 7. POST /posts/ (Ghost auth) ---');
  try {
    const res = await fetch(`${GHOST_URL}/ghost/api/admin/posts/`, {
      method: 'POST',
      headers: {
        'Authorization': `Ghost ${token}`,
        'Content-Type': 'application/json',
        'Accept-Version': 'v5.0',
      },
      body: JSON.stringify({
        posts: [{
          title: 'API Test',
          html: '<p>Test</p>',
          status: 'draft',
        }]
      }),
    });
    console.log('Status:', res.status);
    const body = await res.text();
    console.log('Response:', body.slice(0, 500));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

run();
