// Node 22's WebSocket client keeps the profile probe free of npm dependencies.
import { readFileSync } from 'node:fs';

const [endpoint, method] = process.argv.slice(2);
const params = JSON.parse(readFileSync(0, 'utf8'));
const url = new URL(endpoint);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(url);
const timer = setTimeout(() => {
  console.error(`Ogmios ${method} timed out`);
  process.exit(1);
}, 15000);

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'caribic', method, params }));
});
socket.addEventListener('message', ({ data }) => {
  try {
    const response = JSON.parse(data);
    if (response.id !== 'caribic') return;
    if (response.error) throw new Error(JSON.stringify(response.error));
    if (!Object.hasOwn(response, 'result')) throw new Error('Missing result');
    process.stdout.write(JSON.stringify(response.result));
    clearTimeout(timer);
    socket.close();
  } catch (error) {
    console.error(`Ogmios ${method}: ${error.message}`);
    process.exit(1);
  }
});
socket.addEventListener('error', () => {
  console.error(`Ogmios ${method}: WebSocket connection failed`);
  process.exit(1);
});
