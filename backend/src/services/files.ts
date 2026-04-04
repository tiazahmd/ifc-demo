import pdf from 'pdf-parse'
import mammoth from 'mammoth'

export async function extractFileContents(files: File[]): Promise<string[]> {
  const results: string[] = []
  for (const file of files.slice(0, 5)) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      if (file.name.endsWith('.pdf')) {
        const data = await pdf(buffer)
        results.push(`[File: ${file.name}]\n${data.text}`)
      } else if (file.name.endsWith('.docx')) {
        const { value } = await mammoth.extractRawText({ buffer })
        results.push(`[File: ${file.name}]\n${value}`)
      }
    } catch {
      // skip unparseable files silently
    }
  }
  return results
}
