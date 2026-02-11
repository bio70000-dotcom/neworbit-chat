/**
 * Telegram Bot API 모듈
 * - 일일 주제 보고/승인/거부/재선정
 * - 사용자 사진 수신
 * - 발행 결과 알림
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastUpdateId = 0;

/**
 * Telegram 메시지 전송 (HTML 파싱)
 */
async function sendMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] BOT_TOKEN 또는 CHAT_ID 없음');
    return null;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.warn(`[Telegram] 전송 실패: ${data.description}`);
    }
    return data;
  } catch (e) {
    console.warn(`[Telegram] 전송 에러: ${e.message}`);
    return null;
  }
}

/**
 * 새 업데이트(메시지) 가져오기 (long polling)
 * @param {number} timeout 폴링 대기 시간(초)
 */
async function getUpdates(timeout = 30) {
  if (!BOT_TOKEN) return [];

  try {
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), (timeout + 10) * 1000);

    const res = await fetch(
      `${TELEGRAM_API}${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=${timeout}`,
      { signal: controller.signal }
    );

    clearTimeout(abortTimeout);

    const data = await res.json();
    if (!data.ok || !data.result) return [];

    const updates = data.result.filter(
      (u) => u.message && String(u.message.chat.id) === String(CHAT_ID)
    );

    if (data.result.length > 0) {
      lastUpdateId = data.result[data.result.length - 1].update_id;
    }

    return updates;
  } catch (e) {
    if (e.name === 'AbortError') return [];
    console.warn(`[Telegram] getUpdates 에러: ${e.message}`);
    return [];
  }
}

/**
 * "시작" / "주제 선정" 등 주제 선정 트리거 명령이 있는지 확인 (폴링용, getUpdates(timeout=0))
 * @returns {Promise<boolean>} 트리거 명령이 있으면 true
 */
async function checkForStartCommand() {
  const cmd = await checkForSchedulerCommand();
  return cmd === 'start';
}

/**
 * 스케줄러 제어 명령 확인 (폴링용)
 * @returns {Promise<'start'|'status'|'pause'|'resume'|null>}
 */
async function checkForSchedulerCommand() {
  const updates = await getUpdates(0);
  for (const u of updates) {
    const text = (u.message?.text || '').trim();
    const lower = text.toLowerCase();
    if (['멈춤', '일시정지', '스케줄러 멈춤', '정지'].some((c) => lower === c || lower.includes(c))) return 'pause';
    if (['재개', '스케줄러 재개', '다시 시작'].some((c) => lower === c || lower.includes(c))) return 'resume';
    if (['시작', '주제 선정', '주제선정', '시작해', '오늘 주제'].some((c) => lower === c || lower.includes(c))) return 'start';
    if (['상태', 'status', '스케줄러 상태', '스케줄러'].some((c) => lower === c || lower.includes(c))) return 'status';
  }
  return null;
}

/**
 * 기존 쌓인 메시지 비우기 (시작 시 호출)
 */
async function flushUpdates() {
  try {
    const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getUpdates?offset=-1&timeout=0`);
    const data = await res.json();
    if (data.ok && data.result && data.result.length > 0) {
      lastUpdateId = data.result[data.result.length - 1].update_id;
    }
  } catch (e) {
    console.warn(`[Telegram] flush 에러: ${e.message}`);
  }
}

/**
 * 승인/거부/재선정 응답 대기
 * @param {number} timeoutMs 최대 대기 시간 (기본 4시간)
 * @returns {Promise<{type: string, data?: any}>}
 *   type: 'approve' | 'reject_some' | 'reject_all' | 'photo' | 'status' | 'timeout'
 */
async function waitForResponse(timeoutMs = 4 * 60 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  const photos = []; // 대기 중 수신된 사진 모아두기

  while (Date.now() < deadline) {
    const updates = await getUpdates(30);

    for (const update of updates) {
      const msg = update.message;

      // 사진 수신
      if (msg.photo && msg.photo.length > 0) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const caption = (msg.caption || '').trim();
        const postNumber = parseInt(caption, 10) || null;

        photos.push({ fileId, postNumber, caption });
        console.log(`[Telegram] 사진 수신 (번호: ${postNumber || '미지정'})`);

        await sendMessage(`사진 접수 완료${postNumber ? ` → ${postNumber}번 글에 배정` : ' → 자동 배정'}`);
        continue;
      }

      const text = (msg.text || '').trim().toLowerCase();

      // 전체 승인
      if (text === 'ok' || text === '승인' || text === 'ㅇㅋ') {
        return { type: 'approve', photos };
      }

      // 전체 취소 (오늘 발행 안 함)
      if (text === '취소' || text === '취소해' || text === '전체 취소' || text === '취소할게') {
        return { type: 'cancel', photos: [] };
      }

      // 전체 재선정
      if (text === '전체 다시' || text === '다시' || text === '재선정') {
        return { type: 'reject_all', photos };
      }

      // 특정 번호 재선정: "2,5 다시", "재선정 2 5", "1 3 다시", "2,4"
      const rejectMatch = text.match(/(?:재선정\s*)?(\d[\d,\s]*)\s*(?:다시|재선정)?/);
      if (rejectMatch) {
        const numbers = rejectMatch[1]
          .split(/[,\s]+/)
          .map((n) => parseInt(n, 10))
          .filter((n) => n >= 1 && n <= 6);

        if (numbers.length > 0) {
          return { type: 'reject_some', numbers, photos };
        }
      }

      // 상태 조회
      if (text === '상태' || text === 'status') {
        return { type: 'status', photos };
      }
    }
  }

  return { type: 'timeout', photos: [] };
}

/**
 * 사진 취합 완료 대기 (소제목 보고 후)
 * 사용자 "완료"/"사진 완료" 입력 또는 타임아웃 시 수집된 사진 반환
 * @param {number} timeoutMs 최대 대기 (기본 2시간)
 * @returns {Promise<{photos: Array<{fileId, postNumber, caption}>, done: boolean}>} done true면 사용자가 완료 입력, false면 타임아웃
 */
async function waitForPhotosComplete(timeoutMs = 2 * 60 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  const photos = [];

  while (Date.now() < deadline) {
    const updates = await getUpdates(30);

    for (const update of updates) {
      const msg = update.message;

      if (msg.photo && msg.photo.length > 0) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const caption = (msg.caption || '').trim();
        const postNumber = parseInt(caption, 10) || null;
        photos.push({ fileId, postNumber, caption });
        console.log(`[Telegram] 사진 수신 (번호: ${postNumber || '미지정'})`);
        await sendMessage(`사진 접수 완료${postNumber ? ` → ${postNumber}번 글에 배정` : ' → 자동 배정'}`);
        continue;
      }

      const text = (msg.text || '').trim().toLowerCase();
      if (text === '완료' || text === '사진 완료' || text === '완료해') {
        return { photos, done: true };
      }
    }
  }

  return { photos, done: false };
}

/**
 * Telegram 서버에서 사진 파일 다운로드
 * @param {string} fileId Telegram file_id
 * @returns {Promise<Buffer|null>}
 */
async function downloadPhoto(fileId) {
  try {
    // 파일 경로 얻기
    const fileRes = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();

    if (!fileData.ok || !fileData.result.file_path) {
      console.warn('[Telegram] 파일 경로 획득 실패');
      return null;
    }

    // 파일 다운로드
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
    const imgRes = await fetch(downloadUrl);

    if (!imgRes.ok) {
      console.warn(`[Telegram] 파일 다운로드 실패: HTTP ${imgRes.status}`);
      return null;
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    console.log(`[Telegram] 사진 다운로드 완료: ${(buffer.length / 1024).toFixed(0)}KB`);
    return buffer;
  } catch (e) {
    console.warn(`[Telegram] 사진 다운로드 에러: ${e.message}`);
    return null;
  }
}

/**
 * 일일 주제 보고 메시지 생성
 * @param {Array} plan [{writer, topics: [{keyword, source, rationale?}]}]
 * @param {string} dateStr 날짜 문자열
 * @param {number[]|null} changedNumbers 변경된 번호들 (재선정 시)
 */
function formatDailyReport(plan, dateStr, changedNumbers = null) {
  const writerIcons = {
    dalsanchek: '달산책',
    textree: '텍스트리',
    bbittul: '삐뚤빼뚤',
  };

  let header;
  if (changedNumbers) {
    header = `<b>주제 수정 완료 (${changedNumbers.join(', ')}번)</b>`;
  } else {
    header = `<b>Three-Body Blog 일일 포스팅 플랜</b>`;
  }

  let msg = `${header}\n━━━━━━━━━━━━━━━━━━\n${dateStr}\n`;

  let num = 1;
  for (const entry of plan) {
    const name = writerIcons[entry.writer.id] || entry.writer.nickname;
    msg += `\n<b>[${name}]</b>\n`;

    for (const topic of entry.topics) {
      const changed = changedNumbers && changedNumbers.includes(num) ? ' ← 변경' : '';
      let volSuffix = '';
      if (topic.searchVolumeLabel && topic.searchVolumeLabel !== '-') {
        if (typeof topic.searchVolume === 'number') {
          volSuffix = topic.searchVolume >= 10000
            ? ` (검색량: ${topic.searchVolumeLabel}, 약 ${(topic.searchVolume / 10000).toFixed(0)}만건)`
            : ` (검색량: ${topic.searchVolumeLabel}, ${topic.searchVolume.toLocaleString()}건)`;
        } else {
          volSuffix = ` (검색량: ${topic.searchVolumeLabel})`;
        }
      }
      msg += ` ${num}. [${topic.source}] ${topic.keyword}${volSuffix}${changed}\n`;
      if (topic.rationale) {
        msg += `   → ${topic.rationale}\n`;
      }
      num++;
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>ok</b> - 전체 승인\n`;
  msg += `<b>취소</b> - 전체 취소 (오늘 발행 안 함)\n`;
  msg += `<b>2,5 다시</b> - 해당 번호 재선정\n`;
  msg += `<b>전체 다시</b> - 전부 재선정\n`;
  msg += `사진 전송 시 글에 적용 (캡션에 번호)`;

  return msg;
}

/**
 * 주제 + 소제목(h2) 보고 메시지 (초안 작성 후 이미지 준비용)
 * @param {Array<{index: number, keyword: string, subheadings: string[]}>} items
 * @returns {string}
 */
function formatSubheadingsReport(items) {
  let msg = `<b>📝 주제 및 소제목 (이미지 참고)</b>\n━━━━━━━━━━━━━━━━━━\n`;
  for (const it of items) {
    const h2Text = (it.subheadings && it.subheadings.length > 0) ? it.subheadings.join(', ') : '(소제목 없음)';
    msg += `${it.index}. [${it.keyword}]\n   소제목: ${h2Text}\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━\n위 소제목에 맞는 이미지를 보내주세요. 캡션에 1~6 번호 입력.\n<b>완료</b> 또는 <b>사진 완료</b> 입력 시 스케줄로 진행합니다.`;
  return msg;
}

/**
 * 발행 결과 알림
 */
async function sendPostResult(result) {
  let msg;
  if (result.success) {
    msg = `✅ <b>발행 완료</b>\n`;
    msg += `작가: ${result.writer}\n`;
    msg += `제목: ${result.title}\n`;
    msg += `URL: ${result.url || 'N/A'}`;
  } else {
    msg = `❌ <b>발행 실패</b>\n`;
    msg += `작가: ${result.writer}\n`;
    msg += `키워드: ${result.keyword}\n`;
    msg += `에러: ${(result.error || '').slice(0, 200)}`;
  }

  return sendMessage(msg);
}

/**
 * 일일 요약 알림
 */
async function sendDailySummary(results) {
  const success = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success).length;

  let msg = `<b>Three-Body Blog 일일 요약</b>\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `성공: ${success}편 / 실패: ${fail}편\n\n`;

  for (const r of results) {
    if (r.success) {
      msg += `✅ ${r.writer}: ${r.title}\n`;
    } else {
      msg += `❌ ${r.writer}: ${r.keyword} - ${(r.error || '').slice(0, 50)}\n`;
    }
  }

  return sendMessage(msg);
}

module.exports = {
  sendMessage,
  getUpdates,
  flushUpdates,
  waitForResponse,
  waitForPhotosComplete,
  checkForStartCommand,
  checkForSchedulerCommand,
  downloadPhoto,
  formatDailyReport,
  formatSubheadingsReport,
  sendPostResult,
  sendDailySummary,
};
