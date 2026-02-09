/**
 * Ghost 작가(Author) 초기 설정 스크립트
 *
 * Ghost에서는 Staff를 직접 API로 생성하기 어렵기 때문에,
 * 기본 Owner 계정의 정보를 확인하고 작가별 태그 시스템을 설정합니다.
 *
 * Ghost의 "Staff" 기능을 활용하려면 Ghost Admin에서 수동으로
 * 3명의 Staff를 초대(Invite)해야 합니다.
 *
 * 이 스크립트는:
 * 1. 현재 Ghost 스태프 목록 확인
 * 2. 프로필 이미지 업로드 안내
 * 3. 작가별 설정 가이드 출력
 *
 * 사용법: node setupAuthors.js
 */

require('dotenv').config();

const { WRITERS } = require('./writers');
const { getGhostUsers, ghostRequest } = require('./pipeline/publisher');

async function main() {
  console.log('=' .repeat(60));
  console.log('  Ghost 작가 설정 가이드');
  console.log('='.repeat(60));

  // 1. 현재 Ghost 스태프 확인
  console.log('\n[1] 현재 Ghost 스태프 목록:');
  const users = await getGhostUsers();

  if (users.length === 0) {
    console.log('  스태프를 가져올 수 없습니다. Ghost 연결을 확인하세요.');
    return;
  }

  users.forEach((u) => {
    console.log(`  - ${u.name} (${u.email}) [${u.slug}] roles: ${u.roles?.map(r => r.name).join(', ')}`);
  });

  // 2. 작가 매칭 확인
  console.log('\n[2] 작가 매칭 상태:');
  for (const writer of WRITERS) {
    const found = users.find(
      (u) => u.slug === writer.id || u.name === writer.nickname
    );
    if (found) {
      console.log(`  ✓ ${writer.nickname} → Ghost: ${found.name} (${found.id})`);
      writer.ghostAuthorId = found.id;
    } else {
      console.log(`  ✗ ${writer.nickname} → 미등록`);
    }
  }

  // 3. 설정 가이드 출력
  const unregistered = WRITERS.filter((w) => !w.ghostAuthorId);
  if (unregistered.length > 0) {
    console.log('\n[3] Ghost Admin에서 아래 작가를 수동으로 초대하세요:');
    console.log(`    URL: ${process.env.GHOST_URL || 'http://ghost:2368'}/ghost/#/settings/staff`);
    console.log('');
    unregistered.forEach((w) => {
      console.log(`    작가: ${w.nickname}`);
      console.log(`    슬러그(slug): ${w.id}`);
      console.log(`    소개: ${w.bio}`);
      console.log(`    프로필 이미지: ${w.profileImage}`);
      console.log('');
    });
    console.log('    ※ 초대 후 slug를 작가 ID와 일치시키면 자동 매칭됩니다.');
    console.log('    ※ Staff를 추가하지 않아도 Owner 계정으로 발행됩니다.');
    console.log('    ※ 본문 하단에 작가 서명이 자동으로 추가됩니다.');
  } else {
    console.log('\n[3] 모든 작가가 Ghost에 등록되어 있습니다!');
  }

  console.log('\n' + '='.repeat(60));
  console.log('  설정 완료');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error('오류:', e.message);
  process.exit(1);
});
