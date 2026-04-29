// Tiny markdown renderer tailored for the bodies emitted by
// `buildReportEmail` (email.ts). The viewer page uses this to render
// the same document inline without pulling in a markdown library.
//
// Pure & deterministic so it can live next to the other libs.

export type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "tag"; text: string; tone: "action" | "context" }
  | { kind: "p"; text: string };

const TAG_PATTERN = /^\*(Action \d+|Context)\*$/;

export function parseMarkdownBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let buffer: string[] = [];

  function flushParagraph() {
    if (buffer.length === 0) return;
    const text = buffer.join(" ").trim();
    if (text) blocks.push({ kind: "p", text });
    buffer = [];
  }

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      continue;
    }
    const tagMatch = line.trim().match(TAG_PATTERN);
    if (tagMatch) {
      flushParagraph();
      const text = tagMatch[1] ?? "";
      const tone: "action" | "context" = text.startsWith("Action")
        ? "action"
        : "context";
      blocks.push({ kind: "tag", text, tone });
      continue;
    }
    buffer.push(line.trim());
  }
  flushParagraph();
  return blocks;
}
