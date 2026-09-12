/**
 * /api/ai — function serverless da Vercel (Node.js runtime).
 * ---------------------------------------------------------------------
 * Ponte segura entre o NEXUS (index.html) e a OpenAI Responses API.
 *
 * - A OPENAI_API_KEY só existe aqui, lida de variável de ambiente do
 *   projeto na Vercel. Nunca é enviada ao navegador do jogador.
 * - O frontend chama SEMPRE "/api/ai" (mesma origem) — nunca a OpenAI
 *   diretamente.
 * - Só retorna ao frontend a resposta da IA (texto ou JSON da análise),
 *   nunca o corpo bruto da OpenAI, tokens de uso, ids internos, etc.
 *
 * Configuração necessária no projeto da Vercel (Settings → Environment
 * Variables):
 *   OPENAI_API_KEY   (obrigatória)
 *   OPENAI_MODEL      (opcional — padrão: gpt-5.6-luna)
 */

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

const MAX_QUESTION_LENGTH = 500;   // limite básico de tamanho da mensagem do jogador
const MAX_BODY_LENGTH = 20000;     // limite básico de tamanho do corpo inteiro (em caracteres JSON)
const OPENAI_TIMEOUT_MS = 25000;   // timeout da chamada à OpenAI — deixa folga dentro do maxDuration do vercel.json

/* -----------------------------------------------------------------------
   Limite básico de requisições por IP (em memória — reinicia a cada cold
   start da function; suficiente como primeira linha de defesa contra
   abuso/gasto descontrolado de crédito). Para um limite robusto e
   compartilhado entre instâncias, use um serviço externo como Upstash
   Redis (@upstash/ratelimit).
   ----------------------------------------------------------------------- */
const requestLog = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const arr = (requestLog.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  requestLog.set(ip, arr);
  return arr.length > RATE_MAX_PER_WINDOW;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

/* -----------------------------------------------------------------------
   Prompt de sistema — sempre ancorado nos dados reais recebidos do jogo.
   ----------------------------------------------------------------------- */
function buildSystemPrompt(mode) {
  const base =
    'Você é o NEXUS CEO, uma consultora de negócios integrada a um jogo de simulação empresarial. ' +
    'Você recebe o estado ATUAL e REAL da empresa do jogador em JSON. Baseie sua resposta apenas nesses ' +
    'números — nunca invente dados que não estejam no JSON. Seja direta, prática e específica, citando os ' +
    'valores relevantes. Responda sempre em português do Brasil.';

  if (mode === 'analysis') {
    return (
      base +
      ' Modo: ANÁLISE AUTOMÁTICA. Responda APENAS com um JSON válido, sem markdown, sem texto fora do JSON, ' +
      'exatamente neste formato: {"situacao_atual": "...", "principal_problema": "...", ' +
      '"melhor_oportunidade": "...", "recomendacao": "...", "risco_financeiro": "..."}. Cada campo deve ter no ' +
      'máximo 2 frases curtas e diretas. Se o saldo estiver negativo ou perto da falência, deixe isso explícito ' +
      'no campo "risco_financeiro".'
    );
  }
  return base + ' Modo: PERGUNTA LIVRE. Responda a pergunta do jogador em um parágrafo curto (no máximo 4-5 frases).';
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  let text = '';
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
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
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  // -------- método --------
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido. Use POST.' });
    return;
  }

  // -------- limite básico de requisições --------
  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Muitas requisições. Aguarde um pouco antes de perguntar de novo.' });
    return;
  }

  // -------- chave da OpenAI --------
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[api/ai] OPENAI_API_KEY não configurada nas variáveis de ambiente da Vercel.');
    res.status(500).json({ error: 'Servidor sem OPENAI_API_KEY configurada.' });
    return;
  }

  // -------- corpo da requisição (bloqueio contra requisições vazias/; limite de tamanho) --------
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    res.status(400).json({ error: 'Corpo da requisição vazio ou inválido.' });
    return;
  }
  if (JSON.stringify(body).length > MAX_BODY_LENGTH) {
    res.status(413).json({ error: 'Requisição grande demais.' });
    return;
  }

  const { mode, question, state } = body;

  if (mode !== 'analysis' && mode !== 'chat') {
    res.status(400).json({ error: 'Modo inválido (use "analysis" ou "chat").' });
    return;
  }
  if (!state || typeof state !== 'object') {
    res.status(400).json({ error: 'Estado da empresa não enviado ou inválido.' });
    return;
  }
  if (mode === 'chat') {
    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) {
      res.status(400).json({ error: 'Pergunta vazia.' });
      return;
    }
    if (q.length > MAX_QUESTION_LENGTH) {
      res.status(400).json({ error: 'Pergunta longa demais (máximo ' + MAX_QUESTION_LENGTH + ' caracteres).' });
      return;
    }
  }

  const systemPrompt = buildSystemPrompt(mode);
  const userContent =
    mode === 'analysis'
      ? 'Estado atual da empresa (JSON):\n' + JSON.stringify(state)
      : 'Estado atual da empresa (JSON):\n' + JSON.stringify(state) + '\n\nPergunta do jogador: ' + question.trim();

  // -------- chamada server-side à OpenAI, com timeout --------
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  let openaiRes;
  try {
    openaiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: systemPrompt,
        input: userContent,
        max_output_tokens: 500,
        temperature: 0.4
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'A IA demorou demais para responder. Tente novamente.' });
      return;
    }
    console.error('[api/ai] Falha de rede ao chamar a OpenAI:', err);
    res.status(502).json({ error: 'Não foi possível conectar à OpenAI.' });
    return;
  }
  clearTimeout(timeoutId);

  if (!openaiRes.ok) {
    const errBody = await openaiRes.text().catch(() => '');
    console.error('[api/ai] Erro da OpenAI:', openaiRes.status, errBody);
    res.status(502).json({ error: 'Erro ao consultar a IA. Tente novamente em instantes.' });
    return;
  }

  let data;
  try {
    data = await openaiRes.json();
  } catch (e) {
    res.status(502).json({ error: 'Resposta inválida da IA.' });
    return;
  }

  const text = extractOutputText(data);

  // -------- retorna ao frontend SOMENTE a resposta da IA --------
  if (mode === 'analysis') {
    let parsed;
    try {
      parsed = parseJsonLoose(text);
    } catch (e) {
      console.error('[api/ai] Resposta da IA não é JSON válido:', text);
      res.status(502).json({ error: 'A IA retornou um formato inesperado.' });
      return;
    }
    res.status(200).json({ analysis: parsed });
    return;
  }

  res.status(200).json({ answer: (text || '').trim() || 'A IA não retornou conteúdo.' });
};
