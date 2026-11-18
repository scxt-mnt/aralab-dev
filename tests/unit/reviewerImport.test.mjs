import test from 'node:test'
import assert from 'node:assert/strict'
import { renderReviewer, SAMPLE_CONTENT } from '../../src/render.js'
import { parseAraLabHtml, parseReviewerHtml, parseReviewerText, looksLikeFinishedReviewer, htmlToReviewerText, parseReviewerPdfText, pdfToReviewerText } from '../../src/reviewerImport.js'
import { convertFile } from '../../src/fileConvert.js'

test('import: a reviewer made by AraLab keeps its sections, terms, cards and quiz exactly', () => {
  const html = renderReviewer(SAMPLE_CONTENT, 'studyflow', 'indigo')
  const c = parseAraLabHtml(html)
  assert.ok(c)
  assert.equal(c.title, SAMPLE_CONTENT.title)
  assert.equal(c.sections.length, SAMPLE_CONTENT.sections.length)
  assert.deepEqual(c.sections[0], SAMPLE_CONTENT.sections[0])
  assert.deepEqual(c.terms, SAMPLE_CONTENT.terms)
  assert.deepEqual(c.flashcards, SAMPLE_CONTENT.flashcards)
  assert.deepEqual(c.quiz, SAMPLE_CONTENT.quiz)
  assert.equal(looksLikeFinishedReviewer(c, 'cell reviewer.html', { html: true }), true)
})

test('import: generic reviewer HTML is read from headings, bullets and Q/A', () => {
  const html = `<html><head><title>Biology Reviewer</title></head><body>
    <h1>Biology Reviewer</h1><p>Everything for the midterm.</p>
    <h2>Cell parts</h2><ul><li>Nucleus stores DNA</li><li>Mitochondria make ATP</li></ul>
    <h2>Key terms</h2><p><b>Osmosis</b> — water moving across a membrane</p><p><b>ATP</b> — energy currency</p>
    <h2>Flashcards</h2><p>Q: Powerhouse of the cell?<br>A: Mitochondria</p>
    <h2>Quiz</h2><p>1. Which organelle makes ATP?</p><p>A) Nucleus</p><p>B) Mitochondria</p><p>Answer: B</p>
  </body></html>`
  const c = parseReviewerHtml(html)
  assert.ok(c)
  assert.equal(c.title, 'Biology Reviewer')
  assert.ok(c.sections.some(s => /Cell parts/.test(s.heading) && s.points.includes('Nucleus stores DNA')))
  assert.ok(c.terms.some(t => t.term === 'Osmosis'))
  assert.ok(c.flashcards.some(f => /Powerhouse/.test(f.q) && f.a === 'Mitochondria'))
  assert.ok(c.quiz.some(q => /organelle/.test(q.q) && q.choices[1] === 'Mitochondria' && q.answer === 1))
  assert.equal(looksLikeFinishedReviewer(c, 'Biology Reviewer.html', { html: true }), true)
})

test('import: plain text reviewer with Q/A and a quiz is read', () => {
  const text = `HRM Midterm Reviewer
Sections
- Recruitment is finding candidates
- Selection is choosing one
Key terms
Induction — the first days at work
Quiz
1. What is recruitment?
A) Finding candidates
B) Choosing one
Answer: A
`
  const c = parseReviewerText(text, 'HRM reviewer.txt')
  assert.ok(c)
  assert.ok(c.sections.some(s => s.points.length >= 2))
  assert.ok(c.terms.some(t => t.term === 'Induction'))
  assert.ok(c.quiz.length === 1 && c.quiz[0].answer === 0)
  assert.equal(looksLikeFinishedReviewer(c, 'HRM reviewer.txt'), true)
})

test('import: a reviewer whose data lives in JS arrays (S/T/C/Q) keeps all of it', () => {
  const html = `<html><head><title>Child Development</title></head><body><h1>ProfEd · Child Development</h1>
    <script>
    const S=["Foundations","Physical"];
    const T=[[0,"Growth and Development","Group 1",["Growth is measurable.","Development is a change in abilities."]],[1,"Motor Skills","Group 2",["Gross motor uses large muscles."]]];
    const C=[["Growth vs development","Growth is measurable; development is abilities",0],["Gross motor","Large muscles",1]];
    const Q=[["Which uses large muscles?","Gross motor","Fine motor","Both","Neither",1]];
    </script></body></html>`
  const c = parseReviewerHtml(html)
  assert.ok(c)
  assert.equal(c.title, 'ProfEd · Child Development')
  assert.equal(c.sections.length, 2)
  assert.equal(c.sections[0].points.length, 2)
  assert.equal(c.flashcards.length, 2)
  assert.equal(c.quiz.length, 1)
  assert.deepEqual(c.quiz[0].choices.slice().sort(), ['Both', 'Fine motor', 'Gross motor', 'Neither'].sort())
  assert.equal(c.quiz[0].choices[c.quiz[0].answer], 'Gross motor')
  assert.equal(looksLikeFinishedReviewer(c, 'Child Development.html', { html: true }), true)
})

test('import: a data-array reviewer with single quotes, trailing commas and comments is still read', () => {
  const html = `<html><head><title>Abbreviation Reviewer</title></head><body><h1>Abbreviation Reviewer</h1>
    <script>
    // study data
    const T=[
      [0,'Common Abbreviations','Group 1',['e.g. = for example','i.e. = that is',]],
      [1,'School Terms','Group 2',['GPA = grade point average',]],
    ];
    const C=[
      ['What does e.g. mean?','For example',0],
    ];
    const Q=[
      ['What does i.e. mean?','That is','For example','And so on','None',9],
    ];
    </script></body></html>`
  const c = parseReviewerHtml(html)
  assert.ok(c)
  assert.equal(c.title, 'Abbreviation Reviewer')
  assert.equal(c.sections.length, 2)
  assert.equal(c.sections[0].points.length, 2)
  assert.equal(c.flashcards.length, 1)
  assert.equal(c.quiz.length, 1)
  assert.equal(c.quiz[0].choices[c.quiz[0].answer], 'That is')
  assert.equal(looksLikeFinishedReviewer(c, 'Abbreviation Reviewer (from html).txt', { html: true }), true)
  assert.equal(looksLikeFinishedReviewer(c, 'abbrev.html', { html: true }), true)   // data arrays alone are enough
})

test('import: convertFile attaches the content to the converted HTML file', async () => {
  const html = `<h1>Biology Reviewer</h1><h2>Cell parts</h2><ul><li>Nucleus stores DNA</li><li>Mitochondria make ATP</li></ul>
    <h2>Quiz</h2><p>1. Which organelle makes ATP?</p><p>A) Nucleus</p><p>B) Mitochondria</p><p>Answer: B</p>`
  const out = await convertFile(new File([html], 'Biology Reviewer.html', { type: 'text/html' }))
  assert.equal(out.type, 'text/plain')
  assert.ok(out.importContent)
  assert.equal(out.importContent.quiz[0].choices[out.importContent.quiz[0].answer], 'Mitochondria')
})

test('import: a printed PDF reviewer keeps its topics (headings recovered from flat text)', () => {
  const text = `ProfEd Reviewer: Child Development
Comprehensive Study Guide
UNIT 1: FOUNDATIONS OF HUMAN GROWTH
Growth and Development
Growth is measurable change in the body; development is wider.
Development: changes in abilities, thinking and emotions.
Domains: physical, cognitive, emotional, social, moral.
Nature, Nurture, Heredity and Genes
Heredity: genetic information passed from parents to child, the blueprint for physical
development.
Environment: all external conditions and experiences.
UNIT 2: PHYSICAL AND MOTOR DEVELOPMENT
Gross and Fine Motor Development
Gross motor uses large muscles and whole-body movement.
Fine motor uses small muscles and precise hand movement.
ProfEd Reviewer: Child Development Page 2 of 5
ProfEd Reviewer: Child Development Page 3 of 5
ProfEd Reviewer: Child Development Page 4 of 5`
  const md = pdfToReviewerText(text)
  assert.match(md, /^# ProfEd Reviewer/)
  assert.match(md, /^## Growth and Development$/m)
  assert.doesNotMatch(md, /Page \d+ of/)
  const c = parseReviewerPdfText(text, 'ProfEd Reviewer - Child Development.pdf')
  assert.ok(c)
  assert.equal(c.title, 'ProfEd Reviewer: Child Development')
  assert.ok(c.sections.length >= 2)
  assert.ok(c.sections.some(s => /Growth and Development/.test(s.heading) && s.points.length >= 1))
  assert.ok(c.sections.flatMap(s => s.points).some(p => /blueprint for physical development/.test(p)))
})
test('import: a plain PDF of notes is not treated as a finished reviewer', () => {
  const text = `Lecture 3
The cell is the basic unit of life.
Mitochondria produce ATP.
The nucleus stores DNA.`
  assert.equal(parseReviewerPdfText(text, 'lecture 3 notes.pdf'), null)
})

test('import: ordinary notes are NOT treated as a finished reviewer', () => {
  const notes = `Lecture 3
- The cell is the basic unit of life.
- Mitochondria produce ATP.
- The nucleus stores DNA.
`
  const c = parseReviewerText(notes, 'lecture 3 notes.txt')
  assert.ok(c)
  assert.equal(looksLikeFinishedReviewer(c, 'lecture 3 notes.txt'), false)
  assert.match(htmlToReviewerText('<h2>Cell</h2><ul><li>DNA</li></ul>'), /## Cell/)
})
