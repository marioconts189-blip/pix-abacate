const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ABACATEPAY_API_KEY = process.env.ABACATEPAY_API_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "pix123seguro";
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

const paidPayments = new Map();

app.use(cors({
  origin: FRONTEND_URL === "*" ? "*" : FRONTEND_URL.split(",").map(s => s.trim())
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireApiKey() {
  if (!ABACATEPAY_API_KEY) {
    throw new Error("ABACATEPAY_API_KEY não configurada no Render.");
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Servidor PIX online" });
});

app.post("/api/create-pix", async (req, res) => {
  try {
    requireApiKey();

    const amount = Number(req.body.amount);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Informe um valor válido." });
    }

    const amountInCents = Math.round(amount * 100);

    console.log("Criando PIX AbacatePay:", {
      amount,
      amountInCents
    });

    const response = await fetch("https://api.abacatepay.com/v2/transparents/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ABACATEPAY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        method: "PIX",
        data: {
          amount: amountInCents
        }
      })
    });

    const resultText = await response.text();

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      result = { raw: resultText };
    }

    console.log("Resposta AbacatePay:", {
      statusHttp: response.status,
      body: result
    });

    if (!response.ok || result.error || !result.data) {
      return res.status(response.status || 400).json({
        error: "Erro ao criar PIX na AbacatePay.",
        statusHttp: response.status,
        details: result
      });
    }

    const payment = result.data;
    paidPayments.set(payment.id, payment.status || "PENDING");

    return res.json({
      id: payment.id,
      status: payment.status,
      brCode: payment.brCode,
      brCodeBase64: payment.brCodeBase64,
      expiresAt: payment.expiresAt,
      amount: payment.amount,
      devMode: payment.devMode
    });

  } catch (error) {
    console.error("Erro geral ao criar PIX:", error);
    return res.status(500).json({
      error: error.message
    });
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

    console.log("Consulta pagamento:", {
      id,
      statusHttp: response.status,
      body: result
    });

    if (!response.ok || result.error) {
      return res.status(response.status || 400).json({
        error: "Erro ao consultar pagamento.",
        details: result
      });
    }

    const status = result.data?.status || "PENDING";
    paidPayments.set(id, status);

    return res.json({
      id,
      status,
      expiresAt: result.data?.expiresAt
    });

  } catch (error) {
    console.error("Erro ao consultar:", error);
    return res.status(500).json({ error: error.message });
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
      body: JSON.stringify({})
    });

    const result = await response.json();

    console.log("Simulação pagamento:", {
      id,
      statusHttp: response.status,
      body: result
    });

    if (!response.ok || result.error) {
      return res.status(response.status || 400).json({
        error: "Erro ao simular pagamento.",
        details: result
      });
    }

    paidPayments.set(id, "PAID");
    return res.json({ ok: true, status: "PAID", data: result.data });

  } catch (error) {
    console.error("Erro simulação:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/webhook/abacatepay", (req, res) => {
  try {
    if (req.query.webhookSecret !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Webhook não autorizado." });
    }

    const payload = req.body;
    const event = payload.event;
    const data = payload.data || {};
    const paymentId = data.id || data.paymentId || data.checkoutId || data.transparentId;

    console.log("Webhook recebido:", {
      event,
      paymentId,
      payload
    });

    if (event === "transparent.completed" && paymentId) {
      paidPayments.set(paymentId, "PAID");
    }

    return res.json({ received: true });

  } catch (error) {
    console.error("Erro webhook:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
