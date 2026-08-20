# Nexus Chat

Plataforma de voz, vídeo e **compartilhamento de tela** no estilo Discord — servidores, canais de texto e canais de voz, chat em tempo real e call P2P.

Áudio, câmera e tela vão **direto de um navegador para o outro** (WebRTC). O servidor só faz a apresentação entre as pessoas e guarda o chat.

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

**Opção definitiva (deploy):** ver a seção abaixo.

---

## Deploy: Vercel + Render

O Vercel **não mantém WebSocket aberto** (funções serverless não vivem entre requisições), então ele não consegue hospedar a sinalização do Socket.IO. A divisão que funciona:

| Parte | Onde | Por quê |
|---|---|---|
| Interface (HTML/CSS/JS) | **Vercel** | CDN rápido, HTTPS automático |
| Sinalização (Socket.IO) | **Render** (free) | aceita conexão WebSocket persistente |
| Áudio / vídeo / tela | **P2P** entre os navegadores | não passa por servidor nenhum |

### 1. Servidor de sinalização no Render

1. [render.com](https://render.com) → **New → Web Service** → conecte este repositório.
2. O `render.yaml` já define tudo (build `npm install`, start `npm start`, plano free).
3. Copie a URL final, algo como `https://nexus-chat-xxxx.onrender.com`.

> O plano free hiberna após 15 min sem uso; a primeira conexão depois disso demora ~30s para acordar.

### 2. Interface no Vercel

No projeto do Vercel, adicione a variável de ambiente e faça redeploy:

```
SIGNAL_URL = https://nexus-chat-xxxx.onrender.com
```

Opcionalmente, `TURN_URL`, `TURN_USER` e `TURN_PASS`.

**Sem querer mexer em variável?** Dá para passar o servidor pela URL:

```
https://seu-app.vercel.app/?signal=https://nexus-chat-xxxx.onrender.com
```

O endereço fica salvo no navegador, e também dá para editá-lo em *Servidor de conexão* na tela de entrada.

### Alternativa: tudo num lugar só

O `server.js` serve a interface **e** a sinalização. Subindo só no Render (ou Railway/Fly), a URL dele já é a plataforma inteira — sem Vercel, sem `SIGNAL_URL`.

### TURN (importante para internet)

Em redes normais o P2P se resolve com STUN. Em NAT simétrico (algumas operadoras, 4G, redes corporativas) a conexão só fecha com um servidor TURN. Configure por variáveis de ambiente:

```bash
TURN_URL=turn:seu-servidor:3478 TURN_USER=usuario TURN_PASS=senha npm start
```

Serviços prontos: Metered, Twilio Network Traversal, Cloudflare Calls. Ou suba um `coturn` num VPS.

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

**Áudio do sistema:** no Chrome/Edge, ao escolher "Guia do Chrome" ou "Janela", aparece a opção *Compartilhar áudio*. No Firefox e no Safari só vai vídeo. No Windows, compartilhar a **tela inteira** não captura áudio — use janela ou aba.

## Arquitetura

```
public/app.js       -> UI + malha WebRTC (negociacao perfeita, sem glare)
public/style.css    -> tema escuro estilo Discord
public/vendor/       -> cliente socket.io (servido junto, funciona sem backend na mesma origem)
server.js           -> Express + Socket.IO: salas, chat, sinalizacao, /ice
api/config.js       -> funcao serverless do Vercel: devolve SIGNAL_URL + ICE
vercel.json         -> front estatico + rewrite /ice -> /api/config
render.yaml         -> blueprint do servidor de sinalizacao
scripts/gen-cert.js -> certificado autoassinado (HTTPS local)
```

- **Mesh P2P**: cada pessoa abre uma conexão com cada outra. Ótimo até ~6-8 pessoas por call; acima disso o upload de quem transmite fica pesado (aí o caminho é uma SFU, tipo mediasoup ou LiveKit).
- Bitrate da tela é limitado por `maxBitrate` com `degradationPreference: maintain-resolution` — texto continua legível em vez de borrar.
- `contentHint`: `detail` em 30fps (leitura/código), `motion` em 60fps (jogos).
- Chat fica em memória (200 mensagens por canal) e some ao reiniciar o servidor. Para persistir, troque o `Map` de mensagens por SQLite/Postgres.

## Personalizar servidores e canais

Edite `DEFAULT_SERVERS` no topo de `server.js` — nome, ícone (2 letras), canais de texto e de voz.
