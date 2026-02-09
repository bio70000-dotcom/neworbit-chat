/**
 * Blog Agent - AI 자동 게시 에이전트
 *
 * 실행 흐름:
 * 1. 랜덤 딜레이 (0~55분) - 봇 탐지 회피
 * 2. 10% 확률로 스킵 - 하루 2~3편으로 자연스러운 패턴
 * 3. 필수 페이지 확인/생성 (개인정보처리방침, 이용약관, 소개)
 * 4. 글감 1편 선정
 * 5. 리서치 → 초안 → 인간화 → 이미지 → 발행
 *
 * cron으로 하루 3회 실행, 각 실행 시 1편씩 발행
 */

require('dotenv').config();

const { selectTopics } = require('./pipeline/topicSelector');
const { research } = require('./pipeline/researcher');
const { writeDraft } = require('./pipeline/draftWriter');
const { humanize } = require('./pipeline/humanizer');
const { generateImages } = require('./pipeline/imageGenerator');
const { publish } = require('./pipeline/publisher');
const { markPublished, disconnect } = require('./utils/dedup');
const { ensureRequiredPages } = require('./utils/requiredPages');

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
 * 랜덤 딜레이 (0~55분)
 * 매번 다른 시각에 발행되어 봇 패턴 회피
 */
async function randomDelay() {
  const delayMin = Math.floor(Math.random() * 55);
  console.log(`[Agent] 랜덤 딜레이: ${delayMin}분 대기...`);
  await new Promise((r) => setTimeout(r, delayMin * 60 * 1000));
  console.log(`[Agent] 딜레이 완료, 작업 시작`);
}

/**
 * 단일 글 처리 파이프라인
 */
async function processOne(topic) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[글] 시작: "${topic.keyword}" (${topic.source})`);
  console.log('='.repeat(60));

  try {
    // Step 1: 리서치
    console.log('[글] 1/5 리서치 중...');
    const researchData = await research(topic.keyword);

    // Step 2: 초안 생성
    console.log('[글] 2/5 초안 생성 중 (Gemini Flash)...');
    const draft = await writeDraft(topic, researchData);

    // Step 3: 인간화
    console.log('[글] 3/5 인간화 중 (Claude Sonnet)...');
    let finalPost;
    try {
      finalPost = await humanize(draft);
    } catch (e) {
      console.warn(`[글] 인간화 실패, 초안 사용: ${e.message}`);
      finalPost = draft;
    }

    // Step 4: 이미지 생성
    console.log('[글] 4/5 이미지 생성 중 (Gemini Imagen)...');
    let thumbnailBuffer = null;
    let bodyImageBuffers = [];
    try {
      const images = await generateImages(finalPost.title, topic.keyword);
      thumbnailBuffer = images.thumbnail;
      bodyImageBuffers = images.bodyImages;
    } catch (e) {
      console.warn(`[글] 이미지 생성 실패 (이미지 없이 발행): ${e.message}`);
    }

    // Step 5: Ghost 발행
    console.log('[글] 5/5 Ghost 발행 중...');
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

    console.log(`[글] 발행 성공! "${published?.title}"`);
    console.log(`[글] URL: ${published?.url || 'N/A'}`);

    return { success: true, title: finalPost.title, url: published?.url };
  } catch (e) {
    console.error(`[글] 실패: ${e.message}`);
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

    // 랜덤 딜레이 (--now 플래그로 즉시 실행 가능)
    const immediate = process.argv.includes('--now');
    if (!immediate) {
      await randomDelay();
    } else {
      console.log('[Agent] --now 플래그: 딜레이 없이 즉시 실행');
    }

    // 10% 확률로 스킵 (하루 2~3편 자연스러운 패턴)
    if (!immediate && Math.random() < 0.1) {
      console.log('[Agent] 이번 실행은 랜덤 스킵합니다 (자연스러운 패턴 유지)');
      return;
    }

    // AdSense 필수 페이지 확인/생성 (최초 1회)
    console.log('\n[Step] 필수 페이지 확인 중...');
    try {
      await ensureRequiredPages();
    } catch (e) {
      console.warn(`[Agent] 필수 페이지 생성 실패 (계속 진행): ${e.message}`);
    }

    // 글감 선정 (1편만)
    console.log('\n[Step] 글감 선정 중...');
    const topics = await selectTopics();

    if (topics.length === 0) {
      console.error('글감을 선정하지 못했습니다');
      process.exit(1);
    }

    // 1편만 처리 (cron 3회 x 1편 = 하루 3편)
    const topic = topics[0];
    const result = await processOne(topic);

    // 결과 요약
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '▓'.repeat(60));
    console.log('  Blog Agent 완료');
    console.log(`  결과: ${result.success ? '성공' : '실패'}`);
    console.log(`  소요시간: ${elapsed}초`);
    if (result.success) {
      console.log(`  제목: ${result.title}`);
      console.log(`  URL: ${result.url || 'N/A'}`);
    } else {
      console.log(`  키워드: ${result.keyword}`);
      console.log(`  에러: ${result.error}`);
    }
    console.log('▓'.repeat(60));
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
