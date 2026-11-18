import test from 'node:test'
import assert from 'node:assert/strict'
import { checkVideo, checkDuration, videoType, videoExt, videoPath, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from '../../src/videoLogic.js'

const f = (name, type, size = 1000) => ({ name, type, size })

test('accepts mp4, webm and mov', () => {
  for (const [n, t] of [['a.mp4', 'video/mp4'], ['a.webm', 'video/webm'], ['a.mov', 'video/quicktime']]) assert.equal(checkVideo(f(n, t)), '')
})
test('falls back to the extension when the browser gives no mime type', () => {
  assert.equal(videoType(f('clip.MOV', '')), 'video/quicktime'); assert.equal(videoExt(f('clip.m4v', '')), 'mp4'); assert.equal(checkVideo(f('clip.mp4', '')), '')
})
test('rejects other formats, missing files and oversized videos', () => {
  assert.match(checkVideo(f('a.avi', 'video/x-msvideo')), /MP4, WebM or MOV/)
  assert.match(checkVideo(f('virus.exe', 'application/octet-stream')), /MP4, WebM or MOV/)
  assert.match(checkVideo(f('big.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1)), /over 50 MB/)
  assert.equal(checkVideo(f('edge.mp4', 'video/mp4', MAX_VIDEO_BYTES)), '')
  assert.ok(checkVideo(null))
})
test('duration: up to 60 s is fine, unknown length is allowed, longer is refused', () => {
  assert.equal(checkDuration(MAX_VIDEO_SECONDS), ''); assert.equal(checkDuration(null), ''); assert.equal(checkDuration(NaN), '')
  assert.match(checkDuration(95), /up to 60 seconds/)
})
test('videoPath extracts the storage path only from our bucket URLs', () => {
  assert.equal(videoPath('https://x.supabase.co/storage/v1/object/public/post-videos/uid-1/abc.mp4'), 'uid-1/abc.mp4')
  assert.equal(videoPath('https://x.supabase.co/storage/v1/object/public/post-images/uid-1/abc.jpg'), '')
  assert.equal(videoPath(''), ''); assert.equal(videoPath(null), '')
})
