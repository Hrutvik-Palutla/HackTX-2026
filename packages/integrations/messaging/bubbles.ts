// iMessage reads best as a few short plain-text bubbles. Models and formatters write one block, possibly with
// markdown and several links; this turns it into separate messages: the answer first, then each link alone at the
// end (iOS only builds a link preview for a bubble that is just a URL).
const MAX_BUBBLE = 280;
const MAX_BUBBLES = 6;
const URL_RE = /https?:\/\/[^\s)<>\]]+/g;
const trimUrl = (u: string) => u.replace(/[.,;:!?]+$/, '');

function plain(text: string) {
  return text.replace(/\r\n/g, '\n')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/^[ \t]*[-*]\s+/gm, '• ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Remove links from the prose. A line that is only "Label: url" disappears; an inline url is cut out of its sentence. */
function pullLinks(text: string) {
  const links: string[] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const found = (line.match(URL_RE) ?? []).map(trimUrl);
    if (!found.length) { if (!/^\s*(sources?|links?|see)\s*:?\s*$/i.test(line)) kept.push(line); continue; }
    for (const u of found) if (!links.includes(u)) links.push(u);
    const rest = line.replace(URL_RE, (m) => m.slice(trimUrl(m).length)).replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    if (rest && !rest.endsWith(':')) kept.push(rest); // "Check showtimes: <url>" is just a label for the link
  }
  return { prose: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), links };
}

function splitLong(paragraph: string): string[] {
  if (paragraph.length <= MAX_BUBBLE) return [paragraph];
  const out: string[] = [];
  let cur = '';
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (cur && (cur + ' ' + sentence).length > MAX_BUBBLE) { out.push(cur); cur = sentence; } else cur = cur ? `${cur} ${sentence}` : sentence;
  }
  if (cur) out.push(cur);
  return out;
}

export function toBubbles(input: string): string[] {
  const cleaned = plain(input);
  if (!cleaned) return [];
  if (cleaned.length <= MAX_BUBBLE && !/https?:\/\//.test(cleaned)) return [cleaned];
  const { prose, links } = pullLinks(cleaned);
  const text: string[] = [];
  for (const piece of prose.split(/\n\n/).flatMap((p) => splitLong(p.trim())).filter(Boolean)) {
    const last = text.at(-1);
    if (last && last.length + piece.length + 2 <= MAX_BUBBLE) text[text.length - 1] = `${last}\n\n${piece}`; else text.push(piece);
  }
  const allowed = Math.max(1, MAX_BUBBLES - links.length);
  if (text.length > allowed) text.splice(allowed - 1, text.length - allowed + 1, text.slice(allowed - 1).join('\n\n'));
  return [...text, ...links];
}
