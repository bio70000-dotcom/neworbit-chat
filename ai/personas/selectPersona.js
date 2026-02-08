const fs = require('fs');
const path = require('path');

function loadPersonas() {
  const jsonPath = path.join(__dirname, 'personas.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  return JSON.parse(raw);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// profile 예시:
// { purpose: "smalltalk|vent|info|advice|meet", tags: ["game","music"], ageGroup?: "10s|20s|30s|40plus", gender?: "male|female|na" }
function scorePersona(persona, profile = {}) {
  const w = persona.weights || {};
  let score = typeof w.default === 'number' ? w.default : 1.0;

  if (profile?.purpose && w.purpose && typeof w.purpose[profile.purpose] === 'number') {
    score *= w.purpose[profile.purpose];
  }

  // 연령대 옵션: 입력했을 때만 약하게 반영
  if (profile?.ageGroup) {
    if (profile.ageGroup === '20s' && persona.ageGroup === '20s') score *= 1.1;
    if (profile.ageGroup === '30s' && persona.ageGroup === '30s') score *= 1.1;
    if (profile.ageGroup === '40plus' && persona.ageGroup === '40plus') score *= 1.1;
  }

  // 태그는 단기에는 “역할/톤”에 매핑만(가벼운 가중치)
  if (Array.isArray(profile?.tags) && profile.tags.length > 0) {
    const tags = new Set(profile.tags);
    // IT/개발/경제는 info role 선호
    if (tags.has('it') || tags.has('dev') || tags.has('finance')) {
      if (persona.role === 'info') score *= 1.1;
    }
    // 연애/심리는 counselor 선호
    if (tags.has('love') || tags.has('psych')) {
      if (persona.role === 'counselor') score *= 1.1;
    }
    // 게임/스포츠는 fun friend 선호
    if (tags.has('game') || tags.has('sports')) {
      if (persona.role === 'friend' && persona.tone === 'fun') score *= 1.1;
    }
  }

  return clamp(score, 0.05, 10);
}

function weightedRandom(items, weights, rng = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * 단기 선택 로직:
 * - 목적/태그 기반 가중치로 1개 선택
 * - exploreRate(기본 0.2)로 무작위 탐색 유지
 */
function selectPersona(profile = {}, opts = {}) {
  const { personas } = loadPersonas();
  const exploreRate = typeof opts.exploreRate === 'number' ? opts.exploreRate : 0.2;
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;

  if (!Array.isArray(personas) || personas.length === 0) {
    throw new Error('No personas configured');
  }

  // 탐색: 완전 랜덤 20%
  if (rng() < exploreRate) {
    return personas[Math.floor(rng() * personas.length)];
  }

  // 착취: 가중치 랜덤
  const weights = personas.map((p) => scorePersona(p, profile));
  return weightedRandom(personas, weights, rng);
}

module.exports = { selectPersona, scorePersona };

