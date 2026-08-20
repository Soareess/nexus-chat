/**
 * Funcao serverless do Vercel (responde em /ice via rewrite).
 *
 * O Vercel nao mantem WebSocket aberto, entao ele hospeda so a interface.
 * Aqui devolvemos onde esta o servidor de sinalizacao (Render/Railway/VPS)
 * e a lista de servidores ICE.
 *
 * Variaveis de ambiente no painel do Vercel:
 *   SIGNAL_URL -> https://seu-servidor.onrender.com
 *   TURN_URL / TURN_USER / TURN_PASS -> opcional, para redes com NAT restritivo
 */
module.exports = (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || ''
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    iceServers,
    signalUrl: (process.env.SIGNAL_URL || '').replace(/\/+$/, '')
  });
};
