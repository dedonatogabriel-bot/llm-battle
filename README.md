# LLM Battle — Comparativa semanal automática

Cada lunes a las 9:00 UTC, GitHub Actions:
1. Genera un prompt nuevo via Claude
2. Se lo manda a todos los modelos configurados
3. Cada modelo evalúa las respuestas de los demás (scoring cruzado)
4. El ranking sale de matemática pura: promedio de todas las evaluaciones recibidas
5. Graba los resultados en Google Sheets (historial permanente)
6. Publica el HTML en GitHub Pages con gráficas de tendencia histórica

---

## Setup (una sola vez)

### 1. Crear el repositorio en GitHub

```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/TU_USUARIO/llm-battle.git
git push -u origin main
```

---

### 2. Configurar Google Sheets

**Crear el Sheet:**
1. Nuevo Google Sheet en sheets.google.com
2. Crear dos pestañas con nombres exactos: `Resultados` y `ScoresCruzados`
3. En `Resultados` fila 1: `Semana | Fecha | Prompt | Modelo | Score | Claridad | Profundidad | Originalidad | Concisión | Votos`
4. En `ScoresCruzados` fila 1: `Semana | Fecha | Evaluador | Evaluado | Claridad | Profundidad | Originalidad | Concisión | Promedio`
5. Copiar el ID del Sheet de la URL: `docs.google.com/spreadsheets/d/`**`ESTE_ID`**`/edit`

**Crear Service Account:**
1. console.cloud.google.com → crear o usar un proyecto
2. APIs & Services → Library → **Google Sheets API** → Enable
3. IAM & Admin → Service Accounts → Create → nombre: `llm-battle-bot`
4. Entrar al Service Account → Keys → Add Key → Create new key → **JSON** → descargar

**Dar acceso al Sheet:**
1. Abrir el JSON descargado, copiar el valor de `client_email`
2. En el Google Sheet → Compartir → pegar ese email → rol **Editor**

---

### 3. Secrets en GitHub

Settings → Secrets and variables → Actions → New repository secret

| Secret | Valor |
|--------|-------|
| `ANTHROPIC_KEY` | console.anthropic.com |
| `OPENAI_KEY` | platform.openai.com/api-keys |
| `GEMINI_KEY` | aistudio.google.com/app/apikey |
| `GROK_KEY` | console.x.ai |
| `KIMI_KEY` | platform.moonshot.cn |
| `DEEPSEEK_KEY` | platform.deepseek.com |
| `AZURE_KEY` | Azure Portal → tu recurso OpenAI |
| `AZURE_ENDPOINT` | Azure Portal → URL del recurso |
| `GOOGLE_SHEET_ID` | El ID del Sheet (paso 2) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Contenido completo del archivo JSON |

Los modelos sin key se omiten. Con 2+ modelos funciona.

---

### 4. GitHub Pages

Settings → Pages → Branch: main → Folder: /docs

URL: `https://TU_USUARIO.github.io/llm-battle/`

Para disparar a mano: Actions → LLM Weekly Battle → Run workflow

---

## Métricas disponibles

**HTML (GitHub Pages):**
- Resultados de la semana + scoring cruzado completo
- Evolución de score por semana (líneas)
- Victorias acumuladas (barras)
- Score promedio histórico por modelo
- Radar de fortalezas por dimensión
- Tabla con prompt + ganador + ranking de cada semana

**Google Sheets (datos crudos para análisis propio):**
- `Resultados`: una fila por modelo por semana
- `ScoresCruzados`: una fila por par evaluador/evaluado
