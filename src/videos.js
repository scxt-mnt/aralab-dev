import { sb } from './supabase'
import { uid } from './lib'
import { videoExt, videoPath, videoType } from './videoLogic'
export * from './videoLogic'

// Reads the length of a local video. Resolves null when the browser can't tell (e.g. a .mov it can't decode), so the caller only enforces the size limit then.
export function videoDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file), v = document.createElement('video')
    const done = n => { clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(n) }
    const t = setTimeout(() => done(null), 5000)
    v.preload = 'metadata'; v.muted = true
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null)
    v.onerror = () => done(null)
    v.src = url
  })
}

// uploads to post-videos/<admin-id>/<random>.<ext> (the database only lets admins write there); returns the public URL + path
export async function uploadPostVideo(userId, file) {
  const path = `${userId}/${uid()}.${videoExt(file)}`
  const { error } = await sb.storage.from('post-videos').upload(path, file, { contentType: videoType(file), cacheControl: '31536000' })
  if (error) throw new Error(/exceeded|too large|size/i.test(error.message) ? 'The server rejected the video as too large. Try a shorter or smaller one.' : error.message)
  return { url: sb.storage.from('post-videos').getPublicUrl(path).data.publicUrl, path }
}
export const removePostVideo = ref => { const path = ref?.includes?.('/') && /^https?:/.test(ref) ? videoPath(ref) : ref; return path ? sb.storage.from('post-videos').remove([path]) : null }
