# Deploy do NEXUS na Vercel

Estrutura do projeto (é exatamente isso que vai para o repositório/deploy):

```
/
├── index.html      → o jogo (frontend)
├── api/
│   └── ai.js       → function serverless que fala com a OpenAI
└── vercel.json     → configuração da function e headers
```

Não há `package.json` porque `api/ai.js` não usa nenhuma dependência externa
(usa `fetch` e `AbortController`, nativos do runtime Node.js da Vercel).

## 1. Subir o projeto

Pela CLI:
```
npm i -g vercel
vercel login
vercel
```
Ou: suba esses 3 itens para um repositório no GitHub/GitLab e importe o
repositório em https://vercel.com/new.

## 2. Configurar a variável de ambiente

No painel do projeto na Vercel: **Settings → Environment Variables**, adicione:

| Nome              | Valor                        |
|-------------------|-------------------------------|
| `OPENAI_API_KEY`  | sua chave da OpenAI           |
| `OPENAI_MODEL`    | *(opcional)* padrão: `gpt-5.6-luna` |

Depois de adicionar, refaça o deploy (`vercel --prod`) para as variáveis entrarem em vigor.

## 3. Testar

Abra a URL pública gerada pela Vercel, vá na aba **IA CEO** e clique em
"Rodar Análise da Empresa". O jogo sempre chama `/api/ai` (mesma origem) —
nunca a OpenAI diretamente, e a chave nunca aparece no navegador.

## Segurança já embutida em `api/ai.js`

- A chave só existe como variável de ambiente do servidor.
- Só aceita `POST`; qualquer outro método é rejeitado.
- Bloqueia corpo vazio/inválido e limita o tamanho da pergunta (500 caracteres)
  e do corpo da requisição (~20 KB).
- Timeout de 25s na chamada à OpenAI (dentro do `maxDuration: 30` do
  `vercel.json`), retornando erro claro em vez de travar.
- Limite básico de requisições por IP (8 por minuto) contra abuso.
- Devolve ao frontend só a resposta da IA — nunca o corpo bruto da OpenAI,
  tokens de uso ou ids internos.
- Sem CORS: como o jogo e a function moram na mesma origem, não é preciso
  liberar `Access-Control-Allow-Origin`, o que reduz a superfície de ataque.
