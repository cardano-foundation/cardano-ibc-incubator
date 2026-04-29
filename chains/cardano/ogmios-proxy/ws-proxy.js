const path = require('path');
const http = require('http');
const https = require('https');
let WebSocket;

try {
  WebSocket = require('/workspace/node_modules/ws');
} catch (_error) {
  WebSocket = require(path.resolve(__dirname, '../../../cardano/gateway/node_modules/ws'));
}
const upstreamHost = process.env.OGMIOS_PROXY_UPSTREAM_HOST;
const upstreamPort = process.env.OGMIOS_PROXY_UPSTREAM_PORT || '443';
const apiKey = process.env.OGMIOS_PROXY_API_KEY || '';
const listenPort = Number(process.env.OGMIOS_PROXY_LISTEN_PORT || '1337');
const upstreamIsTls = upstreamPort === '443';

if (!upstreamHost) {
  console.error('OGMIOS_PROXY_UPSTREAM_HOST is required');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const requestBody = [];

  req.on('data', (chunk) => {
    requestBody.push(chunk);
  });

  req.on('error', (error) => {
    console.error(`downstream http request error: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(400, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'downstream request error', message: error.message }));
  });

  req.on('end', () => {
    const body = Buffer.concat(requestBody);
    const headers = {
      ...req.headers,
      host: upstreamHost,
    };

    delete headers.connection;
    delete headers['content-length'];
    delete headers['transfer-encoding'];

    if (apiKey) {
      headers['dmtr-api-key'] = apiKey;
    }

    const upstreamRequest = (upstreamIsTls ? https : http).request(
      {
        hostname: upstreamHost,
        port: Number(upstreamPort),
        method: req.method,
        path: req.url || '/',
        headers: {
          ...headers,
          'content-length': body.length,
        },
      },
      (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      },
    );

    upstreamRequest.on('error', (error) => {
      console.error(`upstream http error: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'upstream request error', message: error.message }));
    });

    upstreamRequest.end(body);
  });
});

const wss = new WebSocket.Server({ server });

function closeSocket(socket, code, reason) {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  const normalizedReason =
    typeof reason === 'string' && Buffer.byteLength(reason) <= 123 ? reason : undefined;
  const normalizedCode =
    typeof code === 'number' &&
    Number.isInteger(code) &&
    code !== 1005 &&
    code !== 1006 &&
    code !== 1015 &&
    (code === 1000 || (code >= 3000 && code <= 4999))
      ? code
      : undefined;

  if (normalizedCode !== undefined) {
    socket.close(normalizedCode, normalizedReason);
    return;
  }

  socket.close();
}

wss.on('connection', (downstream) => {
  const headers = {};
  if (apiKey) {
    headers['dmtr-api-key'] = apiKey;
  }

  const upstream = new WebSocket(`wss://${upstreamHost}:${upstreamPort}`, { headers });
  const pendingMessages = [];

  upstream.on('open', () => {
    console.log(`upstream connected to ${upstreamHost}:${upstreamPort}`);
    while (pendingMessages.length > 0 && upstream.readyState === WebSocket.OPEN) {
      const { data, isBinary } = pendingMessages.shift();
      upstream.send(data, { binary: isBinary });
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (downstream.readyState === WebSocket.OPEN) {
      downstream.send(data, { binary: isBinary });
    }
  });

  downstream.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }

    pendingMessages.push({ data, isBinary });
  });

  upstream.on('unexpected-response', (_request, response) => {
    console.error(`upstream unexpected response: ${response.statusCode}`);
    closeSocket(downstream, 1011, 'upstream unexpected response');
  });

  upstream.on('error', (error) => {
    console.error(`upstream websocket error: ${error.message}`);
    closeSocket(downstream, 1011, 'upstream websocket error');
  });

  downstream.on('error', (error) => {
    console.error(`downstream websocket error: ${error.message}`);
    closeSocket(upstream, 1011, 'downstream websocket error');
  });

  upstream.on('close', (code, reason) => {
    console.log(`upstream closed: ${code} ${reason}`);
    closeSocket(downstream, code || 1000, reason);
  });

  downstream.on('close', (code, reason) => {
    console.log(`downstream closed: ${code} ${reason}`);
    closeSocket(upstream, code || 1000, reason);
  });
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`ogmios ws proxy listening on :${listenPort}`);
});
