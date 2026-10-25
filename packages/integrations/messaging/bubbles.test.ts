import { describe, expect, it } from 'vitest';
import { toBubbles } from './bubbles.ts';

describe('toBubbles', () => {
  it('packs short paragraphs into one bubble', () => {
    expect(toBubbles('Here’s what I found:\nA) Clayface, 7:00 PM\n\nWhat time works best?\n\nhttps://a.example/1')).toEqual([
      'Here’s what I found:\nA) Clayface, 7:00 PM\n\nWhat time works best?',
      'https://a.example/1',
    ]);
  });

  it('leaves a short plain message untouched', () => {
    expect(toBubbles('Here are 3 options')).toEqual(['Here are 3 options']);
    expect(toBubbles('Your SideQuest code is 123456')).toEqual(['Your SideQuest code is 123456']);
  });

  it('sends each link as its own final bubble and drops the label line', () => {
    expect(toBubbles('Clayface is at 7:00 PM.\nCheck showtimes: https://theater.example/tech-ridge\n')).toEqual([
      'Clayface is at 7:00 PM.',
      'https://theater.example/tech-ridge',
    ]);
  });

  it('cuts an inline link out of the sentence without a dangling label', () => {
    expect(toBubbles('Hugo and Cindy, details are at https://a.example/x. Reply A to lock it.')).toEqual([
      'Hugo and Cindy, details are at. Reply A to lock it.',
      'https://a.example/x',
    ]);
  });

  it('turns markdown into plain text', () => {
    expect(toBubbles('**Best fit:** [AMC Tech Ridge](https://amc.example/a)\n- 7:00 PM\n- 10:00 PM')).toEqual([
      'Best fit: AMC Tech Ridge\n• 7:00 PM\n• 10:00 PM',
      'https://amc.example/a',
    ]);
  });

  it('keeps each link once and drops "Sources:" headings', () => {
    const out = toBubbles('Listing shows 7pm.\n\nSources:\nhttps://a.example/1\nhttps://b.example/2\nhttps://a.example/1');
    expect(out).toEqual(['Listing shows 7pm.', 'https://a.example/1', 'https://b.example/2']);
  });

  it('splits a long answer at sentence boundaries under the bubble size', () => {
    const sentence = 'The 7:00 PM showing at Tech Ridge has seats left tonight.';
    const out = toBubbles(Array(10).fill(sentence).join(' '));
    expect(out.length).toBeGreaterThan(1);
    for (const b of out) expect(b.length).toBeLessThanOrEqual(280);
    expect(out.join(' ')).toBe(Array(10).fill(sentence).join(' '));
  });

  it('never sends more than six bubbles', () => {
    const para = Array(8).fill('A paragraph long enough that two of them cannot share one bubble. '.repeat(3).trim()).join('\n\n');
    const out = toBubbles(`${para}\n\nhttps://a.example/1\nhttps://b.example/2`);
    expect(out).toHaveLength(6);
    expect(out.slice(-2)).toEqual(['https://a.example/1', 'https://b.example/2']);
  });
});
