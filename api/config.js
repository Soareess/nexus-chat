/**
 * Configuracao que o cliente busca antes de conectar (/ice, via rewrite).
 *
 * Sem SIGNAL_URL: a sinalizacao roda na propria Vercel Function WebSocket
 * (api/socket-io.js). Com SIGNAL_URL: aponta para um servidor dedicado
 * (Render, Railway, VPS), recomendado para calls longas ou grupos maiores.
 *
 * Variaveis de ambiente:
 *   SIGNAL_URL -> https://seu-servidor.onrender.com   (opcional)
 *   TURN_URL / TURN_USER / TURN_PASS                  (opcional)
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

  const signalUrl = (process.env.SIGNAL_URL || '').replace(/\/+$/, '');

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    iceServers,
    signalUrl,
    // servidor proprio usa o caminho padrao; na Vercel a funcao fica sob /api/socket-io
    socketPath: signalUrl ? '/socket.io' : '/api/socket-io/socket.io',
    transports: signalUrl ? ['websocket', 'polling'] : ['websocket']
  });
};
