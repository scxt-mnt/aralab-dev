// Study aids ("reviewer strategy"): extra sections a student can ask for when creating a reviewer
// (abbreviations, memory tricks, comparison tables...). Pure data, shared by the browser (form + preview) and the server (AI prompt).
export const AIDS = {
  abbreviations: {
    label: 'Abbreviations & acronyms', hint: 'Short forms and what they stand for',
    shape: '"abbreviations":[{"abbr":string,"meaning":string,"note":string (optional, max 12 words)}] (max 25)',
    rule: 'abbreviations: only abbreviations or acronyms that appear in the notes or are standard in the subject. Always give the full meaning.',
  },
  mnemonics: {
    label: 'Mnemonics & memory tricks', hint: 'Acronyms and phrases to remember lists',
    shape: '"mnemonics":[{"topic":string,"trick":string,"explain":string}] (max 10)',
    rule: 'mnemonics: make a short, catchy memory trick for lists, steps or groups of terms found in the notes. "trick" is the phrase or acronym itself; "explain" says what each letter or word stands for. Use only facts from the notes.',
  },
  keyFacts: {
    label: 'Cheat sheet (must-know facts)', hint: 'The most testable facts, names and numbers',
    shape: '"keyFacts":[string] (max 20)',
    rule: 'keyFacts: the most testable facts, formulas, names and numbers from the notes, one short line each.',
  },
  comparisons: {
    label: 'Compare & contrast tables', hint: 'Look-alike concepts side by side',
    shape: '"comparisons":[{"title":string,"headers":[2 to 4 strings],"rows":[[one string per header]]}] (max 3 tables, max 8 rows each)',
    rule: 'comparisons: compare and contrast similar concepts from the notes (theories, types, stages, terms) in a table. The first header names the thing being compared.',
  },
  timeline: {
    label: 'Timeline / step-by-step order', hint: 'Events, stages or steps in order',
    shape: '"timeline":[{"label":string,"detail":string}] (max 15)',
    rule: 'timeline: events, stages or steps in order. Put the date, age or step number in "label".',
  },
  traps: {
    label: 'Common mistakes & exam traps', hint: 'Look-alike answers students fall for',
    shape: '"traps":[{"mistake":string,"correct":string}] (max 8)',
    rule: 'traps: common mistakes or look-alike wrong answers about the notes, each with the correct idea.',
  },
  examples: {
    label: 'Real-life examples', hint: 'Apply the lesson to a short scenario',
    shape: '"examples":[{"scenario":string,"answer":string}] (max 6)',
    rule: 'examples: short real-life or classroom scenarios that apply the lessons, with the answer and the reason.',
  },
  diagrams: {
    label: 'Diagrams & graphs', hint: 'A simple drawing for the main process or numbers',
    shape: '"diagrams":[{"kind":"flow","title":string,"steps":[3-6 short strings]},{"kind":"cycle","title":string,"steps":[3-6 short strings]},{"kind":"bars","title":string,"unit":string (optional),"items":[{"label":string,"value":number}] (2-6)},{"kind":"symbols","title":string,"items":[{"symbol":string,"meaning":string}] (2-10)}] (max 4)',
    rule: 'diagrams: draw only the ideas that are easier to see than to read — a process (flow), a repeating cycle (cycle), numbers that compare (bars), or formulas and symbols (symbols). Keep each one small and simple, use facts and numbers from the notes only, and never invent data. Bars need real numbers from the notes; if there are none, use flow, cycle or symbols instead.',
  },
}
export const AID_IDS = Object.keys(AIDS)

// One-tap presets. They just tick the boxes; the student can still add or remove any aid.
export const STRATEGIES = {
  memorize: { label: 'Memorize fast', hint: 'Short forms, memory tricks and a cheat sheet', aids: ['abbreviations', 'mnemonics', 'keyFacts'] },
  understand: { label: 'Understand deeply', hint: 'Comparisons, examples and the right order', aids: ['comparisons', 'examples', 'timeline'] },
  exam: { label: 'Exam ready', hint: 'Cheat sheet, comparisons and common traps', aids: ['keyFacts', 'comparisons', 'traps'] },
  visual: { label: 'Visual learner', hint: 'Diagrams, side-by-side tables and the order of steps', aids: ['diagrams', 'comparisons', 'timeline'] },
}

export const cleanAids = x => [...new Set((Array.isArray(x) ? x : []).filter(k => Object.prototype.hasOwnProperty.call(AIDS, k)))].slice(0, 8)

// Text appended to the AI system prompt for the chosen aids ('' when none).
export function aidsPrompt(aids) {
  const list = cleanAids(aids)
  if (!list.length) return ''
  return `\nThe student also asked for these study aids. Add exactly these extra keys to the JSON object, and no other extra keys:\n${list.map(k => `- ${AIDS[k].shape}`).join('\n')}\nRules for the extras:\n${list.map(k => `- ${AIDS[k].rule}`).join('\n')}\nIf the notes are too thin for one of them, return an empty array for it. Never invent facts to fill an aid.`
}
