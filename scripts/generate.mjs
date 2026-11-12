#!/usr/bin/env node
// Signal Run — profile README card generator.
// Fetches your GitHub data and writes animated SVG cards into ./assets,
// then refreshes the missions link line inside README.md.
// Usage:  GH_TOKEN=xxx GH_LOGIN=akidmahmud node scripts/generate.mjs
//         node scripts/generate.mjs --mock        (offline preview data)
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const LOGIN = process.env.GH_LOGIN || 'akidmahmud';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const MOCK = process.argv.includes('--mock');
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'assets');

// ---- Optional overrides (set as env vars in the workflow) -----------------
const CONFIG = {
  displayName: process.env.DISPLAY_NAME || '', // empty = your GitHub name
  bio: process.env.PILOT_BIO || '',            // empty = auto line from top language + latest repo
  missions: 6,
  powerUps: 5,
};

// ---- Theme ---------------------------------------------------------------
const C = {
  card: '#060912', panel: '#0a0f1d', border: '#1b2337',
  cyan: '#22d3ee', yellow: '#facc15', text: '#e8eef8', sub: '#8a95aa', dim: '#4a5468',
  ship: '#a855f7',
  cells: {
    NONE: '#131a2b', FIRST_QUARTILE: '#0e4429', SECOND_QUARTILE: '#006d32',
    THIRD_QUARTILE: '#26a641', FOURTH_QUARTILE: '#39d353',
  },
};
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const W = 840;

const LANG_ABBR = {
  TypeScript: 'TS', JavaScript: 'JS', PHP: 'php', Python: 'Py', 'Jupyter Notebook': 'Jn',
  HTML: 'H5', CSS: 'CSS', Dart: 'Dt', Java: 'Jv', Kotlin: 'Kt', Go: 'Go', Rust: 'Rs',
  'C++': 'C++', C: 'C', 'C#': 'C#', Shell: 'sh', Vue: 'V', Blade: 'Bl', Swift: 'Sw',
};

// ---- Helpers --------------------------------------------------------------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const trunc = (s = '', n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const lum = (hex) => {
  const h = (hex || '#888888').replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

function svg(h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" fill="none">
<defs>${defs}</defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="16" fill="${C.card}" stroke="${C.border}"/>
${body}
</svg>`;
}
const label = (x, y, t, color = C.cyan) =>
  `<text x="${x}" y="${y}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="2.2" fill="${color}">${esc(t.toUpperCase())}</text>`;

function langIcon(x, y, lang, color, size = 16) {
  const ab = LANG_ABBR[lang] || lang.slice(0, 2);
  const fg = lum(color) > 0.6 ? '#111' : '#fff';
  const fs = ab.length > 2 ? size * 0.42 : size * 0.5;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="3.5" fill="${color}"/>
<text x="${x + size / 2}" y="${y + size / 2 + fs * 0.36}" text-anchor="middle" font-family="${SANS}" font-size="${fs}" font-weight="800" fill="${fg}">${esc(ab)}</text>`;
}

// ---- Data -----------------------------------------------------------------
const QUERY = `query($login:String!){
  user(login:$login){
    name login bio avatarUrl(size:240)
    followers{ totalCount }
    allRepos: repositories(privacy:PUBLIC, ownerAffiliations:OWNER){ totalCount }
    repos: repositories(first:100, privacy:PUBLIC, ownerAffiliations:OWNER, isFork:false, orderBy:{field:PUSHED_AT, direction:DESC}){
      nodes{
        name description stargazerCount url pushedAt
        primaryLanguage{ name color }
        languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } }
      }
    }
    contributionsCollection{
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount contributionLevel } } }
    }
  }
}`;

async function fetchData() {
  if (!TOKEN) throw new Error('Set GH_TOKEN (or run with --mock).');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'signal-run' },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const u = json.data.user;
  let avatar = '';
  try {
    const img = await fetch(u.avatarUrl);
    const type = img.headers.get('content-type') || 'image/png';
    avatar = `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  } catch { /* falls back to a plain circle */ }
  return {
    name: u.name || u.login, login: u.login, bio: u.bio, avatar,
    followers: u.followers.totalCount, repoCount: u.allRepos.totalCount,
    repos: u.repos.nodes,
    weeks: u.contributionsCollection.contributionCalendar.weeks,
  };
}

function mockData() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
  const today = new Date('2026-11-12T00:00:00Z');
  const start = new Date(today); start.setUTCDate(start.getUTCDate() - 364 - today.getUTCDay());
  const weeks = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0) weeks.push({ contributionDays: [] });
    const recent = (today - d) / 864e5 < 190;
    const r = rnd(); const lv = recent ? (r < 0.25 ? 0 : r < 0.85 ? 1 : r < 0.95 ? 2 : 3) : (r < 0.8 ? 0 : 1);
    weeks.at(-1).contributionDays.push({ date: d.toISOString().slice(0, 10), contributionCount: lv * 2, contributionLevel: levels[lv] });
  }
  const L = (name, color) => ({ name, color });
  const PHP = L('PHP', '#4F5D95'), JN = L('Jupyter Notebook', '#DA5B0B'), TS = L('TypeScript', '#3178c6'), JS = L('JavaScript', '#f1e05a'), H = L('HTML', '#e34c26');
  const repo = (name, stars, lang, description, sizes) => ({
    name, stargazerCount: stars, primaryLanguage: lang, description, url: `https://github.com/${LOGIN}/${name}`,
    pushedAt: '2026-11-10', languages: { edges: sizes.map(([node, size]) => ({ node, size })) },
  });
  return {
    name: 'Mahmud', login: LOGIN, bio: '', avatar: '', followers: 4, repoCount: 55, weeks,
    repos: [
      repo('amadere-monorepo', 0, TS, '', [[TS, 140], [JS, 40]]),
      repo('Pearson-Specter-Litt-Legal-RAG-Legal-Document-Rag', 1, L('Python', '#3572A5'), '', [[JN, 300]]),
      repo('Real-Time-Face-Detection-and-Classification-Using-CNN-in-Colab', 1, JN, '', []),
      repo('ai-visibility-tracker', 0, TS, '', []),
      repo('PocketMoney', 0, TS, '', [[JS, 80]]),
      repo('shapla-infosys', 0, TS, 'A Static Compnay landing webpage build on nextjs', [[H, 50]]),
      repo('laravel-shop', 0, PHP, '', [[PHP, 310]]),
    ],
  };
}

function derive(d) {
  const days = d.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
  let i = days.length - 1;
  if (days[i] && days[i].contributionCount === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].contributionCount > 0) { current++; i--; }
  let best = 0, run = 0;
  for (const x of days) { run = x.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }
  const year = new Date().getUTCFullYear();
  const yearTotal = days.filter((x) => x.date.startsWith(String(year))).reduce((s, x) => s + x.contributionCount, 0);
  const stars = d.repos.reduce((s, r) => s + r.stargazerCount, 0);

  const langMap = new Map();
  for (const r of d.repos) for (const e of r.languages.edges) {
    const cur = langMap.get(e.node.name) || { name: e.node.name, color: e.node.color || '#8b949e', size: 0 };
    cur.size += e.size; langMap.set(e.node.name, cur);
  }
  const total = [...langMap.values()].reduce((s, l) => s + l.size, 0) || 1;
  const langs = [...langMap.values()].sort((a, b) => b.size - a.size).slice(0, CONFIG.powerUps)
    .map((l) => ({ ...l, pct: Math.round((l.size / total) * 100) }));

  const missions = [...d.repos].sort((a, b) => b.stargazerCount - a.stargazerCount || b.pushedAt.localeCompare(a.pushedAt)).slice(0, CONFIG.missions);
  const latest = d.repos[0]?.name;
  const bio = CONFIG.bio || d.bio || `${langs[0]?.name || 'Software'} developer.${latest ? ` Working on ${latest} right now.` : ''}`;
  return { ...d, name: CONFIG.displayName || d.name, days, current, best, year, yearTotal, stars, langs, missions, bio };
}

// ---- Cards ----------------------------------------------------------------
function heroCard(d) {
  const H = 330, gx = 28, gy = 62, gw = W - 56;
  const weeks = d.weeks.slice(-53);
  const gap = 3, cell = (gw - gap * (weeks.length - 1)) / weeks.length;
  const gh = 7 * cell + 6 * gap;
  const startX = gx - 50, endX = gx + gw + 60, dur = 14;
  let grid = '';
  weeks.forEach((w, ci) => {
    const x = gx + ci * (cell + gap);
    let base = '', busy = '';
    for (const day of w.contributionDays) {
      const y = gy + new Date(day.date + 'T00:00:00Z').getUTCDay() * (cell + gap);
      base += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2" fill="${C.cells.NONE}"/>`;
      if (day.contributionLevel !== 'NONE')
        busy += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2" fill="${C.cells[day.contributionLevel]}"/>`;
    }
    const p = Math.min(Math.max((x + cell / 2 - startX) / (endX - startX), 0.001), 0.97);
    grid += base;
    if (busy) grid += `<g>${busy}<animate attributeName="opacity" values="1;1;0.12;0.12" keyTimes="0;${p.toFixed(3)};${(p + 0.02).toFixed(3)};1" dur="${dur}s" repeatCount="indefinite"/></g>`;
  });
  const shipY = gy + 3 * (cell + gap) + cell / 2;
  const avatar = d.avatar
    ? `<image href="${d.avatar}" x="-4" y="-11" width="22" height="22" clip-path="url(#shipClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="7" cy="0" r="10" fill="${C.panel}"/>`;
  const ship = `<g>
  <animateTransform attributeName="transform" type="translate" values="${startX} ${shipY};${endX} ${shipY}" dur="${dur}s" repeatCount="indefinite"/>
  <line x1="-46" y1="-3" x2="-18" y2="-3" stroke="${C.cyan}" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
  <line x1="-40" y1="3" x2="-18" y2="3" stroke="${C.cyan}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
  <path d="M-16 0 L4 -15 Q26 -12 26 0 Q26 12 4 15 Z" fill="url(#shipGrad)" stroke="${C.cyan}" stroke-width="1.5"/>
  <circle cx="7" cy="0" r="11.5" fill="none" stroke="${C.cyan}" stroke-width="1.5"/>
  ${avatar}
</g>`;

  const sy = gy + gh + 24, bw = (gw - 36) / 4;
  const stats = [['Level', d.year], ['Streak', `${d.current} DAY${d.current === 1 ? '' : 'S'}`], ['Stars', d.stars], ['Followers', d.followers]]
    .map(([k, v], i) => {
      const x = gx + i * (bw + 12);
      return `<rect x="${x}" y="${sy}" width="${bw}" height="58" rx="10" fill="${C.panel}" stroke="${C.border}"/>
<text x="${x + 14}" y="${sy + 21}" font-family="${MONO}" font-size="9.5" letter-spacing="1.6" fill="${C.sub}">${k.toUpperCase()}</text>
<text x="${x + 14}" y="${sy + 45}" font-family="${SANS}" font-size="20" font-weight="800" fill="${C.text}">${esc(v)}</text>`;
    }).join('');

  const py = sy + 74;
  const pills = d.langs.slice(0, 4).map((l, i) => {
    const x = gx + 72 + i * 136;
    return `<rect x="${x}" y="${py}" width="124" height="26" rx="13" fill="${l.color}" fill-opacity="0.08" stroke="${l.color}" stroke-opacity="0.9"/>
${langIcon(x + 9, py + 5, l.name, l.color)}
<text x="${x + 32}" y="${py + 17}" font-family="${MONO}" font-size="10" font-weight="700" fill="${C.text}">${esc(trunc(l.name, 12))}</text>`;
  }).join('');

  const body = `${label(gx, 40, `Signal Run · @${d.login}`)}
<text x="${W - gx}" y="40" text-anchor="end" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1.5" fill="${C.yellow}">HI-SCORE ${d.yearTotal}</text>
${grid}${ship}${stats}
<text x="${gx}" y="${py + 17}" font-family="${MONO}" font-size="9.5" letter-spacing="1.4" fill="${C.sub}">POWER-UPS</text>
${pills}
<text x="${gx}" y="${H - 22}" font-family="${MONO}" font-size="9.5" fill="${C.dim}">the ship flies my real contribution grid and eats every busy day</text>
<text x="${W - gx}" y="${H - 22}" text-anchor="end" font-family="${MONO}" font-size="9.5" fill="${C.dim}">updated ${new Date().toISOString().slice(0, 10)}</text>`;
  const defs = `<linearGradient id="shipGrad" x1="0" x2="1"><stop offset="0" stop-color="${C.ship}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>
<clipPath id="shipClip"><circle cx="7" cy="0" r="10"/></clipPath>`;
  return svg(H, body, defs);
}

function pilotCard(d) {
  const H = 190, cx = W - 100, cy = H / 2, r = 54;
  const avatar = d.avatar
    ? `<image href="${d.avatar}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.panel}"/>`;
  const body = `${label(32, 46, 'Pilot')}
<text x="32" y="92" font-family="${SANS}" font-size="30" font-weight="800" fill="${C.text}">${esc(d.name)}</text>
<text x="32" y="124" font-family="${SANS}" font-size="15" fill="#c9d3e3">${esc(trunc(d.bio, 62))}</text>
<text x="32" y="160" font-family="${MONO}" font-size="11.5" fill="${C.sub}">${d.followers} followers · ${d.repoCount} repositories · ★ ${d.stars} stars</text>
${avatar}
<circle cx="${cx}" cy="${cy}" r="${r + 2}" stroke="${C.cyan}" stroke-width="4"/>`;
  return svg(H, body, `<clipPath id="av"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`);
}

function missionsCard(d) {
  const row = 40, H = 78 + d.missions.length * row;
  const rows = d.missions.map((m, i) => {
    const y = 66 + i * row;
    const lang = m.primaryLanguage || { name: '?', color: '#8b949e' };
    return `${i ? `<line x1="28" y1="${y}" x2="${W - 28}" y2="${y}" stroke="${C.border}"/>` : ''}
<text x="28" y="${y + 25}" font-family="${MONO}" font-size="10" fill="${C.sub}">${String(i + 1).padStart(2, '0')}</text>
${langIcon(58, y + 12, lang.name, lang.color)}
<text x="84" y="${y + 25}" font-family="${SANS}" font-size="13.5" font-weight="700" fill="${C.text}">${esc(trunc(m.name, 26))}</text>
<text x="300" y="${y + 25}" font-family="${SANS}" font-size="11.5" fill="${C.sub}">${esc(trunc(m.description || '', 52))}</text>
<text x="${W - 28}" y="${y + 25}" text-anchor="end" font-family="${MONO}" font-size="11" font-weight="700" fill="${C.cyan}">★ ${m.stargazerCount}</text>`;
  }).join('');
  return svg(H, `${label(28, 44, 'Missions · by stars')}${rows}`);
}

function powerUpsCard(d) {
  const row = 30, H = 80 + d.langs.length * row, bx = 210, bw = W - bx - 100;
  const max = Math.max(...d.langs.map((l) => l.pct), 1);
  const rows = d.langs.map((l, i) => {
    const y = 68 + i * row;
    return `${langIcon(28, y, l.name, l.color)}
<text x="54" y="${y + 12.5}" font-family="${SANS}" font-size="13" font-weight="700" fill="${C.text}">${esc(l.name)}</text>
<rect x="${bx}" y="${y + 3}" width="${bw}" height="11" rx="5.5" fill="#1a2132"/>
<rect x="${bx}" y="${y + 3}" width="${Math.max((l.pct / max) * bw, 8).toFixed(1)}" height="11" rx="5.5" fill="${l.color}"/>
<text x="${W - 28}" y="${y + 12.5}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.sub}">${l.pct}%</text>`;
  }).join('');
  return svg(H, `${label(28, 44, 'Power-ups')}${rows}`);
}

function flightLogCard(d) {
  const H = 200, gx = 28, gy = 64, cell = 12, gap = 3;
  const weeks = d.weeks.slice(-26);
  let grid = '';
  weeks.forEach((w, ci) => w.contributionDays.forEach((day) => {
    const x = gx + ci * (cell + gap), y = gy + new Date(day.date + 'T00:00:00Z').getUTCDay() * (cell + gap);
    grid += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${C.cells[day.contributionLevel]}"/>`;
  }));
  const sx = gx + 26 * (cell + gap) + 52;
  const stat = (y, k, v) => `<text x="${sx}" y="${y}" font-family="${MONO}" font-size="9.5" letter-spacing="1.6" fill="${C.sub}">${k}</text>
<text x="${sx}" y="${y + 22}" font-family="${SANS}" font-size="19" font-weight="800" fill="${C.text}">${esc(v)}</text>`;
  return svg(H, `${label(gx, 44, 'Flight log · 26 weeks')}${grid}
${stat(74, 'CURRENT RUN', `${d.current} day${d.current === 1 ? '' : 's'}`)}
${stat(118, 'BEST RUN', `${d.best} days`)}
${stat(162, 'SCORE THIS YEAR', d.yearTotal)}`);
}

// ---- README links line ----------------------------------------------------
async function updateReadme(d) {
  const file = path.join(ROOT, 'README.md');
  let md;
  try { md = await readFile(file, 'utf8'); } catch { return; }
  const links = d.missions.map((m) => `[${m.name}](${m.url})`).join(' · ');
  md = md.replace(/<!-- MISSIONS:START -->[\s\S]*?<!-- MISSIONS:END -->/, `<!-- MISSIONS:START -->\n\n${links}\n\n<!-- MISSIONS:END -->`);
  await writeFile(file, md);
}

// ---- Main -----------------------------------------------------------------
const data = derive(MOCK ? mockData() : await fetchData());
await mkdir(OUT, { recursive: true });
await Promise.all([
  writeFile(path.join(OUT, 'signal-run.svg'), heroCard(data)),
  writeFile(path.join(OUT, 'pilot.svg'), pilotCard(data)),
  writeFile(path.join(OUT, 'missions.svg'), missionsCard(data)),
  writeFile(path.join(OUT, 'power-ups.svg'), powerUpsCard(data)),
  writeFile(path.join(OUT, 'flight-log.svg'), flightLogCard(data)),
]);
await updateReadme(data);
console.log(`Cards written for @${data.login}: streak ${data.current}, best ${data.best}, score ${data.yearTotal}`);
