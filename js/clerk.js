// The clerk's one job: ask a question. Shared by the office (app.js) and the
// question test bench (eval.html), so the bench measures exactly what visitors get.

// If the model's question is unusable, the clerk falls back to one of these.
export const FALLBACK_QUESTIONS = [
  'What is a sound that still brings them back to you?',
  'Where did you most often find them, and what were they doing?',
  'What did they always say, or always do, that no one else did?',
  'What is something you never got to tell them?',
  'What did they teach you without meaning to?',
];

// A 1B model follows worked examples far better than a list of rules.
// Two short memory -> question pairs teach it to ask about a detail in
// what you wrote. After the first question it sees your first memory and
// your latest answer, so each question follows the conversation. It never
// sees its own earlier question there: on the test bench (eval.html), when
// it did, it copied that question back 11 times out of 16.
export function questionPrompt(letter) {
  const rel = letter.rel ? `, their ${letter.rel.replace(/^my\s+/i, '')}` : '';
  const first = letter.items[0];
  const last = letter.items.at(-1);
  const memory = last === first ? first.a : `${first.a} ${last.a}`;
  const asked = letter.questions.length ? `\nDo not ask again: ${letter.questions.join(' / ')}\n` : '';
  return [{
    role: 'user',
    content:
`You help people remember someone who has died by asking one short question about a detail in what they wrote. The question names a sense (sound, smell, sight, touch, taste), a place, or something the person used to say. Ask it in the language they wrote in.

Example 1
They remember about Rosa: She read the newspaper every morning before work.
Question: Where did Rosa sit when she read the newspaper?

Example 2
They remember about Uncle Sam: He fixed bicycles in the garage on Sundays.
Question: What did the garage smell like when Uncle Sam was working?
${asked}
Now
They remember about ${letter.name}${rel}: ${memory}
Question:`,
  }];
}

const wordSet = (t) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2));
export function tooSimilar(q, earlier) {
  const a = wordSet(q);
  return earlier.some((e) => {
    const b = wordSet(e);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / Math.max(1, Math.min(a.size, b.size)) > 0.6;
  });
}

// Keep only a real question: the first line, cut at the question mark.
// Statements, refusals and rambling come back as null.
export function cleanQuestion(raw) {
  let q = (raw || '').replace(/<[^>]+>/g, '').replace(/^\s*(question:|q:)\s*/i, '').trim();
  q = q.split('\n').map((s) => s.trim()).find((s) => s.length > 3) || '';
  q = q.replace(/^["“'*\s]+|["”'*\s]+$/g, '');
  const qm = q.search(/[?？؟]/);
  if (qm === -1) return null;
  q = q.slice(0, qm + 1);
  if (q.length < 8 || q.length > 220 || /as an ai|i'm sorry|i cannot/i.test(q)) return null;
  return q;
}

// Questions a grieving person must never be asked. On the test bench a
// small model once asked "What did Grandpa Joe taste like when he held the
// net while fishing?"
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function unkind(q, name) {
  const who = ['he', 'she', 'they', 'him', 'her', ...(name ? [esc(name)] : [])].join('|');
  return new RegExp(`\\b(${who})\\s+(\\w+\\s+)?tasted?\\b`, 'i').test(q);
}

// Ask the model up to twice. Returns { q, raws }; q is null when nothing
// usable came back, and the office then uses a hand-written question.
export async function modelQuestion(letter, ask) {
  const raws = [];
  for (let tries = 0; tries < 2; tries++) {
    const raw = await ask(questionPrompt(letter), { max_new_tokens: 40, temperature: tries ? 0.9 : 0.7 });
    raws.push(raw);
    const q = cleanQuestion(raw);
    if (q && !tooSimilar(q, letter.questions) && !unkind(q, letter.name)) return { q, raws };
  }
  return { q: null, raws };
}
