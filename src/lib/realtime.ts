const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type ServerEvent = { type: string; [key: string]: unknown };
export type ToolResult = { output: unknown; image?: string };
export type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;

type FunctionCall = { type: "function_call"; name: string; call_id: string; arguments?: string };

type Callbacks = {
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onEvent?: (event: ServerEvent) => void;
  onAgentSpeaking?: (speaking: boolean) => void;
  onUserSpeaking?: (speaking: boolean) => void;
};

// Browser side of a Realtime session: WebRTC audio, the oai-events data channel, and function-call dispatch.
export class RealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private agentSpeaking = false;
  private userSpeaking = false;
  private responding = false;

  constructor(
    private tools: Record<string, ToolHandler>,
    private callbacks: Callbacks,
  ) {}

  // True while either side is talking or a response is still being generated.
  get busy() {
    return this.agentSpeaking || this.userSpeaking || this.responding;
  }

  async connect(mic: MediaStreamTrack, speaker: HTMLAudioElement) {
    const tokenRes = await fetch("/api/realtime-token", { method: "POST" });
    const token = (await tokenRes.json()) as { value?: string; error?: string };
    if (!tokenRes.ok || !token.value) throw new Error(token.error ?? `Token request failed (${tokenRes.status})`);

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (e) => {
      speaker.srcObject = e.streams[0];
      speaker.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.callbacks.onClose?.(`Connection ${pc.connectionState}`);
      }
    };
    pc.addTrack(mic);

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onopen = () => this.callbacks.onOpen?.();
    dc.onmessage = (e) => void this.handleEvent(JSON.parse(e.data) as ServerEvent);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch(REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
    });
    const sdp = await sdpRes.text();
    if (!sdpRes.ok) throw new Error(`OpenAI rejected the call (${sdpRes.status}): ${sdp.slice(0, 200)}`);
    await pc.setRemoteDescription({ type: "answer", sdp });
  }

  send(event: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  // Adds a message from the app (not the user's voice), optionally with a photo, and has the agent respond.
  sendAppMessage(text: string, image?: string) {
    if (this.agentSpeaking) this.interrupt();
    this.send({ type: "conversation.item.create", item: userMessage(text, image) });
    this.send({ type: "response.create" });
  }

  interrupt() {
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
  }

  close() {
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
  }

  private async handleEvent(event: ServerEvent) {
    this.callbacks.onEvent?.(event);
    switch (event.type) {
      case "output_audio_buffer.started":
        this.setAgentSpeaking(true);
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.setAgentSpeaking(false);
        break;
      case "input_audio_buffer.speech_started":
      case "input_audio_buffer.speech_stopped":
        this.userSpeaking = event.type === "input_audio_buffer.speech_started";
        this.callbacks.onUserSpeaking?.(this.userSpeaking);
        break;
      case "response.created":
        this.responding = true;
        break;
      case "response.done":
        this.responding = false;
        await this.runFunctionCalls(event);
        break;
    }
  }

  private setAgentSpeaking(speaking: boolean) {
    this.agentSpeaking = speaking;
    this.callbacks.onAgentSpeaking?.(speaking);
  }

  // Runs every function call in a finished response, returns the results, then lets the agent continue.
  private async runFunctionCalls(event: ServerEvent) {
    const output = (event.response as { output?: { type?: string }[] } | undefined)?.output ?? [];
    const calls = output.filter((item): item is FunctionCall => item.type === "function_call");
    if (calls.length === 0) return;

    for (const call of calls) {
      const result = await this.runTool(call);
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result.output) },
      });
      if (result.image) {
        this.send({ type: "conversation.item.create", item: userMessage(`[app] Photo from ${call.name}:`, result.image) });
      }
    }
    this.send({ type: "response.create" });
  }

  private async runTool(call: FunctionCall): Promise<ToolResult> {
    try {
      const handler = this.tools[call.name];
      if (!handler) throw new Error(`Unknown tool: ${call.name}`);
      return await handler(JSON.parse(call.arguments || "{}"));
    } catch (err) {
      return { output: { error: err instanceof Error ? err.message : String(err) } };
    }
  }
}

function userMessage(text: string, image?: string) {
  const content: Record<string, string>[] = [{ type: "input_text", text }];
  if (image) content.push({ type: "input_image", image_url: image });
  return { type: "message", role: "user", content };
}
