/**
 * Log Viewer - log.neworbit.co.kr
 * 접근 코드로 보호된 서버 중요 로그 조회
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = Number(process.env.PORT) || 3010;
const LOG_DIR = process.env.LOG_DIR || '/var/log/neworbit';
const ACCESS_CODE = process.env.LOG_VIEWER_ACCESS_CODE || '';
const API_KEY = process.env.LOG_VIEWER_API_KEY || ''; // API 조회용 (봇/자동화)
const COOKIE_NAME = 'logviewer';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

function sign(value) {
  if (!ACCESS_CODE) return value;
  return crypto.createHmac('sha256', ACCESS_CODE).update(value).digest('hex');
}

function parseCookie(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [k, v] = part.trim().split('=').map((s) => s.trim());
    if (k && v) acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

function isAuthenticated(req, query = {}) {
  if (!ACCESS_CODE && !API_KEY) return true; // no auth set = allow all (dev)
  if (API_KEY && query.api_key === API_KEY) return true; // API 키로 조회 (봇/에이전트용)
  const cookie = parseCookie(req.headers.cookie || '');
  const token = cookie[COOKIE_NAME];
  return token === sign('ok');
}

function setAuthCookie(res, value) {
  const opts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    `HttpOnly`,
    `SameSite=Strict`,
  ];
  if (process.env.NODE_ENV === 'production') opts.push('Secure');
  res.setHeader('Set-Cookie', opts.join('; '));
}

function send(res, status, body, contentType = 'text/plain') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json');
}

function listLogFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((f) => fs.statSync(path.join(LOG_DIR, f)).isFile())
    .sort()
    .reverse();
}

function readLastLines(filePath, lines = 500) {
  const fullPath = path.join(LOG_DIR, filePath);
  if (!path.resolve(fullPath).startsWith(path.resolve(LOG_DIR))) return null;
  if (!fs.existsSync(fullPath)) return '';

  const maxBytes = 2 * 1024 * 1024; // 2MB cap
  const stat = fs.statSync(fullPath);
  let start = 0;
  if (stat.size > maxBytes) start = stat.size - maxBytes;

  const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
  const fd = fs.openSync(fullPath, 'r');
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);

  const text = buf.toString('utf8');
  const allLines = text.split(/\n/).filter(Boolean);
  const tail = allLines.slice(-lines);
  return tail.join('\n');
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // Login form
  if (pathname === '/' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      send(res, 200, getLoginHtml(), 'text/html; charset=utf-8');
      return;
    }
    send(res, 200, getViewerHtml(), 'text/html; charset=utf-8');
    return;
  }

  // Auth check
  if (pathname === '/auth' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let code = '';
      try {
        code = new URLSearchParams(body).get('code') || '';
      } catch (e) {}
      if (ACCESS_CODE && code !== ACCESS_CODE) {
        send(res, 403, 'Access code invalid');
        return;
      }
      setAuthCookie(res, sign('ok'));
      res.writeHead(302, { Location: '/' });
      res.end();
    });
    return;
  }

  // Logout
  if (pathname === '/logout' && req.method === 'GET') {
    setAuthCookie(res, '');
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  // API: list sources (쿠키 또는 api_key 인증)
  if (pathname === '/api/sources' && req.method === 'GET') {
    if (!isAuthenticated(req, query)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    sendJson(res, 200, { files: listLogFiles() });
    return;
  }

  // API: read log (쿠키 또는 api_key 인증) — 에이전트/봇이 URL만으로 조회 가능
  if (pathname === '/api/logs' && req.method === 'GET') {
    if (!isAuthenticated(req, query)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    const source = query.source || '';
    const lines = Math.min(Number(query.lines) || 500, 2000);
    if (!source || /[^a-zA-Z0-9_.-]/.test(source)) {
      sendJson(res, 400, { error: 'Invalid source' });
      return;
    }
    const content = readLastLines(source, lines);
    if (content === null) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    sendJson(res, 200, { content, source, lines });
    return;
  }

  send(res, 404, 'Not Found');
});

function getLoginHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log Viewer - NewOrbit</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #1a1a2e; color: #eee; }
    .box { background: #16213e; padding: 2rem; border-radius: 8px; width: 100%; max-width: 360px; }
    h1 { margin: 0 0 1.5rem; font-size: 1.25rem; }
    input { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #0f3460; border-radius: 4px; background: #0f3460; color: #eee; }
    button { width: 100%; padding: 0.75rem; background: #e94560; border: none; border-radius: 4px; color: #fff; font-weight: 600; cursor: pointer; }
    button:hover { background: #c73e54; }
    .error { color: #e94560; font-size: 0.875rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Log Viewer</h1>
    <form method="post" action="/auth">
      <input type="password" name="code" placeholder="엑세스 코드" required autofocus>
      <button type="submit">입장</button>
    </form>
  </div>
</body>
</html>`;
}

function getViewerHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log Viewer - NewOrbit</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ui-monospace, monospace; margin: 0; background: #0d1117; color: #c9d1d9; min-height: 100vh; }
    header { background: #161b22; padding: 0.75rem 1rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; border-bottom: 1px solid #21262d; }
    select { padding: 0.5rem; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; min-width: 180px; }
    button { padding: 0.5rem 1rem; background: #238636; border: none; border-radius: 4px; color: #fff; cursor: pointer; }
    button:hover { background: #2ea043; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .pre { padding: 1rem; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 13px; line-height: 1.5; }
    .pre .ts { color: #8b949e; }
    .pre .err { color: #f85149; }
    .pre .warn { color: #d29922; }
  </style>
</head>
<body>
  <header>
    <select id="source"><option value="">로그 선택</option></select>
    <button id="refresh">새로고침</button>
    <label><input type="number" id="lines" value="500" min="100" max="2000" step="100" style="width:70px"> 줄</label>
    <a href="/logout" style="margin-left:auto">로그아웃</a>
  </header>
  <pre class="pre" id="content">로그 소스를 선택하세요.</pre>
  <script>
    const sourceEl = document.getElementById('source');
    const contentEl = document.getElementById('content');
    const refreshBtn = document.getElementById('refresh');
    const linesEl = document.getElementById('lines');

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    function highlight(line) {
      const ts = line.match(/^\\d{4}-\\d{2}-\\d{2}T[^Z]+Z/);
      let rest = line;
      let cls = '';
      if (ts) { rest = line.slice(ts[0].length); }
      if (/error|fail|Exception|uncaught|unhandled/i.test(line)) cls = 'err';
      else if (/warn/i.test(line)) cls = 'warn';
      const tsSpan = ts ? '<span class="ts">' + escapeHtml(ts[0]) + '<\\/span> ' : '';
      return tsSpan + '<span class="' + cls + '">' + escapeHtml(rest) + '<\\/span>';
    }

    async function loadSources() {
      const r = await fetch('/api/sources');
      const data = await r.json();
      sourceEl.innerHTML = '<option value="">로그 선택</option>' + (data.files || []).map(f => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('');
    }

    async function loadLog() {
      const source = sourceEl.value;
      if (!source) return;
      const lines = linesEl.value || 500;
      const r = await fetch('/api/logs?source=' + encodeURIComponent(source) + '&lines=' + lines);
      const data = await r.json();
      if (data.content !== undefined) {
        contentEl.innerHTML = data.content.split('\\n').map(highlight).join('\\n');
      } else {
        contentEl.textContent = data.error || 'Failed to load';
      }
    }

    refreshBtn.addEventListener('click', loadLog);
    sourceEl.addEventListener('change', loadLog);
    loadSources();
  </script>
</body>
</html>`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Log Viewer listening on ${PORT}, LOG_DIR=${LOG_DIR}`);
});
