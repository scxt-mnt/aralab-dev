// Speed dial (v70): which shortcuts the floating "Quick start" button offers. Pure, so it is easy to test.
// The first item is the one closest to the button. An item that points at the screen you are already on is left out,
// and on the Create screen the first item becomes a step-by-step guide ("How to create a reviewer") instead.
// tab: a screen id from App.jsx. guide: opens the Welcome guide at that step (0 = intro, 2 = how to create a reviewer).
export const DIAL_ITEMS = [
  { id: 'create', icon: 'sparkles', label: 'Create a reviewer', hint: 'Upload notes. AI builds notes, flashcards and a quiz.', tab: 'requests' },
  { id: 'classroom', icon: 'school', label: 'Import from Google Classroom', hint: 'Turn the lessons your teachers posted into reviewers.', tab: 'classroom' },
  { id: 'library', icon: 'library', label: 'Browse reviewers', hint: 'Study what other students already made.', tab: 'library' },
  { id: 'feed', icon: 'feed', label: 'Post in the Feed', hint: 'Share what you study and follow classmates.', tab: 'feed' },
  { id: 'astra', icon: 'cap', label: 'University Astra', hint: 'Your school guide, ranking and classmates.', tab: 'astra' },
  { id: 'tour', icon: 'help', label: 'Show me around', hint: 'A 1-minute tour of what AraLab can do.', guide: 0 },
]
export const HOWTO = { id: 'howto', icon: 'bulb', label: 'How to create a reviewer', hint: 'Step by step, takes one minute.', guide: 2 }

// screens that live under another nav button
const GROUP = { rank: 'astra', campus: 'astra' }

export function dialItems(tab) {
  const here = GROUP[tab] || tab || ''
  const rest = DIAL_ITEMS.filter(i => i.tab !== here)
  return here === 'requests' ? [HOWTO, ...rest] : rest
}
