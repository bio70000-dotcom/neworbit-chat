/**
 * Blog Agent - AI 자동 게시 에이전트
 *
 * 두 가지 모드로 동작:
 * 1. scheduler.js에서 호출: processOne()을 import하여 사용
 * 2. CLI 직접 실행: node agent.js --now --writer dalsanchek (수동 테스트)
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
const { selectWriter, getWriterById } = require('./writers');
const { sendMessage } = require('./utils/telegram');
const { extractKeywordsFromHtml } = require('./utils/pexelsSearch');

const fs = require('fs');
const path = require('path');

/**
 * 당일 6편 초안만 생성 (스케줄러에서 1차 승인 후 소제목 보고용)
 * @param {Object} topic - { keyword, category, source }
 * @returns {Promise<{title, metaDescription, body, tags}>}
 */
async function generateDraftOnly(topic) {
  let researchData;
  try {
    researchData = await research(topic.keyword);
  } catch (e) {
    throw new Error(`research: ${e.message}`);
  }
  try {
    return await writeDraft(topic, researchData);
  } catch (e) {
    throw new Error(`writeDraft: ${e.message}`);
  }
}

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
 * @param {Object} topic - 선정된 글감
 * @param {Object} writer - 선택된 작가
 * @param {Object} options - { userImageBuffers?, postIndex?, preGeneratedDraft? } preGeneratedDraft 있으면 리서치/초안 스킵
 */
async function processOne(topic, writer, options = {}) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[글] 시작: "${topic.keyword}" (${topic.source})`);
  console.log(`[글] 작가: ${writer.nickname}`);
  console.log('='.repeat(60));

  try {
    let draft;
    if (options.preGeneratedDraft) {
      draft = options.preGeneratedDraft;
      console.log('[글] 사전 생성 초안 사용 (리서치/초안 스킵)');
    } else {
      // Step 1: 리서치
      console.log('[글] 1/5 리서치 중...');
      const researchData = await research(topic.keyword);

      // Step 2: 초안 생성
      console.log('[글] 2/5 초안 생성 중 (Gemini Flash)...');
      draft = await writeDraft(topic, researchData);
    }

    // Step 3: 인간화 (작가 페르소나 적용)
    console.log(`[글] 3/5 인간화 중 (Claude Sonnet → ${writer.nickname})...`);
    let finalPost;
    try {
      finalPost = await humanize(draft, writer);
    } catch (e) {
      console.warn(`[글] 인간화 실패, 초안 사용: ${e.message}`);
      finalPost = draft;
    }

    // 소제목(h2) 텔레그램 전송 — 사전 생성 초안이 아닐 때만 (이미 배치로 보고했으면 스킵)
    const postIndex = options.postIndex;
    if (postIndex != null && !options.preGeneratedDraft) {
      const h2List = extractKeywordsFromHtml(finalPost.body);
      if (h2List.length > 0) {
        const subheadingsMsg = `${postIndex}번 글 소제목 (이미지 참고): ${h2List.join(', ')}`;
        try {
          await sendMessage(subheadingsMsg);
        } catch (err) {
          console.warn(`[글] 소제목 텔레그램 전송 실패: ${err.message}`);
        }
      }
    }

    // Step 4: 이미지 생성 (사용자 이미지 > AI + Pexels 실사)
    console.log('[글] 4/5 이미지 준비 중...');
    let thumbnailBuffer = null;
    let bodyImageBuffers = [];
    let pexelsImages = [];
    const userImageBuffers = options.userImageBuffers || [];

    if (userImageBuffers.length > 0) {
      console.log(`[글] 사용자 제공 이미지 ${userImageBuffers.length}장 사용`);
    }

    try {
      const images = await generateImages(finalPost.title, topic.keyword, finalPost.body);
      thumbnailBuffer = images.thumbnail;
      // 사용자 이미지가 있으면 AI 본문 이미지 대신 사용
      if (userImageBuffers.length > 0) {
        bodyImageBuffers = userImageBuffers;
        pexelsImages = userImageBuffers.length >= 3 ? [] : (images.pexelsImages || []);
      } else {
        bodyImageBuffers = images.bodyImages;
        pexelsImages = images.pexelsImages || [];
      }
    } catch (e) {
      console.warn(`[글] AI 이미지 생성 실패: ${e.message}`);
      // 사용자 이미지라도 있으면 사용
      if (userImageBuffers.length > 0) {
        bodyImageBuffers = userImageBuffers;
      }
    }

    // Step 5: Ghost 발행 (작가 지정)
    console.log(`[글] 5/5 Ghost 발행 중 (${writer.nickname})...`);
    const published = await publish({
      title: finalPost.title,
      body: finalPost.body,
      metaDescription: finalPost.metaDescription,
      tags: finalPost.tags,
      thumbnailBuffer,
      bodyImageBuffers,
      pexelsImages,
      writer,
    });

    // 발행 성공 → 중복 방지 기록
    await markPublished(topic.keyword);

    console.log(`[글] 발행 성공! "${published?.title}" by ${writer.nickname}`);
    console.log(`[글] URL: ${published?.url || 'N/A'}`);

    return { success: true, title: finalPost.title, url: published?.url, writer: writer.nickname };
  } catch (e) {
    console.error(`[글] 실패: ${e.message}`);
    return { success: false, keyword: topic.keyword, error: e.message, writer: writer.nickname };
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

    // 작가 선택 (--writer=id 또는 --writer id 플래그로 수동 지정 가능)
    const writerEqFlag = process.argv.find((a) => a.startsWith('--writer='));
    const writerSpaceIdx = process.argv.indexOf('--writer');
    let writer;
    if (writerEqFlag) {
      writer = getWriterById(writerEqFlag.split('=')[1]);
    } else if (writerSpaceIdx !== -1 && process.argv[writerSpaceIdx + 1]) {
      writer = getWriterById(process.argv[writerSpaceIdx + 1]);
    } else {
      writer = selectWriter();
    }

    console.log(`\n[Agent] 오늘의 작가: ${writer.nickname}`);
    console.log(`[Agent] 소개: ${writer.bio}`);

    // AdSense 필수 페이지 확인/생성 (최초 1회)
    console.log('\n[Step] 필수 페이지 확인 중...');
    try {
      await ensureRequiredPages();
    } catch (e) {
      console.warn(`[Agent] 필수 페이지 생성 실패 (계속 진행): ${e.message}`);
    }

    // 글감 선정 (작가 분야 기반)
    console.log('\n[Step] 글감 선정 중...');
    const topics = await selectTopics(writer);

    if (topics.length === 0) {
      console.error('글감을 선정하지 못했습니다');
      process.exit(1);
    }

    // 1편만 처리 (cron 3회 x 1편 = 하루 3편)
    const topic = topics[0];
    const result = await processOne(topic, writer);

    // 결과 요약
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '▓'.repeat(60));
    console.log('  Blog Agent 완료');
    console.log(`  작가: ${result.writer}`);
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

/**
 * 에이전트 초기화 (scheduler에서 호출)
 */
async function initAgent() {
  const required = ['GEMINI_API_KEY', 'GHOST_ADMIN_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`필수 환경변수 누락: ${missing.join(', ')}`);
  }

  if (!process.env.CLAUDE_API_KEY) {
    console.warn('CLAUDE_API_KEY 없음 - 인간화 단계를 건너뜁니다');
  }

  // 필수 페이지 확인 (최초 1회)
  try {
    await ensureRequiredPages();
  } catch (e) {
    console.warn(`[Agent] 필수 페이지 확인 실패: ${e.message}`);
  }
}

/**
 * 에이전트 정리 (scheduler에서 호출)
 */
async function cleanupAgent() {
  cleanupTmp();
  await disconnect();
}

// CLI 직접 실행 시에만 main() 호출
if (require.main === module) {
  main();
}

module.exports = { processOne, generateDraftOnly, initAgent, cleanupAgent };
