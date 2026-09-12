# NEXUS CEO — como ativar a consultora de IA

O jogo (`index.html`) funciona **sozinho, sem internet**, para tudo que não seja a IA:
economia, funcionários, estoque, vendas, marketing, banco, eventos, save/load. Isso
continua valendo mesmo sem configurar nada abaixo.

A aba **"IA CEO"** é a única parte que depende de um servidor externo, porque a chave
da OpenAI **nunca pode ficar dentro de um arquivo HTML público** — qualquer pessoa que
abrisse o arquivo ou olhasse o código-fonte poderia roubá-la e gastar seu crédito.
Por isso a chave mora em um pequeno backend, separado do jogo.

## Passo a passo (rodando no seu computador)

1. Você vai precisar do [Node.js](https://nodejs.org) instalado (versão 18 ou mais nova).
2. Abra um terminal dentro da pasta `nexus-ceo-backend/`.
3. Instale as dependências:
   ```
   npm install
   ```
4. Copie o arquivo de exemplo de variáveis de ambiente e edite-o:
   ```
   cp .env.example .env
   ```
   Abra o `.env` e cole sua chave da OpenAI em `OPENAI_API_KEY`. Ajuste `OPENAI_MODEL`
   se quiser usar outro modelo disponível na sua conta.
5. Inicie o servidor:
   ```
   npm start
   ```
   Você verá algo como `Backend rodando em http://localhost:3001`.
6. Abra o `index.html` do jogo, vá na aba **IA CEO** e cole no campo "Endereço do
   servidor de IA":
   ```
   http://localhost:3001/api/nexus-ceo
   ```
   Clique em "Salvar endereço". Pronto — os botões "Rodar Análise da Empresa" e o
   chat de perguntas já vão funcionar.

## Publicando o backend (para jogar de qualquer lugar/celular)

O mesmo `server.js` pode ser publicado em qualquer serviço que rode Node.js (Render,
Railway, Fly.io, um VPS, etc.). O processo é sempre parecido:

1. Suba a pasta `nexus-ceo-backend/` para o serviço escolhido.
2. Configure lá as mesmas variáveis do `.env` (`OPENAI_API_KEY`, `OPENAI_MODEL`, `PORT`)
   como variáveis de ambiente do painel — nunca envie o arquivo `.env` de verdade.
3. O serviço vai te dar uma URL pública (ex: `https://seu-app.onrender.com`).
4. No jogo, cole `https://seu-app.onrender.com/api/nexus-ceo` no campo de endereço.

## O que o backend faz

- Recebe do jogo o estado **real e atual** da empresa (saldo, receita, despesas,
  estoque, funcionários, reputação, empréstimos, últimos eventos etc.).
- Monta um prompt para a OpenAI Responses API (`POST /v1/responses`) com esses dados.
- Em modo "análise", pede uma resposta estruturada com 5 campos (situação atual,
  principal problema, melhor oportunidade, recomendação, risco financeiro) e devolve
  isso como JSON para o jogo montar o painel de consultoria.
- Em modo "pergunta livre", devolve a resposta da IA para aparecer no chat.
- Tem um limite básico de requisições por IP (8 por minuto) para evitar abuso e gasto
  descontrolado de crédito da OpenAI. O jogo também tem seu próprio limite no
  navegador (intervalo mínimo entre perguntas e um teto por dia).

## Segurança

- **Nunca** publique seu arquivo `.env` real (com a chave preenchida) em um
  repositório público, PR, print de tela ou qualquer lugar aberto.
- Se desconfiar que uma chave vazou, revogue-a no painel da OpenAI e gere outra.
