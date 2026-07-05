const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);
const backendUrl = String(process.env.BACKEND_URL || 'http://localhost:3001').trim().replace(/\/$/, '');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.env': 'text/plain; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

const sanitizePath = (requestPath) => {
  const decodedPath = decodeURIComponent(requestPath.split('?')[0] || '/');
  const normalizedPath = path.normalize(decodedPath).replace(/^([.][.][\\/])+/, '');
  const relativePath = normalizedPath === path.sep ? 'index.html' : normalizedPath.replace(/^[\\/]+/, '');
  return relativePath || 'index.html';
};

const sendResponse = (res, statusCode, body, contentType) => {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
};

const proxyToBackend = (req, res) => {
  let target;
  try {
    target = new URL(`${backendUrl}${req.url || '/'}`);
  } catch {
    sendResponse(res, 500, 'Invalid BACKEND_URL', 'text/plain; charset=utf-8');
    return;
  }

  const transport = target.protocol === 'https:' ? https : http;
  const proxyReq = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers: {
      ...req.headers,
      host: target.host
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    sendResponse(res, 502, 'Backend unavailable', 'text/plain; charset=utf-8');
  });

  req.pipe(proxyReq);
};

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/') || req.url === '/health') {
    proxyToBackend(req, res);
    return;
  }

  if ((req.url || '').startsWith('/s/')) {
    const scanPage = path.join(rootDir, 'public-scan.html');
    fs.readFile(scanPage, (readError, data) => {
      if (readError) {
        sendResponse(res, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }

      sendResponse(res, 200, data, contentTypes['.html']);
    });
    return;
  }

  const relativePath = sanitizePath(req.url || '/');
  const absolutePath = path.join(rootDir, relativePath);

  if (!absolutePath.startsWith(rootDir)) {
    sendResponse(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  fs.stat(absolutePath, (statError, stats) => {
    let filePath = absolutePath;

    if (!statError && stats.isDirectory()) {
      filePath = path.join(absolutePath, 'index.html');
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        sendResponse(res, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      sendResponse(res, 200, data, contentTypes[extension] || 'application/octet-stream');
    });
  });
});

server.listen(port, () => {
  console.log(`Frontend local disponible en http://localhost:${port}`);
  console.log(`Proxy API activo -> ${backendUrl}`);
});