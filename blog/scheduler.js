/**
 * Blog Scheduler - 24/7 상주 프로세스
 *
 * 매일 09:00 KST:
 *  1. 6편 주제 선정 → 텔레그램 보고
 *  2. 1차 주제 승인/거부/재선정 대기
 *  3. 승인 후 1~6번 순차: N번 초안 생성(Gemini) → N번 소제목 전달 + N번 사진 수집 (1번 사진 접수 완료 후 2번 초안 생성 … 방식)
 *  4. 발행 스케줄 보고 → 11:00~22:00 KST 랜덤 시간에 6편 발행
 *  5. 23시 포스팅 결과 보고 (성공/실패)
 */

require('dotenv').config();

const fs = require('fs');
const { WRITERS } = require('./writers');

const { selectTopics, selectDailyTopicsWithQuota, getTopicFromSource, getCandidatesPool, enrichPoolWithSearchVolume } = require('./pipeline/topicSelector');
const { selectTopicsWithAI } = require('./pipeline/topicSelectAI');

function serverLog(msg, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), msg, ...data }) + '\n';
  if (process.env.DEBUG_LOG_PATH) {
    try { fs.appendFileSync(process.env.DEBUG_LOG_PATH, line); } catch (e) {}
  }
}
const { processOne, generateDraftOnly, initAgent, cleanupAgent } = require('./agent');
const {
  sendMessage,
  flushUpdates,
  waitForResponse,
  waitForPhotosComplete,
  waitForPhotosForSlot,
  checkForStartCommand,
  checkForSchedulerCommand,
  downloadPhoto,
  formatDailyReport,
  sendPostResult,
  sendDailySummary,
} = require('./utils/telegram');
const { extractKeywordsFromHtml } = require('./utils/pexelsSearch');

// 예기치 않은 예외/거부 시 로그 및 텔레그램 알림 (발행이 멈춘 원인 추적용)
process.on('uncaughtException', (err) => {
  console.error('[Scheduler] uncaughtException:', err.message);
  console.error(err.stack);
  serverLog('uncaughtException', { error: err.message, stack: err.stack });
  sendMessage(`❌ Scheduler 비정상 종료 (uncaughtException): ${(err.message || '').slice(0, 200)}`).catch(() => {});
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Scheduler] unhandledRejection:', reason);
  serverLog('unhandledRejection', { reason: String(reason) });
  sendMessage(`❌ Scheduler unhandledRejection: ${String(reason).slice(0, 200)}`).catch(() => {});
});

// ── 설정 ──────────────────────────────────
const POSTS_PER_WRITER = 2;          // 작가당 글 수
const PUBLISH_START_HOUR = 11;        // 발행 시작 시각 (KST) 11:00~22:00
const PUBLISH_END_HOUR = 22;          // 발행 종료 시각 (KST)
const MIN_GAP_MINUTES = 60;           // 포스트 간 최소 간격 (분)
const SAME_WRITER_GAP_MINUTES = 180;  // 같은 작가 글 간 최소 간격 (분)
const APPROVAL_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 승인 대기 최대 4시간
const PHOTOS_COMPLETE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // (레거시) 소제목 보고 후 사진 취합 대기

// 스케줄러 상태 (텔레그램 "상태" 명령용)
let schedulerState = 'idle'; // 'idle' | 'approval' | 'photos' | 'publishing'
let currentSchedule = null;   // 발행 중일 때 [{ time, writer, topic, index }]
let schedulerPaused = false; // true면 09:00/시작 시 dailyCycle 실행 안 함

// ── KST 시간 유틸 (UTC+9, 서버 타임존 무관) ─────────────────────────
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 현재 시각을 KST 기준 날짜로 (UTC getter 사용 시 KST 값) */
function getKSTDate() {
  return new Date(Date.now() + KST_OFFSET_MS);
}

function getKSTHour() {
  return getKSTDate().getUTCHours();
}

function getKSTDateString() {
  const d = getKSTDate();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} (${days[d.getUTCDay()]})`;
}

/** 다음 지정 시각(KST)까지 밀리초. 09:00 KST = 00:00 UTC */
function msUntilKST(hour, minute = 0) {
  const now = new Date();
  const utcHour = (hour - 9 + 24) % 24;
  let targetUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    utcHour,
    minute,
    0,
    0
  ));
  if (targetUTC <= now) targetUTC.setUTCDate(targetUTC.getUTCDate() + 1);
  return targetUTC.getTime() - now.getTime();
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

/** 테스트용: 현재(KST) 기준 다음 5분 단위부터 count개, intervalMinutes 간격 */
function generateTestPublishTimes(count, intervalMinutes = 5) {
  const now = getKSTDate();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMin = Math.ceil((nowMin + 1) / intervalMinutes) * intervalMinutes; // 다음 interval 경계
  const times = [];
  for (let i = 0; i < count; i++) {
    times.push(startMin + i * intervalMinutes);
  }
  return times;
}

/**
 * 발행 시간에 작가 배정 (같은 작가 글은 최소 3시간 간격)
 * planIndex: 주제 보고/사진 수집 시 사용한 1~6 고정 번호. 사진 매칭에 사용.
 * index: 발행 순서(시간순) 1~6. 메시지 표시용.
 * @param {Array} plan [{writer, topics: [topic1, topic2]}]
 * @param {number[]} times 분 단위 시간 배열
 * @returns {Array} [{time, writer, topic, planIndex, index}]
 */
function assignTimesToPosts(plan, times) {
  const posts = [];
  let planIndex = 0;
  for (const entry of plan) {
    for (const topic of entry.topics) {
      planIndex++;
      posts.push({ writer: entry.writer, topic, planIndex });
    }
  }

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
        planIndex: post.planIndex,
        index: 0,
      });
    }
  }

  const sorted = scheduled.sort((a, b) => a.time - b.time);
  sorted.forEach((item, i) => {
    item.index = i + 1;
  });
  return sorted;
}

// ── 주제 선정 ──────────────────────────────
/** 일일 6편: 시즌 2 + 네이버 뉴스 2 + 구글 트렌드 2 균형 할당 */
async function selectDailyTopics() {
  return selectDailyTopicsWithQuota(WRITERS, POSTS_PER_WRITER);
}

/** plan에 저장된 source(표시명/내부명 혼재)를 getTopicFromSource용 내부값으로 변환 */
function normalizeSourceForReselect(source) {
  if (!source || typeof source !== 'string') return 'naver_news';
  const s = source.toLowerCase().replace(/_/g, '');
  if (s === 'natetrend') return 'nate_trend';
  if (s === 'seasonal') return 'seasonal';
  if (s.includes('naver') || s.includes('dalsanchek') || s.includes('textree') || s.includes('bbittul')) return 'naver_news';
  if (source.toLowerCase() === 'nate_trend') return 'nate_trend';
  if (source.toLowerCase() === 'naver_news') return 'naver_news';
  if (source.toLowerCase() === 'seasonal') return 'seasonal';
  return 'naver_news';
}

/**
 * 특정 번호의 주제만 재선정
 * @param {Array} plan 현재 플랜
 * @param {number[]} numbers 재선정할 번호 (1~6)
 */
async function reselectTopics(plan, numbers) {
  console.warn('[Scheduler] 재선정 요청 numbers=', numbers);
  const usedKeywords = new Set();
  for (const entry of plan) {
    for (const t of entry.topics) usedKeywords.add(t.keyword);
  }
  let num = 1;
  for (const entry of plan) {
    for (let i = 0; i < entry.topics.length; i++) {
      if (numbers.includes(num)) {
        const originalSource = entry.topics[i].source;
        const internalSource = normalizeSourceForReselect(originalSource);
        const newTopic = await getTopicFromSource(entry.writer, internalSource, usedKeywords);
        if (newTopic) {
          entry.topics[i] = newTopic;
          usedKeywords.add(newTopic.keyword);
          console.warn(`[Scheduler] ${num}번 재선정 성공: [${originalSource}] → [${internalSource}] "${newTopic.keyword}"`);
        } else {
          console.warn(`[Scheduler] ${num}번 재선정 실패: originalSource=${JSON.stringify(originalSource)} internalSource=${internalSource} (후보 없음), 기존 주제 유지`);
        }
      }
      num++;
    }
  }
  return plan;
}

// ── 발행 실행 ──────────────────────────────
async function executeSchedule(schedule, userPhotos) {
  const results = [];

  let displayOrder = 0;
  for (const item of schedule) {
    displayOrder += 1;
    const timeStr = `${String(Math.floor(item.time / 60)).padStart(2, '0')}:${String(item.time % 60).padStart(2, '0')}`;

    // 매 반복마다 현재 KST 기준으로 대기 시간 계산 (고정 시각 사용 시 2번째 글부터 잘못 대기함)
    const now = getKSTDate();
    const currentMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const waitMin = item.time - currentMin;

    if (waitMin > 0) {
      const h = Math.floor(waitMin / 60);
      const m = waitMin % 60;
      console.log(`[Scheduler] ${item.index}번 "${item.topic.keyword}" → ${h}시간 ${m}분 후 발행 (현재 KST ${Math.floor(currentMin/60)}:${String(currentMin%60).padStart(2,'0')})`);
      await sendMessage(`⏳ ${item.index}번 "${item.topic.keyword}" → ${timeStr} KST 발행 예정`);
      await new Promise((r) => setTimeout(r, waitMin * 60 * 1000));
    } else {
      console.log(`[Scheduler] ${item.index}번 "${item.topic.keyword}" → 예정 시각(${timeStr})이 지나 즉시 발행`);
      await sendMessage(`⏩ ${item.index}번 "${item.topic.keyword}" → 예정 시각이 지나 즉시 발행합니다.`);
    }

    // 이 글에 배정된 사용자 이미지 수집 (plan 순서 1~6 = planIndex로 매칭)
    const assignedPhotos = userPhotos.filter(
      (p) => p.postNumber === item.planIndex || (!p.postNumber && !p.used)
    );
    const userImageBuffers = [];
    const seenFileIds = new Set(); // 같은 사진 중복 전송 시 한 번만 사용
    for (const photo of assignedPhotos) {
      if (seenFileIds.has(photo.fileId)) continue;
      try {
        const buffer = await downloadPhoto(photo.fileId);
        if (buffer) {
          userImageBuffers.push(buffer);
          seenFileIds.add(photo.fileId);
          photo.used = true;
        }
      } catch (e) {
        console.warn(`[Scheduler] 사진 다운로드 실패: ${e.message}`);
      }
    }

    if (userImageBuffers.length > 0) {
      console.log(`[Scheduler] ${item.index}번에 사용자 이미지 ${userImageBuffers.length}장 적용`);
    }

    // 글 발행 (예외까지 잡아서 텔레그램으로 보고)
    console.log(`\n[Scheduler] ${item.index}번 발행 시작: "${item.topic.keyword}" by ${item.writer.nickname}`);
    serverLog('post.start', { displayOrder, timeStr, keyword: item.topic.keyword, writer: item.writer.nickname });

    let result;
    try {
      result = await processOne(item.topic, item.writer, {
      userImageBuffers,
      postIndex: item.index,
      preGeneratedDraft: item.topic.draft,
    });
      if (!result || typeof result.success === 'undefined') {
        result = { success: false, keyword: item.topic.keyword, error: 'processOne returned invalid result', writer: item.writer.nickname };
      }
    } catch (e) {
      console.error(`[Scheduler] ${item.index}번 processOne 예외:`, e);
      serverLog('post.error', { displayOrder, error: e.message, stack: e.stack });
      result = {
        success: false,
        keyword: item.topic.keyword,
        error: e.message || String(e),
        writer: item.writer.nickname,
      };
    }

    results.push(result);

    try {
      await sendPostResult(result);
    } catch (sendErr) {
      console.warn(`[Scheduler] 발행 결과 텔레그램 전송 실패: ${sendErr.message}`);
    }
    serverLog('post.done', {
      displayOrder,
      timeStr,
      keyword: item.topic.keyword,
      success: result.success,
      title: result.title,
      error: result.error,
    });

    // 다음 글 전 30초 대기
    await new Promise((r) => setTimeout(r, 30000));
  }

  return results;
}

/**
 * 스케줄러 상태 메시지 (텔레그램 "상태" 명령 응답)
 * @param {number} [nextRunMs] 대기 중일 때 다음 실행까지 ms (idle일 때만 사용)
 */
function formatSchedulerStatus(nextRunMs) {
  const stateLabels = {
    idle: '대기 중',
    approval: '1차 승인 대기 중',
    photos: '사진 취합 대기 중',
    publishing: '발행 진행 중',
  };
  const label = stateLabels[schedulerState] || schedulerState;

  let msg = `<b>📋 스케줄러 상태</b>\n━━━━━━━━━━━━━━━━━━\n`;
  if (schedulerPaused) {
    msg += `⏸ 일시정지됨. <b>재개</b> 또는 <b>시작</b> 입력 시 다시 실행됩니다.\n`;
  }
  msg += `상태: ${label}\n`;

  if (schedulerState === 'idle' && nextRunMs != null) {
    const nextDate = new Date(Date.now() + nextRunMs);
    const kst = new Date(nextDate.getTime() + KST_OFFSET_MS);
    const dateStr = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')} KST`;
    msg += `다음 실행: ${dateStr}\n`;
  }
  if (schedulerState === 'publishing' && currentSchedule && currentSchedule.length > 0) {
    msg += `\n오늘 발행 예정:\n`;
    for (let i = 0; i < currentSchedule.length; i++) {
      const it = currentSchedule[i];
      const h = Math.floor(it.time / 60);
      const m = String(it.time % 60).padStart(2, '0');
      msg += `${i + 1}. ${h}:${m} - [${it.writer.nickname}] ${it.topic.keyword}\n`;
    }
  }
  msg += `━━━━━━━━━━━━━━━━━━`;
  return msg;
}

// ── 일일 사이클 ────────────────────────────
/**
 * @param {Object} [opts] - { test5Min: boolean } 테스트 시 5분 간격 6편
 */
async function dailyCycle(opts = {}) {
  const test5Min = opts.test5Min === true;
  const dateStr = getKSTDateString();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[Scheduler] 일일 사이클 시작: ${dateStr}${test5Min ? ' (테스트 5분 간격)' : ''}`);
  console.log('═'.repeat(60));
  serverLog('dailyCycle.start', { test5Min, dateStr });

  try {
    schedulerState = 'approval';
    currentSchedule = null;
    // 이전 메시지 비우기
    await flushUpdates();

    // 1. 주제 선정
    console.log('[Scheduler] 6편 주제 선정 중...');
    let plan = await selectDailyTopics();

    // 2. 텔레그램 보고
    const reportMsg = formatDailyReport(plan, dateStr);
    await sendMessage(reportMsg);
    console.log('[Scheduler] 텔레그램 보고 완료, 승인 대기...');

    // 3. 1차 승인 루프 (주제만)
    let approved = false;

    while (!approved) {
      const response = await waitForResponse(APPROVAL_TIMEOUT_MS);

      switch (response.type) {
        case 'approve':
          approved = true;
          await sendMessage('✅ 1차 승인 완료! 초안 생성 후 주제·소제목을 보내드립니다.');
          console.log('[Scheduler] 승인됨');
          break;

        case 'cancel':
          console.log('[Scheduler] 사용자 취소 - 오늘 발행 안 함');
          await sendMessage('🛑 오늘 발행을 취소했습니다.');
          schedulerState = 'idle';
          currentSchedule = null;
          return;

        case 'reject_some':
          console.warn(`[Scheduler] reject_some 수신 numbers=${response.numbers.join(',')}, 재선정 실행`);
          plan = await reselectTopics(plan, response.numbers);
          await sendMessage(formatDailyReport(plan, dateStr, response.numbers));
          console.warn('[Scheduler] 수정 플랜 보고 완료, 재승인 대기...');
          break;

        case 'reject_all':
          console.log('[Scheduler] 전체 재선정 요청');
          plan = await selectDailyTopics();
          await sendMessage(formatDailyReport(plan, dateStr));
          console.log('[Scheduler] 새 플랜 보고 완료, 재승인 대기...');
          break;

        case 'status':
          await sendMessage('현재 상태: 승인 대기 중...');
          break;

        case 'timeout':
          console.log('[Scheduler] 승인 타임아웃 - 오늘 발행 취소');
          await sendMessage('⏰ 4시간 내 승인이 없어 오늘 발행을 취소합니다.');
          schedulerState = 'idle';
          currentSchedule = null;
          return;

        default:
          break;
      }
    }

    // 4. 1~6번 순서: N번 초안 생성 → N번 소제목 전달 + 사진 수집 (1번 사진 접수 완료 후 2번 초안 생성 … 방식으로 API 부하·타임아웃 완화)
    await initAgent();
    const orderedItems = [];
    let num = 1;
    for (const entry of plan) {
      for (const topic of entry.topics) {
        orderedItems.push({ index: num, keyword: topic.keyword, topic, subheadings: [] });
        num++;
      }
    }
    schedulerState = 'photos';

    const allPhotos = [];
    for (const item of orderedItems) {
      const n = item.index;
      console.log(`[Scheduler] ${n}/6 초안 생성: "${item.topic.keyword}"`);
      try {
        item.topic.draft = await generateDraftOnly(item.topic);
        item.subheadings = item.topic.draft && item.topic.draft.body ? extractKeywordsFromHtml(item.topic.draft.body) : [];
      } catch (e) {
        console.error(`[Scheduler] 초안 생성 실패 (${item.topic.keyword}): ${e.message}`);
        if (e.stack) console.error(`[Scheduler] stack: ${e.stack}`);
        await sendMessage(`❌ ${n}번 초안 생성 실패: ${item.topic.keyword} - ${e.message}`);
        await cleanupAgent();
        schedulerState = 'idle';
        currentSchedule = null;
        return;
      }
      const h2Text = item.subheadings.length > 0 ? item.subheadings.join(', ') : '(소제목 없음)';
      await sendMessage(`📝 <b>${n}번</b> [${item.keyword}]\n   소제목: ${h2Text}\n\n위 주제에 맞는 이미지를 보내주세요 (최대 3장). 다음 번호로 가려면 <b>다음</b> 또는 <b>스킵</b> 입력`);
      const slotPhotos = await waitForPhotosForSlot(n, item.keyword, 3);
      for (const p of slotPhotos) {
        allPhotos.push({ fileId: p.fileId, postNumber: n, caption: '' });
      }
    }
    await sendMessage('✅ 사진 수집 완료! 발행 스케줄(11:00~22:00)을 생성합니다.');

    // 6. 발행 스케줄 생성 (시간 배정은 사진 수집이 끝난 뒤)
    const times = test5Min
      ? generateTestPublishTimes(WRITERS.length * POSTS_PER_WRITER, 5)
      : generatePublishTimes(WRITERS.length * POSTS_PER_WRITER);
    const schedule = assignTimesToPosts(plan, times);

    // 7. 발행 스케줄 보고
    schedulerState = 'publishing';
    currentSchedule = schedule;

    serverLog('schedule.built', {
      test5Min,
      schedule: schedule.map((it, i) => ({
        line: i + 1,
        time: `${String(Math.floor(it.time / 60)).padStart(2, '0')}:${String(it.time % 60).padStart(2, '0')}`,
        keyword: it.topic.keyword,
        writer: it.writer.nickname,
      })),
    });

    let scheduleMsg = '📋 <b>오늘의 발행 스케줄</b>\n━━━━━━━━━━━━━━━━━━\n';
    for (let i = 0; i < schedule.length; i++) {
      const item = schedule[i];
      const h = Math.floor(item.time / 60);
      const m = String(item.time % 60).padStart(2, '0');
      scheduleMsg += `${i + 1}. ${h}:${m} - [${item.writer.nickname}] ${item.topic.keyword}\n`;
    }
    scheduleMsg += `━━━━━━━━━━━━━━━━━━\n${test5Min ? '(테스트: 5분 간격 발행)' : ''}`;
    await sendMessage(scheduleMsg);

    console.log('[Scheduler] 발행 스케줄:');
    for (const item of schedule) {
      console.log(`  ${Math.floor(item.time / 60)}:${String(item.time % 60).padStart(2, '0')} - ${item.writer.nickname}: ${item.topic.keyword}`);
    }

    // 8. 발행 실행
    const results = await executeSchedule(schedule, allPhotos);

    // 9. 포스팅 결과 보고 (23시 2시간 이내면 23시에 전송, 아니면 즉시)
    const kstNow = getKSTDate();
    const kstMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
    const minUntil23 = (23 * 60 - kstMin + 24 * 60) % (24 * 60);
    if (minUntil23 > 0 && minUntil23 <= 120) {
      const waitMs = minUntil23 * 60 * 1000;
      console.log(`[Scheduler] ${minUntil23}분 후 23시 결과 보고 예정...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    await sendDailySummary(results);
    await cleanupAgent();

    console.log(`[Scheduler] 일일 사이클 완료: 성공 ${results.filter((r) => r.success).length}편 / 실패 ${results.filter((r) => !r.success).length}편`);
  } catch (e) {
    console.error(`[Scheduler] 일일 사이클 에러: ${e.message}`);
    console.error(e.stack);
    await sendMessage(`❌ 스케줄러 에러: ${e.message}`);
  } finally {
    schedulerState = 'idle';
    currentSchedule = null;
  }
}

// ── 주제 선정 테스트 (텔레그램 3단계 보고) ──────────────────────────────
const MAX_MSG_LEN = 4000;

async function runTopicSelectionTest() {
  try {
    await sendMessage('🧪 <b>주제 선정 테스트</b>를 시작합니다.');

    const pool = await getCandidatesPool(WRITERS, POSTS_PER_WRITER);
    const SOURCE_TAGS = ['Nate_Trend', 'Naver_Dalsanchek', 'Naver_Textree', 'Naver_Bbittul', 'Seasonal'];
    const byTag = {};
    SOURCE_TAGS.forEach((tag) => { byTag[tag] = []; });
    for (const c of pool) {
      const tag = c.sourceTag || c.source || 'Seasonal';
      if (byTag[tag]) byTag[tag].push(c);
    }

    let poolMsg = '📋 <b>전체 풀 (' + pool.length + '개)</b>\n━━━━━━━━━━━━━━━━━━\n';
    for (const tag of SOURCE_TAGS) {
      const list = byTag[tag] || [];
      if (list.length === 0) continue;
      poolMsg += `\n<b>[${tag}]</b>\n`;
      list.forEach((c, i) => { poolMsg += `${i + 1}. ${(c.keyword || '').slice(0, 80)}\n`; });
    }
    if (poolMsg.length > MAX_MSG_LEN) {
      await sendMessage(poolMsg.slice(0, MAX_MSG_LEN) + '\n…(생략)');
    } else {
      await sendMessage(poolMsg);
    }

    await enrichPoolWithSearchVolume(pool);
    const result = await selectTopicsWithAI(pool, WRITERS);
    const plan = result?.plan;

    if (!plan || plan.every((p) => p.topics.length === 0)) {
      const reason = result?.error ? `\n사유: ${result.error}` : '';
      await sendMessage('❌ AI 선정 실패 (후보 부족 또는 API 오류).' + reason);
      return;
    }

    let finalMsg = '✅ <b>최종 선정 (작가별 2개)</b>\n━━━━━━━━━━━━━━━━━━\n';
    for (const entry of plan) {
      finalMsg += `\n<b>${entry.writer.nickname}</b>\n`;
      (entry.topics || []).forEach((t, i) => { finalMsg += `  ${i + 1}. ${(t.keyword || '').slice(0, 60)}\n`; });
    }
    await sendMessage(finalMsg);
    console.log('[Scheduler] 주제 선정 테스트 완료');
  } catch (e) {
    console.error('[Scheduler] 주제 테스트 에러:', e.message);
    await sendMessage('❌ 주제 테스트 중 오류: ' + (e.message || '').slice(0, 150));
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

  await sendMessage('🟢 Blog Scheduler가 시작되었습니다.\n텔레그램에서 <b>시작</b> 또는 <b>주제 선정</b> 입력 시 즉시 주제 선정을 시작합니다.\n<b>주제 테스트</b> 입력 시 풀(~25개)과 최종 작가별 선정만 보고합니다.');

  // --test-5min: 즉시 주제 선정 → 텔레그램 보고 → 승인 후 5분 간격 6편 발행 (로그는 DEBUG_LOG_PATH에)
  if (process.argv.includes('--test-5min')) {
    console.log('[Scheduler] --test-5min: 테스트 모드 (5분 간격 6편)');
    await dailyCycle({ test5Min: true });
    process.exit(0);
  }

  // --now 플래그: 즉시 일일 사이클 실행 (테스트용)
  if (process.argv.includes('--now')) {
    console.log('[Scheduler] --now 플래그: 즉시 실행');
    await dailyCycle();
    process.exit(0);
  }

  // 무한 루프: 매일 09:00 KST 또는 텔레그램 "시작" 명령 시 실행
  const POLL_CHUNK_MS = 15 * 1000; // 15초마다 명령 확인 (상태/시작 등 빠른 응답)

  while (true) {
    const waitMs = msUntilKST(9, 0);
    const waitHours = (waitMs / 1000 / 60 / 60).toFixed(1);
    console.log(`[Scheduler] 다음 실행까지 ${waitHours}시간 대기 (09:00 KST 또는 텔레그램 "시작" 명령)`);

    const loopStartTime = Date.now();
    let triggeredByCommand = false;

    while (Date.now() - loopStartTime < waitMs) {
      await new Promise((r) => setTimeout(r, POLL_CHUNK_MS));

      try {
        const cmd = await checkForSchedulerCommand();
        if (cmd === 'pause') {
          schedulerPaused = true;
          await sendMessage('⏸ 스케줄러가 일시정지되었습니다. <b>재개</b> 또는 <b>시작</b> 입력 시 다시 실행됩니다.');
          console.log('[Scheduler] 사용자 "멈춤" 명령 - 일시정지');
        } else if (cmd === 'resume') {
          schedulerPaused = false;
          await sendMessage('▶ 스케줄러를 재개했습니다.');
          console.log('[Scheduler] 사용자 "재개" 명령');
        } else if (cmd === 'status') {
          const remainingMs = waitMs - (Date.now() - loopStartTime);
          await sendMessage(formatSchedulerStatus(remainingMs > 0 ? remainingMs : 0));
        } else if (cmd === 'topic_test') {
          console.log('[Scheduler] 사용자 "주제 테스트" 명령 수신');
          await runTopicSelectionTest();
        } else if (cmd === 'start') {
          triggeredByCommand = true;
          schedulerPaused = false;
          console.log('[Scheduler] 사용자 "시작" 명령 수신');
          await sendMessage('📌 주제 선정을 시작합니다.');
          break;
        }
      } catch (e) {
        console.warn(`[Scheduler] 명령 확인 중 오류: ${e.message}`);
      }
    }

    if (schedulerPaused) {
      console.log('[Scheduler] 일시정지 상태라 오늘 사이클을 건너뜁니다.');
      continue;
    }
    await dailyCycle();
  }
}

main().catch((e) => {
  console.error(`[Scheduler] 치명적 오류: ${e.message}`);
  process.exit(1);
});
