// Pure helpers for announcement videos (no React, no Supabase) so they can be unit-tested.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 60
const BY_TYPE = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
const BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }

// Some phones/browsers leave file.type empty, so fall back to the extension.
export const videoType = f => BY_TYPE[f?.type] ? f.type : BY_EXT[String(f?.name || '').split('.').pop().toLowerCase()] || ''
export const videoExt = f => BY_TYPE[videoType(f)] || ''

// returns '' when fine, otherwise a message to show
export function checkVideo(f) {
  if (!f) return 'Choose a video first.'
  if (!videoType(f)) return `${f.name || 'That file'}: please choose an MP4, WebM or MOV video.`
  if (f.size > MAX_VIDEO_BYTES) return `${f.name || 'That video'} is over ${MAX_VIDEO_BYTES / 1048576} MB. Shorten or compress it first.`
  return ''
}
export const checkDuration = secs => (Number.isFinite(secs) && secs > MAX_VIDEO_SECONDS + 1 ? `Videos can be up to ${MAX_VIDEO_SECONDS} seconds (this one is ${Math.round(secs)}s).` : '')

// storage path inside the post-videos bucket, from a public URL (used to delete the file with the post)
export const videoPath = url => { const m = /\/storage\/v1\/object\/public\/post-videos\/([^?#]+)/.exec(String(url || '')); return m ? decodeURIComponent(m[1]) : '' }
