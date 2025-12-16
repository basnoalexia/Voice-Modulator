class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0 }];
  }

  constructor(options) {
    super(options);
    this._bufferSize = 16384; // internal circular buffer size
    this._buffers = [];
    this._writeIndex = 0;
    this._readIndex = 0.0;
    this._initialized = false;
    this._pitch = 1.0;
  }

  _ensureChannels(channelCount) {
    while (this._buffers.length < channelCount) {
      this._buffers.push(new Float32Array(this._bufferSize));
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      // no input -> output silence
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
      return true;
    }

    const channelCount = Math.max(input.length, output.length);
    this._ensureChannels(channelCount);

    // read pitch parameter (may be array if automated)
    const pitchParam = parameters.pitch;
    const pitch = pitchParam.length > 0 ? pitchParam[pitchParam.length - 1] : this._pitch;
    this._pitch = pitch;

    const blockSize = input[0].length;

    // Write incoming samples into circular buffer
    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const buf = this._buffers[ch];
      for (let i = 0; i < inCh.length; i++) {
        buf[this._writeIndex] = inCh[i];
        this._writeIndex = (this._writeIndex + 1) % this._bufferSize;
      }
    }

    // For channels without input, zero-fill the write region
    for (let ch = input.length; ch < channelCount; ch++) {
      const buf = this._buffers[ch];
      for (let i = 0; i < blockSize; i++) {
        buf[this._writeIndex] = 0;
        this._writeIndex = (this._writeIndex + 1) % this._bufferSize;
      }
    }

    // Produce output by resampling from circular buffer using linear interpolation
    for (let ch = 0; ch < output.length; ch++) {
      const outCh = output[ch];
      const buf = this._buffers[ch];
      for (let i = 0; i < outCh.length; i++) {
        // compute read position relative to buffer
        const readPos = (this._writeIndex + this._readIndex) % this._bufferSize;
        // linear interpolation
        const i0 = Math.floor(readPos);
        const i1 = (i0 + 1) % this._bufferSize;
        const frac = readPos - i0;
        const s0 = buf[(i0 + this._bufferSize) % this._bufferSize];
        const s1 = buf[(i1 + this._bufferSize) % this._bufferSize];
        outCh[i] = s0 + frac * (s1 - s0);
        // advance read index by pitch (pitch>1 => faster read => higher pitch)
        this._readIndex += this._pitch;
        // keep readIndex in reasonable range (negative allowed)
        if (this._readIndex > this._bufferSize - 1) this._readIndex -= this._bufferSize;
      }
    }

    // normalize readIndex to be offset from writeIndex
    // keep it modest to avoid runaway values
    this._readIndex = this._readIndex % this._bufferSize;

    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
