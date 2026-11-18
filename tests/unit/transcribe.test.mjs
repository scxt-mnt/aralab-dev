import test from 'node:test'
import assert from 'node:assert/strict'
import { planChunks, wavBytes, pcm16, mergeTranscripts, isMediaName, toMono, resampleLinear, SAMPLE_RATE, CHUNK_SECONDS } from '../../src/transcribe.js'
import { transcribeChunk, groqTranscribe, MAX_AUDIO_B64, SYSTEM, GROQ_URL } from '../../server/transcribe.js'
import { generateJson as aiGenerate } from '../../server/ai.js'

test('v74: audio is planned in 90-second pieces, in order, with the last one shorter', () => {
  assert.deepEqual(planChunks(0), [])
  assert.deepEqual(planChunks(60), [{ index: 0, start: 0, end: 60 }])
  assert.deepEqual(planChunks(90), [{ index: 0, start: 0, end: 90 }])
  const three = planChunks(181)
  assert.equal(three.length, 3)
  assert.deepEqual(three.map(c => [c.start, c.end]), [[0, 90], [90, 180], [180, 181]])
  assert.equal(CHUNK_SECONDS, 90)
})

test('v74: a chunk is a real mono 16 kHz WAV the AI can read', () => {
  const samples = new Float32Array(SAMPLE_RATE).fill(0.25)          // one second
  const bytes = wavBytes(samples)
  assert.equal(bytes.length, 44 + SAMPLE_RATE * 2)
  const v = new DataView(bytes.buffer)
  const tag = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n))
  assert.equal(tag(0, 4), 'RIFF'); assert.equal(tag(8, 4), 'WAVE'); assert.equal(tag(12, 4), 'fmt '); assert.equal(tag(36, 4), 'data')
  assert.equal(v.getUint16(20, true), 1)                             // PCM
  assert.equal(v.getUint16(22, true), 1)                             // mono
  assert.equal(v.getUint32(24, true), 16000)                         // sample rate
  assert.equal(v.getUint16(34, true), 16)                            // bits per sample
  assert.equal(v.getUint32(40, true), SAMPLE_RATE * 2)               // data size
  assert.equal(v.getInt16(44, true), 8191)                          // 0.25 * 0x7fff, truncated to 16-bit
})

test('v74: loud samples are clipped instead of wrapping around', () => {
  const p = pcm16([2, -2, 0])
  assert.deepEqual([...p], [0x7fff, -0x8000, 0])
})

test('v74: pieces are joined in order and silence pieces are dropped', () => {
  assert.equal(mergeTranscripts(['  Hello there. ', '', 'Next idea.']), 'Hello there.\n\nNext idea.')
  assert.equal(mergeTranscripts(null), '')
  assert.equal(mergeTranscripts([]), '')
})

test('v74: every channel is mixed down to one, so a stereo recording is not twice the size', () => {
  const fake = { length: 3, numberOfChannels: 2, getChannelData: c => (c === 0 ? Float32Array.from([1, 0, -1]) : Float32Array.from([0, 1, 0])) }
  const mono = toMono(fake)
  assert.equal(mono.length, 3)
  assert.deepEqual([...mono], [0.5, 0.5, -0.5])
  const one = { length: 2, numberOfChannels: 1, getChannelData: () => Float32Array.from([0.2, 0.4]) }
  assert.deepEqual([...toMono(one)].map(n => +n.toFixed(3)), [0.2, 0.4])
})

test('v74: only one window of a long recording is mixed at a time', () => {
  const buf = { length: 8, numberOfChannels: 1, getChannelData: () => Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]) }
  assert.deepEqual([...toMono(buf, 2, 5)], [2, 3, 4])
  assert.deepEqual([...toMono(buf, 6, 20)], [6, 7])          // past the end is clamped
  assert.equal(toMono(buf, 5, 5).length, 0)                  // empty window
})

test('v74: a browser that ignores the 16 kHz request is resampled', () => {
  const out = resampleLinear(Float32Array.from([0, 1, 2, 3]), 32000, 16000)
  assert.equal(out.length, 2)
  assert.deepEqual([...out], [0, 2])
  assert.equal(resampleLinear(null, 48000, 16000), null)
  const same = Float32Array.from([1, 2])
  assert.equal(resampleLinear(same, 16000, 16000), same)
})

test('v74: only video/audio names are offered for transcription', () => {  assert.equal(isMediaName('lecture.mp4'), true)
  assert.equal(isMediaName('meet recording.webm'), true)
  assert.equal(isMediaName('voice.m4a'), true)
  assert.equal(isMediaName('notes.pdf'), false)
  assert.equal(isMediaName(''), false)
})

test('v74: the server keeps only the words the AI returns', async () => {
  let seen = null
  const ai = async opts => {
    seen = opts
    return { text: '{"transcript":"  Cells are the unit of life.\\n\\nRibosomes build proteins. "}', model: 'gemini-test' }
  }
  const out = await transcribeChunk({ audio: 'AAAA', mime: 'audio/wav', key: 'k', ai })
  assert.equal(out.text, 'Cells are the unit of life.\n\nRibosomes build proteins.')
  assert.equal(out.model, 'gemini-test')
  assert.equal(seen.parts[0].inlineData.mimeType, 'audio/wav')
  assert.equal(seen.parts[0].inlineData.data, 'AAAA')
  assert.match(seen.system, /Do not summarise/)
  assert.match(SYSTEM, /transcript/)
  assert.doesNotThrow(() => seen.validate('{"transcript":""}'))      // silence is a valid answer
})

test('v74: a broken or non-text answer is rejected', async () => {
  await assert.rejects(transcribeChunk({ audio: 'AAAA', mime: 'audio/wav', key: 'k', ai: async () => ({ text: '{"oops":1}' }) }), /did not return a transcript/)
  await assert.rejects(transcribeChunk({ audio: 'AAAA', mime: 'audio/wav', key: 'k', ai: async () => ({ text: 'not json at all' }) }), /did not return (a transcript|valid JSON)/)
})

test('v74: the server refuses missing/oversized audio, wrong formats and no key', async () => {
  const ai = async () => ({ text: '{"transcript":"x"}' })
  await assert.rejects(transcribeChunk({ audio: '', key: 'k', ai }), /No audio/)
  await assert.rejects(transcribeChunk({ audio: 'a'.repeat(MAX_AUDIO_B64 + 1), key: 'k', ai }), /too big/)
  await assert.rejects(transcribeChunk({ audio: 'AAAA', mime: 'video/mp4', key: 'k', ai }), /not an audio format/)
  await assert.rejects(transcribeChunk({ audio: 'AAAA', mime: 'audio/wav', key: '', ai }), /no AI key/)
})

test('v74: if Gemini cannot listen, Groq Whisper writes it down instead', async () => {
  const old = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'gtest'
  try {
    const out = await transcribeChunk({
      audio: 'AAAA', mime: 'audio/wav', key: 'k',
      ai: async () => { throw Object.assign(new Error('quota reached'), { status: 429 }) },
      groq: async ({ mime }) => ({ text: `Fallback words (${mime}).`, model: 'groq:test' }),
    })
    assert.equal(out.text, 'Fallback words (audio/wav).')
    assert.equal(out.model, 'groq:test')
  } finally {
    if (old === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = old
  }
})

test('v74: the Groq fallback sends the audio as a real multipart file', async () => {
  let seen = null
  const out = await groqTranscribe({
    audio: Buffer.from('RIFFxxxx').toString('base64'), key: 'k',
    fetchImpl: async (url, opts) => { seen = { url, auth: opts.headers.Authorization, form: opts.body }; return { ok: true, status: 200, json: async () => ({ text: ' Hi there ' }) } },
  })
  assert.equal(out.text, 'Hi there')
  assert.match(out.model, /^groq:/)
  assert.equal(seen.url, GROQ_URL)
  assert.equal(seen.auth, 'Bearer k')
  assert.ok(seen.form instanceof FormData)
  assert.equal(seen.form.get('response_format'), 'json')
})

test('v74: audio is never retried on the text-only Groq chat fallback', async () => {
  let groqCalls = 0
  const out = await aiGenerate({
    key: 'k', system: 's', parts: [{ inlineData: { mimeType: 'audio/wav', data: 'AAAA' } }],
    groqKey: 'g', gemini: async () => ({ text: '{"transcript":"ok"}' }), groq: async () => { groqCalls++; return { text: '{"transcript":"invented"}' } },
  })
  assert.equal(out.text, '{"transcript":"ok"}')
  assert.equal(groqCalls, 0)
})
