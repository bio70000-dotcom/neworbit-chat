/**
 * Blog Scheduler - 24/7 상주 프로세스
 *
 * 매일 09:00 KST:
 *  1. 3명 작가 x 2편 = 6편 주제 선정
 *  2. 텔레그램으로 보고
 *  3. 승인/거부/재선정 대기
 *  4. 승인 후 10:00~22:00 사이 랜덤 시간에 발행
 *  5. 발행 결과 텔레그램 알림
 */

require('dotenv').config();

const { WRITERS } = require('./writers');
const { selectTopics } = require('./pipeline/topicSelector');
const { processOne, initAgent, cleanupAgent } = require('./agent');
const {
  sendMessage,
  flushUpdates,
  waitForResponse,
  downloadPhoto,
  formatDailyReport,
  sendPostResult,
  sendDailySummary,
} = require('./utils/telegram');

// ── 설정 ──────────────────────────────────
const POSTS_PER_WRITER = 2;          // 작가당 글 수
const PUBLISH_START_HOUR = 10;        // 발행 시작 시각 (KST)
const PUBLISH_END_HOUR = 22;          // 발행 종료 시각 (KST)
const MIN_GAP_MINUTES = 60;           // 포스트 간 최소 간격 (분)
const SAME_WRITER_GAP_MINUTES = 180;  // 같은 작가 글 간 최소 간격 (분)
const APPROVAL_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 승인 대기 최대 4시간

// ── KST 시간 유틸 ─────────────────────────
function getKSTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

function getKSTHour() {
  return getKSTDate().getHours();
}

function getKSTDateString() {
  const d = getKSTDate();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
}

function msUntilKST(hour, minute = 0) {
  const now = getKSTDate();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  // KST -> UTC 보정
  const nowUTC = Date.now();
  const kstOffset = now.getTime() - nowUTC;
  return target.getTime() - kstOffset - nowUTC;
}

// ── 랜덤 발행 시간 생성 ────────────────────
function generatePublishTimes(count) {
  const startMin = PUBLISH_START_HOUR * 60;
  const endMin = PUBLISH_END_HOUR * 60;
  const range = endMin - startMin;

  const times = [];
  let attempts = 0;

  while (times.length < count && attempts < 1000) {
    attempts++;
    const randomMin = startMin + Math.floor(Math.random() * range);

    // 다른 시간과 최소 간격 체크
    const tooClose = times.some((t) => Math.abs(t - randomMin) < MIN_GAP_MINUTES);
    if (tooClose) continue;

    times.push(randomMin);
  }

  // 간격 못 맞추면 균등 분배
  if (times.length < count) {
    times.length = 0;
    const gap = Math.floor(range / (count + 1));
    for (let i = 0; i < count; i++) {
      times.push(startMin + gap * (i + 1));
    }
  }

  return times.sort((a, b) => a - b);
}

/**
 * 발행 시간에 작가 배정 (같은 작가 글은 최소 3시간 간격)
 * @param {Array} plan [{writer, topics: [topic1, topic2]}]
 * @param {number[]} times 분 단위 시간 배열
 * @returns {Array} [{time, writer, topic, index}]
 */
function assignTimesToPosts(plan, times) {
  const posts = [];
  for (const entry of plan) {
    for (const topic of entry.topics) {
      posts.push({ writer: entry.writer, topic });
    }
  }

  // 시간 배정 (같은 작가 글은 떨어뜨리기)
  const scheduled = [];
  const usedTimes = new Set();
  const writerLastTime = {};

  for (const post of posts) {
    let bestTime = null;
    let bestGap = -1;

    for (const t of times) {
      if (usedTimes.has(t)) continue;

      const lastT = writerLastTime[post.writer.id];
      const gap = lastT != null ? Math.abs(t - lastT) : Infinity;

      if (gap >= SAME_WRITER_GAP_MINUTES && gap > bestGap) {
        bestTime = t;
        bestGap = gap;
      }
    }

    // 간격 못 맞추면 아무 빈 시간
    if (bestTime === null) {
      for (const t of times) {
        if (!usedTimes.has(t)) {
          bestTime = t;
          break;
        }
      }
    }

    if (bestTime !== null) {
      usedTimes.add(bestTime);
      writerLastTime[post.writer.id] = bestTime;
      scheduled.push({
        time: bestTime,
        writer: post.writer,
        topic: post.topic,
        index: scheduled.length + 1,
      });
    }
  }

  return scheduled.sort((a, b) => a.time - b.time);
}

// ── 주제 선정 ──────────────────────────────
async function selectDailyTopics() {
  const plan = [];

  for (const writer of WRITERS) {
    const topics = [];
    for (let i = 0; i < POSTS_PER_WRITER; i++) {
      const [topic] = await selectTopics(writer);
      topics.push(topic);
    }
    plan.push({ writer, topics });
  }

  return plan;
}

/**
 * 특정 번호의 주제만 재선정
 * @param {Array} plan 현재 플랜
 * @param {number[]} numbers 재선정할 번호 (1~6)
 */
async function reselectTopics(plan, numbers) {
  let num = 1;
  for (const entry of plan) {
    for (let i = 0; i < entry.topics.length; i++) {
      if (numbers.includes(num)) {
        const [newTopic] = await selectTopics(entry.writer);
        entry.topics[i] = newTopic;
        console.log(`[Scheduler] ${num}번 재선정: "${newTopic.keyword}"`);
      }
      num++;
    }
  }
  return plan;
}

// ── 발행 실행 ──────────────────────────────
async function executeSchedule(schedule, userPhotos) {
  const results = [];
  const now = getKSTDate();
  const todayBaseMin = now.getHours() * 60 + now.getMinutes();

  for (const item of schedule) {
    // 발행 시간까지 대기
    const waitMin = item.time - todayBaseMin;
    if (waitMin > 0) {
      const h = Math.floor(waitMin / 60);
      const m = waitMin % 60;
      console.log(`[Scheduler] ${item.index}번 "${item.topic.keyword}" → ${h}시간 ${m}분 후 발행`);
      await sendMessage(`⏳ ${item.index}번 "${item.topic.keyword}" → ${Math.floor(item.time / 60)}:${String(item.time % 60).padStart(2, '0')} KST 발행 예정`);
      await new Promise((r) => setTimeout(r, waitMin * 60 * 1000));
    }

    // 이 글에 배정된 사용자 이미지 수집
    const assignedPhotos = userPhotos.filter(
      (p) => p.postNumber === item.index || (!p.postNumber && !p.used)
    );
    const userImageBuffers = [];
    for (const photo of assignedPhotos) {
      const buffer = await downloadPhoto(photo.fileId);
      if (buffer) {
        userImageBuffers.push(buffer);
        photo.used = true;
      }
    }

    if (userImageBuffers.length > 0) {
      console.log(`[Scheduler] ${item.index}번에 사용자 이미지 ${userImageBuffers.length}장 적용`);
    }

    // 글 발행
    console.log(`\n[Scheduler] ${item.index}번 발행 시작: "${item.topic.keyword}" by ${item.writer.nickname}`);
    try {
      const result = await processOne(item.topic, item.writer, { userImageBuffers });
      results.push(result);
      await sendPostResult(result);
    } catch (e) {
      const failResult = {
        success: false,
        keyword: item.topic.keyword,
        error: e.message,
        writer: item.writer.nickname,
      };
      results.push(failResult);
      await sendPostResult(failResult);
    }

    // 다음 글 전 30초 대기
    await new Promise((r) => setTimeout(r, 30000));
  }

  return results;
}

// ── 일일 사이클 ────────────────────────────
async function dailyCycle() {
  const dateStr = getKSTDateString();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[Scheduler] 일일 사이클 시작: ${dateStr}`);
  console.log('═'.repeat(60));

  try {
    // 이전 메시지 비우기
    await flushUpdates();

    // 1. 주제 선정
    console.log('[Scheduler] 6편 주제 선정 중...');
    let plan = await selectDailyTopics();

    // 2. 텔레그램 보고
    const reportMsg = formatDailyReport(plan, dateStr);
    await sendMessage(reportMsg);
    console.log('[Scheduler] 텔레그램 보고 완료, 승인 대기...');

    // 3. 승인 루프
    let approved = false;
    let allPhotos = [];

    while (!approved) {
      const response = await waitForResponse(APPROVAL_TIMEOUT_MS);

      // 대기 중 수신된 사진 누적
      if (response.photos) {
        allPhotos.push(...response.photos);
      }

      switch (response.type) {
        case 'approve':
          approved = true;
          await sendMessage('✅ 승인 완료! 오늘의 발행 스케줄을 생성합니다.');
          console.log('[Scheduler] 승인됨');
          break;

        case 'reject_some':
          console.log(`[Scheduler] ${response.numbers.join(',')}번 재선정 요청`);
          plan = await reselectTopics(plan, response.numbers);
          const updatedMsg = formatDailyReport(plan, dateStr, response.numbers);
          await sendMessage(updatedMsg);
          console.log('[Scheduler] 수정 플랜 보고 완료, 재승인 대기...');
          break;

        case 'reject_all':
          console.log('[Scheduler] 전체 재선정 요청');
          plan = await selectDailyTopics();
          const newMsg = formatDailyReport(plan, dateStr);
          await sendMessage(newMsg);
          console.log('[Scheduler] 새 플랜 보고 완료, 재승인 대기...');
          break;

        case 'status':
          await sendMessage('현재 상태: 승인 대기 중...');
          break;

        case 'timeout':
          console.log('[Scheduler] 승인 타임아웃 - 오늘 발행 취소');
          await sendMessage('⏰ 4시간 내 승인이 없어 오늘 발행을 취소합니다.');
          return;

        default:
          break;
      }
    }

    // 4. 발행 스케줄 생성
    const times = generatePublishTimes(WRITERS.length * POSTS_PER_WRITER);
    const schedule = assignTimesToPosts(plan, times);

    let scheduleMsg = '📋 <b>오늘의 발행 스케줄</b>\n━━━━━━━━━━━━━━━━━━\n';
    for (const item of schedule) {
      const h = Math.floor(item.time / 60);
      const m = String(item.time % 60).padStart(2, '0');
      scheduleMsg += `${h}:${m} - [${item.writer.nickname}] ${item.topic.keyword}\n`;
    }
    scheduleMsg += `━━━━━━━━━━━━━━━━━━\n이미지를 보내시면 글에 적용됩니다 (캡션에 번호)`;
    await sendMessage(scheduleMsg);

    console.log('[Scheduler] 발행 스케줄:');
    for (const item of schedule) {
      console.log(`  ${Math.floor(item.time / 60)}:${String(item.time % 60).padStart(2, '0')} - ${item.writer.nickname}: ${item.topic.keyword}`);
    }

    // 5. 발행 실행
    await initAgent();
    const results = await executeSchedule(schedule, allPhotos);

    // 6. 일일 요약
    await sendDailySummary(results);
    await cleanupAgent();

    console.log(`[Scheduler] 일일 사이클 완료: 성공 ${results.filter((r) => r.success).length}편 / 실패 ${results.filter((r) => !r.success).length}편`);
  } catch (e) {
    console.error(`[Scheduler] 일일 사이클 에러: ${e.message}`);
    console.error(e.stack);
    await sendMessage(`❌ 스케줄러 에러: ${e.message}`);
  }
}

// ── 메인 루프 ──────────────────────────────
async function main() {
  console.log('▓'.repeat(60));
  console.log('  Blog Scheduler 시작');
  console.log(`  시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log('▓'.repeat(60));

  // 환경변수 확인
  const required = ['GEMINI_API_KEY', 'GHOST_ADMIN_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`필수 환경변수 누락: ${missing.join(', ')}`);
    process.exit(1);
  }

  await sendMessage('🟢 Blog Scheduler가 시작되었습니다.');

  // --now 플래그: 즉시 일일 사이클 실행 (테스트용)
  if (process.argv.includes('--now')) {
    console.log('[Scheduler] --now 플래그: 즉시 실행');
    await dailyCycle();
    process.exit(0);
  }

  // 무한 루프: 매일 09:00 KST에 실행
  while (true) {
    const waitMs = msUntilKST(9, 0);
    const waitHours = (waitMs / 1000 / 60 / 60).toFixed(1);
    console.log(`[Scheduler] 다음 실행까지 ${waitHours}시간 대기 (09:00 KST)`);

    await new Promise((r) => setTimeout(r, waitMs));

    await dailyCycle();
  }
}

main().catch((e) => {
  console.error(`[Scheduler] 치명적 오류: ${e.message}`);
  process.exit(1);
});
