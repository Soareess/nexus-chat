/**
 * Nexus Chat - servidor completo (interface + sinalizacao).
 * Roda local, no Render, Railway, Fly ou qualquer VPS.
 * Toda a midia (voz, camera e tela) trafega P2P entre os navegadores;
 * aqui so acontece o "aperto de mao" e o chat.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const { attachSignaling, iceServers } = require('./lib/signaling');

const PORT = process.env.PORT || process.argv[2] || 3000;
const CERT_DIR = path.join(__dirname, 'certs');

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Configuracao que o cliente busca antes de conectar.
app.get('/ice', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    iceServers: iceServers(),
    signalUrl: (process.env.SIGNAL_URL || '').replace(/\/+$/, ''),
    socketPath: '/socket.io'
  });
});

// HTTPS local (necessario para camera/tela fora de localhost). Cai para HTTP se nao houver certificado.
let server;
let scheme = 'http';
const keyPath = path.join(CERT_DIR, 'key.pem');
const certPath = path.join(CERT_DIR, 'cert.pem');
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
  scheme = 'https';
} else {
  server = http.createServer(app);
}

const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });
attachSignaling(io);

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log('');
  console.log('  Nexus Chat no ar');
  console.log('  local : ' + scheme + '://localhost:' + PORT);
  lan.forEach((ip) => console.log('  rede  : ' + scheme + '://' + ip + ':' + PORT));
  if (scheme === 'http') {
    console.log('');
    console.log('  Camera/tela so funcionam em localhost sem HTTPS.');
    console.log('  Rode "npm run cert" para gerar certificado e liberar o acesso pela rede.');
  } else {
    console.log('');
    console.log('  HTTPS ativo - aceite o aviso de certificado no navegador.');
  }
  console.log('');
});
