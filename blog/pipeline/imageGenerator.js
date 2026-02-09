/**
 * 이미지 생성 모듈
 * Gemini Imagen 3을 사용하여 블로그 썸네일 및 본문 이미지 생성
 */

const fs = require('fs');
const path = require('path');

const IMAGEN_URL = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict';
const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

/**
 * Imagen 3으로 이미지 생성
 * @param {string} prompt 이미지 설명
 * @returns {Promise<Buffer|null>} 이미지 바이너리 또는 null
 */
async function generateWithImagen(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `${IMAGEN_URL}?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
          safetyFilterLevel: 'block_few',
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[ImageGen] Imagen HTTP ${res.status}: ${errText.slice(0, 150)}`);
      return null;
    }

    const data = await res.json();
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) return null;

    return Buffer.from(b64, 'base64');
  } catch (e) {
    console.warn(`[ImageGen] Imagen 실패: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Gemini 2.0 Flash로 이미지 생성 (fallback)
 * @param {string} prompt 이미지 설명
 * @returns {Promise<Buffer|null>}
 */
async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `${GEMINI_GENERATE_URL}?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Generate an image: ${prompt}` }],
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart) return null;

    return Buffer.from(imagePart.inlineData.data, 'base64');
  } catch (e) {
    console.warn(`[ImageGen] Gemini Flash 이미지 생성 실패: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 블로그 이미지 생성 (썸네일 + 본문 이미지)
 * @param {string} title 글 제목
 * @param {string} keyword 키워드
 * @returns {Promise<{thumbnail: Buffer|null, bodyImages: Buffer[]}>}
 */
async function generateImages(title, keyword) {
  const thumbnailPrompt = `A clean, bright, modern blog header illustration for the topic "${keyword}". 
Flat design style, pastel colors, no text, no watermark, 16:9 aspect ratio. 
Professional blog thumbnail aesthetic. Korean lifestyle theme.`;

  const bodyPrompt = `A supplementary blog illustration about "${keyword}". 
Minimal flat vector style, soft colors, clean composition, no text, no watermark.
Suitable for a Korean lifestyle blog article.`;

  console.log(`[ImageGen] 이미지 생성 시작: "${keyword}"`);

  // 썸네일 생성 (Imagen → Gemini fallback)
  let thumbnail = await generateWithImagen(thumbnailPrompt);
  if (!thumbnail) {
    console.log('[ImageGen] Imagen 실패, Gemini Flash로 fallback');
    thumbnail = await generateWithGemini(thumbnailPrompt);
  }

  // 본문 이미지 1장
  let bodyImage = await generateWithImagen(bodyPrompt);
  if (!bodyImage) {
    bodyImage = await generateWithGemini(bodyPrompt);
  }

  const bodyImages = bodyImage ? [bodyImage] : [];

  console.log(`[ImageGen] 생성 완료: 썸네일 ${thumbnail ? 'O' : 'X'}, 본문 ${bodyImages.length}장`);

  return { thumbnail, bodyImages };
}

/**
 * 이미지 버퍼를 임시 파일로 저장
 * @param {Buffer} buffer
 * @param {string} name
 * @returns {string} 파일 경로
 */
function saveTempImage(buffer, name) {
  const tmpDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `${name}-${Date.now()}.png`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = { generateImages, saveTempImage };
