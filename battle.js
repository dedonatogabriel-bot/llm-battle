// ═══════════════════════════════════════════════════════
//  LLM BATTLE — battle.js
//  Corre cada lunes via GitHub Actions.
//  Genera prompt → todos responden → todos evalúan a todos
//  → scoring matemático puro → Google Sheets + HTML con gráficas
// ═══════════════════════════════════════════════════════

import fs from 'fs';

// ── Configuración de modelos ──────────────────────────
const MODELS = [
  { id: 'claude',   name: 'Claude',   version: 'claude-opus-4-5',        enabled: !!process.env.ANTHROPIC_KEY, call: callClaude   },
  { id: 'gpt4o',    name: 'GPT-4o',   version: 'gpt-4o',                 enabled: !!process.env.OPENAI_KEY,    call: callOpenAI   },
  { id: 'gemini',   name: 'Gemini',   version: 'gemini-2.0-flash',       enabled: !!process.env.GEMINI_KEY,    call: callGemini   },
  { id: 'grok',     name: 'Grok',     version: 'grok-2',                 enabled: !!process.env.GROK_KEY,      call: callGrok     },
  { id: 'kimi',     name: 'Kimi',     version: 'moonshot-v1-8k',         enabled: !!process.env.KIMI_KEY,      call: callKimi     },
  { id: 'deepseek', name: 'DeepSeek', version: 'deepseek-chat',          enabled: !!process.env.DEEPSEEK_KEY,  call: callDeepSeek },
  { id: 'mistral',  name: 'Mistral',  version: 'mistral-large-latest',   enabled: !!process.env.MISTRAL_KEY,   call: callMistral  },
  { id: 'cohere',   name: 'Cohere',   version: 'command-r-plus',         enabled: !!process.env.COHERE_KEY,    call: callCohere   },
  { id: 'groq',     name: 'Groq',     version: 'llama-3.3-70b-versatile',enabled: !!process.env.GROQ_KEY,      call: callGroq     },
];

const ACTIVE = MODELS.filter(m => m.enabled);
console.log(`\n⚡ Modelos activos: ${ACTIVE.map(m => m.name).join(', ')}\n`);

const DIMS = ['claridad', 'profundidad', 'originalidad', 'concision'];
const DIM_LABELS = { claridad: 'Claridad', profundidad: 'Profundidad', originalidad: 'Originalidad', concision: 'Concisión' };

// ═══════════════════════════════════════════════════════
//  1. PROMPT SEMANAL (rotatorio, sin API)
// ═══════════════════════════════════════════════════════
async function generateWeeklyPrompt() {
  const PROMPTS = [
    '¿En qué momento una mentira piadosa deja de ser un acto de cuidado y se convierte en una forma de control?',
    '¿Puede existir progreso genuino sin pérdida, o toda mejora implica necesariamente que algo valioso desaparece?',
    'Si la consciencia es solo el resultado de procesos físicos, ¿tiene sentido hablar de libre albedrío, o es una ilusión útil?',
    '¿Qué dice más de una sociedad: cómo trata a sus criminales o cómo trata a sus genios?',
    '¿Es posible ser completamente honesto con otra persona sin ser, en alguna medida, cruel?',
    'Si pudieras eliminar el aburrimiento de la experiencia humana, ¿deberías hacerlo?',
    '¿Cuál es la diferencia entre adaptarse y rendirse?',
    '¿En qué se parece diseñar una ciudad a diseñar una mente?',
    '¿Puede una inteligencia artificial tener intuición, o solo puede simularla?',
    '¿Qué hace que una disculpa sea genuina, y por qué a veces preferimos no recibirlas?',
    '¿Tiene sentido hablar de identidad personal si cada célula de tu cuerpo se reemplaza con el tiempo?',
    '¿Qué es más valioso: una vida larga y ordinaria, o una vida corta e intensa?',
  ];
  const now = new Date();
  const week = Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
  const prompt = PROMPTS[week % PROMPTS.length];
  console.log(`   Prompt: "${prompt.slice(0, 80)}..."\n`);
  return prompt;
}

// ═══════════════════════════════════════════════════════
//  2. RESPUESTAS
// ═══════════════════════════════════════════════════════
async function getAllResponses(prompt) {
  console.log('🤖 Consultando modelos en paralelo...');
  const results = await Promise.allSettled(
    ACTIVE.map(async m => {
      try {
        const text = await m.call(prompt);
        console.log(`   ✓ ${m.name}`);
        return { id: m.id, name: m.name, version: m.version, text, error: null };
      } catch (e) {
        console.log(`   ✗ ${m.name}: ${e.message}`);
        return { id: m.id, name: m.name, version: m.version, text: null, error: e.message };
      }
    })
  );
  return results.map(r => r.value || r.reason);
}

// ═══════════════════════════════════════════════════════
//  3. SCORING CRUZADO
// ═══════════════════════════════════════════════════════
async function crossScore(prompt, responses) {
  console.log('\n📊 Scoring cruzado...');
  const successful = responses.filter(r => r.text);
  if (successful.length < 2) {
    console.log('   Menos de 2 respuestas exitosas, no hay scoring cruzado.');
    return {};
  }
  const scores = {};
  const evalJobs = successful.map(async evaluator => {
    const others = successful.filter(r => r.id !== evaluator.id);
    if (others.length === 0) return;
    const responsesBlock = others.map(r => `[${r.name}]:\n${r.text}`).join('\n\n---\n\n');
    const evalPrompt = `Se le hizo esta pregunta a varios modelos de IA:

PREGUNTA: "${prompt}"

RESPUESTAS A EVALUAR:
${responsesBlock}

Evaluá cada respuesta en estas 4 dimensiones, con un número entero del 1 al 10:
- claridad: qué tan clara y comprensible es
- profundidad: profundidad del razonamiento
- originalidad: perspectiva no genérica ni obvia
- concision: concisa sin perder sustancia

Respondé ÚNICAMENTE con JSON válido, sin texto extra ni markdown:
{
  "evaluations": {
    "NOMBRE_MODELO": { "claridad": N, "profundidad": N, "originalidad": N, "concision": N }
  }
}

Nombres exactos a usar: ${others.map(r => r.name).join(', ')}`;
    try {
      const raw = await evaluator.call(evalPrompt);
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      scores[evaluator.id] = parsed.evaluations || {};
      console.log(`   ✓ ${evaluator.name} evaluó a ${Object.keys(scores[evaluator.id]).join(', ')}`);
    } catch (e) {
      console.log(`   ✗ ${evaluator.name} no pudo evaluar: ${e.message}`);
      scores[evaluator.id] = {};
    }
  });
  await Promise.all(evalJobs);
  return scores;
}

// ═══════════════════════════════════════════════════════
//  4. RANKING
// ═══════════════════════════════════════════════════════
function computeRanking(responses, scores) {
  const successful = responses.filter(r => r.text);
  const totals = {};
  successful.forEach(model => {
    let sumTotal = 0, count = 0;
    const dimSums = { claridad: 0, profundidad: 0, originalidad: 0, concision: 0 };
    const dimCounts = { claridad: 0, profundidad: 0, originalidad: 0, concision: 0 };
    Object.entries(scores).forEach(([evaluatorId, evals]) => {
      if (evaluatorId === model.id) return;
      const sc = evals[model.name];
      if (!sc) return;
      DIMS.forEach(d => {
        if (typeof sc[d] === 'number') {
          dimSums[d] += sc[d]; dimCounts[d]++; sumTotal += sc[d]; count++;
        }
      });
    });
    const dimAvgs = {};
    DIMS.forEach(d => { dimAvgs[d] = dimCounts[d] > 0 ? +(dimSums[d] / dimCounts[d]).toFixed(2) : null; });
    totals[model.id] = {
      name: model.name, version: model.version, text: model.text, error: model.error,
      dimAvgs, finalScore: count > 0 ? +(sumTotal / count).toFixed(2) : null, voteCount: count,
    };
  });
  responses.filter(r => !r.text).forEach(r => {
    totals[r.id] = { name: r.name, version: r.version, text: null, error: r.error, dimAvgs: {}, finalScore: null, voteCount: 0 };
  });
  return Object.values(totals).sort((a, b) => {
    if (a.finalScore === null) return 1;
    if (b.finalScore === null) return -1;
    return b.finalScore - a.finalScore;
  });
}

// ═══════════════════════════════════════════════════════
//  5. GOOGLE SHEETS
// ═══════════════════════════════════════════════════════
async function getGoogleAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  };
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(creds.private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const d = await res.json();
  if (!res.ok) throw new Error('Error obteniendo token Google: ' + JSON.stringify(d));
  return d.access_token;
}

async function writeToSheets(ranking, prompt, weekLabel, allScores) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('   ⚠ Google Sheets no configurado, saltando.');
    return;
  }
  console.log('\n📊 Escribiendo en Google Sheets...');
  const token = await getGoogleAccessToken();
  const now = new Date().toISOString().slice(0, 10);
  const weekNum = weekLabel.replace('SEMANA ', '').trim();

  // Resultados — columnas: semana, fecha, prompt, modelo, pos, score, claridad, profundidad, originalidad, concision, votos, excerpt
  const resultRows = ranking
    .filter(r => r.finalScore !== null)
    .map((r, i) => [
      weekNum, now, prompt.slice(0, 200), r.name, i + 1,
      r.finalScore?.toFixed(3) ?? '',
      r.dimAvgs.claridad?.toFixed(3) ?? '',
      r.dimAvgs.profundidad?.toFixed(3) ?? '',
      r.dimAvgs.originalidad?.toFixed(3) ?? '',
      r.dimAvgs.concision?.toFixed(3) ?? '',
      r.voteCount,
      (r.text || '').slice(0, 400),
    ]);
  await sheetsAppend(token, sheetId, 'Resultados', resultRows);

  const crossRows = [];
  Object.entries(allScores).forEach(([evaluatorId, evals]) => {
    const evaluatorModel = ACTIVE.find(m => m.id === evaluatorId);
    if (!evaluatorModel) return;
    Object.entries(evals).forEach(([targetName, sc]) => {
      crossRows.push([
        weekNum, now, evaluatorModel.name, targetName,
        sc.claridad ?? '', sc.profundidad ?? '', sc.originalidad ?? '', sc.concision ?? '',
        ((DIMS.reduce((s, d) => s + (sc[d] || 0), 0)) / DIMS.length).toFixed(3),
      ]);
    });
  });
  if (crossRows.length > 0) await sheetsAppend(token, sheetId, 'ScoresCruzados', crossRows);
  console.log('   ✓ Sheets actualizado');
}

async function sheetsAppend(token, sheetId, sheetName, rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Error escribiendo hoja "${sheetName}": ${err}`);
  }
}

// Lee historial completo desde Sheets
// Columnas: semana(0), fecha(1), prompt(2), modelo(3), pos(4), score(5),
//           claridad(6), profundidad(7), originalidad(8), concision(9), votos(10), excerpt(11)
async function readHistoryFromSheets() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return [];
  try {
    const token = await getGoogleAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('Resultados')}!A2:L`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const d = await res.json();
    return (d.values || []).map(r => ({
      week:         r[0] || '',
      date:         r[1] || '',
      prompt:       r[2] || '',
      model:        r[3] || '',
      pos:          parseInt(r[4]) || 0,
      score:        parseFloat(r[5]) || null,
      claridad:     parseFloat(r[6]) || null,
      profundidad:  parseFloat(r[7]) || null,
      originalidad: parseFloat(r[8]) || null,
      concision:    parseFloat(r[9]) || null,
      votes:        parseInt(r[10]) || 0,
      excerpt:      r[11] || '',
    }));
  } catch(e) {
    console.log('   ⚠ No se pudo leer historial de Sheets:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════
//  6. BUILD HTML
// ═══════════════════════════════════════════════════════
function buildHTML(prompt, ranking, weekLabel, allScores, history) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Construir array WEEKS para el HTML a partir del historial de Sheets
  // + la batalla actual (que aún no está en Sheets al momento de generar el HTML)
  const weekMap = {};

  history.forEach(r => {
    if (!weekMap[r.week]) {
      weekMap[r.week] = { id: r.week, label: r.week, date: r.date, prompt: r.prompt, results: [] };
    }
    weekMap[r.week].results.push({
      model: r.model,
      score: r.score,
      pos: r.pos,
      dims: {
        Claridad:     r.claridad,
        Profundidad:  r.profundidad,
        Originalidad: r.originalidad,
        'Concisión':  r.concision,
      },
      excerpt: r.excerpt,
    });
  });

  // Añadir semana actual
  const currentWeekId = weekLabel.replace('SEMANA ', 'S').replace(' · ', '·');
  weekMap[currentWeekId] = {
    id: currentWeekId,
    label: currentWeekId,
    date: dateStr,
    prompt: prompt,
    results: ranking
      .filter(r => r.finalScore !== null)
      .map((r, i) => ({
        model: r.name,
        score: r.finalScore,
        pos: i + 1,
        dims: {
          Claridad:     r.dimAvgs.claridad,
          Profundidad:  r.dimAvgs.profundidad,
          Originalidad: r.dimAvgs.originalidad,
          'Concisión':  r.dimAvgs.concision,
        },
        excerpt: (r.text || '').slice(0, 400),
      })),
  };

  // Ordenar semanas cronológicamente
  const weeksArray = Object.values(weekMap).sort((a, b) => a.id.localeCompare(b.id));
  const weeksJSON = JSON.stringify(weeksArray);

  const modelList = [...new Set(weeksArray.flatMap(w => w.results.map(r => r.model)))];
  const modelsJSON = JSON.stringify(modelList);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Battle</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0f14;--surface:#13161e;--surface2:#1a1e29;--border:#232736;--border2:#2d3245;
  --accent:#3b82f6;--accent2:#60a5fa;--text:#e8eaf0;--muted:#6b7280;--muted2:#9ca3af;
  --win-bg:#0f172a;--win-border:#1e3a5f;--gold:#f59e0b;--silver:#94a3b8;--bronze:#cd7c2f;
}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.logo{font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;letter-spacing:-.02em}
.logo span{color:var(--accent)}
.tag{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;background:var(--accent);color:#fff;padding:3px 9px;border-radius:4px;letter-spacing:.05em}
.header-meta{text-align:right;font-size:11px;color:var(--muted);line-height:1.6;font-family:'IBM Plex Mono',monospace}
.tab-bar{background:var(--surface);border-bottom:1px solid var(--border);padding:0 2rem;display:flex;gap:0}
.tab{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.75rem 1.2rem;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;transition:color .2s,border-color .2s;user-select:none}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent2);border-bottom-color:var(--accent)}
.wrap{max-width:1400px;margin:0 auto;padding:2rem 1.5rem}
.panel{display:none}.panel.active{display:block}
.sl{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:.5rem}
.pbox{background:var(--surface2);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;padding:1.1rem 1.4rem;margin-bottom:1.5rem;font-size:.95rem;line-height:1.7;font-style:italic;color:var(--muted2)}
.vbox{background:var(--win-bg);border:1px solid var(--win-border);border-radius:10px;padding:1.3rem 1.5rem;margin-bottom:2rem}
.vwin{font-family:'Syne',sans-serif;font-size:1.6rem;font-weight:800;color:var(--text);margin-bottom:.3rem}
.vwin span{color:var(--accent2)}
.ranking-line{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--muted);margin-top:.4rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1rem;margin-bottom:2.5rem}
.mcard{background:var(--surface);border:1px solid var(--border);border-radius:10px;display:flex;flex-direction:column;transition:border-color .2s,transform .15s}
.mcard:hover{transform:translateY(-2px);border-color:var(--border2)}
.mcard.winner{border-color:var(--accent)}
.mcard-head{display:flex;align-items:center;justify-content:space-between;padding:11px 15px;border-bottom:1px solid var(--border)}
.mcard-name{font-weight:600;font-size:14px}
.mcard-pos{font-family:'IBM Plex Mono',monospace;font-size:.85rem;font-weight:700}
.pos-1{color:var(--gold)}.pos-2{color:var(--silver)}.pos-3{color:var(--bronze)}.pos-n{color:var(--muted)}
.mcard-excerpt{padding:11px 15px;font-size:11.5px;line-height:1.65;color:var(--muted);flex:1;font-style:italic}
.mcard-dims{padding:10px 15px;border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.dim{display:flex;flex-direction:column;align-items:center;gap:3px}
.dim-label{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.dim-val{font-family:'IBM Plex Mono',monospace;font-size:.85rem;font-weight:600}
.dim-bar{width:100%;height:2px;background:var(--border2);border-radius:1px}
.dim-fill{height:100%;border-radius:1px}
.mcard-score{padding:9px 15px;border-top:1px solid var(--border);display:flex;align-items:center}
.score-label{flex:1;font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.score-val{font-family:'IBM Plex Mono',monospace;font-size:1.3rem;font-weight:600;color:var(--accent2)}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2.5rem}
@media(max-width:800px){.charts{grid-template-columns:1fr}}
.cbox{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.2rem}
.cbox canvas{max-height:240px}
.ctitle{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:1rem}
.week-selector{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
.week-btn{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;padding:5px 12px;border-radius:5px;cursor:pointer;border:1px solid var(--border2);background:var(--surface);color:var(--muted);transition:all .15s}
.week-btn:hover{color:var(--text);border-color:var(--muted)}
.week-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
table.hist{border-collapse:collapse;width:100%;font-size:12px;font-family:'IBM Plex Mono',monospace}
table.hist th,table.hist td{border:1px solid var(--border);padding:7px 12px;text-align:left}
table.hist th{background:var(--surface2);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
table.hist td{color:var(--muted2)}
table.hist tr:hover td{background:var(--surface2)}
.rank-badge{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px}
</style>
</head>
<body>

<header>
  <div class="logo">LLM <span>Battle</span></div>
  <div class="header-meta">
    <span class="tag" id="current-tag"></span><br>
    Comparativa semanal automatizada
  </div>
</header>

<div class="tab-bar">
  <div class="tab active" data-tab="semana">Esta semana</div>
  <div class="tab" data-tab="charts">Gráficos</div>
  <div class="tab" data-tab="historia">Historial</div>
</div>

<div class="wrap">
  <div class="panel active" id="tab-semana">
    <div class="sl" id="latest-week-label"></div>
    <div class="pbox" id="latest-prompt"></div>
    <div class="vbox" id="latest-winner"></div>
    <div class="sl" id="latest-models-label"></div>
    <div class="grid" id="latest-grid"></div>
  </div>

  <div class="panel" id="tab-charts">
    <div class="charts">
      <div class="cbox"><div class="ctitle">Tendencia por semana</div><canvas id="cTrend"></canvas></div>
      <div class="cbox"><div class="ctitle">Victorias acumuladas</div><canvas id="cWins"></canvas></div>
      <div class="cbox"><div class="ctitle">Score promedio global</div><canvas id="cAvg"></canvas></div>
      <div class="cbox"><div class="ctitle">Radar de dimensiones</div><canvas id="cRadar"></canvas></div>
    </div>
  </div>

  <div class="panel" id="tab-historia">
    <div class="week-selector" id="week-selector"></div>
    <div id="history-detail"></div>
  </div>
</div>

<script>
const WEEKS = ${weeksJSON};
const MODEL_LIST = ${modelsJSON};

const PALETTE = {
  Claude:"#3b82f6","GPT-4o":"#10b981",Grok:"#f59e0b",Gemini:"#8b5cf6",
  DeepSeek:"#ef4444",Kimi:"#06b6d4",Mistral:"#ec4899",Cohere:"#f97316",Groq:"#a78bfa"
};
const col = m => PALETTE[m] || "#6b7280";
const posClass = p => p===1?"pos-1":p===2?"pos-2":p===3?"pos-3":"pos-n";

function buildCard(r) {
  const dimKeys = Object.keys(r.dims);
  const dimsHtml = dimKeys.map(d => {
    const v = r.dims[d];
    if (v === null || v === undefined) return '';
    return \`<div class="dim">
      <div class="dim-label">\${d}</div>
      <div class="dim-val" style="color:\${col(r.model)}">\${parseFloat(v).toFixed(1)}</div>
      <div class="dim-bar"><div class="dim-fill" style="width:\${parseFloat(v)*10}%;background:\${col(r.model)}"></div></div>
    </div>\`;
  }).join('');
  return \`<div class="mcard\${r.pos===1?' winner':''}">
    <div class="mcard-head">
      <div class="mcard-name" style="color:\${r.pos===1?col(r.model):'var(--text)'}">\${r.model}</div>
      <div class="mcard-pos \${posClass(r.pos)}">\${r.pos}°</div>
    </div>
    <div class="mcard-excerpt">\${r.excerpt||''}</div>
    <div class="mcard-dims">\${dimsHtml}</div>
    <div class="mcard-score">
      <span class="score-label">Score</span>
      <span class="score-val" style="color:\${col(r.model)}">\${parseFloat(r.score).toFixed(2)}</span>
    </div>
  </div>\`;
}

function renderLatest() {
  const w = WEEKS[WEEKS.length - 1];
  const winner = w.results[0];
  const rankingLine = w.results.map(r => \`\${r.pos}. \${r.model} (\${parseFloat(r.score).toFixed(2)})\`).join(' · ');
  document.getElementById('current-tag').textContent = w.label;
  document.getElementById('latest-week-label').textContent = \`\${w.label} · \${w.date}\`;
  document.getElementById('latest-prompt').textContent = w.prompt;
  document.getElementById('latest-models-label').textContent = \`\${w.results.length} modelos · \${w.label}\`;
  document.getElementById('latest-winner').innerHTML = \`
    <div class="sl" style="color:#93c5fd">Ganador</div>
    <div class="vwin">\${winner.model} <span>gana esta semana</span></div>
    <div class="ranking-line">\${rankingLine}</div>\`;
  document.getElementById('latest-grid').innerHTML = w.results.map(r => buildCard(r)).join('');
}

function renderCharts() {
  const weekLabels = WEEKS.map(w => w.label);
  const wins = {}, dimAccum = {}, scoreAccum = {};
  MODEL_LIST.forEach(m => { wins[m]=0; dimAccum[m]={Claridad:0,Profundidad:0,Originalidad:0,'Concisión':0}; scoreAccum[m]=[]; });
  WEEKS.forEach(w => {
    w.results.forEach(r => {
      if (r.pos===1) wins[r.model]=(wins[r.model]||0)+1;
      scoreAccum[r.model].push(parseFloat(r.score));
      ['Claridad','Profundidad','Originalidad','Concisión'].forEach(d => {
        const v = r.dims[d];
        if (v!=null) dimAccum[r.model][d]=(dimAccum[r.model][d]||0)+parseFloat(v);
      });
    });
  });
  const avgDims = {};
  MODEL_LIST.forEach(m => {
    avgDims[m]={};
    ['Claridad','Profundidad','Originalidad','Concisión'].forEach(d => {
      avgDims[m][d]=dimAccum[m][d]/WEEKS.length;
    });
  });
  const cd = { responsive:true, maintainAspectRatio:true, plugins:{ legend:{ labels:{ color:'#9ca3af', font:{size:11}, boxWidth:12 }}}};
  new Chart(document.getElementById('cTrend'),{type:'line',data:{
    labels:weekLabels,
    datasets:MODEL_LIST.map(m=>({label:m,data:WEEKS.map(w=>w.results.find(r=>r.model===m)?.score??null),
      borderColor:col(m),backgroundColor:col(m)+'22',borderWidth:2,pointRadius:5,tension:.3,spanGaps:true}))
  },options:{...cd,scales:{x:{ticks:{color:'#9ca3af',font:{size:10}},grid:{color:'#232736'}},y:{min:0,max:10,ticks:{color:'#9ca3af'},grid:{color:'#232736'}}}}});
  const ws=Object.entries(wins).sort((a,b)=>b[1]-a[1]);
  new Chart(document.getElementById('cWins'),{type:'bar',data:{labels:ws.map(([m])=>m),datasets:[{label:'Victorias',data:ws.map(([,v])=>v),backgroundColor:ws.map(([m])=>col(m)),borderWidth:0}]},
    options:{...cd,indexAxis:'y',plugins:{...cd.plugins,legend:{display:false}},scales:{x:{ticks:{color:'#9ca3af',stepSize:1},grid:{color:'#232736'}},y:{ticks:{color:'#9ca3af',font:{size:11}},grid:{color:'#232736'}}}}});
  const as=MODEL_LIST.map(m=>({m,v:scoreAccum[m].length?scoreAccum[m].reduce((a,b)=>a+b,0)/scoreAccum[m].length:0})).sort((a,b)=>b.v-a.v);
  new Chart(document.getElementById('cAvg'),{type:'bar',data:{labels:as.map(d=>d.m),datasets:[{label:'Score promedio',data:as.map(d=>+d.v.toFixed(3)),backgroundColor:as.map(d=>col(d.m)),borderWidth:0}]},
    options:{...cd,plugins:{...cd.plugins,legend:{display:false}},scales:{x:{ticks:{color:'#9ca3af',font:{size:10}},grid:{color:'#232736'}},y:{min:0,max:10,ticks:{color:'#9ca3af'},grid:{color:'#232736'}}}}});
  new Chart(document.getElementById('cRadar'),{type:'radar',data:{labels:['Claridad','Profundidad','Originalidad','Concisión'],
    datasets:MODEL_LIST.map(m=>({label:m,data:['Claridad','Profundidad','Originalidad','Concisión'].map(d=>avgDims[m][d]||0),
      borderColor:col(m),backgroundColor:col(m)+'18',pointBackgroundColor:col(m),borderWidth:2}))},
    options:{...cd,scales:{r:{min:0,max:10,ticks:{color:'#9ca3af',backdropColor:'transparent',stepSize:2},grid:{color:'#232736'},pointLabels:{color:'#9ca3af',font:{size:10}},angleLines:{color:'#232736'}}}}});
}

let activeWeekIdx = WEEKS.length - 1;
function renderHistorySelector() {
  const sel = document.getElementById('week-selector');
  sel.innerHTML = WEEKS.map((w,i) => \`<div class="week-btn\${i===activeWeekIdx?' active':''}" data-idx="\${i}">\${w.label}</div>\`).join('');
  sel.querySelectorAll('.week-btn').forEach(btn => btn.addEventListener('click', () => {
    activeWeekIdx=parseInt(btn.dataset.idx); renderHistorySelector(); renderHistoryDetail();
  }));
}
function renderHistoryDetail() {
  const w = WEEKS[activeWeekIdx];
  const winner = w.results[0];
  const rankingLine = w.results.map(r => \`\${r.pos}. \${r.model} (\${parseFloat(r.score).toFixed(2)})\`).join(' · ');
  const tableRows = w.results.map(r => {
    const dimsStr = Object.entries(r.dims).filter(([,v])=>v!=null).map(([k,v])=>\`\${k}: \${parseFloat(v).toFixed(1)}\`).join(' · ');
    return \`<tr>
      <td><span class="rank-badge" style="background:\${col(r.model)}22;color:\${col(r.model)}">\${r.pos}°</span></td>
      <td style="color:\${col(r.model)};font-weight:600">\${r.model}</td>
      <td style="font-weight:700;color:var(--accent2)">\${parseFloat(r.score).toFixed(2)}</td>
      <td style="color:var(--muted);font-size:11px">\${dimsStr}</td>
    </tr>\`;
  }).join('');
  document.getElementById('history-detail').innerHTML = \`
    <div class="sl">\${w.date}</div>
    <div class="pbox" style="margin-bottom:1.2rem">\${w.prompt}</div>
    <div class="vbox" style="margin-bottom:1.5rem">
      <div class="sl" style="color:#93c5fd">Ganador</div>
      <div class="vwin">\${winner.model} <span>gana esta semana</span></div>
      <div class="ranking-line">\${rankingLine}</div>
    </div>
    <table class="hist" style="margin-bottom:1.5rem">
      <thead><tr><th>#</th><th>Modelo</th><th>Score</th><th>Dimensiones</th></tr></thead>
      <tbody>\${tableRows}</tbody>
    </table>
    <div class="sl" style="margin-bottom:.75rem">\${w.results.length} modelos · \${w.label}</div>
    <div class="grid">\${w.results.map(r=>buildCard(r)).join('')}</div>\`;
}

let chartsRendered = false;
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab==='charts' && !chartsRendered) { chartsRendered=true; renderCharts(); }
    if (tab.dataset.tab==='historia') { renderHistorySelector(); renderHistoryDetail(); }
  });
});

renderLatest();
<\/script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════
//  API CALLS
// ═══════════════════════════════════════════════════════
async function callClaude(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error Claude');
  return d.content[0].text;
}
async function callOpenAI(prompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error OpenAI');
  return d.choices[0].message.content;
}
async function callGemini(prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 800 } })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error Gemini');
  return d.candidates[0].content.parts[0].text;
}
async function callGrok(prompt) {
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROK_KEY}` },
    body: JSON.stringify({ model: 'grok-2', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error Grok');
  return d.choices[0].message.content;
}
async function callKimi(prompt) {
  const r = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.KIMI_KEY}` },
    body: JSON.stringify({ model: 'moonshot-v1-8k', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error Kimi');
  return d.choices[0].message.content;
}
async function callDeepSeek(prompt) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error DeepSeek');
  return d.choices[0].message.content;
}
async function callMistral(prompt) {
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.MISTRAL_KEY}` },
    body: JSON.stringify({ model: 'mistral-large-latest', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error Mistral');
  return d.choices[0].message.content;
}
async function callCohere(prompt) {
  const r = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.COHERE_KEY}` },
    body: JSON.stringify({ model: 'command-r-plus', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Error Cohere');
  return d.message.content[0].text;
}
async function callGroq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_KEY}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Error Groq');
  return d.choices[0].message.content;
}

// ═══════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════
async function main() {
  const now = new Date();
  const week = Math.ceil((((new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))-new Date(Date.UTC(now.getFullYear(),0,1)))/86400000)+1)/7);
  const weekLabel = `SEMANA ${String(week).padStart(2,'0')} · ${now.getFullYear()}`;

  console.log(`\n🥊 LLM BATTLE — ${weekLabel}`);
  console.log('═'.repeat(50));

  if (ACTIVE.length < 2) {
    console.error('Se necesitan al menos 2 modelos con API key configurada.');
    process.exit(1);
  }

  const prompt = await generateWeeklyPrompt();
  const responses = await getAllResponses(prompt);
  const allScores = await crossScore(prompt, responses);

  console.log('\n🏆 Calculando ranking...');
  const ranking = computeRanking(responses, allScores);
  ranking.forEach((m, i) => {
    console.log(`   ${i+1}. ${m.name} — ${m.finalScore !== null ? m.finalScore.toFixed(2) : 'sin score'}`);
  });

  await writeToSheets(ranking, prompt, weekLabel, allScores);

  console.log('\n📈 Leyendo historial para gráficas...');
  const history = await readHistoryFromSheets();
  console.log(`   ${history.length} registros históricos`);

  console.log('\n🌐 Generando HTML...');
  if (!fs.existsSync('docs')) fs.mkdirSync('docs');
  const html = buildHTML(prompt, ranking, weekLabel, allScores, history);
  fs.writeFileSync('docs/index.html', html);
  console.log('   ✓ docs/index.html generado');

  console.log('\n✅ Batalla completada.\n');
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
