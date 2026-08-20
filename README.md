# Nexus Chat

Plataforma de voz, vídeo e **compartilhamento de tela** no estilo Discord — servidores, canais de texto e canais de voz, chat em tempo real e call P2P.

Áudio, câmera e tela vão **direto de um navegador para o outro** (WebRTC). O servidor só faz a apresentação entre as pessoas e guarda o chat.

**No ar:** https://nexus-chat-soareess-projects.vercel.app

---

## 1. Rodar na sua máquina

```bash
npm install
```

```bash
npm start
```

Abra `http://localhost:3000`. Para testar sozinho, abra uma segunda aba anônima.

> Em `localhost` o navegador libera microfone, câmera e tela sem HTTPS.

## 2. Chamar os amigos na mesma rede (LAN)

Fora do `localhost` o Chrome/Edge **exige HTTPS** para liberar câmera e captura de tela. Gere um certificado local:

```bash
npm run cert
```

```bash
npm start
```

O servidor sobe em `https://SEU_IP:3000`. Seus amigos abrem esse endereço e clicam em **Avançado > Continuar** no aviso de certificado (é autoassinado, normal).

## 3. Chamar os amigos pela internet

**Opção rápida (túnel):** com o servidor rodando em HTTP na porta 3000:

```bash
npx localtunnel --port 3000
```

Ele devolve uma URL `https://...loca.lt` — mande para os amigos. (`ngrok http 3000` e `cloudflared tunnel --url http://localhost:3000` funcionam igual.)

Mas o mais simples é usar a URL já publicada — veja **Deploy** abaixo.

**Opção definitiva (deploy):** ver a seção abaixo.

---

## Deploy

O projeto já está publicado no Vercel: a interface **e** a sinalização rodam no mesmo deploy.

O Vercel passou a suportar WebSocket em Functions (Fluid compute), então `api/socket-io.js` sobe como função WebSocket em `/api/socket-io` e `api/config.js` responde em `/ice` dizendo ao cliente onde conectar. Nada extra para configurar — todo push na `main` vira um deploy novo.

### A call não tem prazo de validade

A chamada **não depende** do servidor de sinalização depois que começa:

- Cada pessoa tem um **id fixo** guardado no navegador. Se a conexão cair, ela volta como a mesma pessoa — ninguém é removido da call.
- Assim que a conexão P2P sobe, abre-se um **DataChannel** entre os participantes. Ligar/desligar tela, câmera e mudo passam a viajar por ele, direto de um navegador ao outro. Dá para começar e parar de transmitir a tela com o servidor **inteiramente fora do ar**.
- O servidor guarda 45 segundos de carência antes de anunciar que alguém saiu, então a reciclagem da função serverless passa despercebida.
- Só a **entrada** de alguém novo na call precisa do servidor.

Na prática: dá para ficar horas em call transmitindo tela, mesmo com a função do Vercel reciclando a conexão a cada ~5 minutos.

### O que ainda depende do servidor no Vercel

| Situação | Efeito |
|---|---|
| Alguém novo entra bem na hora em que a função reciclou | pode cair numa instância diferente e não enxergar a call; basta recarregar a página |
| A função recicla | o histórico do chat (que fica em memória) se perde; a call continua |

### Servidor dedicado (opcional)

1. [render.com](https://render.com) → **New → Blueprint** → aponte para este repositório (o `render.yaml` já traz build, start e health check no plano free).
2. Copie a URL, ex.: `https://nexus-chat-xxxx.onrender.com`.
3. No Vercel, defina a variável `SIGNAL_URL` com essa URL e refaça o deploy.

Sem mexer em variável, dá para apontar pela própria URL:

```
https://nexus-chat-soareess-projects.vercel.app/?signal=https://nexus-chat-xxxx.onrender.com
```

O endereço fica salvo no navegador e também pode ser editado em *Servidor de conexão*, na tela de entrada.

> O plano free do Render hiberna após 15 min parado; a primeira conexão depois disso leva ~30s para acordar.

### Tudo num lugar só

O `server.js` serve a interface **e** a sinalização. Subindo só no Render (ou Railway/Fly), a URL dele já é a plataforma inteira — sem Vercel, sem `SIGNAL_URL`.

### TURN (redes difíceis)

Em rede normal o P2P se resolve com STUN. Em NAT simétrico (algumas operadoras, 4G, rede corporativa) a conexão só fecha com TURN. No Vercel ou no servidor próprio, defina:

```
TURN_URL=turn:seu-servidor:3478
TURN_USER=usuario
TURN_PASS=senha
```

Serviços prontos: Metered, Twilio Network Traversal, Cloudflare Calls. Ou um `coturn` num VPS.

---

## Como usar

| Ação | Onde |
|---|---|
| Entrar numa call | clique num **canal de voz** na barra lateral |
| Mutar / desmutar | botão **Mic** ou `Ctrl+M` |
| Silenciar tudo | fone na barra inferior ou `Ctrl+D` |
| Ligar câmera | botão **Câmera** |
| Compartilhar tela | botão **Tela** → escolha 720p / 1080p30 / 1080p60 / original |
| Áudio do jogo junto | marque *incluir áudio do sistema* e compartilhe uma **aba** ou **janela** |
| Focar numa tela | clique no quadro; `Esc` volta |
| Tela cheia | duplo clique no quadro, ou botão **Tela cheia** |
| Sair da call | botão **Sair** |

**Áudio do sistema:** no Chrome/Edge, ao escolher "Guia do Chrome" ou "Janela", marque *Compartilhar áudio* na própria janela de seleção — sem isso o navegador não entrega faixa de áudio nenhuma e a plataforma avisa na tela. No Firefox e no Safari só vai vídeo. No Windows, compartilhar a **tela inteira** normalmente não captura áudio — use aba ou janela.

O áudio da tela vai em faixa separada, a 128 kbps (som de jogo e música soam bem melhor que os ~32 kbps de voz), e toca num elemento de áudio próprio — o `<video>` do Chrome ignora faixa de áudio que chega depois da imagem, que é o motivo clássico de "a transmissão está muda".

## Arquitetura

```
public/app.js       -> UI + malha WebRTC (negociacao perfeita, sem glare)
public/style.css    -> tema escuro estilo Discord
public/vendor/       -> cliente socket.io (servido junto, funciona sem backend na mesma origem)
server.js           -> Express + Socket.IO: salas, chat, sinalizacao, /ice
lib/signaling.js    -> salas, chat e sinalizacao (usado pelos dois backends)
api/socket-io.js    -> a mesma sinalizacao como Vercel Function WebSocket
api/config.js       -> /ice no Vercel: ICE servers, path do socket e SIGNAL_URL
vercel.json         -> front estatico + function + rewrite /ice -> /api/config
render.yaml         -> blueprint do servidor dedicado
scripts/gen-cert.js -> certificado autoassinado (HTTPS local)
```

- **Mesh P2P**: cada pessoa abre uma conexão com cada outra. Ótimo até ~6-8 pessoas por call; acima disso o upload de quem transmite fica pesado (aí o caminho é uma SFU, tipo mediasoup ou LiveKit).
- Bitrate da tela é limitado por `maxBitrate` com `degradationPreference: maintain-resolution` — texto continua legível em vez de borrar.
- `contentHint`: `detail` em 30fps (leitura/código), `motion` em 60fps (jogos).
- Chat fica em memória (200 mensagens por canal) e some ao reiniciar o servidor. Para persistir, troque o `Map` de mensagens por SQLite/Postgres.

## Personalizar servidores e canais

Edite `DEFAULT_SERVERS` no topo de `lib/signaling.js` — nome, ícone (2 letras), canais de texto e de voz.
