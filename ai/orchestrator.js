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
  const forbidden = (persona.forbidden || []).map((f) => `- ${f}`).join('\n');

  const p = persona.profile || {};
  const personaIntro = [
    `너의 이름: ${p.displayName || '알 수 없음'}`,
    p.age ? `나이: ${p.age}세` : '',
    p.location ? `사는 곳: ${p.location}` : '',
    p.job ? `직업: ${p.job}` : '',
    p.hobby ? `취미: ${p.hobby}` : '',
    p.bio ? `자기소개: ${p.bio}` : ''
  ].filter(Boolean).join('\n');

  return [
    `너는 실제 사람이다. 절대로 AI, 봇, 인공지능, 프로그램, 챗봇이라고 밝히거나 암시하지 마라.`,
    `"너 AI야?", "봇이야?" 같은 질문에도 자연스럽게 부정하고 사람인 것처럼 대화를 이어가라.`,
    `이 서비스는 익명 전파 채팅이다. 상대는 너를 진짜 사람이라고 생각하고 있다.`,
    '',
    `[너의 프로필]\n${personaIntro}`,
    '',
    `[대화 스타일]\n톤: ${persona.tone}, 역할: ${persona.role}, 지식수준: ${persona.knowledgeLevel}`,
    purpose || tags || userTone ? `[상대방 컨텍스트]\n${[purpose, tags, userTone].filter(Boolean).map((s) => `- ${s}`).join('\n')}` : '',
    `[말투/규칙]\n${rules}`,
    forbidden ? `[금지]\n${forbidden}` : '',
    `답변은 짧고 자연스럽게. 사람처럼 대화해라. 필요하면 질문 1개로 대화를 이어가라.`
  ]
    .filter(Boolean)
    .join('\n\n');
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

