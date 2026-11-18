// Pure functions shared by the browser and the server (api/generate.js). No browser APIs here.
import { HTML_TEMPLATES } from './templates.generated.js'
import { cleanAids } from './aids.js'
import { normalizeDiagrams, diagramsHtml, autoDiagrams, topicIcon } from './illustrations.js'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const arr = x => (Array.isArray(x) ? x : [])
const str = (x, n = 2000) => String(x ?? '').slice(0, n)

export const THEMES = {
  indigo: { bg: '#f5f6fa', card: '#ffffff', ink: '#1f2740', mute: '#6f7995', acc: '#6c7bf0', line: '#e6e9f2' },
  forest: { bg: '#f2f6f3', card: '#ffffff', ink: '#1c2b22', mute: '#62786a', acc: '#2f9e6b', line: '#dfe9e2' },
  sunset: { bg: '#fbf4f1', card: '#ffffff', ink: '#33231f', mute: '#8a6c64', acc: '#e0663d', line: '#f0e1db' },
  slate:  { bg: '#14171f', card: '#1d212d', ink: '#e7eaf6', mute: '#8f98b8', acc: '#8b9bff', line: '#2a3047' },
}
// v64: every theme also has a dark twin. It is used when the student's app is in dark mode (the reader tells the page), so a reviewer never glares in a dark app.
const DARK_THEMES = {
  indigo: { bg: '#12151f', card: '#1a1e2c', ink: '#e7eaf6', mute: '#9aa3c2', acc: '#8794ff', line: '#2a3047' },
  forest: { bg: '#101713', card: '#18221c', ink: '#e3efe7', mute: '#92a99a', acc: '#4cc38a', line: '#26352b' },
  sunset: { bg: '#1a1411', card: '#241b17', ink: '#f4e8e2', mute: '#b39a90', acc: '#f08a63', line: '#3a2b24' },
  slate:  THEMES.slate,
}
for (const k of Object.keys(THEMES)) Object.defineProperty(THEMES[k], 'dark', { value: DARK_THEMES[k], enumerable: false })   // not enumerable: templates and tests that loop over a theme's colours see the same six keys as before

// Study aids (see aids.js). A key is only present when it has content, so reviewers made without aids stay exactly as before.
function normalizeExtras(c) {
  const out = {
    abbreviations: arr(c.abbreviations).slice(0, 30).map(a => ({ abbr: str(a?.abbr, 40), meaning: str(a?.meaning, 200), note: str(a?.note, 160) })).filter(a => a.abbr && a.meaning),
    mnemonics: arr(c.mnemonics).slice(0, 12).map(m => ({ topic: str(m?.topic, 140), trick: str(m?.trick, 240), explain: str(m?.explain, 400) })).filter(m => m.trick),
    keyFacts: arr(c.keyFacts).slice(0, 25).map(x => str(x, 300)).filter(Boolean),
    comparisons: arr(c.comparisons).slice(0, 4).map(t => {
      const headers = arr(t?.headers).slice(0, 4).map(h => str(h, 80))
      return { title: str(t?.title, 140), headers, rows: arr(t?.rows).slice(0, 10).map(r => headers.map((_, i) => str(arr(r)[i], 200))) }
    }).filter(t => t.headers.length >= 2 && t.rows.length),
    timeline: arr(c.timeline).slice(0, 20).map(t => ({ label: str(t?.label, 80), detail: str(t?.detail, 300) })).filter(t => t.label || t.detail),
    traps: arr(c.traps).slice(0, 10).map(t => ({ mistake: str(t?.mistake, 300), correct: str(t?.correct, 300) })).filter(t => t.mistake && t.correct),
    examples: arr(c.examples).slice(0, 8).map(e => ({ scenario: str(e?.scenario, 500), answer: str(e?.answer, 500) })).filter(e => e.scenario && e.answer),
    diagrams: normalizeDiagrams(c.diagrams),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.length))
}
const exArr = (c, k) => (Array.isArray(c[k]) ? c[k] : [])

// v75: pictures the student chose to keep in the reviewer are embedded as data URIs (no bucket, no expiring links).
// Only a real, base64 image is accepted, so a stored reviewer can never inject a script through this field.
const VISUAL_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/
export const MAX_VISUALS = 8

export function normalizeContent(raw, caps = {}) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const cap = (k, d) => (Number.isInteger(caps[k]) && caps[k] > 0 ? caps[k] : d)
  const base = {
    title: str(c.title, 160) || 'Untitled reviewer',
    summary: str(c.summary, 1500),
    sections: arr(c.sections).slice(0, cap('sections', 12)).map(s => ({ heading: str(s?.heading, 160), points: arr(s?.points).slice(0, cap('points', 14)).map(p => str(p, 500)) })),
    terms: arr(c.terms).slice(0, cap('terms', 25)).map(t => ({ term: str(t?.term, 120), definition: str(t?.definition, 400) })),
    flashcards: arr(c.flashcards).slice(0, cap('flashcards', 20)).map(f => ({ q: str(f?.q, 300), a: str(f?.a, 400) })),
    quiz: arr(c.quiz).slice(0, cap('quiz', 15)).map(q => {
      const choices = arr(q?.choices).slice(0, 4).map(x => str(x, 200))
      const answer = Number.isInteger(q?.answer) && q.answer >= 0 && q.answer < choices.length ? q.answer : 0
      return { q: str(q?.q, 300), choices, answer, why: str(q?.why, 400) }
    }).filter(q => q.choices.length >= 2),
    visuals: arr(c.visuals).slice(0, MAX_VISUALS).map(v => ({ name: str(v?.name, 120), url: str(v?.url, 500000) })).filter(v => VISUAL_URI.test(v.url)),
  }
  return { ...base, ...normalizeExtras(c) }
}
export const plainText = c => [c.title, c.summary, ...c.sections.flatMap(s => [s.heading, ...s.points]), ...c.terms.flatMap(t => [t.term, t.definition]), ...c.flashcards.flatMap(f => [f.q, f.a]),
  ...exArr(c, 'abbreviations').flatMap(a => [a.abbr, a.meaning]), ...exArr(c, 'mnemonics').flatMap(m => [m.topic, m.trick, m.explain]), ...exArr(c, 'keyFacts'),
  ...exArr(c, 'comparisons').flatMap(t => [t.title, ...t.headers, ...t.rows.flat()]), ...exArr(c, 'timeline').flatMap(t => [t.label, t.detail]),
  ...exArr(c, 'traps').flatMap(t => [t.mistake, t.correct]), ...exArr(c, 'examples').flatMap(e => [e.scenario, e.answer])].join(' ').replace(/\s+/g, ' ').trim()

// Shown in the template preview (students see their chosen template with this sample before they request anything)
export const SAMPLE_CONTENT = normalizeContent({
  title: 'Sample: The Cell',
  summary: 'Cells are the basic unit of life. This is only a preview of the layout; your reviewer is built from your own notes.',
  sections: [
    { heading: 'Cell basics', points: ['All living things are made of cells.', 'Cells come from existing cells.', 'Prokaryotes lack a nucleus; eukaryotes have one.'] },
    { heading: 'Organelles', points: ['Nucleus stores DNA.', 'Mitochondria produce ATP.', 'Ribosomes build proteins.'] },
    { heading: 'Membrane transport', points: ['Diffusion moves molecules down a gradient.', 'Osmosis is the diffusion of water.'] },
  ],
  terms: [{ term: 'Organelle', definition: 'A specialised structure inside a cell.' }, { term: 'ATP', definition: 'The main energy currency of the cell.' }, { term: 'Osmosis', definition: 'Diffusion of water across a membrane.' }],
  flashcards: [{ q: 'Powerhouse of the cell?', a: 'Mitochondria' }, { q: 'Where is DNA stored in eukaryotes?', a: 'In the nucleus' }, { q: 'What builds proteins?', a: 'Ribosomes' }, { q: 'Water moving across a membrane?', a: 'Osmosis' }],
  quiz: [
    { q: 'Which organelle produces most ATP?', choices: ['Nucleus', 'Mitochondria', 'Golgi body', 'Lysosome'], answer: 1, why: 'Mitochondria carry out cellular respiration.' },
    { q: 'Which cells have no nucleus?', choices: ['Plant cells', 'Animal cells', 'Prokaryotes', 'Fungal cells'], answer: 2, why: 'Prokaryotes lack a membrane-bound nucleus.' },
  ],
})

// Sample study aids, so the template preview can show them when the student ticks an aid
const SAMPLE_EXTRAS = normalizeExtras({
  abbreviations: [{ abbr: 'ATP', meaning: 'Adenosine triphosphate', note: 'Energy currency' }, { abbr: 'ER', meaning: 'Endoplasmic reticulum' }, { abbr: 'DNA', meaning: 'Deoxyribonucleic acid' }],
  mnemonics: [{ topic: 'Phases of mitosis', trick: 'PMAT', explain: 'Prophase, Metaphase, Anaphase, Telophase.' }],
  keyFacts: ['Mitochondria make most ATP.', 'Prokaryotes have no nucleus.', 'Osmosis is the diffusion of water.'],
  comparisons: [{ title: 'Prokaryote vs eukaryote', headers: ['Feature', 'Prokaryote', 'Eukaryote'], rows: [['Nucleus', 'No', 'Yes'], ['Size', 'Small', 'Larger'], ['Example', 'Bacteria', 'Plants, animals']] }],
  timeline: [{ label: '1665', detail: 'Hooke names the cell.' }, { label: '1838–39', detail: 'Schleiden and Schwann: all organisms are made of cells.' }, { label: '1855', detail: 'Virchow: cells come from existing cells.' }],
  traps: [{ mistake: 'Osmosis moves solutes across a membrane.', correct: 'Osmosis is the movement of water.' }],
  examples: [{ scenario: 'A cell sits in very salty water and shrinks. Why?', answer: 'Water leaves the cell by osmosis toward the saltier side.' }],
})
export const sampleFor = aids => { const out = { ...SAMPLE_CONTENT }; for (const k of cleanAids(aids)) if (SAMPLE_EXTRAS[k]) out[k] = SAMPLE_EXTRAS[k]; return out }

// ---------- shared HTML pieces ----------
const sectionsHtml = c => c.sections.map(s => `<section class="card" data-rv><h2>${esc(s.heading)}</h2><ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></section>`).join('')
const summaryHtml = c => (c.summary ? `<p class="sum">${esc(c.summary)}</p>` : '')
const termsHtml = c => (c.terms.length ? `<section class="card" data-rv><h2>Key terms</h2><dl>${c.terms.map(t => `<dt>${esc(t.term)}</dt><dd>${esc(t.definition)}</dd>`).join('')}</dl></section>` : '')
const cardsHtml = c => (c.flashcards.length ? `<h2 class="h">Flashcards <small>tap to flip</small></h2><div class="fcs">${c.flashcards.map(f => `<button class="fc"><span class="f">${esc(f.q)}</span><span class="b">${esc(f.a)}</span></button>`).join('')}</div>` : '')
const quizHtml = c => (c.quiz.length ? `<h2 class="h">Quiz <small id="sc"></small></h2>${c.quiz.map((q, i) => `<div class="card q" data-a="${q.answer}"><p><b>${i + 1}. ${esc(q.q)}</b></p>${q.choices.map((x, j) => `<button data-j="${j}">${esc(x)}</button>`).join('')}<p class="why" hidden>${esc(q.why)}</p></div>`).join('')}` : '')
const headerHtml = c => `<header><h1>${esc(c.title)}</h1>${summaryHtml(c)}</header>`
const abbrHtml = c => (exArr(c, 'abbreviations').length ? `<section class="card ex" data-rv data-rv><h2>Abbreviations</h2><div class="abbr">${c.abbreviations.map(a => `<div class="ab"><b>${esc(a.abbr)}</b><span>${esc(a.meaning)}${a.note ? `<small>${esc(a.note)}</small>` : ''}</span></div>`).join('')}</div></section>` : '')
const mnemHtml = c => (exArr(c, 'mnemonics').length ? `<section class="card ex" data-rv data-rv><h2>Memory tricks</h2>${c.mnemonics.map(m => `<div class="mn">${m.topic ? `<small>${esc(m.topic)}</small>` : ''}<p class="trick">${esc(m.trick)}</p>${m.explain ? `<p class="mnx">${esc(m.explain)}</p>` : ''}</div>`).join('')}</section>` : '')
const factsHtml = c => (exArr(c, 'keyFacts').length ? `<section class="card ex kf" data-rv data-rv><h2>Must-know facts</h2><ul>${c.keyFacts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>` : '')
const compareHtml = c => exArr(c, 'comparisons').map(t => `<section class="card ex" data-rv data-rv><h2>${esc(t.title || 'Compare')}</h2><div class="tbl"><table><thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('')
const timelineHtml = c => (exArr(c, 'timeline').length ? `<section class="card ex" data-rv data-rv><h2>Timeline</h2><ol class="tlx">${c.timeline.map(t => `<li><b>${esc(t.label)}</b><span>${esc(t.detail)}</span></li>`).join('')}</ol></section>` : '')
const trapsHtml = c => (exArr(c, 'traps').length ? `<section class="card ex" data-rv data-rv><h2>Common mistakes</h2>${c.traps.map(t => `<div class="trap"><p class="bad"><em>Mistake</em>${esc(t.mistake)}</p><p class="good"><em>Correct</em>${esc(t.correct)}</p></div>`).join('')}</section>` : '')
const examplesHtml = c => (exArr(c, 'examples').length ? `<section class="card ex" data-rv data-rv><h2>Apply it</h2>${c.examples.map(e => `<div class="exm"><p><b>${esc(e.scenario)}</b></p><p class="ans">${esc(e.answer)}</p></div>`).join('')}</section>` : '')
const extrasHtml = (c, t) => `${diagramsHtml(c, t)}${factsHtml(c)}${abbrHtml(c)}${mnemHtml(c)}${compareHtml(c)}${timelineHtml(c)}${trapsHtml(c)}${examplesHtml(c)}`
const extrasNoDgHtml = c => `${factsHtml(c)}${abbrHtml(c)}${mnemHtml(c)}${compareHtml(c)}${timelineHtml(c)}${trapsHtml(c)}${examplesHtml(c)}`
const EXTRA_KEYS = ['diagrams', 'abbreviations', 'mnemonics', 'keyFacts', 'comparisons', 'timeline', 'traps', 'examples']
const hasExtras = c => EXTRA_KEYS.some(k => exArr(c, k).length)

const SCRIPT = `(function(){var d=document,H=d.documentElement,P=window.parent!==window?window.parent:null;
function post(m){m.rv=1;try{if(P)P.postMessage(m,'*')}catch(e){}}
d.body.classList.add('js');
d.querySelectorAll('a[href^="#"]').forEach(function(a){a.onclick=function(ev){var t=d.getElementById(a.getAttribute('href').slice(1));if(t){ev.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'})}}});
d.querySelectorAll('.tabs [data-tab]').forEach(function(b){b.onclick=function(){var k=b.dataset.tab;d.querySelectorAll('.tabs [data-tab]').forEach(function(x){x.classList.toggle('on',x===b)});d.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('on',p.dataset.pane===k)});window.scrollTo({top:0})}});
var reads=[].slice.call(d.querySelectorAll('[data-rv]'));if(!reads.length)reads=[].slice.call(d.querySelectorAll('h2'));
var fcs=[].slice.call(d.querySelectorAll('.fc')),qs=[].slice.call(d.querySelectorAll('.q')),keys={},done={},tm={},st=null,total=0;
function reg(list,pre){list.forEach(function(e,i){var k=pre+i;e.setAttribute('data-uk',k);keys[k]=1;total++})}
reg(reads,'r');reg(fcs,'f');reg(qs,'q');
function send(){clearTimeout(st);st=setTimeout(function(){post({type:'progress',done:Object.keys(done),total:total})},120)}
function mark(k){if(!keys[k]||done[k])return;done[k]=1;send()}
fcs.forEach(function(e){e.onclick=function(){e.classList.toggle('on');mark(e.getAttribute('data-uk'))}});
qs.forEach(function(q){q.querySelectorAll('button').forEach(function(b){b.onclick=function(){var a=+q.dataset.a;q.querySelectorAll('button').forEach(function(x){x.disabled=true;if(+x.dataset.j===a)x.classList.add('ok')});if(+b.dataset.j!==a)b.classList.add('no');else q.dataset.right=1;q.dataset.done=1;q.querySelector('.why').hidden=false;mark(q.getAttribute('data-uk'));var s=d.getElementById('sc');if(s){s.textContent=d.querySelectorAll('.q[data-done]').length+'/'+d.querySelectorAll('.q').length+' answered, '+d.querySelectorAll('.q[data-right]').length+' correct'}}})});
if(window.IntersectionObserver){var io=new IntersectionObserver(function(es){es.forEach(function(en){var k=en.target.getAttribute('data-uk'),ok=en.isIntersecting&&(en.intersectionRatio>=.5||en.intersectionRect.height>=window.innerHeight*.45);
if(ok&&!tm[k]&&!done[k])tm[k]=setTimeout(function(){mark(k)},1200);else if(!ok&&tm[k]){clearTimeout(tm[k]);delete tm[k]}})},{threshold:[0,.25,.5,.75,1]});reads.forEach(function(e){io.observe(e)})}
function setDark(x){H.setAttribute('data-mode',x?'dark':'light')}
var oks=[],whys=[];
window.addEventListener('beforeprint',function(){qs.forEach(function(q){if(q.dataset.done)return;var a=q.querySelector('button[data-j="'+q.dataset.a+'"]');if(a){a.classList.add('ok');oks.push(a)}var w=q.querySelector('.why');if(w&&w.hidden){w.hidden=false;whys.push(w)}})});
window.addEventListener('afterprint',function(){oks.forEach(function(x){x.classList.remove('ok')});whys.forEach(function(x){x.hidden=true});oks=[];whys=[]});
window.addEventListener('message',function(e){var m=e.data;if(!m||m.rv!==1||e.source!==P)return;
if(m.type==='init'){setDark(m.dark);(m.done||[]).forEach(function(k){if(keys[k])done[k]=1});send()}
else if(m.type==='theme')setDark(m.dark);else if(m.type==='print')window.print()});
post({type:'ready',total:total});send()})()`
const scriptTag = `<script>${SCRIPT}</script>`

const darkVars = t => { const k = t.dark || t; return `html[data-mode=dark]{color-scheme:dark;--bg:${k.bg};--card:${k.card};--ink:${k.ink};--mute:${k.mute};--acc:${k.acc};--line:${k.line}}` }
const styleTag = t => `<style>:root{--bg:${t.bg};--card:${t.card};--ink:${t.ink};--mute:${t.mute};--acc:${t.acc};--line:${t.line}}${darkVars(t)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:28px 18px}
.wrap{max-width:860px;margin:auto}header{margin-bottom:22px}h1{margin:0 0 8px;font-size:30px;line-height:1.2}.sum{color:var(--mute);margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:14px}.card h2{margin:0 0 8px;font-size:19px;color:var(--acc)}ul{margin:0;padding-left:20px}li{margin:4px 0}
dt{font-weight:700;margin-top:10px}dd{margin:2px 0 0;color:var(--mute)}.two{display:grid;grid-template-columns:2fr 1fr;gap:14px;align-items:start}aside{position:sticky;top:12px}
.h{margin:26px 0 10px;font-size:21px}.h small{color:var(--mute);font-weight:400;font-size:13px}.fcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.fc{position:relative;min-height:110px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:14px;padding:16px;font:inherit;cursor:pointer;text-align:left}.fc .b{display:none;color:var(--acc);font-weight:600}.fc.on .f{display:none}.fc.on .b{display:block}.fc.on{background:var(--bg)}
.q button{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;margin:6px 0;padding:10px 12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;font:inherit;cursor:pointer}.q button.ok{border-color:#2f9e6b;background:rgba(47,158,107,.15)}.q button.no{border-color:#d9566a;background:rgba(217,86,106,.15)}.q button.ok:after{content:'\\2713';font-weight:800;color:#2f9e6b}.q button.no:after{content:'\\2715';font-weight:800;color:#d9566a}.why{color:var(--mute);margin:8px 0 0}

.ex{scroll-margin-top:70px}.abbr{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}.ab{display:flex;gap:10px;align-items:baseline;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg)}.ab b{color:var(--acc);min-width:44px}.ab small{display:block;color:var(--mute)}
.mn{padding:10px 12px;border-left:4px solid var(--acc);background:var(--bg);border-radius:0 10px 10px 0;margin:8px 0}.mn small{color:var(--mute);font-weight:700}.trick{margin:2px 0;font-size:19px;font-weight:800;color:var(--acc)}.mnx{margin:0;color:var(--mute)}
.kf li::marker{color:var(--acc)}.tbl{overflow-x:auto}.tbl table{border-collapse:collapse;width:100%;min-width:320px}.tbl th{text-align:left;background:var(--bg);color:var(--acc);font-size:14px}.tbl th,.tbl td{border:1px solid var(--line);padding:7px 10px;vertical-align:top}
.tlx{list-style:none;margin:0;padding:0 0 0 18px;border-left:3px solid var(--line)}.tlx li{position:relative;margin:0 0 12px;padding-left:14px}.tlx li:before{content:"";position:absolute;left:-26px;top:.5em;width:11px;height:11px;border-radius:50%;background:var(--acc)}.tlx b{display:block;color:var(--acc)}.tlx span{color:var(--ink)}
.trap{margin:8px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden}.trap p{margin:0;padding:8px 12px}.trap em{font-style:normal;font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;display:block}.trap .bad{background:rgba(217,86,106,.12)}.trap .bad em{color:#d9566a}.trap .good{background:rgba(47,158,107,.12)}.trap .good em{color:#2f9e6b}
.exm{margin:8px 0;padding:10px 12px;background:var(--bg);border-radius:10px}.exm p{margin:0}.exm .ans{color:var(--mute);margin-top:4px}
.dgwrap{margin:12px 0;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden}.dgwrap figcaption{font-weight:800;color:var(--acc);margin:0 0 9px;font-size:15px}.dgwrap svg{display:block;width:100%;height:auto}
.dg-cycle{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}.dg-cycle li{display:flex;gap:9px;align-items:baseline}.dg-cycle b{flex:none;width:22px;height:22px;border-radius:50%;background:color-mix(in srgb,var(--acc) 14%,var(--card));color:var(--acc);display:grid;place-items:center;font-size:12px}
.dgtl{list-style:none;margin:0;padding:0 0 0 6px;border-left:3px solid var(--line)}.dgtl li{position:relative;padding:2px 0 14px 18px}.dgtl li:before{content:"";position:absolute;left:-10px;top:4px;width:15px;height:15px;border-radius:50%;background:hsl(var(--h) 68% 56%);border:3px solid var(--card)}.dgtl b{display:block;color:var(--ink)}.dgtl span{color:var(--mute);font-size:.95em}.dgs{border-top:3px solid hsl(var(--h,235) 68% 56%)}.dgs b{background:hsl(var(--h,235) 68% 56%);color:#fff;border-radius:10px;padding:2px 9px;display:inline-block;min-width:34px;text-align:center}
.dgcmp{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch}.dgc{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--bg)}.dgc.c0{border-top:4px solid var(--acc)}.dgc.c1{border-top:4px solid var(--line)}.dgc h4{margin:0 0 6px;font-size:15px;color:var(--ink)}.dgc ul{margin:0;padding-left:18px}.dgc li{margin:3px 0}.dgvs{align-self:center;font-weight:800;font-size:12px;color:var(--mute)}@media(max-width:560px){.dgcmp{grid-template-columns:1fr}.dgvs{justify-self:center}}.dgwrap svg{width:100%;height:auto;display:block}
.dgsym{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}.dgsym .dgs{display:flex;gap:10px;align-items:baseline;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--bg)}.dgsym b{color:var(--acc);font-size:17px;min-width:26px}.dgsym span{color:var(--ink);font-size:14px}
.tabs{display:flex;gap:6px;overflow-x:auto;position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0 10px;margin:0 0 8px;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:none;border:1px solid var(--line);background:var(--card);color:var(--mute);border-radius:999px;padding:8px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.tabs button small{opacity:.7;margin-left:2px}.tabs button.on{background:var(--acc);border-color:var(--acc);color:#fff}
.js .pane{display:none}.js .pane.on{display:block}.pane>.h:first-child{margin-top:4px}#sc{color:var(--mute);font-weight:600}
@media(max-width:640px){.two{grid-template-columns:1fr}aside{position:static}h1{font-size:25px}}
@media print{:root,html[data-mode]{--bg:#fff;--card:#fff;--ink:#111;--mute:#555;--line:#ccc}body{padding:0!important;background:#fff!important;color:#111!important}.tabs{display:none!important}.js .pane{display:block!important}.card,.fc,.q,.term,.note{break-inside:avoid;box-shadow:none!important}.fc .f,.fc .b{display:block!important}.fc .b{border-top:1px dashed #999;margin-top:6px;padding-top:6px}.q button{background:#fff!important}.q button:not(.ok){opacity:.85}}</style>`

// ---------- tabs: one thing on screen at a time (without scripts, e.g. thumbnails, every pane simply shows) ----------
const tabbed = items => { const l = items.filter(i => i.html); return `<div class=\"tabs\" role=\"tablist\">${l.map((i, n) => `<button type=\"button\" data-tab=\"${i.k}\" class=\"${n === 0 ? 'on' : ''}\">${i.label}${i.n ? ` <small>${i.n}</small>` : ''}</button>`).join('')}</div>${l.map((i, n) => `<div class=\"pane${n === 0 ? ' on' : ''}\" data-pane=\"${i.k}\">${i.html}</div>`).join('')}` }
const tabItems = (c, p) => ({ notes: { k: 'notes', label: 'Notes', n: c.sections.length, html: p.sections }, terms: { k: 'terms', label: 'Terms', n: c.terms.length, html: p.terms }, aids: { k: 'aids', label: 'Study aids', html: hasExtras(c) ? p.extras : '' }, cards: { k: 'cards', label: 'Flashcards', n: c.flashcards.length, html: p.cards }, quiz: { k: 'quiz', label: 'Quiz', n: c.quiz.length, html: p.quiz } })

// ---------- built-in templates ----------
const BUILTIN = {
  classic: { label: 'Classic', description: 'Simple tabs: Notes, Terms, Flashcards, Quiz. One thing on screen at a time.', body: (p, c) => { const t = tabItems(c, p); return `${p.head}${tabbed([t.notes, t.terms, t.aids, t.cards, t.quiz])}` } },
  guide: { label: 'Study guide', description: 'Notes with key terms pinned beside them, then flashcards and quiz in tabs.', body: (p, c) => { const t = tabItems(c, p); return `${p.head}${tabbed([{ ...t.notes, html: `<div class=\"two\"><main>${p.sections}</main><aside>${p.terms}</aside></div>` }, t.aids, t.cards, t.quiz])}` } },
  cards: { label: 'Flashcards first', description: 'Opens on flashcards and the quiz, notes one tap away.', body: (p, c) => { const t = tabItems(c, p); return `${p.head}${tabbed([t.cards, t.quiz, t.notes, t.terms, t.aids])}` } },
}

// ---------- custom HTML templates (a tiny logic-less "mustache" so a designer can drop in a file) ----------
//  {{title}} {{summary}} {{theme.acc}}      escaped values
//  {{#sections}}..{{heading}}..{{#points}}{{.}}{{/points}}..{{/sections}}   loops (also terms, flashcards, quiz, quiz choices)
//  {{@index}} {{@number}}                    0-based / 1-based position inside a loop
//  {{^terms}}No terms{{/terms}}              shown when empty
//  {{>header}} {{>sections}} {{>terms}} {{>flashcards}} {{>quiz}} {{>style}} {{>script}}   ready-made blocks
function parseTpl(tpl) {
  const re = /\{\{\{?\s*([#^\/>]?)\s*([^}\s]+)\s*\}?\}\}/g
  const root = { kids: [] }, stack = [root]
  let last = 0, m
  while ((m = re.exec(tpl))) {
    const top = stack[stack.length - 1]
    if (m.index > last) top.kids.push({ t: 'text', v: tpl.slice(last, m.index) })
    last = re.lastIndex
    const [, kind, key] = m
    if (kind === '#' || kind === '^') { const n = { t: kind, k: key, kids: [] }; top.kids.push(n); stack.push(n) }
    else if (kind === '/') { if (stack.length > 1) stack.pop() }
    else if (kind === '>') top.kids.push({ t: '>', k: key })
    else top.kids.push({ t: 'v', k: key })
  }
  if (last < tpl.length) stack[stack.length - 1].kids.push({ t: 'text', v: tpl.slice(last) })
  return root
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj)
function lookup(key, scopes) {
  if (key === '.') return scopes[scopes.length - 1].value
  if (key.startsWith('@')) { const m = scopes[scopes.length - 1].meta || {}; return key === '@index' ? m.index : key === '@number' ? m.index + 1 : undefined }
  for (let i = scopes.length - 1; i >= 0; i--) {
    const v = scopes[i].value
    if (v && typeof v === 'object') { const r = getPath(v, key); if (r !== undefined) return r }
  }
  return undefined
}
const truthy = v => (Array.isArray(v) ? v.length > 0 : !!v)
function renderNodes(nodes, scopes, partials) {
  let out = ''
  for (const n of nodes) {
    if (n.t === 'text') out += n.v
    else if (n.t === 'v') { const v = lookup(n.k, scopes); out += typeof v === 'string' || typeof v === 'number' ? esc(v) : '' }
    else if (n.t === '>') out += partials[n.k] ?? ''
    else if (n.t === '^') { if (!truthy(lookup(n.k, scopes))) out += renderNodes(n.kids, scopes, partials) }
    else if (n.t === '#') {
      const v = lookup(n.k, scopes)
      if (Array.isArray(v)) v.forEach((item, index) => { out += renderNodes(n.kids, [...scopes, { value: item, meta: { index } }], partials) })
      else if (truthy(v)) out += renderNodes(n.kids, [...scopes, { value: v, meta: {} }], partials)
    }
  }
  return out
}
export function renderHtmlTemplate(tpl, c, t) {
  const partials = { header: headerHtml(c), sections: sectionsHtml(c), terms: termsHtml(c), flashcards: cardsHtml(c), quiz: quizHtml(c), style: styleTag(t), script: scriptTag,
    extras: extrasHtml(c, t), extrasNoDg: extrasNoDgHtml(c), printExtras: extrasHtml(c, t).replace(/ data-rv/g, ''), diagrams: diagramsHtml(c, t), dgFirst: diagramsHtml({ diagrams: exArr(c, 'diagrams').slice(0, 1) }, t), dgRest: diagramsHtml({ diagrams: exArr(c, 'diagrams').slice(1) }, t), abbreviations: abbrHtml(c), mnemonics: mnemHtml(c), keyfacts: factsHtml(c), keyFacts: factsHtml(c), comparisons: compareHtml(c), timeline: timelineHtml(c), traps: trapsHtml(c), examples: examplesHtml(c) }
  const has = { dgRest: exArr(c, 'diagrams').length > 1, extras: hasExtras(c), moreExtras: EXTRA_KEYS.some(k => k !== 'diagrams' && exArr(c, k).length), visuals: c.visuals.length > 0, strip: c.visuals.length > 0, ...Object.fromEntries(EXTRA_KEYS.map(k => [k, exArr(c, k).length > 0])) }
  const ctx = { ...c, sections: c.sections.map((s, i) => ({ ...s, ic: topicIcon(s.heading), hue: (i * 53 + 235) % 360 })), strip: c.visuals.slice(0, 4), theme: t, hasSummary: !!c.summary, has }
  const clean = tpl.replace(/^\s*<!--\s*label:[\s\S]*?-->\s*/i, '')   // the label/description line is for the picker only
  let html = renderNodes(parseTpl(clean).kids, [{ value: ctx, meta: {} }], partials)
  // a template that never mentions the study aids still shows them (before </body>), so a student's choice is never silently dropped
  if (hasExtras(c) && !/\{\{[#^>]?\s*(extras|diagrams|abbreviations|mnemonics|keyfacts|comparisons|timeline|traps|examples)\b/i.test(tpl)) {
    const block = `<div class="wrap">${extrasHtml(c, t)}</div>`
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${block}</body>`) : html + block
  }
  if (!/\{\{\s*>\s*script/.test(tpl)) html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${scriptTag}</body>`) : html + scriptTag   // v64: the script is always there (dark mode, progress bar, print and the Challenge all talk through it), even if the template forgot it
  return html
}

// ---------- public API ----------
export const TEMPLATE_INFO = {
  ...Object.fromEntries(Object.entries(BUILTIN).map(([k, v]) => [k, { label: v.label, description: v.description, custom: false }])),
  ...Object.fromEntries(Object.entries(HTML_TEMPLATES).map(([k, v]) => [k, { label: v.label, description: v.description, custom: true }])),
}
export const TEMPLATES = Object.fromEntries(Object.entries(TEMPLATE_INFO).map(([k, v]) => [k, v.label]))   // id -> label (kept for older code)

// Marks the page dark before it is drawn (needed for previews that run no script). The reader also flips it live through a message.
export const withDarkMode = html => (/<html[\s>]/i.test(html) ? html.replace(/<html(?![^>]*data-mode)/i, '<html data-mode="dark"') : html)

export function renderReviewer(content, template = 'studyflow', theme = 'indigo', opts = {}) {
  const out = renderReviewerBase(content, template, theme)
  return opts && opts.dark ? withDarkMode(out) : out
}
// Rendering must never cut content that is already stored: a finished reviewer can be imported (or merged) with more
// sections than the AI generation caps allow. Cleaning still happens in normalizeContent; only the limits are wider.
export const FULL_CAPS = { sections: 60, points: 40, terms: 100, flashcards: 100, quiz: 80 }
function renderReviewerBase(content, template, theme) {
  let c = normalizeContent(content, FULL_CAPS)
  // v77: always give the reviewer a drawn overview (see autoDiagrams)
  if (!exArr(c, 'diagrams').some(d => d.kind === 'map')) c = { ...c, diagrams: [...autoDiagrams(c), ...exArr(c, 'diagrams')] }
  const t = THEMES[theme] || THEMES.indigo
  const custom = Object.prototype.hasOwnProperty.call(HTML_TEMPLATES, template) ? HTML_TEMPLATES[template] : null
  if (custom) return renderHtmlTemplate(custom.html, c, t)
  const b = Object.prototype.hasOwnProperty.call(BUILTIN, template) ? BUILTIN[template] : BUILTIN.classic
  const body = b.body({ head: headerHtml(c), sections: sectionsHtml(c), terms: termsHtml(c), extras: extrasHtml(c, t), cards: cardsHtml(c), quiz: quizHtml(c) }, c)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title>${styleTag(t)}</head><body><div class="wrap">${body}</div>${scriptTag}</body></html>`
}
