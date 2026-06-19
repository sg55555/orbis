// Orbis ライブ字幕用 AudioWorklet。
// Silero VAD は 16kHz で 512 サンプル窓を要求する。render quantum は 128 サンプルなので
// 128 を 512 に貯めてから送る（128 のまま送ると VAD が常に無音判定する）。
class LcPcmWorklet extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(512); this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._n++] = ch[i];
        if (this._n === 512) { this.port.postMessage(this._buf.slice(0)); this._n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('lc-pcm-worklet', LcPcmWorklet);
