import { Fragment, ReactNode } from "react";

/**
 * Minimal markdown for assistant replies: paragraphs, headings, bullet and numbered
 * lists, **bold** and `code`. Builds React elements only, never HTML strings.
 */
function inline(text: string, key: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Bold needs a letter or digit inside and no neighbouring asterisks, so masked card
  // numbers (4265-****-****-4591) and snake_case IDs stay literal.
  const pattern = /((?<!\*)\*\*(?=[^*\n]*[A-Za-z0-9])[^*\n]+?\*\*(?!\*)|`[^`\n]+`)/g;
  let last = 0,
    match: RegExpExecArray | null,
    i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith("**"))
      parts.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else
      parts.push(
        <code
          key={k}
          className="rounded bg-gray-2 px-1 py-0.5 text-[0.9em] dark:bg-dark-3"
        >
          {token.slice(1, -1)}
        </code>,
      );
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={i} className="font-semibold">
          {inline(heading[2], `h${i}`)}
        </p>,
      );
      i++;
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i])) {
        items.push(lines[i].replace(ordered ? numbered : bullet, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={`l${i}`}
          className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, n) => (
            <li key={n}>{inline(item, `l${i}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p${i}`}>
        {paragraph.map((p, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(p, `p${i}-${n}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-3 break-words leading-relaxed">{blocks}</div>;
}
