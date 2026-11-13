/**
 * Minimal markdown for assistant replies, the same rules as the web chat
 * (frontend/src/components/chat/Markdown.tsx): paragraphs, headings, bullet and
 * numbered lists, **bold** and `code`. Parses into plain data so it can be tested
 * without React Native.
 */
export type Span = { type: "text" | "bold" | "code"; text: string };
export type MdBlock =
  | { type: "heading"; spans: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | { type: "paragraph"; lines: Span[][] };

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  // Bold needs a letter or digit inside and no neighbouring asterisks, so masked card
  // numbers (4265-****-****-4591) and snake_case IDs stay literal.
  const pattern =
    /((?<!\*)\*\*(?=[^*\n]*[A-Za-z0-9])[^*\n]+?\*\*(?!\*)|`[^`\n]+`)/g;
  let last = 0,
    match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last)
      spans.push({ type: "text", text: text.slice(last, match.index) });
    const token = match[0];
    spans.push(
      token.startsWith("**")
        ? { type: "bold", text: token.slice(2, -2) }
        : { type: "code", text: token.slice(1, -1) },
    );
    last = match.index + token.length;
  }
  if (last < text.length) spans.push({ type: "text", text: text.slice(last) });
  return spans;
}

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const bullet = /^\s*[-*•]\s+/;
  const numbered = /^\s*\d+[.)]\s+/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", spans: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: Span[][] = [];
      while (i < lines.length && marker.test(lines[i])) {
        items.push(parseInline(lines[i].replace(marker, "")));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph: Span[][] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i])
    ) {
      paragraph.push(parseInline(lines[i]));
      i++;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }
  return blocks;
}
