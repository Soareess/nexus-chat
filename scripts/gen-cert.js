/**
 * Gera um certificado autoassinado para rodar em HTTPS.
 * Sem HTTPS o navegador bloqueia camera e compartilhamento de tela fora do localhost.
 * Requer o openssl no PATH (vem com o Git para Windows: C:\Program Files\Git\usr\bin).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(dir, { recursive: true });

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address);

const alt = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => 'IP:' + ip)].join(',');

const args = [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
  '-keyout', path.join(dir, 'key.pem'),
  '-out', path.join(dir, 'cert.pem'),
  '-subj', '/CN=nexus-chat',
  '-addext', 'subjectAltName=' + alt
];

const candidates = [
  'openssl',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'
];

let ok = false;
for (const bin of candidates) {
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (!r.error && r.status === 0) { ok = true; break; }
}

if (ok) {
  console.log('\nCertificado criado em certs/. Rode "npm start" - o servidor sobe em HTTPS.');
  console.log('SAN: ' + alt);
  console.log('No navegador vai aparecer "conexao nao privada": clique em Avancado > Continuar.\n');
} else {
  console.error('\nNao encontrei o openssl. Instale o Git para Windows ou o OpenSSL e rode de novo.');
  console.error('Alternativa: use "npx localtunnel --port 3000" para obter uma URL https publica.\n');
  process.exit(1);
}
