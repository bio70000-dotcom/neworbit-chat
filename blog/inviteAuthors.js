/**
 * Ghost에 AI 작가 3명을 Staff로 초대하는 유틸리티
 * mailpit이 이메일을 캡처하므로 가짜 이메일로 초대 가능
 *
 * 사용법: node inviteAuthors.js
 *
 * 초대 후 mailpit에서 초대 링크를 확인하고 각 작가 계정을 설정해야 합니다.
 * 또는 Ghost Admin에서 직접 Staff를 추가하세요.
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

const AUTHORS = [
  {
    email: 'dalsanchek@neworbit.co.kr',
    name: '달산책',
    slug: 'dalsanchek',
    role: 'Author',
  },
  {
    email: 'textree@neworbit.co.kr',
    name: '텍스트리',
    slug: 'textree',
    role: 'Author',
  },
  {
    email: 'bbittul@neworbit.co.kr',
    name: '삐뚤빼뚤',
    slug: 'bbittul',
    role: 'Author',
  },
];

async function run() {
  console.log('=== Ghost AI 작가 초대 ===\n');

  // 1. 현재 스태프 확인
  const usersRes = await fetch(`${GHOST_URL}/ghost/api/admin/users/?limit=all`, {
    headers: { Authorization: `Ghost ${token()}` },
  });
  const usersData = await usersRes.json();
  const users = usersData.users || [];

  console.log('현재 스태프:');
  users.forEach((u) => console.log(`  - ${u.name} (${u.slug}) [${u.roles?.map(r => r.name).join(',')}]`));

  // 2. 역할 ID 가져오기
  const rolesRes = await fetch(`${GHOST_URL}/ghost/api/admin/roles/?limit=all`, {
    headers: { Authorization: `Ghost ${token()}` },
  });
  const rolesData = await rolesRes.json();
  const roles = rolesData.roles || [];
  const authorRole = roles.find((r) => r.name === 'Author');

  if (!authorRole) {
    console.log('Author 역할을 찾을 수 없습니다. 사용 가능한 역할:');
    roles.forEach((r) => console.log(`  - ${r.name} (${r.id})`));
    return;
  }

  console.log(`\nAuthor 역할 ID: ${authorRole.id}`);

  // 3. 각 작가 초대
  for (const author of AUTHORS) {
    const existing = users.find((u) => u.slug === author.slug || u.name === author.name);
    if (existing) {
      console.log(`\n✓ ${author.name} 이미 존재 (${existing.slug})`);
      continue;
    }

    console.log(`\n→ ${author.name} 초대 중 (${author.email})...`);

    try {
      const inviteRes = await fetch(`${GHOST_URL}/ghost/api/admin/invites/`, {
        method: 'POST',
        headers: {
          Authorization: `Ghost ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invites: [{
            email: author.email,
            role_id: authorRole.id,
          }],
        }),
      });

      if (inviteRes.ok) {
        console.log(`  ✓ 초대 이메일 발송 완료 (mailpit에서 확인)`);
      } else {
        const err = await inviteRes.text();
        console.log(`  ✗ 초대 실패: ${err.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`  ✗ 에러: ${e.message}`);
    }
  }

  console.log('\n=== 완료 ===');
  console.log('mailpit에서 초대 이메일을 확인하고 각 작가 계정을 설정하세요.');
  console.log('또는 Ghost Admin → Settings → Staff에서 직접 추가하세요.');
}

run();
