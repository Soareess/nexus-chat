/**
 * Logica de salas, chat e sinalizacao WebRTC.
 * Usada tanto pelo servidor Node (server.js) quanto pela Vercel Function
 * (api/socket-io.js) - o mesmo codigo nos dois lugares.
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

function attachSignaling(io) {
  /** guildId -> guild */
  const guilds = new Map();
  for (const g of DEFAULT_SERVERS) guilds.set(g.id, { ...g, messages: new Map() });

  /** socketId -> user */
  const users = new Map();

  const guildOf = (id) => guilds.get(id) || guilds.get('geral');

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
    const user = users.get(socket.id);
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
      const name = String(payload.name || 'Anonimo').slice(0, 24).trim();
      const user = {
        id: socket.id,
        name: name || 'Anonimo',
        color: /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#5865f2',
        guildId: guild.id,
        voiceChannelId: null,
        muted: false,
        deafened: false,
        cam: false,
        screen: false
      };
      users.set(socket.id, user);
      socket.join('guild:' + guild.id);

      socket.to('guild:' + guild.id).emit('user:joined', publicUser(user));
      if (typeof ack === 'function') {
        ack({
          me: publicUser(user),
          guild: guildPayload(guild),
          guilds: [...guilds.values()].map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
          users: usersOfGuild(guild.id)
        });
      }
    });

    socket.on('guild:switch', (payload, ack) => {
      payload = payload || {};
      const user = users.get(socket.id);
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
      const user = users.get(socket.id);
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
      const user = users.get(socket.id);
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
      const user = users.get(socket.id);
      if (!user) return;
      leaveVoice(socket);

      const guild = guildOf(user.guildId);
      const channel = guild.voiceChannels.find((c) => c.id === payload.channelId);
      if (!channel) return;

      const room = 'voice:' + guild.id + ':' + channel.id;
      const peers = [...users.values()]
        .filter((u) => u.guildId === guild.id && u.voiceChannelId === channel.id && u.id !== user.id)
        .map(publicUser);

      user.voiceChannelId = channel.id;
      socket.join(room);
      socket.to(room).emit('voice:joined', publicUser(user));
      io.to('guild:' + guild.id).emit('user:update', publicUser(user));
      if (typeof ack === 'function') ack({ peers, channelId: channel.id });
    });

    socket.on('voice:leave', () => leaveVoice(socket));

    // Encaminha offer/answer/candidate direto para o destinatario.
    socket.on('signal', (payload) => {
      payload = payload || {};
      if (!payload.to) return;
      io.to(payload.to).emit('signal', { from: socket.id, data: payload.data });
    });

    // Diz ao outro lado o que cada MediaStream representa (mic, camera ou tela).
    socket.on('media:meta', (payload) => {
      payload = payload || {};
      if (!payload.to) return;
      io.to(payload.to).emit('media:meta', {
        from: socket.id,
        streamId: payload.streamId,
        kind: payload.kind
      });
    });

    socket.on('state:update', (payload) => {
      payload = payload || {};
      const user = users.get(socket.id);
      if (!user) return;
      if (typeof payload.muted === 'boolean') user.muted = payload.muted;
      if (typeof payload.deafened === 'boolean') user.deafened = payload.deafened;
      if (typeof payload.cam === 'boolean') user.cam = payload.cam;
      if (typeof payload.screen === 'boolean') user.screen = payload.screen;
      io.to('guild:' + user.guildId).emit('user:update', publicUser(user));
    });

    socket.on('voice:speaking', (payload) => {
      payload = payload || {};
      const user = users.get(socket.id);
      if (!user || !user.voiceChannelId) return;
      socket
        .to('voice:' + user.guildId + ':' + user.voiceChannelId)
        .emit('voice:speaking', { id: user.id, speaking: !!payload.speaking });
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (!user) return;
      leaveVoice(socket);
      users.delete(socket.id);
      io.to('guild:' + user.guildId).emit('user:left', { id: user.id });
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

module.exports = { attachSignaling, iceServers, DEFAULT_SERVERS };
