/**
 * Ghost 발행 모듈
 * Ghost Admin API를 사용하여 블로그 글 + 이미지 발행
 * 작가별 저자(author) 지정 지원
 */

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

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

  // Ghost 공식 문서 형식 (keyid + algorithm 사용)
  const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id,
    algorithm: 'HS256',
    expiresIn: '5m',
    audience: `/admin/`,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // Node.js 20+ native FormData + Blob
    // 파일명을 .jpg로 변경하여 Ghost가 JPEG로 인식하게 함
    const jpgFilename = filename.replace(/\.png$/i, '.jpg');
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('file', blob, jpgFilename);
    formData.append('purpose', 'image');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Ghost ${token}`,
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
  }
}

// ── 작가 (Author) 관리 ──────────────────────────────

/**
 * 기존 Ghost 스태프 목록 가져오기
 */
async function getGhostUsers() {
  try {
    const data = await ghostRequest('/users/?limit=all');
    return data?.users || [];
  } catch (e) {
    console.warn(`[Publisher] 스태프 목록 조회 실패: ${e.message}`);
    return [];
  }
}

/**
 * Ghost 스태프(작가) 생성 또는 기존 조회
 * Ghost는 invite 방식이라 직접 생성이 어려울 수 있음 → slug로 조회
 */
async function findOrGetAuthor(writer) {
  // 캐시된 Ghost author ID가 있으면 바로 반환
  if (writer.ghostAuthorId) return writer.ghostAuthorId;

  const users = await getGhostUsers();

  // slug 또는 이름으로 작가 찾기
  const found = users.find(
    (u) => u.slug === writer.id || u.name === writer.nickname
  );

  if (found) {
    console.log(`[Publisher] 작가 발견: ${found.name} (${found.id})`);
    writer.ghostAuthorId = found.id;
    return found.id;
  }

  // 기존 작가가 없으면 기본 작가(Owner) 사용하고 nickname으로 표시
  const owner = users.find((u) => u.roles?.some((r) => r.name === 'Owner'));
  if (owner) {
    console.log(`[Publisher] 작가 "${writer.nickname}" 미등록 → Owner(${owner.name}) 사용`);
    return owner.id;
  }

  console.log('[Publisher] Owner 찾기 실패 → 기본 작가 사용');
  return null;
}

/**
 * Ghost에 블로그 글 발행 (작가 지정 포함)
 * @param {Object} post - { title, body, metaDescription, tags, thumbnailBuffer?, bodyImageBuffers?, writer? }
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

  // 2. 이미지 삽입 (AI 생성 + Pexels 실사를 h2 사이사이에 분산 배치)
  const allImages = []; // { html: string } 배열

  // 2-1. AI 생성 이미지 업로드
  if (post.bodyImageBuffers && post.bodyImageBuffers.length > 0) {
    for (let i = 0; i < post.bodyImageBuffers.length; i++) {
      try {
        const imgUrl = await uploadImage(post.bodyImageBuffers[i], `body-${Date.now()}-${i}.png`);
        allImages.push({
          html: `<figure><img src="${imgUrl}" alt="${post.title}" /></figure>`,
        });
        console.log(`[Publisher] AI 이미지 ${i + 1} 업로드 완료`);
      } catch (e) {
        console.warn(`[Publisher] AI 이미지 ${i + 1} 업로드 실패: ${e.message}`);
      }
    }
  }

  // 2-2. Pexels 실사 이미지 (업로드 없이 외부 URL 직접 삽입 → Pexels CDN에서 서빙)
  if (post.pexelsImages && post.pexelsImages.length > 0) {
    for (const pImg of post.pexelsImages) {
      allImages.push({
        html: `<figure><img src="${pImg.url}" alt="${pImg.alt}" loading="lazy" /><figcaption>Photo by ${pImg.photographer} on <a href="${pImg.pexelsUrl}" target="_blank" rel="noopener">Pexels</a></figcaption></figure>`,
      });
      console.log(`[Publisher] Pexels 이미지 삽입: ${pImg.photographer}`);
    }
  }

  // 2-3. 이미지를 h2 태그 뒤에 분산 배치
  if (allImages.length > 0) {
    const h2Positions = [];
    const h2Regex = /<\/h2>/gi;
    let h2Match;
    while ((h2Match = h2Regex.exec(bodyHtml)) !== null) {
      h2Positions.push(h2Match.index + h2Match[0].length);
    }

    // 이미지를 균등하게 분배 (첫 번째, 세 번째 h2 뒤 등)
    if (h2Positions.length > 0) {
      const step = Math.max(1, Math.floor(h2Positions.length / (allImages.length + 1)));
      let insertOffset = 0;

      for (let i = 0; i < allImages.length && i * step < h2Positions.length; i++) {
        const posIdx = Math.min((i + 1) * step - 1, h2Positions.length - 1);
        const insertAt = h2Positions[posIdx] + insertOffset;
        const imgHtml = allImages[i].html;
        bodyHtml = bodyHtml.slice(0, insertAt) + imgHtml + bodyHtml.slice(insertAt);
        insertOffset += imgHtml.length;
      }
    }
  }

  // 3. 작가 지정
  let authors = undefined;
  if (post.writer) {
    try {
      const authorId = await findOrGetAuthor(post.writer);
      if (authorId) {
        authors = [{ id: authorId }];
      }
    } catch (e) {
      console.warn(`[Publisher] 작가 지정 실패: ${e.message}`);
    }
  }

  // 4. 태그 생성/조회
  const tags = (post.tags || []).map((name) => ({ name }));

  // 5. 작가 서명 추가 (본문 끝에 작가 정보 삽입)
  if (post.writer) {
    bodyHtml += `\n<hr />\n<p><em>글쓴이: ${post.writer.nickname} · ${post.writer.bio}</em></p>`;
  }

  // 6. Ghost Admin API로 글 발행
  // source: 'html' 필수! 이것이 없으면 Ghost가 html 필드를 무시하고 빈 본문이 됨
  const postStatus = process.env.BLOG_POST_STATUS || 'draft';
  const ghostPost = {
    posts: [
      {
        title: post.title,
        html: bodyHtml,
        status: postStatus, // 비공개(초안). BLOG_POST_STATUS=published 시 공개
        tags,
        meta_title: post.title,
        meta_description: post.metaDescription || '',
        feature_image: featureImage,
        // 작가 지정
        ...(authors && { authors }),
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
    // source=html 파라미터로 Ghost에게 HTML 변환을 요청
    const result = await ghostRequest('/posts/?source=html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghostPost),
    });

    const published = result?.posts?.[0];
    const writerName = post.writer?.nickname || '기본';
    console.log(`[Publisher] 발행 완료: "${published?.title}" by ${writerName} (${published?.url}) status: ${published?.status ?? 'unknown'}`);

    // Ghost가 published로 저장한 경우 draft로 되돌려 비공개 유지 (달산책 등 author별 이슈 방어)
    if (published?.id && published?.status === 'published') {
      try {
        await ghostRequest(`/posts/${published.id}/?source=html`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            posts: [{ id: published.id, updated_at: published.updated_at, status: 'draft' }],
          }),
        });
        console.log(`[Publisher] status가 published였음 → draft로 변경 완료 (${published.id})`);
        published.status = 'draft';
      } catch (e) {
        console.warn(`[Publisher] status draft로 되돌리기 실패: ${e.message}`);
      }
    }

    return published;
  } catch (e) {
    console.error(`[Publisher] 발행 실패: ${e.message}`);
    throw e;
  }
}

/**
 * 발행된 글 본문 하단에 관련글 링크 섹션 추가 (작가 서명 앞에 삽입)
 * @param {string} ghostPostId Ghost 포스트 ID
 * @param {Array<{ title, post_url }>} relatedPosts 관련글 목록 (최대 3~5개)
 */
async function appendRelatedPostsSection(ghostPostId, relatedPosts) {
  if (!ghostPostId || !relatedPosts || relatedPosts.length === 0) return;

  try {
    const existing = await ghostRequest(`/posts/${ghostPostId}/`);
    const post = existing?.posts?.[0];
    if (!post || !post.html) {
      console.warn('[Publisher] 관련글: 포스트 조회 실패');
      return;
    }

    const listItems = relatedPosts
      .map((r) => `<li><a href="${r.post_url}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a></li>`)
      .join('\n');
    const sectionHtml = `\n<hr /><section class="related-posts"><h3>관련 글</h3><ul>${listItems}</ul></section>`;

    let html = post.html;
    const hrIdx = html.lastIndexOf('<hr />');
    if (hrIdx !== -1) {
      html = html.slice(0, hrIdx) + sectionHtml + '\n' + html.slice(hrIdx);
    } else {
      html = html + sectionHtml;
    }

    await ghostRequest(`/posts/${ghostPostId}/?source=html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posts: [{ id: ghostPostId, html, updated_at: post.updated_at }],
      }),
    });
    console.log(`[Publisher] 관련글 ${relatedPosts.length}개 링크 추가 완료`);
  } catch (e) {
    console.warn(`[Publisher] 관련글 섹션 추가 실패: ${e.message}`);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { publish, uploadImage, ghostRequest, getGhostUsers, appendRelatedPostsSection };
