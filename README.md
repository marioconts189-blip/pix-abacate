# PIX automático com AbacatePay

Arquivos para subir no GitHub e hospedar no Render.

## Variáveis no Render

Configure em Environment:

- ABACATEPAY_API_KEY = sua chave da AbacatePay
- WEBHOOK_SECRET = coloque uma frase secreta, exemplo: pix123seguro
- FRONTEND_URL = * para teste, depois coloque seu domínio
- ABACATEPAY_PUBLIC_KEY = opcional para validar HMAC do webhook

## Comandos no Render

Build Command:
npm install

Start Command:
node server.js

## Webhook

Depois do deploy, cadastre na AbacatePay:

https://SEU-LINK-DO-RENDER.onrender.com/webhook/abacatepay?webhookSecret=SEU_WEBHOOK_SECRET

Evento:
transparent.completed
