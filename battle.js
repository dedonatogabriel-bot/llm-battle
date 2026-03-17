// ═══════════════════════════════════════════════════════
//  LLM BATTLE — battle.js
//  Corre cada lunes via GitHub Actions.
//  Genera prompt → todos responden → todos evalúan a todos
//  → scoring matemático puro → Google Sheets + HTML con gráficas
// ═══════════════════════════════════════════════════════

import fs from 'fs';

// ── Configuración de modelos ──────────────────────────
// Comentá o eliminá los modelos cuya key no tengas.
const MODELS = [
  {
    id: 'claude',
    name: 'Claude',
    version: 'claude-opus-4-5',
    enabled: !!process.env.ANTHROPIC_KEY,
    call: callClaude,
  },
  {
    id: 'gpt4o',
    name: 'GPT-4o',
    version: 'gpt-4o',
    enabled: !!process.env.OPENAI_KEY,
    call: callOpenAI,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    version: 'gemini-1.5-pro',
    enabled: !!process.env.GEMINI_KEY,
    call: callGemini,
  },
  {
    id: 'grok',
    name: 'Grok',
    version: 'grok-2',
    enabled: !!process.env.GROK_KEY,
    call: callGrok,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    version: 'moonshot-v1-8k',
    enabled: !!process.env.KIMI_KEY,
    call: callKimi,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    version: 'deepseek-chat',
    enabled: !!process.env.DEEPSEEK_KEY,
    call: callDeepSeek,
  },
{
    id: 'mistral',
    name: 'Mistral',
    version: 'mistral-large-latest',
    enabled: !!process.env.MISTRAL_KEY,
    call: callMistral,
  },
  {
    id: 'cohere',
    name: 'Cohere',
    version: 'command-r-plus',
    enabled: !!process.env.COHERE_KEY,
    call: callCohere,
  },
  {
    id: 'groq',
    name: 'Groq',
    version: 'llama-3.3-70b-versatile',
    enabled: !!process.env.GROQ_KEY,
    call: callGroq,
  },
];

const ACTIVE = MODELS.filter(m => m.enabled);
console.log(`\n⚡ Modelos activos: ${ACTIVE.map(m => m.name).join(', ')}\n`);

// ── Dimensiones de evaluación ─────────────────────────
const DIMS = ['claridad', 'profundidad', 'originalidad', 'concision'];
const DIM_LABELS = {
  claridad:     'Claridad',
  profundidad:  'Profundidad',
  originalidad: 'Originalidad',
  concision:    'Concisión',
};

// ═══════════════════════════════════════════════════════
//  1. GENERAR PROMPT DE LA SEMANA (via Claude)
// ═══════════════════════════════════════════════════════
async function generateWeeklyPrompt() {
  console.log('📝 Generando prompt semanal...');
  const today = new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const metaPrompt = `Hoy es ${today}. Generá una sola pregunta abierta, intelectualmente estimulante, para comparar la capacidad de razonamiento de distintos modelos de lenguaje. 

La pregunta debe:
- Ser original y no genérica
- Admitir múltiples perspectivas válidas
- Tener entre 1 y 3 oraciones
- No tener respuesta única ni correcta
- Variar el tema cada semana (filosofía, ciencia, tecnología, ética, sociedad, creatividad, etc.)

  const text = await callClaude(metaPrompt);
  console.log(`   Prompt generado: "${text.slice(0, 80)}..."\n`);
  return text.trim();
}

// ═══════════════════════════════════════════════════════
//  2. OBTENER RESPUESTAS
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
//  3. SCORING CRUZADO — cada modelo evalúa a todos los demás
// ═══════════════════════════════════════════════════════
async function crossScore(prompt, responses) {
  console.log('\n📊 Scoring cruzado...');
  const successful = responses.filter(r => r.text);
  if (successful.length < 2) {
    console.log('   Menos de 2 respuestas exitosas, no hay scoring cruzado.');
    return {};
  }

  // Tabla: scores[evaluatorId][evaluatedId] = { claridad, profundidad, originalidad, concision }
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
//  4. CALCULAR RANKING FINAL
// ═══════════════════════════════════════════════════════
function computeRanking(responses, scores) {
  const successful = responses.filter(r => r.text);
  const totals = {};

  successful.forEach(model => {
    let sumTotal = 0;
    let count = 0;
    const dimSums = { claridad: 0, profundidad: 0, originalidad: 0, concision: 0 };
    const dimCounts = { claridad: 0, profundidad: 0, originalidad: 0, concision: 0 };

    // Recopilar todos los scores que otros modelos le dieron a este
    Object.entries(scores).forEach(([evaluatorId, evals]) => {
      if (evaluatorId === model.id) return; // no cuenta la auto-evaluación
      const sc = evals[model.name];
      if (!sc) return;
      DIMS.forEach(d => {
        if (typeof sc[d] === 'number') {
          dimSums[d] += sc[d];
          dimCounts[d]++;
          sumTotal += sc[d];
          count++;
        }
      });
    });

    const dimAvgs = {};
    DIMS.forEach(d => {
      dimAvgs[d] = dimCounts[d] > 0 ? +(dimSums[d] / dimCounts[d]).toFixed(2) : null;
    });

    totals[model.id] = {
      name: model.name,
      version: model.version,
      text: model.text,
      error: model.error,
      dimAvgs,
      finalScore: count > 0 ? +(sumTotal / count).toFixed(2) : null,
      voteCount: count,
    };
  });

  // Modelos sin respuesta también aparecen
  responses.filter(r => !r.text).forEach(r => {
    totals[r.id] = {
      name: r.name,
      version: r.version,
      text: null,
      error: r.error,
      dimAvgs: {},
      finalScore: null,
      voteCount: 0,
    };
  });

  return Object.values(totals).sort((a, b) => {
    if (a.finalScore === null) return 1;
    if (b.finalScore === null) return -1;
    return b.finalScore - a.finalScore;
  });
}

// ═══════════════════════════════════════════════════════
//  5. GOOGLE SHEETS — escribir resultados
// ═══════════════════════════════════════════════════════

// Obtiene un access token usando JWT del Service Account
async function getGoogleAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;

  // Firma con RS256 usando crypto nativo de Node 20
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

  // ── Hoja 1: "Resultados" — una fila por modelo por semana ──
  const resultRows = ranking
    .filter(r => r.finalScore !== null)
    .map(r => [
      weekNum,
      now,
      prompt.slice(0, 200),
      r.name,
      r.finalScore?.toFixed(3) ?? '',
      r.dimAvgs.claridad?.toFixed(3) ?? '',
      r.dimAvgs.profundidad?.toFixed(3) ?? '',
      r.dimAvgs.originalidad?.toFixed(3) ?? '',
      r.dimAvgs.concision?.toFixed(3) ?? '',
      r.voteCount,
    ]);

  await sheetsAppend(token, sheetId, 'Resultados', resultRows);

  // ── Hoja 2: "ScoresCruzados" — una fila por par evaluador/evaluado ──
  const crossRows = [];
  Object.entries(allScores).forEach(([evaluatorId, evals]) => {
    const evaluatorModel = ACTIVE.find(m => m.id === evaluatorId);
    if (!evaluatorModel) return;
    Object.entries(evals).forEach(([targetName, sc]) => {
      crossRows.push([
        weekNum, now,
        evaluatorModel.name, targetName,
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

// Lee todo el historial desde Sheets para las gráficas
async function readHistoryFromSheets() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return [];

  try {
    const token = await getGoogleAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('Resultados')}!A2:J`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const d = await res.json();
    const rows = d.values || [];
    // Columnas: semana, fecha, prompt, modelo, score, claridad, profundidad, originalidad, concision, votos
    return rows.map(r => ({
      week:         r[0] || '',
      date:         r[1] || '',
      prompt:       r[2] || '',
      model:        r[3] || '',
      score:        parseFloat(r[4]) || null,
      claridad:     parseFloat(r[5]) || null,
      profundidad:  parseFloat(r[6]) || null,
      originalidad: parseFloat(r[7]) || null,
      concision:    parseFloat(r[8]) || null,
      votes:        parseInt(r[9]) || 0,
    }));
  } catch(e) {
    console.log('   ⚠ No se pudo leer historial de Sheets:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════
//  6. GENERAR HTML CON GRÁFICAS HISTÓRICAS
// ═══════════════════════════════════════════════════════
function buildHTML(prompt, ranking, weekLabel, allScores, history) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const winner = ranking.find(r => r.finalScore !== null);
  const rankColors = ['#ffd700', '#b0b8c8', '#cd8040'];

  // ── Cards semana actual ──
  const cardsHTML = ranking.map((m, i) => {
    const rankColor = i < 3 ? rankColors[i] : '#2a2a2a';
    const dimsHTML = DIMS.map(d => {
      const val = m.dimAvgs[d];
      const pct = val !== null ? (val / 10) * 100 : 0;
      return `<div class="dim">
        <div class="dim-label">${DIM_LABELS[d]}</div>
        <div class="dim-val">${val !== null ? val.toFixed(1) : '—'}</div>
        <div class="dim-bar"><div class="dim-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
    const textPreview = m.text
      ? m.text.slice(0, 320) + (m.text.length > 320 ? '…' : '')
      : `<span class="err">✗ ${m.error || 'Sin respuesta'}</span>`;
    return `
    <div class="card${i === 0 && m.finalScore !== null ? ' winner' : ''}" style="--rank-color:${rankColor}">
      <div class="card-head">
        <div><div class="card-name">${m.name}</div><div class="card-ver">${m.version}</div></div>
        <div class="card-rank" style="color:${rankColor};border-color:${rankColor}">${i + 1}°</div>
      </div>
      <div class="card-response">${textPreview}</div>
      <div class="card-dims">${dimsHTML}</div>
      <div class="card-score">
        <span class="score-lbl">Score promedio</span>
        <span class="score-val" style="color:${m.finalScore !== null ? '#c8ff00' : '#444'}">${m.finalScore !== null ? m.finalScore.toFixed(2) : '—'}</span>
        ${m.voteCount > 0 ? `<span class="score-votes">${m.voteCount} eval.</span>` : ''}
      </div>
    </div>`;
  }).join('');

  // ── Matriz cruzada ──
  const successfulModels = ranking.filter(r => r.finalScore !== null);
  const successfulNames  = successfulModels.map(r => r.name);
  const matrixHeaderCells = successfulNames.map(n => `<th title="${n}">${n.slice(0,7)}</th>`).join('');
  const matrixRows = successfulModels.map(evaluator => {
    const evData = Object.entries(allScores).find(([id]) => ACTIVE.find(m => m.id === id && m.name === evaluator.name));
    const evals = evData?.[1] || {};
    const cells = successfulNames.map(target => {
      if (target === evaluator.name) return '<td class="self">—</td>';
      const sc = evals[target];
      if (!sc) return '<td class="no-data">·</td>';
      return `<td>${(DIMS.reduce((s,d)=>s+(sc[d]||0),0)/DIMS.length).toFixed(1)}</td>`;
    }).join('');
    return `<tr><td class="row-head">${evaluator.name.slice(0,7)}</td>${cells}</tr>`;
  }).join('');

  // ── Datos para gráficas (desde historial Sheets) ──
  // Agrupar por modelo
  const modelNames = [...new Set(history.map(r => r.model))].sort();
  const weeks = [...new Set(history.map(r => r.week))].sort();

  // Serie de scores globales por semana y modelo
  const chartData = {};
  modelNames.forEach(m => { chartData[m] = {}; });
  history.forEach(r => { if (chartData[r.model]) chartData[r.model][r.week] = r.score; });

  // Victorias acumuladas
  const winsPerModel = {};
  modelNames.forEach(m => { winsPerModel[m] = 0; });
  weeks.forEach(w => {
    const weekRows = history.filter(r => r.week === w && r.score !== null);
    if (!weekRows.length) return;
    const topScore = Math.max(...weekRows.map(r => r.score));
    const topModel = weekRows.find(r => r.score === topScore)?.model;
    if (topModel) winsPerModel[topModel] = (winsPerModel[topModel] || 0) + 1;
  });

  // Promedios históricos por dimensión y modelo
  const dimAvgsHistory = {};
  modelNames.forEach(m => {
    const rows = history.filter(r => r.model === m);
    if (!rows.length) { dimAvgsHistory[m] = {}; return; }
    const avg = d => (rows.filter(r=>r[d]!==null).reduce((s,r)=>s+r[d],0) / rows.filter(r=>r[d]!==null).length);
    dimAvgsHistory[m] = {
      claridad:     avg('claridad'),
      profundidad:  avg('profundidad'),
      originalidad: avg('originalidad'),
      concision:    avg('concision'),
    };
  });

  // Historial de batallas para la tabla
  const histWeeks = [...new Set(history.map(r => r.week))].sort().reverse().slice(0, 20);
  const histTableRows = histWeeks.map(w => {
    const weekRows = history.filter(r => r.week === w).sort((a,b) => (b.score??0)-(a.score??0));
    const weekWinner = weekRows[0];
    const weekPrompt = weekRows[0]?.prompt?.slice(0, 100) || '—';
    const rankStr = weekRows.map((r,i) => `${i+1}. ${r.model} (${r.score?.toFixed(2)??'—'})`).join('  ·  ');
    return `<tr>
      <td class="hw">${w}</td>
      <td class="hp">${weekPrompt}…</td>
      <td class="hwin">${weekWinner?.model || '—'}</td>
      <td class="hrank">${rankStr}</td>
    </tr>`;
  }).join('');

  // JSON para los charts (embebido en el HTML)
  const chartJSON = JSON.stringify({ modelNames, weeks, chartData, winsPerModel, dimAvgsHistory });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LLM Battle — ${weekLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;600&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,400&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
:root{--bg:#080808;--sur:#0f0f0f;--brd:#1c1c1c;--acc:#c8ff00;--txt:#e0dbd0;--mut:#444;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--txt);font-family:'IBM Plex Mono',monospace;min-height:100vh;}
body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px);pointer-events:none;z-index:9999;}
header{border-bottom:1px solid var(--brd);padding:1.5rem 2.5rem;display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;background:var(--bg);}
.logo{font-family:'Bebas Neue',sans-serif;font-size:clamp(2rem,4vw,3.5rem);letter-spacing:.04em;line-height:1;}
.logo em{color:var(--acc);font-style:normal;}
.meta{text-align:right;font-size:.65rem;color:var(--mut);line-height:1.9;}
.wtag{display:inline-block;background:var(--acc);color:#000;font-family:'Bebas Neue',sans-serif;font-size:.85rem;padding:.1rem .6rem;letter-spacing:.1em;}
.wrap{max-width:1500px;margin:0 auto;padding:2rem 2.5rem 5rem;}
.lbl{font-size:.6rem;letter-spacing:.2em;color:var(--mut);text-transform:uppercase;margin-bottom:.8rem;margin-top:0;}
.prompt-box{border:1px solid var(--brd);background:var(--sur);padding:1.2rem 1.5rem;margin-bottom:2.5rem;font-family:'Fraunces',serif;font-size:1rem;font-style:italic;line-height:1.7;color:#bbb;}
.verdict{border:1px solid var(--acc);padding:1.8rem 2.2rem;margin-bottom:3rem;}
.vey{font-size:.6rem;letter-spacing:.25em;color:var(--acc);text-transform:uppercase;margin-bottom:.5rem;}
.vwin{font-family:'Bebas Neue',sans-serif;font-size:clamp(2.5rem,5vw,4rem);line-height:1;margin-bottom:.3rem;}
.vwin em{color:var(--acc);font-style:normal;}
.vscore{font-size:.68rem;color:var(--mut);}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.2rem;margin-bottom:3rem;}
.card{border:1px solid var(--brd);background:var(--sur);display:flex;flex-direction:column;}
.card.winner{border-color:var(--rank-color,var(--brd));}
.card-head{padding:.9rem 1.1rem .7rem;border-bottom:1px solid var(--brd);display:flex;align-items:center;justify-content:space-between;gap:.5rem;}
.card-name{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:.04em;}
.card-ver{font-size:.56rem;color:var(--mut);letter-spacing:.1em;}
.card-rank{font-family:'Bebas Neue',sans-serif;font-size:1rem;width:1.8rem;height:1.8rem;display:flex;align-items:center;justify-content:center;border:1px solid;flex-shrink:0;}
.card-response{padding:.9rem 1.1rem;font-family:'Fraunces',serif;font-size:.77rem;line-height:1.75;color:#888;flex:1;max-height:160px;overflow-y:auto;font-style:italic;}
.card-response::-webkit-scrollbar{width:2px;}
.err{color:#ff4444;font-style:normal;font-family:'IBM Plex Mono',monospace;font-size:.7rem;}
.card-dims{padding:.7rem 1.1rem;border-top:1px solid var(--brd);display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;}
.dim{display:flex;flex-direction:column;align-items:center;gap:.2rem;}
.dim-label{font-size:.5rem;letter-spacing:.08em;color:var(--mut);text-transform:uppercase;text-align:center;}
.dim-val{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;line-height:1;}
.dim-bar{width:100%;height:2px;background:var(--brd);position:relative;}
.dim-fill{position:absolute;left:0;top:0;bottom:0;background:var(--acc);}
.card-score{padding:.55rem 1.1rem;border-top:1px solid var(--brd);display:flex;align-items:center;gap:.8rem;background:rgba(200,255,0,.03);}
.score-lbl{font-size:.58rem;letter-spacing:.1em;color:var(--mut);text-transform:uppercase;flex:1;}
.score-val{font-family:'Bebas Neue',sans-serif;font-size:1.8rem;line-height:1;}
.score-votes{font-size:.58rem;color:var(--mut);}
.section{margin-bottom:3rem;}
.matrix-wrap{overflow-x:auto;}
table.matrix{border-collapse:collapse;font-size:.68rem;width:100%;}
table.matrix th,table.matrix td{border:1px solid var(--brd);padding:.4rem .6rem;text-align:center;white-space:nowrap;}
table.matrix th{background:var(--sur);color:var(--mut);font-weight:600;letter-spacing:.05em;}
td.self{color:var(--mut);}td.no-data{color:var(--brd);}
.row-head{background:var(--sur);color:var(--mut);font-weight:600;text-align:left !important;}
/* CHARTS */
.charts-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:3rem;}
@media(max-width:900px){.charts-grid{grid-template-columns:1fr;}}
.chart-box{border:1px solid var(--brd);background:var(--sur);padding:1.2rem;}
.chart-box canvas{max-height:260px;}
.chart-title{font-size:.6rem;letter-spacing:.15em;color:var(--mut);text-transform:uppercase;margin-bottom:1rem;}
/* HISTORY TABLE */
table.hist{border-collapse:collapse;font-size:.65rem;width:100%;}
table.hist th,table.hist td{border:1px solid var(--brd);padding:.4rem .8rem;text-align:left;vertical-align:top;}
table.hist th{background:var(--sur);color:var(--mut);font-weight:600;letter-spacing:.1em;text-transform:uppercase;}
.hw{color:var(--mut);white-space:nowrap;min-width:100px;}
.hp{font-family:'Fraunces',serif;font-style:italic;color:#888;max-width:300px;}
.hwin{color:var(--acc);font-family:'Bebas Neue',sans-serif;font-size:.95rem;white-space:nowrap;}
.hrank{color:#555;font-size:.6rem;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:var(--bg);}::-webkit-scrollbar-thumb{background:var(--brd);}
</style>
</head>
<body>
<header>
  <div class="logo">LLM <em>BATTLE</em></div>
  <div class="meta">
    <span class="wtag">${weekLabel}</span><br>
    Comparativa semanal · scoring cruzado<br>
    ${dateStr}
  </div>
</header>
<div class="wrap">

  <div class="lbl">// Prompt de esta semana</div>
  <div class="prompt-box">${prompt}</div>

  <div class="verdict">
    <div class="vey">// Ganador de esta semana</div>
    <div class="vwin">${winner ? `${winner.name} <em>gana esta semana</em>` : 'Sin ganador'}</div>
    <div class="vscore">${winner ? `Score: ${winner.finalScore?.toFixed(2)} / 10  ·  ${ranking.filter(r=>r.finalScore!==null).map((r,i)=>`${i+1}. ${r.name} (${r.finalScore?.toFixed(2)})`).join('  ·  ')}` : ''}</div>
  </div>

  <div class="lbl">// Resultados de esta semana — ${ranking.filter(r=>r.finalScore!==null).length} modelos</div>
  <div class="grid">${cardsHTML}</div>

  <div class="section">
    <div class="lbl">// Matriz de scoring cruzado (fila = evaluador · columna = evaluado · promedio 4 dims)</div>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th>↓ eval / target →</th>${matrixHeaderCells}</tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
  </div>

  ${history.length > 0 ? `
  <div class="lbl" style="margin-top:3rem">// Análisis histórico — ${weeks.length} semanas · ${history.length} registros</div>
  <div class="charts-grid">

    <div class="chart-box">
      <div class="chart-title">Evolución de score por semana</div>
      <canvas id="chartTrend"></canvas>
    </div>

    <div class="chart-box">
      <div class="chart-title">Victorias acumuladas</div>
      <canvas id="chartWins"></canvas>
    </div>

    <div class="chart-box">
      <div class="chart-title">Score promedio histórico por modelo</div>
      <canvas id="chartAvg"></canvas>
    </div>

    <div class="chart-box">
      <div class="chart-title">Fortalezas por dimensión (promedio histórico)</div>
      <canvas id="chartRadar"></canvas>
    </div>

  </div>

  <div class="section">
    <div class="lbl">// Historial de batallas</div>
    <div style="overflow-x:auto">
      <table class="hist">
        <thead><tr><th>Semana</th><th>Prompt</th><th>Ganador</th><th>Ranking completo</th></tr></thead>
        <tbody>${histTableRows}</tbody>
      </table>
    </div>
  </div>
  ` : '<div class="lbl" style="color:var(--mut);margin-top:2rem">// Historial disponible desde la segunda batalla</div>'}

</div>

<script>
const DATA = ${chartJSON};

// Paleta de colores por modelo (consistente entre gráficas)
const PALETTE = [
  '#c8ff00','#ff4757','#3cc8ff','#ffd700','#ff7f50','#a78bfa','#34d399','#f472b6'
];
const modelColor = name => {
  const idx = DATA.modelNames.indexOf(name);
  return PALETTE[idx % PALETTE.length];
};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: { legend: { labels: { color: '#888', font: { family: 'IBM Plex Mono', size: 11 }, boxWidth: 12 } } },
};

// 1. Evolución de score por semana (líneas)
if (document.getElementById('chartTrend') && DATA.weeks.length > 0) {
  new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: {
      labels: DATA.weeks,
      datasets: DATA.modelNames.map(m => ({
        label: m,
        data: DATA.weeks.map(w => DATA.chartData[m]?.[w] ?? null),
        borderColor: modelColor(m),
        backgroundColor: modelColor(m) + '22',
        pointBackgroundColor: modelColor(m),
        borderWidth: 2,
        pointRadius: 4,
        tension: 0.3,
        spanGaps: true,
      }))
    },
    options: {
      ...chartDefaults,
      scales: {
        x: { ticks: { color:'#555', font:{size:10} }, grid: { color:'#1c1c1c' } },
        y: { min: 0, max: 10, ticks: { color:'#555', font:{size:10} }, grid: { color:'#1c1c1c' } }
      }
    }
  });
}

// 2. Victorias acumuladas (barras horizontales)
if (document.getElementById('chartWins') && DATA.modelNames.length > 0) {
  const sorted = Object.entries(DATA.winsPerModel).sort((a,b)=>b[1]-a[1]);
  new Chart(document.getElementById('chartWins'), {
    type: 'bar',
    data: {
      labels: sorted.map(([m]) => m),
      datasets: [{
        label: 'Victorias',
        data: sorted.map(([,v]) => v),
        backgroundColor: sorted.map(([m]) => modelColor(m)),
        borderWidth: 0,
      }]
    },
    options: {
      ...chartDefaults,
      indexAxis: 'y',
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        x: { ticks: { color:'#555', stepSize:1 }, grid: { color:'#1c1c1c' } },
        y: { ticks: { color:'#888', font:{size:11} }, grid: { color:'#1c1c1c' } }
      }
    }
  });
}

// 3. Score promedio histórico (barras verticales)
if (document.getElementById('chartAvg') && DATA.modelNames.length > 0) {
  const avgs = DATA.modelNames.map(m => {
    const vals = Object.values(DATA.chartData[m]).filter(v=>v!==null);
    return vals.length ? (vals.reduce((s,v)=>s+v,0)/vals.length) : 0;
  });
  const sorted = DATA.modelNames.map((m,i) => ({m, v:avgs[i]})).sort((a,b)=>b.v-a.v);
  new Chart(document.getElementById('chartAvg'), {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.m),
      datasets: [{
        label: 'Score promedio',
        data: sorted.map(d => d.v.toFixed(3)),
        backgroundColor: sorted.map(d => modelColor(d.m)),
        borderWidth: 0,
      }]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        x: { ticks: { color:'#888', font:{size:10} }, grid: { color:'#1c1c1c' } },
        y: { min: 0, max: 10, ticks: { color:'#555', font:{size:10} }, grid: { color:'#1c1c1c' } }
      }
    }
  });
}

// 4. Radar de fortalezas por dimensión
if (document.getElementById('chartRadar') && DATA.modelNames.length > 0) {
  const dims = ['claridad','profundidad','originalidad','concision'];
  const dimLabels = ['Claridad','Profundidad','Originalidad','Concisión'];
  new Chart(document.getElementById('chartRadar'), {
    type: 'radar',
    data: {
      labels: dimLabels,
      datasets: DATA.modelNames.map(m => ({
        label: m,
        data: dims.map(d => DATA.dimAvgsHistory[m]?.[d] ?? 0),
        borderColor: modelColor(m),
        backgroundColor: modelColor(m) + '18',
        pointBackgroundColor: modelColor(m),
        borderWidth: 2,
      }))
    },
    options: {
      ...chartDefaults,
      scales: {
        r: {
          min: 0, max: 10,
          ticks: { color:'#555', backdropColor:'transparent', stepSize:2 },
          grid: { color:'#2a2a2a' },
          pointLabels: { color:'#888', font:{size:10} },
          angleLines: { color:'#2a2a2a' },
        }
      }
    }
  });
}
</script>
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
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_KEY}`, {
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

  // 1. Generar prompt
  const prompt = await generateWeeklyPrompt();

  // 2. Respuestas
  const responses = await getAllResponses(prompt);

  // 3. Scoring cruzado
  const allScores = await crossScore(prompt, responses);

  // 4. Ranking
  console.log('\n🏆 Calculando ranking...');
  const ranking = computeRanking(responses, allScores);
  ranking.forEach((m, i) => {
    const score = m.finalScore !== null ? m.finalScore.toFixed(2) : 'sin score';
    console.log(`   ${i+1}. ${m.name} — ${score}`);
  });

  // 5. Google Sheets
  await writeToSheets(ranking, prompt, weekLabel, allScores);

  // 6. Leer historial completo para las gráficas
  console.log('\n📈 Leyendo historial para gráficas...');
  const history = await readHistoryFromSheets();
  console.log(`   ${history.length} registros históricos`);

  // 7. Generar HTML
  console.log('\n🌐 Generando HTML...');
  if (!fs.existsSync('docs')) fs.mkdirSync('docs');
  const html = buildHTML(prompt, ranking, weekLabel, allScores, history);
  fs.writeFileSync('docs/index.html', html);
  console.log('   ✓ docs/index.html generado');

  console.log('\n✅ Batalla completada.\n');
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
