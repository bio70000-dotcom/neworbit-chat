/**
 * 기존 테스트 포스트 전체 삭제 유틸리티
 * 사용법: node cleanupPosts.js
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');

const GHOST_URL = process.env.GHOST_URL || 'https://blog.neworbit.co.kr';
const apiKey = process.env.GHOST_ADMIN_API_KEY;
const [id, secret] = apiKey.split(':');

function token() {
  return jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id, algorithm: 'HS256', expiresIn: '5m', audience: '/admin/',
  });
}

async function run() {
  // 모든 포스트 조회
  const res = await fetch(`${GHOST_URL}/ghost/api/admin/posts/?limit=all&fields=id,title,slug`, {
    headers: { Authorization: `Ghost ${token()}` },
  });
  const data = await res.json();
  const posts = data.posts || [];

  console.log(`총 ${posts.length}개 포스트 발견:`);
  posts.forEach((p) => console.log(`  - ${p.title} (${p.slug})`));

  if (posts.length === 0) {
    console.log('삭제할 포스트가 없습니다.');
    return;
  }

  // 각 포스트 삭제
  for (const post of posts) {
    const delRes = await fetch(`${GHOST_URL}/ghost/api/admin/posts/${post.id}/`, {
      method: 'DELETE',
      headers: { Authorization: `Ghost ${token()}` },
    });
    if (delRes.ok) {
      console.log(`  ✓ 삭제: ${post.title}`);
    } else {
      console.log(`  ✗ 실패: ${post.title} (${delRes.status})`);
    }
  }

  console.log('포스트 정리 완료!');
}

run();
