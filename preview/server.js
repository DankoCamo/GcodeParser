const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const GcodeOptimizer = require('../gcode_optimizer');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4173);
const ROOT_DIR = path.resolve(__dirname, '..');
const PREVIEW_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': MIME_TYPES['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sanitizePublicPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(cleanPath).replace(/^([.][.][/\\])+/, '');
  return normalized;
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Request too large.'));
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleOptimize(req, res) {
  try {
    const bodyText = await readRequestBody(req);
    const payload = JSON.parse(bodyText || '{}');

    if (typeof payload.gcodeText !== 'string') {
      sendJson(res, 400, {
        error: 'Invalid request: gcodeText must be a string.',
      });
      return;
    }

    const options = payload.options && typeof payload.options === 'object' ? payload.options : {};

    const optimizer = new GcodeOptimizer(payload.gcodeText);
    await optimizer.optimize(options);

    const optimized = optimizer.getOptimized();
    const stats = optimizer.getStatistics();
    const warnings = optimizer.validateSafety();
    const removedEntries = optimizer.getRemovedEntries();

    sendJson(res, 200, {
      optimized,
      stats,
      warnings,
      removedEntries,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function serveStatic(req, res) {
  const requestedPath = sanitizePublicPath(req.url || '/');
  const pathFromRoot = requestedPath === '/' ? 'preview/index.html' : requestedPath.replace(/^\//, '');
  const resolvedPath = path.resolve(ROOT_DIR, pathFromRoot);

  if (!resolvedPath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }

  try {
    const data = await fs.readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'File not found.' });
  }
}

const server = http.createServer(async (req, res) => {
  if ((req.url || '') === '/' && req.method === 'GET') {
    res.writeHead(302, {
      Location: '/preview/index.html',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if ((req.url || '').startsWith('/api/optimize') && req.method === 'POST') {
    await handleOptimize(req, res);
    return;
  }

  if ((req.url || '').startsWith('/api/version') && req.method === 'GET') {
    sendJson(res, 200, {
      name: 'GcodeParser preview',
      uiVersion: 'v2026.03.13-3',
      indexTitle: 'CAMOutput UI v3',
      now: new Date().toISOString(),
    });
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Preview running on http://localhost:${PORT}/preview/index.html`);
  console.log(`Serving preview assets from ${PREVIEW_DIR}`);
});
