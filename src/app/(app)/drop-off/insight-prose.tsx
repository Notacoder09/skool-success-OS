// Tiny renderer for the only markdown feature our AI prose uses:
// **bold** segments around the highlighted lesson title. Keeps us
// off a full markdown parser dependency for one syntax. If we add
// italics or links to the voice rules later, swap to react-markdown
// and delete this file.

import React from "react";

const BOLD_RE = /\*\*([^*]+)\*\*/g;

export function renderInsightProse(body: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = BOLD_RE.exec(body)) !== null) {
    if (match.index > lastIndex) {
      out.push(body.slice(lastIndex, match.index));
    }
    out.push(
      <strong key={`b-${key++}`} className="font-semibold text-ink">
        {match[1]}
      </strong>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    out.push(body.slice(lastIndex));
  }
  return out;
}
