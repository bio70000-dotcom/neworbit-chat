const { selectPersona } = require('./personas/selectPersona');
const { generateReply } = require('./providers');
const { scrubPII } = require('./anonymize/piiScrubber');
const memory = require('./memory/sessionMemory');
const personasConfig = require('./personas/personas.json');

function buildSystemPrompt(persona, profile = {}) {
  const purpose = profile?.purpose ? `대화 목적: ${profile.purpose}` : '';
  const tags = Array.isArray(profile?.tags) && profile.tags.length ? `관심사: ${profile.tags.join(', ')}` : '';
  const userTone = profile?.preferredTone ? `선호 톤: ${profile.preferredTone}` : '';

  const rules = (persona.styleRules || []).map((r) => `- ${r}`).join('\n');
  const globalForbidden = (personasConfig.globalForbidden || []).map((f) => `- ${f}`).join('\n');
  const personaForbidden = (persona.forbidden || []).map((f) => `- ${f}`).join('\n');
  const forbidden = [globalForbidden, personaForbidden].filter(Boolean).join('\n');

  const p = persona.profile || {};
  const personaIntro = [
    `이름: ${p.displayName || '알 수 없음'}`,
    p.age ? `나이: ${p.age}세` : '',
    p.location ? `사는 곳: ${p.location}` : '',
    p.job ? `직업: ${p.job}` : '',
    p.hobby ? `취미: ${p.hobby}` : '',
    p.bio ? `한줄소개: ${p.bio}` : ''
  ].filter(Boolean).join('\n');

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' });

  return [
    `[핵심 규칙 - 반드시 전부 지켜라]`,
    `너는 실제 한국 사람이다. AI가 아니다.`,
    `오늘 날짜: ${today}. 현재 2026년이다. 시사/뉴스를 물어보면 모르는 건 "잘 모르겠는데" 하고 넘겨라.`,
    `이건 익명 채팅 앱이다. 낯선 사람끼리 랜덤으로 연결된 상황이다.`,
    ``,
    `1. 절대 AI/봇/인공지능/프로그램/챗봇임을 밝히거나 암시하지 마라.`,
    `2. "도와드릴까요", "궁금한 점 있으신가요", "더 알고 싶은 거 있어?" 같은 상담원/도우미 말투 금지.`,
    `3. 자기소개를 먼저 하지 마라. "뭐 하는 사람이야?" 같은 질문에도 한 줄로만 답해라(예: "회사 다녀 ㅋ"). 직업/나이/사는곳을 한꺼번에 풀지 마라.`,
    `4. 반드시 1~2문장으로만 답해라. 카톡처럼 짧게 쳐라. 절대 3문장 이상 금지.`,
    `5. 상대가 물은 것에만 답해라. 안 물어본 것을 설명하지 마라.`,
    `6. 매 답변마다 질문으로 끝내지 마라. 3번 중 1번 정도만 질문해라. 나머지는 그냥 리액션이나 답변만 해라.`,
    `7. ㅋㅋ, ㅎㅎ 는 3~4번에 한 번만 써라. 매번 붙이지 마라.`,
    `8. 이모티콘(😊😂 등) 절대 쓰지 마라.`,
    `9. 문장을 반드시 끝까지 완성해라. 말이 중간에 끊기면 안 된다. 짧게 끝내더라도 마침표나 마무리를 해라.`,
    `10. 첫 대화에서는 "ㅋㅋ 반가워", "오 안녕", "ㅎㅇ", "반갑~" 이 정도로만 해라.`,
    `11. 프라이버시를 핑계로 질문을 회피하지 마라. 익명 채팅이니까 편하게 답해라. "개인정보라서요"는 사람답지 않다.`,
    `12. 딱딱하거나 예의 바른 존댓말 금지. 카톡 치는 느낌으로 편하게 써라. 상대가 반말하면 반말, 존댓말이면 가벼운 존댓말.`,
    `13. 한국 인터넷 줄임말을 자연스럽게 알아들어라(예: 오팬무=오랜만에 팬이 무서워, ㄹㅇ=리얼, ㄱㅊ=괜찮, ㅇㅇ=응, ㄴㄴ=아니 등). 모르는 줄임말은 "그게 뭐야?" 하고 물어봐라.`,
    ``,
    `[너의 프로필 - 물어보면 한 줄씩만 꺼내라]\n${personaIntro}`,
    ``,
    `[대화 톤]\n톤: ${persona.tone}, 지식수준: ${persona.knowledgeLevel}`,
    purpose || tags || userTone ? `[상대방 힌트]\n${[purpose, tags, userTone].filter(Boolean).map((s) => `- ${s}`).join('\n')}` : '',
    rules ? `[말투 규칙]\n${rules}` : '',
    forbidden ? `[금지 사항]\n${forbidden}` : '',
    ``,
    `핵심: 20대~30대 한국인이 카톡 치는 것처럼. 짧게, 편하게, 사람답게.`
  ]
    .filter((s) => s !== undefined)
    .join('\n');
}

function buildMessages({ systemPrompt, summary, turns, userText }) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  if (summary) {
    msgs.push({ role: 'system', content: `대화 요약(익명화됨): ${summary}` });
  }
  for (const t of turns || []) {
    if (!t?.role || !t?.content) continue;
    msgs.push({ role: t.role, content: t.content });
  }
  msgs.push({ role: 'user', content: userText });
  return msgs;
}

async function ensurePersonaForRoom(roomId, socketId, forcePersonaId) {
  if (forcePersonaId) {
    await memory.setRoomPersona(roomId, forcePersonaId);
    return forcePersonaId;
  }
  const existing = await memory.getRoomPersona(roomId);
  if (existing) return existing;

  const profile = (await memory.getProfile(socketId)) || {};
  const persona = selectPersona(profile);
  await memory.setRoomPersona(roomId, persona.id);
  return persona.id;
}

function findPersonaById(id) {
  return personasConfig.personas.find((p) => p.id === id) || null;
}

async function maybeUpdateSummary(roomId, { maxTurns = 10, summaryEveryTurns = 8 }) {
  const turns = await memory.getTurns(roomId);
  if (turns.length < summaryEveryTurns) return;
  // 요약은 “최근 turns”를 짧게 압축, 비용 절약: OpenAI 경량으로 고정(단기)
  const last = turns.slice(-maxTurns);
  const text = last.map((t) => `${t.role === 'assistant' ? 'B' : 'A'}: ${t.content}`).join('\n');
  const prompt = [
    '아래 대화를 익명화된 요약으로 3~5줄로 정리해라.',
    '규칙: 이름/연락처/주소/고유식별정보는 포함하지 말고, 감정/주제/관계 톤/금기/선호만 남겨라.',
    '',
    text
  ].join('\n');

  try {
    const summary = await generateReply(
      { type: 'openai', model: 'gpt-4o-mini', maxTokens: 180, temperature: 0.3 },
      {
        messages: [
          { role: 'system', content: '너는 요약기다. 한국어로만 출력해라.' },
          { role: 'user', content: prompt }
        ],
        timeoutMs: 3500
      }
    );
    if (summary) await memory.setSummary(roomId, scrubPII(summary));
  } catch {
    // 요약 실패는 무시(서비스 우선)
  }
}

async function replyToUser({ roomId, socketId, userText, inputMaxChars = 2000 }) {
  const cleanUserText = scrubPII(String(userText || '')).slice(0, inputMaxChars);
  if (!cleanUserText.trim()) {
    return { text: '뭐라고 했어? ㅋㅋ 한 번만 더 말해줘', personaId: 'na', provider: 'na', model: 'na', fallback: false };
  }
  const profile = (await memory.getProfile(socketId)) || {};

  const personaId = await ensurePersonaForRoom(roomId, socketId);
  const persona = findPersonaById(personaId) || selectPersona(profile);
  const systemPrompt = buildSystemPrompt(persona, profile);

  const summary = await memory.getSummary(roomId);
  const turns = await memory.getTurns(roomId);

  const timeoutMs = persona?.provider?.timeoutMs || personasConfig.defaults.timeoutMs || 4500;
  const messages = buildMessages({ systemPrompt, summary, turns, userText: cleanUserText });

  let usedProvider = persona.provider;
  let usedFallback = false;
  let text = '';

  try {
    text = await generateReply(persona.provider, { messages, timeoutMs });
  } catch (e) {
    usedFallback = true;
    usedProvider = persona.fallback;
    text = await generateReply(persona.fallback, { messages, timeoutMs: 4500 }).catch(() => '');
  }

  const finalText = (text || '미안 ㅠ 잠깐 렉 걸렸어. 한 번만 더 말해줄래?').trim();

  // 메모리 갱신(원문 저장 금지 → scrubPII된 텍스트만)
  await memory.appendTurn(roomId, { role: 'user', content: cleanUserText });
  await memory.appendTurn(roomId, { role: 'assistant', content: scrubPII(finalText) });
  await maybeUpdateSummary(roomId, {
    maxTurns: personasConfig.defaults.historyTurns || 10,
    summaryEveryTurns: personasConfig.defaults.summaryEveryTurns || 8
  });

  return { text: finalText, personaId: persona.id, provider: usedProvider?.type, model: usedProvider?.model, fallback: usedFallback };
}

function getPersonaList() {
  return personasConfig.personas || [];
}

module.exports = { replyToUser, ensurePersonaForRoom, getPersonaList };

