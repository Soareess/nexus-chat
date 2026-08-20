/**
 * Sinalizacao rodando como Vercel Function com WebSocket (Fluid compute).
 * A funcao e servida em /api/socket-io, e so esse caminho e roteado ate ela.
 * Por isso o proprio Socket.IO usa path: "/api/socket-io", com websocket puro
 * (long-polling precisaria de sticky session entre instancias).
 */
const http = require('http');
const { Server } = require('socket.io');
const { attachSignaling } = require('../lib/signaling');

const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Endpoint de WebSocket. Conecte via Socket.IO.');
});

const io = new Server(server, {
  path: '/api/socket-io',
  transports: ['websocket'],
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
  pingInterval: 20000,
  pingTimeout: 25000
});

attachSignaling(io);

module.exports = server;
module.exports.default = server;
