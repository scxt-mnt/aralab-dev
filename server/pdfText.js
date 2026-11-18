// Read the text of a PDF on the server (the `unpdf` package is already used by the Groq backup).
// Page breaks are kept: they usually separate headings and paragraphs, which the reviewer importer needs.
export async function pdfText(bytes) {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { text } = await extractText(pdf, { mergePages: false })
    const all = (Array.isArray(text) ? text : [text]).map(String).join('\n')
    return all.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } catch { return '' }
}
