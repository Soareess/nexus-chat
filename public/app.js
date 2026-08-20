/* =========================================================================
   Nexus Chat - cliente
   Malha P2P (mesh) com WebRTC: cada pessoa se conecta direto com as outras.
   O servidor so troca offer/answer/candidates.
   ========================================================================= */

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],
  bundlePolicy: 'max-bundle'
};

const QUALITY = {
  '720p30':  { width: 1280, height: 720,  fps: 30, bitrate: 1_500_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 3_000_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 6_000_000 },
  'source':  { width: null, height: null, fps: 60, bitrate: 8_000_000 }
};

const COLORS = ['#5865f2', '#23a55a', '#f0b232', '#f23f43', '#eb459e', '#00a8fc', '#9b59b6', '#e67e22'];

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ estado */
const state = {
  me: null,
  guild: null,
  guilds: [],
  users: new Map(),          // id -> user
  speaking: new Set(),       // ids falando
  textChannel: null,
  voiceChannel: null,
  lastVoiceChannel: null,     // para voltar sozinho depois de uma reconexao
  peers: new Map(),          // peerId -> Peer
  remote: new Map(),         // peerId -> { mic, cam, screen } MediaStream
  pendingKind: new Map(),    // streamId -> kind (meta chegou antes da track)
  local: { mic: null, cam: null, screen: null },
  muted: false,
  deafened: false,
  focus: null,               // chave da tile em foco
  shareQuality: '1080p30',
  chatVisible: true
};

/* ---------------------------------------------------------------- conexao
   O servidor de sinalizacao pode estar em outro dominio (ex.: front no Vercel,
   sinalizacao no Render). Ordem de prioridade:
     1. ?signal=https://...   2. o que foi salvo no navegador
     3. o que o backend devolve em /ice   4. mesma origem
*/
// Identidade fixa da pessoa (nao muda quando o socket cai e volta).
const clientId = (() => {
  let id = localStorage.getItem('nexus:cid');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('nexus:cid', id);
  }
  return id;
})();

let socket = null;
let signalOrigin = '';
let socketOpts = { transports: ['websocket', 'polling'] };

function paramSignal() {
  try { return new URL(location.href).searchParams.get('signal') || ''; } catch (_) { return ''; }
}

async function loadConfig() {
  let cfg = {};
  try {
    const r = await fetch('/ice', { cache: 'no-store' });
    if (r.ok) cfg = await r.json();
  } catch (_) { /* sem backend na mesma origem */ }
  if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) ICE.iceServers = cfg.iceServers;

  const chosen = (paramSignal() || localStorage.getItem('nexus:signal') || cfg.signalUrl || '').replace(/\/+$/, '');
  socketOpts = {
    transports: chosen ? ['websocket', 'polling'] : (cfg.transports || ['websocket', 'polling'])
  };
  // o path so vale para a mesma origem; servidor externo usa o padrao
  if (!chosen && cfg.socketPath) socketOpts.path = cfg.socketPath;
  return chosen;
}

function connect(url) {
  signalOrigin = url || '';
  if (signalOrigin) localStorage.setItem('nexus:signal', signalOrigin);
  else localStorage.removeItem('nexus:signal');
  const opts = { ...socketOpts };
  if (signalOrigin) { delete opts.path; opts.transports = ['websocket', 'polling']; }
  opts.reconnectionDelay = 400;
  opts.reconnectionDelayMax = 2500;
  opts.timeout = 8000;
  socket = signalOrigin ? io(signalOrigin, opts) : io(opts);
  bindSocketEvents();
}

/* ------------------------------------------------------------------ icones */
function icon(name, size) {
  const s = size || 20;
  const P = {
    mic: '<path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21a1 1 0 1 1-2 0v-3.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/>',
    micOff: '<path fill="currentColor" d="M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-3.6-3.6A7 7 0 0 0 19 11a1 1 0 1 0-2 0c0 1-.3 2-.8 2.8l-1.4-1.4c.1-.3.2-.6.2-1V5a3 3 0 0 0-5.9-.7L3.7 2.3ZM7 9.8 5 7.8V11a7 7 0 0 0 6 6.93V21a1 1 0 1 0 2 0v-3.07c.86-.12 1.66-.4 2.37-.82l-1.5-1.5A5 5 0 0 1 7 11V9.8Z"/>',
    cam: '<path fill="currentColor" d="M3 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm16 3.2 3.4-2.1a1 1 0 0 1 1.6.8v8.2a1 1 0 0 1-1.6.8L19 14.8V9.2Z"/>',
    camOff: '<path fill="currentColor" d="M3.7 2.3a1 1 0 1 0-1.4 1.4L4.6 6H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12c.35 0 .68-.09.97-.24l4.33 4.33a1 1 0 0 0 1.4-1.4L3.7 2.3ZM17 8v6.2l-8-8H15a2 2 0 0 1 2 2Zm2 1.2 3.4-2.1a1 1 0 0 1 1.6.8v8.2a1 1 0 0 1-1.6.8L19 14.8V9.2Z"/>',
    screen: '<path fill="currentColor" d="M3 3h18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6v2h3a1 1 0 1 1 0 2H6a1 1 0 1 1 0-2h3v-2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 3.2-4 4a1 1 0 0 0 1.4 1.4L11 10.2V14a1 1 0 1 0 2 0v-3.8l1.6 1.5a1 1 0 0 0 1.4-1.4l-4-4Z"/>',
    hang: '<path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.7v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28a.98.98 0 0 1-.7-.29L.29 13.08a.98.98 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .27-.11.52-.29.7l-2.48 2.46c-.18.18-.43.29-.7.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.998.998 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z"/>',
    deaf: '<path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-1a7 7 0 1 1 14 0v1h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z"/>',
    deafOff: '<path fill="currentColor" d="M3.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-2.35-2.35c.4-.28.72-.66.93-1.1A3 3 0 0 0 21 17v-5A9 9 0 0 0 6.9 4.6L3.7 2.3ZM3 12a9 9 0 0 1 .5-2.95l3.7 3.7A1 1 0 0 0 7 12H5v-1c0 .35.02.7.06 1.04L3.02 12.5A9.4 9.4 0 0 1 3 12Zm0 2.2 4 4V19a1 1 0 0 1-1 1 3 3 0 0 1-3-3v-2.8Z"/>',
    full: '<path fill="currentColor" d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"/>',
    text: '<path fill="currentColor" d="M10.5 3 9.8 7H6.2l.7-4H4.9l-.7 4H1.5v2h2.4l-.6 4H.9v2h2.1l-.7 4h2l.7-4h3.6l-.7 4h2l.7-4h3.4v-2h-3l.6-4h3.4V7h-3.1l.7-4h-2ZM8.7 15H5.1l.6-4h3.6l-.6 4Z"/>',
    voice: '<path fill="currentColor" d="M11.4 3.2a1 1 0 0 1 .6.9v15.8a1 1 0 0 1-1.65.76L5.6 16.4H3a2 2 0 0 1-2-2v-4.8a2 2 0 0 1 2-2h2.6l4.75-4.26a1 1 0 0 1 1.05-.14ZM15.5 8.2a1 1 0 0 1 1.4.1 5.6 5.6 0 0 1 0 7.4 1 1 0 1 1-1.5-1.3 3.6 3.6 0 0 0 0-4.8 1 1 0 0 1 .1-1.4Zm3-3.1a1 1 0 0 1 1.4 0 9.8 9.8 0 0 1 0 13.8 1 1 0 1 1-1.4-1.4 7.8 7.8 0 0 0 0-11 1 1 0 0 1 0-1.4Z"/>'
  };
  const path = P[name] || '';
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '">' + path + '</svg>';
}

/* ------------------------------------------------------------------- utils */
function toast(text, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  return String(name || '?').trim().slice(0, 2);
}

let audioCtx = null;
function blip(freq, dur) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur + 0.02);
  } catch (_) { /* sem audio, sem problema */ }
}

/* -------------------------------------------------------------------- login */
let chosenColor = COLORS[0];

function buildLogin() {
  const row = $('colorRow');
  row.innerHTML = '';
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (i === 0 ? ' sel' : '');
    b.style.background = c;
    b.type = 'button';
    b.onclick = () => {
      chosenColor = c;
      [...row.children].forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
    };
    row.appendChild(b);
  });

  const saved = localStorage.getItem('nexus:name');
  if (saved) $('loginName').value = saved;

  const secure = window.isSecureContext;
  if (!secure) {
    $('loginHint').textContent = 'Sem HTTPS: camera e compartilhamento de tela podem ser bloqueados pelo navegador.';
  }

  $('signalUrl').value = signalOrigin;
  $('signalHint').textContent = signalOrigin
    ? 'Sinalizacao em ' + signalOrigin
    : 'Usando este mesmo endereco como servidor.';

  $('loginBtn').onclick = doLogin;
  $('loginName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

function doLogin() {
  const name = ($('loginName').value || '').trim();
  if (!name) { $('loginName').focus(); return; }
  localStorage.setItem('nexus:name', name);

  // trocou o servidor de sinalizacao no campo? reconecta antes de entrar
  const typed = ($('signalUrl').value || '').trim().replace(/\/+$/, '');
  if (typed !== signalOrigin) {
    if (socket) socket.close();
    connect(typed);
  }
  if (!socket || !socket.connected) {
    $('loginHint').textContent = 'Conectando ao servidor...';
    socket.once('connect', () => doLogin());
    return;
  }

  socket.emit('join', { clientId, name, color: chosenColor, guildId: 'geral' }, (data) => {
    applyJoin(data);
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
  });
}

function applyJoin(data, opts) {
  const keep = opts && opts.keepCall;
  state.me = data.me;
  state.guilds = data.guilds;
  state.guild = data.guild;
  state.users = new Map(data.users.map((u) => [u.id, u]));
  state.users.set(state.me.id, state.me);
  if (!keep) state.textChannel = data.guild.textChannels[0].id;
  renderRail();
  renderGuild();
  renderMe();
  renderMembers();
  renderMessages();
}

/* ------------------------------------------------------------------ render */
function renderRail() {
  const rail = $('rail');
  rail.innerHTML = '';
  state.guilds.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'guild' + (g.id === state.guild.id ? ' active' : '');
    b.textContent = g.icon;
    b.title = g.name;
    b.onclick = () => switchGuild(g.id);
    rail.appendChild(b);
  });
}

function switchGuild(id) {
  if (id === state.guild.id) return;
  socket.emit('guild:switch', { guildId: id }, (data) => {
    state.lastVoiceChannel = null;
    hangUp(true);
    state.guild = data.guild;
    state.me = data.me;
    state.users = new Map(data.users.map((u) => [u.id, u]));
    state.users.set(state.me.id, state.me);
    state.textChannel = data.guild.textChannels[0].id;
    renderRail();
    renderGuild();
    renderMembers();
    renderMessages();
  });
}

function renderGuild() {
  $('guildName').textContent = state.guild.name;

  const tc = $('textChannels');
  tc.innerHTML = '';
  state.guild.textChannels.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'ch' + (c.id === state.textChannel ? ' active' : '');
    b.innerHTML = icon('text', 18) + '<span>' + esc(c.name) + '</span>';
    b.onclick = () => {
      state.textChannel = c.id;
      renderGuild();
      renderMessages();
      $('channelTitle').textContent = c.name;
      $('msgInput').placeholder = 'Conversar em #' + c.name;
    };
    tc.appendChild(b);
  });

  const vc = $('voiceChannels');
  vc.innerHTML = '';
  state.guild.voiceChannels.forEach((c) => {
    const wrap = document.createElement('div');
    const b = document.createElement('button');
    b.className = 'ch' + (c.id === state.voiceChannel ? ' active' : '');
    const inside = [...state.users.values()].filter((u) => u.voiceChannelId === c.id);
    b.innerHTML =
      icon('voice', 18) + '<span>' + esc(c.name) + '</span>' +
      (inside.length ? '<span class="live">' + inside.length + '</span>' : '');
    b.onclick = () => joinVoice(c.id);
    wrap.appendChild(b);

    if (inside.length) {
      const list = document.createElement('div');
      list.className = 'vc-users';
      inside.forEach((u) => {
        const row = document.createElement('div');
        row.className = 'vc-user' + (state.speaking.has(u.id) ? ' speaking' : '');
        const flags =
          (u.muted ? icon('micOff', 12) : '') +
          (u.deafened ? icon('deafOff', 12) : '') +
          (u.screen ? '<span style="color:var(--green);font-size:10px;font-weight:700">AO VIVO</span>' : '');
        row.innerHTML =
          '<div class="avatar" style="background:' + u.color + '">' + esc(initials(u.name)) + '</div>' +
          '<span>' + esc(u.name) + '</span>' +
          '<span class="flags">' + flags + '</span>';
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }
    vc.appendChild(wrap);
  });

  const vs = $('voiceStatus');
  if (state.voiceChannel) {
    vs.classList.remove('hidden');
    const ch = state.guild.voiceChannels.find((c) => c.id === state.voiceChannel);
    $('vsChannel').textContent = (ch ? ch.name : '') + ' / ' + state.guild.name;
  } else {
    vs.classList.add('hidden');
  }
}

function renderMe() {
  if (!state.me) return;
  const a = $('meAvatar');
  a.textContent = initials(state.me.name);
  a.style.background = state.me.color;
  $('meName').textContent = state.me.name;
  $('btnMic').innerHTML = icon(state.muted ? 'micOff' : 'mic', 18);
  $('btnMic').classList.toggle('off', state.muted);
  $('btnDeaf').innerHTML = icon(state.deafened ? 'deafOff' : 'deaf', 18);
  $('btnDeaf').classList.toggle('off', state.deafened);
}

function renderMembers() {
  const list = $('memberList');
  list.innerHTML = '';
  const arr = [...state.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  $('memberCount').textContent = arr.length;
  arr.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'member';
    const status = u.voiceChannelId ? (u.screen ? 'ao vivo' : 'em call') : '';
    el.innerHTML =
      '<div class="avatar" style="background:' + u.color + '">' + esc(initials(u.name)) + '</div>' +
      '<div class="member-name">' + esc(u.name) + (u.id === (state.me && state.me.id) ? ' (voce)' : '') + '</div>' +
      '<div class="st">' + status + '</div>';
    list.appendChild(el);
  });
}

let lastAuthor = null;
function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  lastAuthor = null;
  const msgs = (state.guild.messages && state.guild.messages[state.textChannel]) || [];
  const ch = state.guild.textChannels.find((c) => c.id === state.textChannel);
  if (ch) {
    $('channelTitle').textContent = ch.name;
    $('msgInput').placeholder = 'Conversar em #' + ch.name;
  }
  msgs.forEach((m) => appendMessage(m, true));
  box.scrollTop = box.scrollHeight;
}

function appendMessage(m, bulk) {
  if (m.channelId !== state.textChannel) return;
  const box = $('messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const grouped = lastAuthor === m.authorId;
  const el = document.createElement('div');
  el.className = 'msg' + (grouped ? ' grouped' : '');
  const time = new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML =
    '<div class="avatar" style="background:' + m.color + '">' + esc(initials(m.author)) + '</div>' +
    '<div class="msg-body">' +
    (grouped ? '' : '<div class="msg-head"><span class="msg-author" style="color:' + m.color + '">' + esc(m.author) + '</span><span class="msg-time">' + time + '</span></div>') +
    '<div class="msg-text">' + esc(m.text) + '</div></div>';
  box.appendChild(el);
  lastAuthor = m.authorId;
  if (!bulk && atBottom) box.scrollTop = box.scrollHeight;
}

function sysMessage(text) {
  const box = $('messages');
  const el = document.createElement('div');
  el.className = 'msg-sys';
  el.textContent = text;
  box.appendChild(el);
  lastAuthor = null;
  box.scrollTop = box.scrollHeight;
}

/* ================================================================== WEBRTC */

/** Um peer = uma conexao P2P com outra pessoa da call. */
class Peer {
  constructor(id) {
    this.id = id;
    // quem tem o id "menor" cede em caso de colisao - regra igual dos dois lados
    this.polite = String(state.me.id) < String(id);
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.pending = false;   // negociacao adiada, refeita ao voltar para "stable"
    this.senders = { mic: null, cam: null, screen: null, screenAudio: null };
    this.pc = new RTCPeerConnection(ICE);

    // Canal de dados negociado nos dois lados com o mesmo id: assim que a
    // conexao P2P sobe, toda renegociacao (ligar tela, camera, mute) passa a
    // viajar por aqui - sem depender do servidor de sinalizacao.
    this.dc = this.pc.createDataChannel('nx', { negotiated: true, id: 0 });
    this.dc.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      handlePeerMessage(this.id, msg);
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.send('signal', { candidate: e.candidate });
    };

    this.pc.onnegotiationneeded = () => this.negotiate();

    // Se uma negociacao precisou esperar (ou foi descartada numa colisao de
    // ofertas), ela e refeita assim que a conexao volta para "stable".
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable' && this.pending) {
        this.pending = false;
        this.negotiate();
      }
    };

    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      attachRemoteStream(id, stream);
      stream.onaddtrack = () => { renderStage(); };
      e.track.onended = () => detachRemoteStream(id, stream.id);
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) detachRemoteStream(id, stream.id);
      };
    };

    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      if (st === 'failed') {
        console.warn('conexao falhou com', id, '- tentando reiniciar ICE');
        try { this.pc.restartIce(); } catch (_) {}
      }
      if (st === 'closed') removePeer(id);
    };

    // manda tudo o que ja esta ativo localmente
    this.syncLocalTracks();
  }

  syncLocalTracks() {
    if (state.local.mic && !this.senders.mic) {
      const t = state.local.mic.getAudioTracks()[0];
      if (t) {
        this.senders.mic = this.pc.addTrack(t, state.local.mic);
        this.sendMeta(state.local.mic.id, 'mic');
      }
    }
    if (state.local.cam && !this.senders.cam) {
      const t = state.local.cam.getVideoTracks()[0];
      if (t) {
        this.senders.cam = this.pc.addTrack(t, state.local.cam);
        this.sendMeta(state.local.cam.id, 'cam');
      }
    }
    if (state.local.screen && !this.senders.screen) {
      const v = state.local.screen.getVideoTracks()[0];
      if (v) {
        this.senders.screen = this.pc.addTrack(v, state.local.screen);
        applyBitrate(this.senders.screen, QUALITY[state.shareQuality].bitrate);
        this.sendMeta(state.local.screen.id, 'screen');
      }
      const a = state.local.screen.getAudioTracks()[0];
      if (a && !this.senders.screenAudio) {
        this.senders.screenAudio = this.pc.addTrack(a, state.local.screen);
        // som de jogo/musica merece mais que os ~32kbps de voz
        applyBitrate(this.senders.screenAudio, 128000, true);
      }
    }
  }

  async negotiate() {
    if (this.pc.signalingState !== 'stable') { this.pending = true; return; }
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.send('signal', { description: this.pc.localDescription });
    } catch (err) {
      console.warn('negotiation', err);
      this.pending = true;
    } finally {
      this.makingOffer = false;
    }
  }

  /** manda pelo DataChannel; se ainda nao abriu, vai pelo servidor */
  send(type, data) {
    if (this.dc && this.dc.readyState === 'open') {
      try { this.dc.send(JSON.stringify({ t: type, d: data })); return true; } catch (_) {}
    }
    if (!socket) return false;
    // sem canal de dados, offer/answer/meta voltam a passar pelo servidor
    if (type === 'signal') socket.emit('signal', { to: this.id, data });
    else if (type === 'meta') socket.emit('media:meta', { to: this.id, ...data });
    else return false;   // state e speaking sao tratados por broadcastPeers
    return true;
  }

  sendMeta(streamId, kind) {
    this.send('meta', { streamId, kind });
  }

  removeKind(kind) {
    const map = kind === 'screen' ? ['screen', 'screenAudio'] : [kind];
    map.forEach((k) => {
      const s = this.senders[k];
      if (s) {
        try { this.pc.removeTrack(s); } catch (_) {}
        this.senders[k] = null;
      }
    });
  }

  close() {
    try { this.pc.close(); } catch (_) {}
  }
}

function applyBitrate(sender, bitrate, isAudio) {
  if (!sender) return;
  try {
    const p = sender.getParameters();
    p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = bitrate;
    if (!isAudio) p.degradationPreference = 'maintain-resolution';
    sender.setParameters(p);
  } catch (_) { /* nem todo browser aceita */ }
}

function attachRemoteStream(peerId, stream) {
  const bucket = state.remote.get(peerId) || {};
  let kind = state.pendingKind.get(stream.id);
  if (!kind) {
    // meta ainda nao chegou: deduz pelo tipo de faixa, mas sem derrubar uma
    // stream diferente que ja esteja ocupando o lugar
    kind = stream.getVideoTracks().length ? 'cam' : 'mic';
    const ocupado = bucket[kind] && bucket[kind].id !== stream.id;
    if (ocupado) kind = kind === 'cam' ? 'screen' : 'mic';
  }
  bucket[kind] = stream;
  state.remote.set(peerId, bucket);
  renderStage();
}

function detachRemoteStream(peerId, streamId) {
  const bucket = state.remote.get(peerId);
  if (!bucket) return;
  Object.keys(bucket).forEach((k) => {
    if (bucket[k] && bucket[k].id === streamId) delete bucket[k];
  });
  state.remote.set(peerId, bucket);
  renderStage();
}

function removePeer(id) {
  const p = state.peers.get(id);
  if (p) p.close();
  state.peers.delete(id);
  state.remote.delete(id);
  renderStage();
}

/* ------------------------------------------------------- entrar / sair voz */
async function ensureMic() {
  if (state.local.mic) return state.local.mic;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  });
  state.local.mic = stream;
  stream.getAudioTracks().forEach((t) => (t.enabled = !state.muted));
  watchSpeaking(stream);
  return stream;
}

async function joinVoice(channelId) {
  if (state.voiceChannel === channelId) return;
  try {
    await ensureMic();
  } catch (err) {
    toast('Nao consegui acessar o microfone: ' + err.message, 'err');
    return;
  }
  hangUp(true);

  socket.emit('voice:join', { channelId }, (res) => {
    if (!res) return;
    state.voiceChannel = res.channelId;
    state.lastVoiceChannel = res.channelId;   // usado para voltar sozinho apos reconexao
    if (state.me) state.me.voiceChannelId = res.channelId;
    $('stage').classList.remove('hidden');
    blip(660, 0.12);
    // quem entra manda a offer para os que ja estavam
    res.peers.forEach((p) => {
      const peer = new Peer(p.id);
      state.peers.set(p.id, peer);
    });
    renderGuild();
    renderStage();
  });
}

function hangUp(silent) {
  if (!state.voiceChannel && state.peers.size === 0) return;
  state.peers.forEach((p) => p.close());
  state.peers.clear();
  state.remote.clear();
  state.pendingKind.clear();
  stopScreen(true);
  stopCam(true);
  state.voiceChannel = null;
  state.focus = null;
  if (state.me) state.me.voiceChannelId = null;
  if (!silent) {
    state.lastVoiceChannel = null;
    socket.emit('voice:leave');
    blip(380, 0.16);
  }
  $('stage').classList.add('hidden');
  renderGuild();
  renderStage();
}

/* -------------------------------------------------------------- microfone */
function toggleMic() {
  state.muted = !state.muted;
  if (state.local.mic) state.local.mic.getAudioTracks().forEach((t) => (t.enabled = !state.muted));
  broadcastPeers('state', { muted: state.muted });
  renderMe();
  renderControls();
  renderGuild();
}

function toggleDeafen() {
  state.deafened = !state.deafened;
  if (state.deafened && !state.muted) toggleMic();
  document.querySelectorAll('audio.remote, video.remote').forEach((el) => { el.muted = state.deafened; });
  broadcastPeers('state', { deafened: state.deafened });
  renderMe();
  renderControls();
  renderGuild();
}

/* ----------------------------------------------------------------- camera */
async function startCam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
    state.local.cam = stream;
    stream.getVideoTracks()[0].onended = () => stopCam();
    state.peers.forEach((p) => p.syncLocalTracks());
    broadcastPeers('state', { cam: true });
    renderStage();
    renderControls();
  } catch (err) {
    toast('Camera indisponivel: ' + err.message, 'err');
  }
}

function stopCam(silent) {
  if (!state.local.cam) return;
  state.local.cam.getTracks().forEach((t) => t.stop());
  const id = state.local.cam.id;
  state.local.cam = null;
  state.peers.forEach((p) => {
    p.removeKind('cam');
    socket.emit('media:meta', { to: p.id, streamId: id, kind: 'stop' });
  });
  if (!silent) broadcastPeers('state', { cam: false });
  renderStage();
  renderControls();
}

/* ------------------------------------------------------ compartilhar tela */
function openShareModal() {
  if (state.local.screen) { stopScreen(); return; }
  $('shareModal').classList.remove('hidden');
}

async function startScreen() {
  const q = QUALITY[state.shareQuality];
  const wantAudio = $('shareAudio').checked;
  const video = { frameRate: { ideal: q.fps, max: q.fps } };
  if (q.width) {
    video.width = { ideal: q.width, max: q.width };
    video.height = { ideal: q.height, max: q.height };
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: wantAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
    });
    state.local.screen = stream;
    const track = stream.getVideoTracks()[0];
    // 'detail' preserva nitidez de texto; 'motion' prioriza fluidez em jogos
    track.contentHint = q.fps >= 60 ? 'motion' : 'detail';
    track.onended = () => stopScreen();

    state.peers.forEach((p) => p.syncLocalTracks());
    broadcastPeers('state', { screen: true });
    state.focus = 'local:screen';
    renderStage();
    renderControls();
    if (wantAudio && stream.getAudioTracks().length === 0) {
      toast('Tela sem audio: na janela do navegador marque "Compartilhar audio da guia" e escolha uma ABA ou JANELA.', 'warn');
    } else if (stream.getAudioTracks().length) {
      toast('Compartilhando tela com audio');
    } else {
      toast('Voce esta compartilhando sua tela');
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError') toast('Nao deu para compartilhar: ' + err.message, 'err');
  }
}

function stopScreen(silent) {
  if (!state.local.screen) return;
  state.local.screen.getTracks().forEach((t) => t.stop());
  const id = state.local.screen.id;
  state.local.screen = null;
  state.peers.forEach((p) => {
    p.removeKind('screen');
    socket.emit('media:meta', { to: p.id, streamId: id, kind: 'stop' });
  });
  if (state.focus === 'local:screen') state.focus = null;
  if (!silent) broadcastPeers('state', { screen: false });
  renderStage();
  renderControls();
}

/* ------------------------------------------------------ deteccao de fala */
function watchSpeaking(stream) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let was = false;
    setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = sum / data.length;
      const now = !state.muted && level > 12;
      if (now !== was) {
        was = now;
        if (state.me) {
          if (now) state.speaking.add(state.me.id); else state.speaking.delete(state.me.id);
        }
        broadcastPeers('speaking', { speaking: now });
        paintSpeaking();
      }
    }, 220);
  } catch (_) {}
}

function paintSpeaking() {
  document.querySelectorAll('.tile[data-owner]').forEach((el) => {
    el.classList.toggle('speaking', state.speaking.has(el.dataset.owner));
  });
  document.querySelectorAll('.vc-user').forEach(() => {});
  renderGuild();
}

/* ------------------------------------------------------------ palco de video */
function renderStage() {
  const grid = $('stageGrid');
  if (!state.voiceChannel) { grid.innerHTML = ''; return; }

  const tiles = [];

  // eu
  tiles.push({ key: 'local:self', owner: state.me.id, user: state.me, stream: state.local.cam, kind: state.local.cam ? 'cam' : 'none', mine: true });
  if (state.local.screen) {
    tiles.push({ key: 'local:screen', owner: state.me.id, user: state.me, stream: state.local.screen, kind: 'screen', mine: true });
  }

  // outros
  state.peers.forEach((_peer, id) => {
    const u = state.users.get(id) || { name: 'Usuario', color: '#5865f2', id };
    const bucket = state.remote.get(id) || {};
    tiles.push({ key: 'cam:' + id, owner: id, user: u, stream: bucket.cam, kind: bucket.cam ? 'cam' : 'none', audio: bucket.mic });
    if (bucket.screen) tiles.push({ key: 'screen:' + id, owner: id, user: u, stream: bucket.screen, kind: 'screen' });
  });

  const focusedExists = tiles.some((t) => t.key === state.focus);
  if (!focusedExists) state.focus = null;
  grid.classList.toggle('focused', !!state.focus);

  // reaproveita elementos existentes para nao piscar o video
  const existing = new Map([...grid.children].map((el) => [el.dataset.key, el]));
  grid.innerHTML = '';

  tiles.forEach((t) => {
    let el = existing.get(t.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile';
      el.dataset.key = t.key;
      el.onclick = () => {
        state.focus = state.focus === t.key ? null : t.key;
        renderStage();
      };
      el.ondblclick = () => {
        const v = el.querySelector('video');
        if (v && v.requestFullscreen) v.requestFullscreen();
      };
    }
    el.dataset.owner = t.owner;
    el.classList.toggle('focus', state.focus === t.key);
    el.classList.toggle('cam', t.kind === 'cam');
    el.classList.toggle('speaking', state.speaking.has(t.owner));

    let video = el.querySelector('video');
    if (t.stream) {
      if (!video) {
        video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.className = 'remote';
        el.innerHTML = '';
        el.appendChild(video);
      }
      if (video.srcObject !== t.stream) video.srcObject = t.stream;
      // todo o audio sai pelos elementos <audio>; o video fica mudo para nao dobrar
      video.muted = true;
      if (t.mine && t.kind === 'cam') video.style.transform = 'scaleX(-1)';
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      if (video) video.remove();
      if (!el.querySelector('.ph')) {
        el.innerHTML = '<div class="ph" style="background:' + t.user.color + '">' + esc(initials(t.user.name)) + '</div>';
      }
    }

    // legenda
    let label = el.querySelector('.label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'label';
      el.appendChild(label);
    }
    const u = state.users.get(t.owner) || t.user;
    const mutedIcon = u && u.muted ? '<span class="m">' + icon('micOff', 13) + '</span>' : '';
    label.innerHTML = esc(t.user.name) + (t.mine ? ' (voce)' : '') + mutedIcon;

    let badge = el.querySelector('.badge');
    if (t.kind === 'screen') {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'badge';
        el.appendChild(badge);
      }
      badge.textContent = 'Tela';
    } else if (badge) badge.remove();

    grid.appendChild(el);
  });

  // audio dos outros (streams so de microfone) fora das tiles
  syncRemoteAudio();
  renderControls();
}

function syncRemoteAudio() {
  let holder = document.getElementById('audioHolder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'audioHolder';
    holder.style.display = 'none';
    document.body.appendChild(holder);
  }

  const wanted = new Set();
  state.remote.forEach((bucket, peerId) => {
    // microfone e audio da tela: cada faixa ganha seu proprio elemento, com uma
    // MediaStream so dela. O Chrome ignora faixa de audio adicionada a uma
    // stream que ja estava tocando, e era por isso que a tela vinha muda.
    ['mic', 'screen'].forEach((kind) => {
      const stream = bucket[kind];
      if (!stream) return;
      stream.getAudioTracks().forEach((track) => {
        const id = 'a-' + peerId + '-' + track.id;
        wanted.add(id);
        let a = document.getElementById(id);
        if (!a) {
          a = document.createElement('audio');
          a.id = id;
          a.autoplay = true;
          a.className = 'remote';
          a.srcObject = new MediaStream([track]);
          holder.appendChild(a);
        }
        a.muted = state.deafened;
        a.volume = 1;
        const pr = a.play();
        if (pr && pr.catch) pr.catch(() => {});
      });
    });
  });
  [...holder.children].forEach((el) => { if (!wanted.has(el.id)) el.remove(); });
}

function renderControls() {
  $('cMic').className = 'cbtn' + (state.muted ? ' off' : '');
  $('cMic').querySelector('.ci').innerHTML = icon(state.muted ? 'micOff' : 'mic');
  $('cCam').className = 'cbtn' + (state.local.cam ? ' active' : '');
  $('cCam').querySelector('.ci').innerHTML = icon(state.local.cam ? 'cam' : 'camOff');
  $('cScreen').className = 'cbtn' + (state.local.screen ? ' active' : ' accent');
  $('cScreen').querySelector('.ci').innerHTML = icon('screen');
  $('cScreen').querySelector('em').textContent = state.local.screen ? 'Parar' : 'Tela';
  $('cFull').querySelector('.ci').innerHTML = icon('full');
  $('cHang').querySelector('.ci').innerHTML = icon('hang');
}

/* ------------------------------------------- tratamento de mensagens P2P */
async function handleSignal(from, data) {
  let peer = state.peers.get(from);
  if (!peer) {
    peer = new Peer(from);
    state.peers.set(from, peer);
    renderStage();
  }
  const pc = peer.pc;
  try {
    if (data.description) {
      const offerCollision =
        data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      // cedendo: a nossa oferta e descartada, entao remarcamos a renegociacao
      if (offerCollision && peer.polite) peer.pending = true;

      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        await pc.setLocalDescription();
        peer.send('signal', { description: pc.localDescription });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); }
      catch (err) { if (!peer.ignoreOffer) throw err; }
    }
  } catch (err) {
    console.warn('signal error', err);
  }
}

function handleMeta(from, streamId, kind) {
  if (kind === 'stop') {
    detachRemoteStream(from, streamId);
    state.pendingKind.delete(streamId);
    return;
  }
  state.pendingKind.set(streamId, kind);
  // se a stream ja chegou, reclassifica
  const bucket = state.remote.get(from);
  if (bucket) {
    Object.keys(bucket).forEach((k) => {
      if (bucket[k] && bucket[k].id === streamId && k !== kind) {
        const st = bucket[k];
        delete bucket[k];
        bucket[kind] = st;
      }
    });
    state.remote.set(from, bucket);
    renderStage();
  }
}

/** mensagens que chegam pelo DataChannel (funcionam com o servidor fora do ar) */
function handlePeerMessage(from, msg) {
  if (!msg || !msg.t) return;
  if (msg.t === 'signal') return handleSignal(from, msg.d || {});
  if (msg.t === 'meta') return handleMeta(from, msg.d.streamId, msg.d.kind);
  if (msg.t === 'state') {
    const u = state.users.get(from);
    if (u) { state.users.set(from, { ...u, ...msg.d }); renderGuild(); renderMembers(); renderStage(); }
    return;
  }
  if (msg.t === 'speaking') return setSpeaking(from, !!msg.d.speaking);
}

function setSpeaking(id, on) {
  if (on) state.speaking.add(id); else state.speaking.delete(id);
  document.querySelectorAll('.tile[data-owner="' + id + '"]').forEach((el) => el.classList.toggle('speaking', on));
  renderGuild();
}

/** avisa todo mundo da call: pelo DataChannel quando der, senao pelo servidor */
function broadcastPeers(type, data) {
  let precisaServidor = state.peers.size === 0;
  state.peers.forEach((p) => {
    if (p.dc && p.dc.readyState === 'open') p.send(type, data);
    else precisaServidor = true;
  });
  // o servidor guarda o estado tambem para quem esta fora da call (sidebar)
  if (type === 'state') socket.emit('state:update', data);
  else if (precisaServidor) socket.emit('voice:speaking', data);
}

/* --------------------------------------------------------------- signaling */
function bindSocketEvents() {
socket.on('signal', ({ from, data }) => handleSignal(from, data));
socket.on('media:meta', ({ from, streamId, kind }) => handleMeta(from, streamId, kind));

socket.on('voice:joined', (user) => {
  state.users.set(user.id, user);
  // o novo entrante inicia a negociacao; aqui so preparamos o estado
  blip(880, 0.1);
  renderGuild();
  renderMembers();
});

socket.on('voice:left', ({ id }) => {
  removePeer(id);
  blip(420, 0.1);
  renderGuild();
});

socket.on('user:joined', (user) => {
  state.users.set(user.id, user);
  renderMembers();
  renderGuild();
  sysMessage(user.name + ' entrou no servidor.');
});

socket.on('user:left', ({ id }) => {
  const u = state.users.get(id);
  removePeer(id);
  state.users.delete(id);
  renderMembers();
  renderGuild();
  if (u) sysMessage(u.name + ' saiu.');
});

socket.on('user:update', (user) => {
  state.users.set(user.id, user);
  if (state.me && user.id === state.me.id) state.me = { ...state.me, ...user };
  renderMembers();
  renderGuild();
  renderStage();
});

socket.on('voice:speaking', ({ id, speaking }) => setSpeaking(id, speaking));

socket.on('chat:message', (m) => {
  if (!state.guild.messages) state.guild.messages = {};
  const list = state.guild.messages[m.channelId] || [];
  list.push(m);
  state.guild.messages[m.channelId] = list;
  appendMessage(m);
});

let typingTimer = null;
socket.on('chat:typing', ({ channelId, name }) => {
  if (channelId !== state.textChannel) return;
  $('typing').textContent = name + ' esta digitando...';
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => ($('typing').textContent = ''), 2200);
});

socket.on('disconnect', () => toast('Conexao perdida. Reconectando...', 'warn'));
socket.on('connect', () => {
  if (!state.me) return;
  // Reentra com o MESMO clientId: o servidor devolve a call em que a pessoa
  // estava e as conexoes P2P que ja existem seguem intactas - a tela nao pisca.
  const back = state.lastVoiceChannel;
  socket.emit('join', { clientId, name: state.me.name, color: state.me.color, guildId: state.guild.id }, (data) => {
    applyJoin(data, { keepCall: true });
    state.lastVoiceChannel = back || state.voiceChannel;
    resumeVoice(data.voice, back);
  });
});

/**
 * Depois de reconectar: mantem quem ja esta conectado e so abre conexao com
 * quem faltar. Ninguem e derrubado - a midia continua correndo pelo P2P.
 */
function resumeVoice(voice, fallbackChannel) {
  const channelId = (voice && voice.channelId) || fallbackChannel;
  if (!channelId) return;

  if (!voice) {
    // o servidor perdeu o estado (instancia nova): entra de novo no canal
    socket.emit('voice:join', { channelId }, (res) => {
      if (!res) return;
      state.voiceChannel = res.channelId;
      if (state.me) state.me.voiceChannelId = res.channelId;
      res.peers.forEach((pu) => {
        state.users.set(pu.id, pu);
        if (!state.peers.has(pu.id)) state.peers.set(pu.id, new Peer(pu.id));
      });
      renderGuild();
      renderStage();
    });
    return;
  }

  state.voiceChannel = channelId;
  if (state.me) state.me.voiceChannelId = channelId;
  voice.peers.forEach((pu) => {
    state.users.set(pu.id, pu);
    if (!state.peers.has(pu.id)) state.peers.set(pu.id, new Peer(pu.id));
  });
  $('stage').classList.remove('hidden');
  renderGuild();
  renderStage();
}

socket.on('connect_error', (err) => {
  if (state.me) return;
  $('loginHint').textContent =
    'Nao consegui falar com o servidor de sinalizacao' +
    (signalOrigin ? ' (' + signalOrigin + ')' : '') + '. Confira o endereco em "Servidor de conexao".';
  $('advBox').open = true;
  console.warn('connect_error', err && err.message);
});
}

/* ------------------------------------------------------------------- eventos */
function bindUI() {
  $('btnMic').onclick = toggleMic;
  $('btnDeaf').onclick = toggleDeafen;
  $('btnHangSmall').onclick = () => hangUp();

  $('cMic').onclick = toggleMic;
  $('cCam').onclick = () => (state.local.cam ? stopCam() : startCam());
  $('cScreen').onclick = openShareModal;
  $('cHang').onclick = () => hangUp();
  $('cFull').onclick = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const target = document.querySelector('.tile.focus video') || document.querySelector('.tile video') || $('stage');
    if (target.requestFullscreen) target.requestFullscreen();
  };

  $('btnToggleChat').onclick = () => {
    state.chatVisible = !state.chatVisible;
    $('chat').classList.toggle('hidden', !state.chatVisible);
    $('btnToggleChat').classList.toggle('on', state.chatVisible);
  };
  $('btnMembers').onclick = () => $('members').classList.toggle('show');

  $('composer').onsubmit = (e) => {
    e.preventDefault();
    const input = $('msgInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:send', { channelId: state.textChannel, text });
    input.value = '';
  };
  let lastTyping = 0;
  $('msgInput').addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTyping > 1500) {
      lastTyping = now;
      socket.emit('chat:typing', { channelId: state.textChannel });
    }
  });

  // modal de qualidade
  $('qualityRow').onclick = (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    [...$('qualityRow').children].forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    state.shareQuality = b.dataset.q;
  };
  $('shareCancel').onclick = () => $('shareModal').classList.add('hidden');
  $('shareGo').onclick = () => {
    $('shareModal').classList.add('hidden');
    startScreen();
  };

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); toggleMic(); }
    if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); toggleDeafen(); }
    if (e.key === 'Escape' && state.focus) { state.focus = null; renderStage(); }
  });

  const despedir = () => { try { socket.emit('voice:leave'); socket.emit('bye'); } catch (_) {} };
  window.addEventListener('beforeunload', despedir);
  window.addEventListener('pagehide', despedir);
}

(async function boot() {
  const url = await loadConfig();   // tambem carrega STUN/TURN
  connect(url);
  buildLogin();
  bindUI();
  renderControls();
})();
