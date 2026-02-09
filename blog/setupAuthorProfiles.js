/**
 * Ghost 작가 프로필 사진 및 소개 설정
 * 사용법: node setupAuthorProfiles.js
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

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
    slug: 'dalsanchek',
    name: '달산책',
    bio: '카페 창가에서 글 쓰는 걸 좋아하는 프리랜서 에디터. 따뜻한 시선으로 일상의 작은 것들을 기록합니다.',
    profileFile: path.join(__dirname, 'profiles', 'dalsanchek.png'),
  },
  {
    slug: 'textree',
    name: '텍스트리',
    bio: 'IT 업계 5년차 개발자. 복잡한 것을 쉽게 설명하는 걸 좋아합니다. 실용적인 정보 위주로 글 씁니다.',
    profileFile: path.join(__dirname, 'profiles', 'textree.png'),
  },
  {
    slug: 'bbittul',
    name: '삐뚤빼뚤',
    bio: '호기심 많은 대학원생. 뭐든 일단 해보고 후기 남기는 게 취미. 솔직한 리뷰 전문.',
    profileFile: path.join(__dirname, 'profiles', 'bbittul.png'),
  },
];

async function uploadImage(filePath, filename) {
  const url = `${GHOST_URL}/ghost/api/admin/images/upload/`;
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'image/png' });
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('purpose', 'profile_image');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Ghost ${token()}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`업로드 실패 ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.images?.[0]?.url || '';
}

async function run() {
  console.log('=== 작가 프로필 사진 설정 ===\n');

  // 스태프 조회
  const usersRes = await fetch(`${GHOST_URL}/ghost/api/admin/users/?limit=all`, {
    headers: { Authorization: `Ghost ${token()}` },
  });
  const usersData = await usersRes.json();
  const users = usersData.users || [];

  for (const author of AUTHORS) {
    const user = users.find((u) => u.slug === author.slug || u.name === author.name);
    if (!user) {
      console.log(`✗ ${author.name} - Ghost에서 찾을 수 없음 (slug: ${author.slug})`);
      continue;
    }

    console.log(`→ ${author.name} (${user.slug}, id: ${user.id})`);

    // 프로필 사진 업로드
    let profileImageUrl = user.profile_image;
    if (fs.existsSync(author.profileFile)) {
      try {
        profileImageUrl = await uploadImage(author.profileFile, `profile-${author.slug}.png`);
        console.log(`  ✓ 프로필 사진 업로드: ${profileImageUrl}`);
      } catch (e) {
        console.log(`  ✗ 프로필 사진 업로드 실패: ${e.message}`);
      }
    } else {
      console.log(`  ⚠ 프로필 사진 파일 없음: ${author.profileFile}`);
    }

    // 프로필 업데이트 (사진 + bio)
    try {
      const updateRes = await fetch(`${GHOST_URL}/ghost/api/admin/users/${user.id}/`, {
        method: 'PUT',
        headers: {
          Authorization: `Ghost ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          users: [{
            profile_image: profileImageUrl,
            bio: author.bio,
            updated_at: user.updated_at,
          }],
        }),
      });

      if (updateRes.ok) {
        console.log(`  ✓ 프로필 업데이트 완료`);
      } else {
        const err = await updateRes.text();
        console.log(`  ✗ 프로필 업데이트 실패: ${err.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`  ✗ 에러: ${e.message}`);
    }

    console.log('');
  }

  console.log('=== 완료 ===');
}

run();
