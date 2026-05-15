const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ABACATEPAY_API_KEY = process.env.ABACATEPAY_API_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "troque-esse-secret";
const ABACATEPAY_PUBLIC_KEY = process.env.ABACATEPAY_PUBLIC_KEY || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

const paidPayments = new Map();

app.use(cors({
  origin: FRONTEND_URL === "*" ? "*" : FRONTEND_URL.split(",").map(s => s.trim())
}));

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function requireApiKey() {
  if (!ABACATEPAY_API_KEY) {
    throw new Error("Configure ABACATEPAY_API_KEY nas variáveis de ambiente do Render.");
  }
}

function verifyWebhookSignature(rawBody, signatureFromHeader) {
  if (!ABACATEPAY_PUBLIC_KEY || !signatureFromHeader) {
    return true; // Para teste inicial. Em produção, configure ABACATEPAY_PUBLIC_KEY.
  }

  const expectedSig = crypto
    .createHmac("sha256", ABACATEPAY_PUBLIC_KEY)
    .update(Buffer.from(rawBody || "", "utf8"))
    .digest("base64");

  const a = Buffer.from(expectedSig);
  const b = Buffer.from(signatureFromHeader);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Servidor PIX online" });
});

app.post("/api/create-pix", async (req, res) => {
  try {
    requireApiKey();

    const amount = Number(req.body.amount);
    const description = String(req.body.description || "Pagamento PIX").slice(0, 37);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Informe um valor válido." });
    }

    const amountInCents = Math.round(amount * 100);
    const externalId = "pedido_" + Date.now();

    const response = await fetch("https://api.abacatepay.com/v2/transparents/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ABACATEPAY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        method: "PIX",
        data: {
          amount: amountInCents,
          expiresIn: 3600,
          description,
          externalId,
          metadata: {
            origem: "site-pix",
            externalId
          }
        }
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      return res.status(response.status || 400).json({
        error: "Erro ao criar PIX na AbacatePay.",
        details: result
      });
    }

    const payment = result.data;
    paidPayments.set(payment.id, payment.status || "PENDING");

    res.json({
      id: payment.id,
      status: payment.status,
      brCode: payment.brCode,
      brCodeBase64: payment.brCodeBase64,
      expiresAt: payment.expiresAt,
      amount: payment.amount,
      devMode: payment.devMode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/check/:id", async (req, res) => {
  try {
    requireApiKey();

    const id = req.params.id;

    if (paidPayments.get(id) === "PAID") {
      return res.json({ id, status: "PAID" });
    }

    const url = new URL("https://api.abacatepay.com/v2/transparents/check");
    url.searchParams.set("id", id);

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${ABACATEPAY_API_KEY}`
      }
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      return res.status(response.status || 400).json({
        error: "Erro ao consultar status.",
        details: result
      });
    }

    const status = result.data?.status || "PENDING";
    paidPayments.set(id, status);

    res.json({
      id,
      status,
      expiresAt: result.data?.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/simulate/:id", async (req, res) => {
  try {
    requireApiKey();

    const id = req.params.id;
    const url = new URL("https://api.abacatepay.com/v2/transparents/simulate-payment");
    url.searchParams.set("id", id);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ABACATEPAY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ metadata: { teste: true } })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      return res.status(response.status || 400).json({
        error: "Erro ao simular pagamento. Isso só funciona no Sandbox.",
        details: result
      });
    }

    paidPayments.set(id, "PAID");
    res.json({ ok: true, status: "PAID", data: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/webhook/abacatepay", (req, res) => {
  try {
    if (req.query.webhookSecret !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Webhook não autorizado." });
    }

    const signature = req.get("X-Webhook-Signature");

    if (!verifyWebhookSignature(req.rawBody, signature)) {
      return res.status(401).json({ error: "Assinatura inválida." });
    }

    const payload = req.body;
    const event = payload.event;
    const data = payload.data || {};
    const paymentId = data.id || data.paymentId || data.checkoutId || data.transparentId;

    if (event === "transparent.completed" && paymentId) {
      paidPayments.set(paymentId, "PAID");
    }

    console.log("Webhook recebido:", event, paymentId || "sem id");
    res.json({ received: true });
  } catch (error) {
    console.error("Erro webhook:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
