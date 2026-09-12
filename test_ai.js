const prism = require('prism-media');
const { pipeline } = require('@xenova/transformers');
const fs = require('fs');
const path = require('path');

let transcriber = null;

async function getTranscriber() {
  if (!transcriber) {
    console.log('Loading Xenova Whisper ONNX speech recognition model...');
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
  }
  return transcriber;
}

function pcmToFloat32Array(pcmBuffer) {
  const samples = new Float32Array(pcmBuffer.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const int16 = pcmBuffer.readInt16LE(i * 2);
    samples[i] = int16 / 32768.0;
  }
  return samples;
}

function decodeOggOpusToPCM(oggFilePath) {
  return new Promise((resolve, reject) => {
    const oggStream = fs.createReadStream(oggFilePath);
    const demuxer = new prism.opus.OggDemuxer();
    const decoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 960 });

    const chunks = [];
    oggStream.pipe(demuxer).pipe(decoder);
    decoder.on('data', chunk => chunks.push(chunk));
    decoder.on('end', () => resolve(Buffer.concat(chunks)));
    decoder.on('error', err => reject(err));
    demuxer.on('error', err => reject(err));
  });
}

async function testPipeline() {
  const mediaDir = path.join(__dirname, 'data', 'media');
  if (!fs.existsSync(mediaDir)) return;
  const files = fs.readdirSync(mediaDir).filter(f => f.endsWith('.ogg'));
  if (files.length === 0) return;

  const testFile = path.join(mediaDir, files[0]);
  console.log('Testing speech recognition on file:', testFile);

  try {
    const pcm = await decodeOggOpusToPCM(testFile);
    console.log('✅ Decoded PCM buffer length:', pcm.length, 'bytes');
    const float32Samples = pcmToFloat32Array(pcm);

    const pipe = await getTranscriber();
    const result = await pipe(float32Samples);
    console.log('🎉 REAL WHISPER TRANSCRIPTION RESULT:', JSON.stringify(result));
  } catch (err) {
    console.error('Pipeline error:', err.message);
  }
}

testPipeline();
