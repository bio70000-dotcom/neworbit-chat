function scrubPII(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text;

  // email
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');

  // phone (KR): 010-1234-5678, 01012345678, 02-123-4567 등
  t = t.replace(/\b(01[016789]|02|0[3-6][1-5]|0[7-9][0-9])[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[PHONE]');

  // 주민등록번호(대략): 6-7자리
  t = t.replace(/\b\d{6}[-\s]?\d{7}\b/g, '[RRN]');

  // 카드번호(대략): 13~19자리(공백/하이픈 허용)
  t = t.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD]');

  // 계좌번호(대략): 은행별 다양 -> 숫자 10~16자리 연속/하이픈
  t = t.replace(/\b\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,6}[-\s]?\d{1,6}\b/g, '[ACCOUNT]');

  return t;
}

module.exports = { scrubPII };

