/**
 * NEXUS CEO — backend de exemplo
 * ---------------------------------------------------------------
 * Este servidor recebe o estado da empresa vindo do jogo (index.html)
 * e repassa para a OpenAI Responses API (POST /v1/responses).
 *
 * A chave da OpenAI SÓ existe aqui, no servidor, lida de variável de
 * ambiente (.env). Ela nunca é enviada ao navegador do jogador.
 *
 * Como rodar localmente:
 *   1) npm install
 *   2) cp .env.example .env      (e cole sua OPENAI_API_KEY dentro)
 *   3) npm start
 *   4) no jogo (aba "IA CEO"), cole o endereço: http://localhost:3001/api/nexus-ceo
 *
 * Para publicar (Render, Railway, Fly.io, VPS, etc.), defina as mesmas
 * variáveis de ambiente no painel do serviço e aponte o jogo para a
 * URL pública gerada.
 */

import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '250kb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PORT = process.env.PORT || 3001;

if (!OPENAI_API_KEY) {
  console.warn('[NEXUS CEO] Aviso: OPENAI_API_KEY não definida no .env — as chamadas de IA vão falhar até você configurá-la.');
}

/* -----------------------------------------------------------------
   Limite básico de requisições (por IP, em memória).
   Para produção com múltiplas instâncias, troque por Redis ou
   um serviço de rate limit dedicado.
   ----------------------------------------------------------------- */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 8;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const arr = (requestLog.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  arr.push(now);
  requestLog.set(ip, arr);
  return arr.length > RATE_LIMIT_MAX_PER_WINDOW;
}

/* -----------------------------------------------------------------
   Prompts de sistema
   ----------------------------------------------------------------- */
function buildSystemPrompt(mode) {
  const base = 'Você é o NEXUS CEO, uma consultora de negócios integrada a um jogo de simulação empresarial. ' +
    'Você recebe o estado ATUAL e REAL da empresa do jogador em JSON. Baseie sua resposta apenas nesses ' +
    'números — nunca invente dados que não estejam no JSON. Seja direta, prática e específica, citando os ' +
    'valores relevantes. Responda em português do Brasil.';

  if (mode === 'analysis') {
    return base +
      ' Modo: ANÁLISE AUTOMÁTICA. Responda APENAS com um JSON válido, sem markdown, sem texto fora do JSON, ' +
      'exatamente neste formato: {"situacao_atual": "...", "principal_problema": "...", ' +
      '"melhor_oportunidade": "...", "recomendacao": "...", "risco_financeiro": "..."}. ' +
      'Cada campo deve ter no máximo 2 frases curtas e diretas. Se o saldo estiver negativo ou próximo do ' +
      'limite de falência, deixe isso explícito no campo "risco_financeiro".';
  }
  return base + ' Modo: PERGUNTA LIVRE. Responda a pergunta do jogador em um parágrafo curto, no máximo 4-5 frases.';
}

function extractOutputText(responsesApiData) {
  if (typeof responsesApiData.output_text === 'string' && responsesApiData.output_text) {
    return responsesApiData.output_text;
  }
  let text = '';
  if (Array.isArray(responsesApiData.output)) {
    for (const item of responsesApiData.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
        }
      }
    }
  }
  return text;
}

function parseJsonLoose(text) {
  const cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/* -----------------------------------------------------------------
   Rota principal
   ----------------------------------------------------------------- */
app.post('/api/nexus-ceo', async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde um pouco antes de perguntar de novo.' });
  }
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Servidor sem OPENAI_API_KEY configurada. Veja o README-NEXUS-CEO.md.' });
  }

  const { mode, question, state } = req.body || {};
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Estado da empresa não enviado ou inválido.' });
  }
  if (mode !== 'analysis' && mode !== 'chat') {
    return res.status(400).json({ error: 'Modo inválido (use "analysis" ou "chat").' });
  }
  if (mode === 'chat' && (!question || typeof question !== 'string')) {
    return res.status(400).json({ error: 'Pergunta ausente para o modo chat.' });
  }

  const systemPrompt = buildSystemPrompt(mode);
  const userContent = mode === 'analysis'
    ? 'Estado atual da empresa (JSON):\n' + JSON.stringify(state)
    : 'Estado atual da empresa (JSON):\n' + JSON.stringify(state) + '\n\nPergunta do jogador: ' + question;

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: systemPrompt,
        input: userContent,
        max_output_tokens: 500,
        temperature: 0.4
      })
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text();
      console.error('[NEXUS CEO] Erro da OpenAI:', openaiRes.status, errBody);
      return res.status(502).json({ error: 'Erro ao consultar a IA. Tente novamente em instantes.' });
    }

    const data = await openaiRes.json();
    const text = extractOutputText(data);

    if (mode === 'analysis') {
      let parsed;
      try {
        parsed = parseJsonLoose(text);
      } catch (e) {
        console.error('[NEXUS CEO] Resposta da IA não é JSON válido:', text);
        return res.status(502).json({ error: 'A IA retornou um formato inesperado.' });
      }
      return res.json({ analysis: parsed });
    }

    return res.json({ answer: text || 'A IA não retornou conteúdo.' });
  } catch (err) {
    console.error('[NEXUS CEO] Erro interno:', err);
    return res.status(500).json({ error: 'Erro interno no servidor da IA.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, model: OPENAI_MODEL, keyConfigured: !!OPENAI_API_KEY }));

app.listen(PORT, () => {
  console.log('[NEXUS CEO] Backend rodando em http://localhost:' + PORT);
  console.log('[NEXUS CEO] Endpoint do jogo: http://localhost:' + PORT + '/api/nexus-ceo');
});
