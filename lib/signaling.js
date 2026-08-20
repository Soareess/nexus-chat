/**
 * Logica de salas, chat e sinalizacao WebRTC.
 * Usada tanto pelo servidor Node (server.js) quanto pela Vercel Function
 * (api/socket-io.js) - o mesmo codigo nos dois lugares.
 *
 * Cada pessoa tem um clientId fixo (guardado no navegador), nao o id do socket.
 * Assim, se a conexao cair - e na Vercel ela cai de tempos em tempos, quando a
 * function atinge a duracao maxima - a pessoa volta como a MESMA pessoa e
 * ninguem e removido da call. Quem cai tem GRACE_MS para voltar antes de ser
 * anunciado como "saiu".
 */

const DEFAULT_SERVERS = [
  {
    id: 'geral',
    name: 'Servidor Principal',
    icon: 'NX',
    textChannels: [
      { id: 'geral', name: 'geral' },
      { id: 'jogos', name: 'jogos' },
      { id: 'memes', name: 'memes' }
    ],
    voiceChannels: [
      { id: 'v-geral', name: 'Sala Geral' },
      { id: 'v-jogos', name: 'Gaming' },
      { id: 'v-privado', name: 'Reuniao' }
    ]
  },
  {
    id: 'squad',
    name: 'Squad',
    icon: 'SQ',
    textChannels: [{ id: 's-geral', name: 'geral' }],
    voiceChannels: [{ id: 's-voz', name: 'Call da Squad' }]
  }
];

const MAX_MESSAGES = 200;
const GRACE_MS = 45000; // tempo para reconectar sem sair da call

function attachSignaling(io) {
  /** guildId -> guild */
  const guilds = new Map();
  for (const g of DEFAULT_SERVERS) guilds.set(g.id, { ...g, messages: new Map() });

  /** clientId -> user */
  const users = new Map();
  /** socketId -> clientId */
  const bySocket = new Map();
  /** clientId -> timer de carencia */
  const grace = new Map();

  const guildOf = (id) => guilds.get(id) || guilds.get('geral');
  const userOf = (socket) => users.get(bySocket.get(socket.id));
  const socketOf = (clientId) => {
    const u = users.get(clientId);
    return u && u.socketId;
  };

  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    color: u.color,
    guildId: u.guildId,
    voiceChannelId: u.voiceChannelId,
    muted: u.muted,
    deafened: u.deafened,
    cam: u.cam,
    screen: u.screen
  });

  const usersOfGuild = (guildId) =>
    [...users.values()].filter((u) => u.guildId === guildId).map(publicUser);

  const peersInVoice = (guildId, channelId, exceptId) =>
    [...users.values()]
      .filter((u) => u.guildId === guildId && u.voiceChannelId === channelId && u.id !== exceptId)
      .map(publicUser);

  function pushMessage(guild, channelId, message) {
    const list = guild.messages.get(channelId) || [];
    list.push(message);
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
    guild.messages.set(channelId, list);
  }

  const guildPayload = (guild) => ({
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    textChannels: guild.textChannels,
    voiceChannels: guild.voiceChannels,
    messages: Object.fromEntries([...guild.messages.entries()])
  });

  function leaveVoice(socket, { silent = false } = {}) {
    const user = userOf(socket);
    if (!user || !user.voiceChannelId) return null;
    const room = 'voice:' + user.guildId + ':' + user.voiceChannelId;
    socket.leave(room);
    if (!silent) socket.to(room).emit('voice:left', { id: user.id });
    const prev = user.voiceChannelId;
    user.voiceChannelId = null;
    user.cam = false;
    user.screen = false;
    io.to('guild:' + user.guildId).emit('user:update', publicUser(user));
    return prev;
  }

  io.on('connection', (socket) => {
    socket.on('join', (payload, ack) => {
      payload = payload || {};
      const guild = guildOf(payload.guildId);
      let clientId = String(payload.clientId || '').slice(0, 64) || socket.id;
      const name = String(payload.name || 'Anonimo').slice(0, 24).trim();

      // voltando de uma queda? cancela a remocao agendada
      const timer = grace.get(clientId);
      if (timer) { clearTimeout(timer); grace.delete(clientId); }

      let previous = users.get(clientId);
      // identidade ja em uso por uma conexao viva (duas abas, id copiado):
      // este entra como pessoa nova em vez de derrubar a outra
      if (previous && previous.socketId && previous.socketId !== socket.id) {
        clientId = clientId + '~' + socket.id.slice(0, 5);
        previous = users.get(clientId);
      }
      const user = {
        id: clientId,
        socketId: socket.id,
        name: name || (previous && previous.name) || 'Anonimo',
        color: /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#5865f2',
        guildId: guild.id,
        voiceChannelId: previous ? previous.voiceChannelId : null,
        muted: previous ? previous.muted : false,
        deafened: previous ? previous.deafened : false,
        cam: previous ? previous.cam : false,
        screen: previous ? previous.screen : false
      };
      // trocou de servidor enquanto estava fora: nao volta para a call antiga
      if (previous && previous.guildId !== guild.id) user.voiceChannelId = null;

      users.set(clientId, user);
      bySocket.set(socket.id, clientId);
      socket.join('guild:' + guild.id);

      let voice = null;
      if (user.voiceChannelId) {
        socket.join('voice:' + guild.id + ':' + user.voiceChannelId);
        voice = {
          channelId: user.voiceChannelId,
          peers: peersInVoice(guild.id, user.voiceChannelId, clientId)
        };
      }

      if (previous) io.to('guild:' + guild.id).emit('user:update', publicUser(user));
      else socket.to('guild:' + guild.id).emit('user:joined', publicUser(user));

      if (typeof ack === 'function') {
        ack({
          me: publicUser(user),
          guild: guildPayload(guild),
          guilds: [...guilds.values()].map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
          users: usersOfGuild(guild.id),
          voice,
          resumed: !!previous
        });
      }
    });

    socket.on('guild:switch', (payload, ack) => {
      payload = payload || {};
      const user = userOf(socket);
      if (!user) return;
      leaveVoice(socket);
      socket.leave('guild:' + user.guildId);
      io.to('guild:' + user.guildId).emit('user:left', { id: user.id });

      const guild = guildOf(payload.guildId);
      user.guildId = guild.id;
      socket.join('guild:' + guild.id);
      socket.to('guild:' + guild.id).emit('user:joined', publicUser(user));
      if (typeof ack === 'function') {
        ack({ guild: guildPayload(guild), users: usersOfGuild(guild.id), me: publicUser(user) });
      }
    });

    socket.on('chat:send', (payload) => {
      payload = payload || {};
      const user = userOf(socket);
      if (!user) return;
      const text = String(payload.text || '').slice(0, 2000).trim();
      if (!text) return;
      const guild = guildOf(user.guildId);
      const channelId = String(payload.channelId || guild.textChannels[0].id);
      const message = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        channelId,
        authorId: user.id,
        author: user.name,
        color: user.color,
        text,
        at: Date.now()
      };
      pushMessage(guild, channelId, message);
      io.to('guild:' + guild.id).emit('chat:message', message);
    });

    socket.on('chat:typing', (payload) => {
      payload = payload || {};
      const user = userOf(socket);
      if (!user) return;
      socket.to('guild:' + user.guildId).emit('chat:typing', {
        channelId: payload.channelId,
        name: user.name,
        id: user.id
      });
    });

    // ---- voz / video ----
    socket.on('voice:join', (payload, ack) => {
      payload = payload || {};
      const user = userOf(socket);
      if (!user) return;
      leaveVoice(socket);

      const guild = guildOf(user.guildId);
      const channel = guild.voiceChannels.find((c) => c.id === payload.channelId);
      if (!channel) return;

      const peers = peersInVoice(guild.id, channel.id, user.id);
      user.voiceChannelId = channel.id;
      socket.join('voice:' + guild.id + ':' + channel.id);
      socket.to('voice:' + guild.id + ':' + channel.id).emit('voice:joined', publicUser(user));
      io.to('guild:' + guild.id).emit('user:update', publicUser(user));
      if (typeof ack === 'function') ack({ peers, channelId: channel.id });
    });

    socket.on('voice:leave', () => leaveVoice(socket));

    // Encaminha offer/answer/candidate para o destinatario (endereçado por clientId).
    socket.on('signal', (payload) => {
      payload = payload || {};
      const user = userOf(socket);
      const target = socketOf(payload.to);
      if (!user || !target) return;
      io.to(target).emit('signal', { from: user.id, data: payload.data });
    });

    // Diz ao outro lado o que cada MediaStream representa (mic, camera ou tela).
    socket.on('media:meta', (payload) => {
      payload = payload || {};
      const user = userOf(socket);
      const target = socketOf(payload.to);
      if (!user || !target) return;
      io.to(target).emit('media:meta', {
        from: user.id,
        streamId: payload.streamId,
        kind: payload.kind
      });
    });

    socket.on('state:update', (payload) => {
      payload = payload || {};
      const user = userOf(socket);
      if (!user) return;
      if (typeof payload.muted === 'boolean') user.muted = payload.muted;
      if (typeof payload.deafened === 'boolean') user.deafened = payload.deafened;
      if (typeof payload.cam === 'boolean') user.cam = payload.cam;
      if (typeof payload.screen === 'boolean') user.screen = payload.screen;
      io.to('guild:' + user.guildId).emit('user:update', publicUser(user));
    });

    socket.on('voice:speaking', (payload) => {
      payload = payload || {};
      const user = userOf(socket);
      if (!user || !user.voiceChannelId) return;
      socket
        .to('voice:' + user.guildId + ':' + user.voiceChannelId)
        .emit('voice:speaking', { id: user.id, speaking: !!payload.speaking });
    });

    // saida intencional (fechou a aba): remove na hora, sem carencia
    socket.on('bye', () => {
      const clientId = bySocket.get(socket.id);
      const user = users.get(clientId);
      if (!user) return;
      const timer = grace.get(clientId);
      if (timer) { clearTimeout(timer); grace.delete(clientId); }
      if (user.voiceChannelId) {
        io.to('voice:' + user.guildId + ':' + user.voiceChannelId).emit('voice:left', { id: clientId });
      }
      users.delete(clientId);
      bySocket.delete(socket.id);
      io.to('guild:' + user.guildId).emit('user:left', { id: clientId });
    });

    socket.on('disconnect', () => {
      const clientId = bySocket.get(socket.id);
      bySocket.delete(socket.id);
      const user = users.get(clientId);
      if (!user || user.socketId !== socket.id) return; // ja reconectou em outro socket

      user.socketId = null;
      // nao anuncia a saida na hora: da tempo de reconectar sem derrubar a call
      const timer = setTimeout(() => {
        grace.delete(clientId);
        const u = users.get(clientId);
        if (!u || u.socketId) return; // voltou
        if (u.voiceChannelId) {
          io.to('voice:' + u.guildId + ':' + u.voiceChannelId).emit('voice:left', { id: clientId });
        }
        users.delete(clientId);
        io.to('guild:' + u.guildId).emit('user:left', { id: clientId });
      }, GRACE_MS);
      if (timer.unref) timer.unref();
      grace.set(clientId, timer);
    });
  });

  return { guilds, users };
}

function iceServers() {
  const list = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || ''
    });
  }
  return list;
}

module.exports = { attachSignaling, iceServers, DEFAULT_SERVERS, GRACE_MS };
