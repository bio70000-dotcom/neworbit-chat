/**
 * Ghost 발행 모듈
 * Ghost Admin API를 사용하여 블로그 글 + 이미지 발행
 */

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const GHOST_URL = process.env.GHOST_URL || 'http://ghost:2368';

/**
 * Ghost Admin API JWT 토큰 생성
 * GHOST_ADMIN_API_KEY 형식: {id}:{secret}
 */
function createGhostToken() {
  const apiKey = process.env.GHOST_ADMIN_API_KEY;
  if (!apiKey) throw new Error('GHOST_ADMIN_API_KEY가 설정되지 않았습니다');

  const [id, secret] = apiKey.split(':');
  if (!id || !secret) throw new Error('GHOST_ADMIN_API_KEY 형식이 잘못되었습니다 (id:secret)');

  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: id };

  const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
    header,
    expiresIn: '5m',
    audience: '/admin/',
  });

  return token;
}

/**
 * Ghost Admin API 요청 헬퍼
 */
async function ghostRequest(endpoint, options = {}) {
  const token = createGhostToken();
  const url = `${GHOST_URL}/ghost/api/admin${endpoint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Ghost ${token}`,
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ghost API ${res.status}: ${errText.slice(0, 300)}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ghost에 이미지 업로드
 * @param {Buffer} imageBuffer 이미지 바이너리
 * @param {string} filename 파일명
 * @returns {Promise<string>} 업로드된 이미지 URL
 */
async function uploadImage(imageBuffer, filename) {
  const token = createGhostToken();
  const url = `${GHOST_URL}/ghost/api/admin/images/upload/`;

  // 임시 파일로 저장 후 업로드
  const tmpPath = path.join(__dirname, '..', 'tmp', filename);
  const tmpDir = path.dirname(tmpPath);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpPath, imageBuffer);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // Node.js 18+ FormData with file upload
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tmpPath), {
      filename,
      contentType: 'image/png',
    });
    formData.append('purpose', 'image');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Ghost ${token}`,
        ...formData.getHeaders(),
      },
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`이미지 업로드 실패 ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return data?.images?.[0]?.url || '';
  } finally {
    clearTimeout(timeout);
    // 임시 파일 정리
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

/**
 * Ghost에 블로그 글 발행
 * @param {Object} post - { title, body, metaDescription, tags, thumbnailBuffer?, bodyImageBuffers? }
 * @returns {Promise<Object>} 발행된 글 정보
 */
async function publish(post) {
  let featureImage = null;
  let bodyHtml = post.body;

  // 1. 썸네일 이미지 업로드
  if (post.thumbnailBuffer) {
    try {
      const slug = post.title.replace(/[^a-zA-Z0-9가-힣]/g, '-').slice(0, 30);
      featureImage = await uploadImage(post.thumbnailBuffer, `thumb-${slug}.png`);
      console.log(`[Publisher] 썸네일 업로드 완료: ${featureImage}`);
    } catch (e) {
      console.warn(`[Publisher] 썸네일 업로드 실패: ${e.message}`);
    }
  }

  // 2. 본문 이미지 업로드 및 삽입
  if (post.bodyImageBuffers && post.bodyImageBuffers.length > 0) {
    for (let i = 0; i < post.bodyImageBuffers.length; i++) {
      try {
        const imgUrl = await uploadImage(post.bodyImageBuffers[i], `body-${Date.now()}-${i}.png`);
        // 본문의 첫 번째 </h2> 뒤에 이미지 삽입
        const insertPoint = bodyHtml.indexOf('</h2>');
        if (insertPoint !== -1) {
          const insertIdx = insertPoint + 5;
          bodyHtml =
            bodyHtml.slice(0, insertIdx) +
            `<figure><img src="${imgUrl}" alt="${post.title}" /></figure>` +
            bodyHtml.slice(insertIdx);
        }
        console.log(`[Publisher] 본문 이미지 ${i + 1} 업로드 완료`);
      } catch (e) {
        console.warn(`[Publisher] 본문 이미지 ${i + 1} 업로드 실패: ${e.message}`);
      }
    }
  }

  // 3. 태그 생성/조회
  const tags = (post.tags || []).map((name) => ({ name }));

  // 4. Ghost Admin API로 글 발행
  const ghostPost = {
    posts: [
      {
        title: post.title,
        html: bodyHtml,
        status: 'published',
        tags,
        meta_title: post.title,
        meta_description: post.metaDescription || '',
        feature_image: featureImage,
        // Open Graph
        og_title: post.title,
        og_description: post.metaDescription || '',
        og_image: featureImage,
        // Twitter Card
        twitter_title: post.title,
        twitter_description: post.metaDescription || '',
        twitter_image: featureImage,
      },
    ],
  };

  try {
    const result = await ghostRequest('/posts/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghostPost),
    });

    const published = result?.posts?.[0];
    console.log(`[Publisher] 발행 완료: "${published?.title}" (${published?.url})`);
    return published;
  } catch (e) {
    console.error(`[Publisher] 발행 실패: ${e.message}`);
    throw e;
  }
}

module.exports = { publish, uploadImage };
