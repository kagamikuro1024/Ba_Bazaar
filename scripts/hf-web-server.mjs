import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PUBLIC_PORT ?? process.env.PORT ?? 7860);
const apiTarget = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;
const webDist =
  process.env.WEB_DIST ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/dist');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp']
]);

function sendStatus(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function proxyToApi(requestFromClient, responseToClient) {
  const targetUrl = new URL(requestFromClient.url ?? '/', apiTarget);
  const headers = { ...requestFromClient.headers, host: targetUrl.host };

  const proxyRequest = request(
    targetUrl,
    {
      method: requestFromClient.method,
      headers
    },
    (proxyResponse) => {
      responseToClient.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(responseToClient);
    }
  );

  proxyRequest.on('error', (error) => {
    console.error('API proxy failed:', error);
    if (!responseToClient.headersSent) {
      sendStatus(responseToClient, 502, 'API proxy failed');
    } else {
      responseToClient.destroy(error);
    }
  });

  requestFromClient.pipe(proxyRequest);
}

async function resolveStaticFile(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(webDist, relativePath);
  const rootWithSeparator = `${path.resolve(webDist)}${path.sep}`;

  if (absolutePath !== path.resolve(webDist) && !absolutePath.startsWith(rootWithSeparator)) {
    return null;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (fileStat.isFile()) {
      return absolutePath;
    }
  } catch {
    if (path.extname(relativePath)) {
      return null;
    }

    return path.join(webDist, 'index.html');
  }

  return path.join(webDist, 'index.html');
}

const server = createServer(async (clientRequest, clientResponse) => {
  const url = clientRequest.url ?? '/';

  if (url.startsWith('/api/') || url === '/health') {
    proxyToApi(clientRequest, clientResponse);
    return;
  }

  if (clientRequest.method !== 'GET' && clientRequest.method !== 'HEAD') {
    sendStatus(clientResponse, 405, 'Method not allowed');
    return;
  }

  const filePath = await resolveStaticFile(url);
  if (!filePath) {
    sendStatus(clientResponse, 404, 'Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  clientResponse.writeHead(200, {
    'cache-control': filePath.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'content-type': mimeTypes.get(extension) ?? 'application/octet-stream'
  });

  if (clientRequest.method === 'HEAD') {
    clientResponse.end();
    return;
  }

  createReadStream(filePath).pipe(clientResponse);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BA Bazaar web server listening on 0.0.0.0:${port}`);
});
