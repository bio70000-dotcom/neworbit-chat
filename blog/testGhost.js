/**
 * Ghost API 연결 테스트
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');

const GHOST_URL = process.env.GHOST_URL || 'http://ghost:2368';
const apiKey = process.env.GHOST_ADMIN_API_KEY;

console.log('=== Ghost API 테스트 ===');
console.log('GHOST_URL:', GHOST_URL);
console.log('API Key:', apiKey ? `${apiKey.slice(0, 20)}...` : 'MISSING');

if (!apiKey) {
  console.error('GHOST_ADMIN_API_KEY가 없습니다');
  process.exit(1);
}

const [id, secret] = apiKey.split(':');
console.log('Key ID:', id);
console.log('Secret length:', secret?.length);

// JWT 생성
const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
  header: { alg: 'HS256', typ: 'JWT', kid: id },
  expiresIn: '5m',
  audience: '/admin/',
});

console.log('JWT Token:', token.slice(0, 50) + '...');

// 테스트 1: /site/ (인증 불필요)
async function test() {
  console.log('\n--- Test 1: /site/ (no auth) ---');
  try {
    const r1 = await fetch(`${GHOST_URL}/ghost/api/admin/site/`);
    console.log('Status:', r1.status);
    const d1 = await r1.json();
    console.log('Title:', d1?.site?.title);
    console.log('Version:', d1?.site?.version);
  } catch (e) {
    console.error('Failed:', e.message);
  }

  // 테스트 2: /users/ (인증 필요)
  console.log('\n--- Test 2: /users/ (with auth) ---');
  try {
    const r2 = await fetch(`${GHOST_URL}/ghost/api/admin/users/`, {
      headers: { Authorization: `Ghost ${token}` },
    });
    console.log('Status:', r2.status);
    const body = await r2.text();
    console.log('Response:', body.slice(0, 300));
  } catch (e) {
    console.error('Failed:', e.message);
  }

  // 테스트 3: Content API (다른 키로)
  console.log('\n--- Test 3: /posts/ with versioned API ---');
  try {
    const r3 = await fetch(`${GHOST_URL}/ghost/api/v5.0/admin/users/`, {
      headers: { Authorization: `Ghost ${token}` },
    });
    console.log('Status:', r3.status);
    const body = await r3.text();
    console.log('Response:', body.slice(0, 300));
  } catch (e) {
    console.error('Failed:', e.message);
  }
}

test();
