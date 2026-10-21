/**
 * Structure-Aware Markdown Splitter for Vercel Edge Runtime
 *
 * Guarantees:
 * 1. Heading-aware boundaries (splits on \n## and \n###).
 * 2. Atomic tables: NEVER splits a markdown table across chunk boundaries.
 * 3. Atomic code blocks: NEVER splits a fenced code block across chunk boundaries.
 * 4. Structural metadata: parent_headers, is_tabular, chunk_index.
 * 5. Target chunk size: 500–800 tokens (~2,000–3,200 characters).
 * 6. Edge Runtime safe: zero Node.js native module dependencies (no fs, path, etc.).
 */

export interface ChunkMetadata {
  parent_headers: string[]
  is_tabular: boolean
  chunk_index: number
}

export interface DocumentChunk {
  content: string
  metadata: ChunkMetadata
}

interface MarkdownBlock {
  type: "heading" | "code" | "table" | "paragraph"
  content: string
  level?: number
  headerText?: string
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 1. Fenced Code Block
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [line]
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) {
        codeLines.push(lines[i]) // closing ```
        i++
      }
      blocks.push({
        type: "code",
        content: codeLines.join("\n"),
      })
      continue
    }

    // 2. Headings (#, ##, ###, ####, etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headerText = headingMatch[2].trim()
      blocks.push({
        type: "heading",
        content: line,
        level,
        headerText,
      })
      i++
      continue
    }

    // 3. Markdown Table (| ... |)
    const trimmed = line.trim()
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [line]
      i++
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableLines.push(lines[i])
        i++
      }
      blocks.push({
        type: "table",
        content: tableLines.join("\n"),
      })
      continue
    }

    // 4. Blank lines
    if (!trimmed) {
      i++
      continue
    }

    // 5. Standard paragraph / list items
    const paragraphLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !(lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|"))
    ) {
      paragraphLines.push(lines[i])
      i++
    }
    blocks.push({
      type: "paragraph",
      content: paragraphLines.join("\n"),
    })
  }

  return blocks
}

function checkIsTabular(text: string): boolean {
  const lines = text.split("\n")
  let tableRowCount = 0
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith("|") && t.endsWith("|")) {
      tableRowCount++
      if (tableRowCount >= 2) return true
    }
  }
  return false
}

export function splitMarkdown(
  markdown: string,
  options?: {
    minTokens?: number
    maxTokens?: number
  }
): DocumentChunk[] {
  const minTokens = options?.minTokens ?? 300 // ~1200 chars
  const maxTokens = options?.maxTokens ?? 800 // ~3200 chars

  const blocks = parseBlocks(markdown)
  if (blocks.length === 0) return []

  const chunks: DocumentChunk[] = []
  let activeHierarchy: string[] = []
  let currentChunkBlocks: MarkdownBlock[] = []
  let currentTokens = 0
  let chunkStartingHierarchy: string[] = []

  const finalizeChunk = () => {
    if (currentChunkBlocks.length === 0) return

    const content = currentChunkBlocks.map((b) => b.content).join("\n\n").trim()
    if (!content) return

    chunks.push({
      content,
      metadata: {
        parent_headers: [...chunkStartingHierarchy],
        is_tabular: checkIsTabular(content),
        chunk_index: chunks.length,
      },
    })

    currentChunkBlocks = []
    currentTokens = 0
  }

  for (const block of blocks) {
    // Update active hierarchy if block is a heading
    if (block.type === "heading" && block.level && block.headerText) {
      const level = block.level
      // Resize hierarchy array up to level - 1
      activeHierarchy = activeHierarchy.slice(0, level - 1)
      activeHierarchy[level - 1] = block.headerText

      // Check for heading-aware boundary split:
      // If heading is level 2 (##) or level 3 (###) and current chunk has reached minTokens:
      if ((level === 2 || level === 3) && currentTokens >= minTokens) {
        finalizeChunk()
      }
    }

    const blockTokens = estimateTokens(block.content)

    // If adding this block would exceed maxTokens and we already have content:
    if (currentTokens + blockTokens > maxTokens && currentChunkBlocks.length > 0) {
      finalizeChunk()
    }

    if (currentChunkBlocks.length === 0) {
      chunkStartingHierarchy = [...activeHierarchy]
    }

    currentChunkBlocks.push(block)
    currentTokens += blockTokens
  }

  // Finalize remaining blocks
  finalizeChunk()

  return chunks
}
