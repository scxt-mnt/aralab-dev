// Upload limits, shared by the browser (checks + hints) and the server (the real enforcement).
// PDFs may be large (whole textbook chapters); photos and plain text stay smaller.
export const MB = 1024 * 1024
export const MAX_PDF_BYTES = 25 * MB, MAX_IMAGE_BYTES = 10 * MB, MAX_TEXT_BYTES = 5 * MB
export const MAX_REQUEST_BYTES = 40 * MB            // all files of one request together (the real safety cap)
export const MAX_FILES = 50                         // v71: no image count limit; the 40 MB total is what protects the server
export const MAX_PDF_PAGES = 100                    // per PDF; counted in the browser, the AI still has its own limit
export const maxBytesFor = type => (type === 'application/pdf' ? MAX_PDF_BYTES : String(type || '').startsWith('image/') ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES)
export const mbText = n => `${Math.round(n / MB)} MB`
export const LIMIT_HINT = 'PDF · Word · Excel · PowerPoint · images · text · up to 25 MB'

// Page count read straight from the PDF bytes. Uses the page objects and the page-tree /Count, whichever is bigger.
// Some PDFs hide these inside compressed streams, so this can UNDER-count but never over-counts; the size limit still applies.
export function countPdfPages(latin1Text) {
  const objs = (latin1Text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length
  let tree = 0
  for (const m of latin1Text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) tree = Math.max(tree, Number(m[1] || m[2]) || 0)
  return Math.max(objs, tree)
}
