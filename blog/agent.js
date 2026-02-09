/**
 * Blog Agent - AI 자동 게시 에이전트
 *
 * 실행 흐름:
 * 1. 글감 선정 (시즌 캘린더 + Google Trends + 에버그린)
 * 2. 리서치 (네이버 검색 API)
 * 3. 초안 생성 (Gemini Flash)
 * 4. 인간화 (Claude Sonnet)
 * 5. 이미지 생성 (Gemini Imagen)
 * 6. Ghost 발행 (Admin API)
 *
 * cron으로 하루 3회 실행 (KST 10시, 14시, 18시)
 */

require('dotenv').config();

const { selectTopics } = require('./pipeline/topicSelector');
const { research } = require('./pipeline/researcher');
const { writeDraft } = require('./pipeline/draftWriter');
const { humanize } = require('./pipeline/humanizer');
const { generateImages } = require('./pipeline/imageGenerator');
const { publish } = require('./pipeline/publisher');
const { markPublished, disconnect } = require('./utils/dedup');

const fs = require('fs');
const path = require('path');

// 임시 디렉토리 정리
function cleanupTmp() {
  const tmpDir = path.join(__dirname, 'tmp');
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 단일 글 처리 파이프라인
 */
async function processOne(topic, index) {
  const label = `[글 ${index + 1}]`;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label} 시작: "${topic.keyword}" (${topic.source})`);
  console.log('='.repeat(60));

  try {
    // Step 1: 리서치
    console.log(`${label} 1/5 리서치 중...`);
    const researchData = await research(topic.keyword);

    // Step 2: 초안 생성
    console.log(`${label} 2/5 초안 생성 중 (Gemini Flash)...`);
    const draft = await writeDraft(topic, researchData);

    // Step 3: 인간화
    console.log(`${label} 3/5 인간화 중 (Claude Sonnet)...`);
    let finalPost;
    try {
      finalPost = await humanize(draft);
    } catch (e) {
      console.warn(`${label} 인간화 실패, 초안 사용: ${e.message}`);
      finalPost = draft;
    }

    // Step 4: 이미지 생성
    console.log(`${label} 4/5 이미지 생성 중 (Gemini Imagen)...`);
    let thumbnailBuffer = null;
    let bodyImageBuffers = [];
    try {
      const images = await generateImages(finalPost.title, topic.keyword);
      thumbnailBuffer = images.thumbnail;
      bodyImageBuffers = images.bodyImages;
    } catch (e) {
      console.warn(`${label} 이미지 생성 실패 (글은 이미지 없이 발행): ${e.message}`);
    }

    // Step 5: Ghost 발행
    console.log(`${label} 5/5 Ghost 발행 중...`);
    const published = await publish({
      title: finalPost.title,
      body: finalPost.body,
      metaDescription: finalPost.metaDescription,
      tags: finalPost.tags,
      thumbnailBuffer,
      bodyImageBuffers,
    });

    // 발행 성공 → 중복 방지 기록
    await markPublished(topic.keyword);

    console.log(`${label} 발행 성공! "${published?.title}"`);
    console.log(`${label} URL: ${published?.url || 'N/A'}`);

    return { success: true, title: finalPost.title, url: published?.url };
  } catch (e) {
    console.error(`${label} 실패: ${e.message}`);
    return { success: false, keyword: topic.keyword, error: e.message };
  }
}

/**
 * 메인 실행
 */
async function main() {
  const startTime = Date.now();
  console.log('\n' + '▓'.repeat(60));
  console.log('  Blog Agent 시작');
  console.log(`  시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log('▓'.repeat(60));

  try {
    // 환경변수 확인
    const required = ['GEMINI_API_KEY', 'GHOST_ADMIN_API_KEY'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.error(`필수 환경변수 누락: ${missing.join(', ')}`);
      process.exit(1);
    }

    if (!process.env.CLAUDE_API_KEY) {
      console.warn('CLAUDE_API_KEY 없음 - 인간화 단계를 건너뜁니다 (초안 그대로 발행)');
    }

    // 글감 선정
    console.log('\n[Step] 글감 선정 중...');
    const topics = await selectTopics();

    if (topics.length === 0) {
      console.error('글감을 선정하지 못했습니다');
      process.exit(1);
    }

    // 각 글감별로 순차 처리 (API 호출 간격을 위해)
    const results = [];
    for (let i = 0; i < topics.length; i++) {
      const result = await processOne(topics[i], i);
      results.push(result);

      // 다음 글 처리 전 10초 대기 (API rate limit 방지)
      if (i < topics.length - 1) {
        console.log('\n다음 글 처리 전 10초 대기...');
        await new Promise((r) => setTimeout(r, 10000));
      }
    }

    // 결과 요약
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log('\n' + '▓'.repeat(60));
    console.log('  Blog Agent 완료');
    console.log(`  성공: ${success}편 / 실패: ${failed}편`);
    console.log(`  소요시간: ${elapsed}초`);
    console.log('▓'.repeat(60));

    results.forEach((r, i) => {
      if (r.success) {
        console.log(`  ✓ ${i + 1}. ${r.title}`);
      } else {
        console.log(`  ✗ ${i + 1}. ${r.keyword}: ${r.error}`);
      }
    });
  } catch (e) {
    console.error(`[Agent] 치명적 오류: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  } finally {
    // 정리
    cleanupTmp();
    await disconnect();
  }
}

main();
