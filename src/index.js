import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const SERVICE_NAME = process.env.SERVICE_NAME || 'order-service';

// Endereços dos serviços downstream.
// Em Kubernetes viram os DNS internos: http://payment-service.payment-service.svc.cluster.local:3002
const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002';
const SHIPPING_URL = process.env.SHIPPING_SERVICE_URL || 'http://localhost:3003';

function log(level, message, extra = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    message,
    ...extra,
  }));
}

// ---------------------------------------------------------------------------
// Health / readiness
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'UP', service: SERVICE_NAME });
});

// ---------------------------------------------------------------------------
// POST /orders  — o fluxo de negócio principal
//
// Encadeamento: order -> payment -> shipping
// Se o pagamento for recusado (402), o envio nem chega a ser chamado.
// ---------------------------------------------------------------------------
app.post('/orders', async (req, res) => {
  const { productId, amount, shippingAddress } = req.body ?? {};

  if (!productId || typeof amount !== 'number' || !shippingAddress) {
    log('warn', 'Invalid order payload received');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'productId (string), amount (number) and shippingAddress (string) are required',
    });
  }

  const orderId = randomUUID();
  log('info', 'Order received', { orderId, productId, amount });

  // ---- Passo 1: autorizar o pagamento -------------------------------------
  let payment;
  try {
    const paymentResponse = await fetch(`${PAYMENT_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, amount }),
    });

    if (paymentResponse.status === 402) {
      log('warn', 'Payment declined', { orderId });
      return res.status(402).json({
        orderId,
        status: 'PAYMENT_DECLINED',
        message: 'Payment was declined by the payment provider',
      });
    }

    if (!paymentResponse.ok) {
      throw new Error(`payment-service returned ${paymentResponse.status}`);
    }

    payment = await paymentResponse.json();
    log('info', 'Payment approved', { orderId, paymentId: payment.paymentId });
  } catch (err) {
    log('error', 'Payment call failed', { orderId, error: err.message });
    return res.status(503).json({
      orderId,
      status: 'FAILED',
      message: 'payment-service unavailable',
    });
  }

  // ---- Passo 2: agendar o envio -------------------------------------------
  let shipping;
  try {
    const shippingResponse = await fetch(`${SHIPPING_URL}/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, shippingAddress }),
    });

    if (!shippingResponse.ok) {
      throw new Error(`shipping-service returned ${shippingResponse.status}`);
    }

    shipping = await shippingResponse.json();
    log('info', 'Shipment scheduled', { orderId, trackingCode: shipping.trackingCode });
  } catch (err) {
    log('error', 'Shipping call failed', { orderId, error: err.message });
    return res.status(503).json({
      orderId,
      status: 'FAILED',
      message: 'shipping-service unavailable',
    });
  }

  // ---- Resposta final ------------------------------------------------------
  log('info', 'Order completed', { orderId });
  res.status(201).json({
    orderId,
    productId,
    amount,
    status: 'COMPLETED',
    paymentId: payment.paymentId,
    trackingCode: shipping.trackingCode,
    createdAt: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  log('info', `${SERVICE_NAME} listening on port ${PORT}`);
});
