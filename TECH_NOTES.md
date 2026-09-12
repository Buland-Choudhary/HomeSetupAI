# Tech notes (checked against the docs 2026-09-12)

## OpenAI Realtime API (GA interface)
- Models: `gpt-realtime-2.1` (current in docs), also `gpt-realtime-2` and `gpt-realtime`. All support **image input** and function calling.
- Voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, **marin**, **cedar** (the docs recommend marin or cedar).
- Browser uses **WebRTC**. The old beta `/v1/realtime/sessions` flow no longer connects.

### Ephemeral key (server)
`POST https://api.openai.com/v1/realtime/client_secrets` with `Authorization: Bearer $OPENAI_API_KEY`
```json
{ "session": { "type": "realtime", "model": "gpt-realtime-2.1", "audio": { "output": { "voice": "marin" } } } }
```
The response's `value` field is the ephemeral key (`ek_...`).

### Browser connect
```js
const pc = new RTCPeerConnection();
const audio = document.createElement("audio"); audio.autoplay = true;
pc.ontrack = (e) => (audio.srcObject = e.streams[0]);
const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
pc.addTrack(ms.getTracks()[0]);
const dc = pc.createDataChannel("oai-events");
const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
const r = await fetch("https://api.openai.com/v1/realtime/calls", {
  method: "POST", body: offer.sdp,
  headers: { Authorization: `Bearer ${EPHEMERAL_KEY}`, "Content-Type": "application/sdp" },
});
await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
```
Alternative "unified interface": the server forwards SDP as FormData (`sdp` plus a `session` JSON string) to `/v1/realtime/calls` using the real API key.

### Events (sent over the `oai-events` data channel)
- `session.update`: `{ type:"session.update", session:{ type:"realtime", model, output_modalities:["audio"], instructions, tools:[...], tool_choice:"auto", audio:{ input:{ turn_detection:{type:"semantic_vad"} }, output:{ voice:"marin" } } } }`
- Image: `{ type:"conversation.item.create", item:{ type:"message", role:"user", content:[{ type:"input_image", image_url:"data:image/jpeg;base64,..." }] } }`
- `conversation.item.create` adds context **without** triggering a reply. Send `{type:"response.create"}` to make the model speak.
- Tools use the flat shape `{ type:"function", name, description, parameters }`.
- Sending frames: high resolution at low FPS is advised; about 1 FPS is the practical floor. Send snapshots on demand rather than streaming video.

Also available at a higher level: the `@openai/agents/realtime` package (`RealtimeAgent`, `RealtimeSession`, `session.connect({ apiKey: ek })`).

## Exa (`npm install exa-js`)
```ts
import Exa from "exa-js";
const exa = new Exa(); // reads EXA_API_KEY
await exa.search("query", { numResults: 5, includeDomains: [...], contents: { highlights: true } }); // type "auto" by default
await exa.getContents([url], { text: true });
await exa.answer("question"); // .answer, with citations
```

## Local machine
node 24, npm 11, python 3.12, uv, docker, gh (logged in as Buland-Choudhary). No gcloud, ngrok or cloudflared. No API keys in env.
Phone camera/mic access needs **HTTPS**, so deploy the app or use a tunnel for testing on a phone.

Sources: developers.openai.com/api/docs/guides/realtime-conversations, /voice-webrtc?api=realtime; exa.ai/docs/sdks/javascript-sdk; github.com/webrtcHacks/gpt-realtime-webrtc
