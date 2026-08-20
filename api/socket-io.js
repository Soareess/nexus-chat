/**
 * Sinalizacao rodando como Vercel Function com WebSocket (Fluid compute).
 * A funcao e servida em /api/socket-io, entao o cliente usa
 * path: "/api/socket-io/socket.io" e transporte websocket puro.
 */
const http = require('http');
const { Server } = require('socket.io');
const { attachSignaling } = require('../lib/signaling');

const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Endpoint de WebSocket. Conecte via Socket.IO.');
});

const io = new Server(server, {
  path: '/api/socket-io/socket.io',
  transports: ['websocket'],
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
  pingInterval: 20000,
  pingTimeout: 25000
});

attachSignaling(io);

module.exports = server;
module.exports.default = server;
