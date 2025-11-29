// backend/src/server.ts
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { paypackService } from "./services/paypack.service";

dotenv.config();
const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: process.env.FRONTEND_URL || "http://localhost:5173" },
});

// Middleware to get raw body for webhook verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));

// Store socket connections by payment ID
const paymentSockets = new Map<string, string>();

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("registerPayment", (paymentId: string) => {
    console.log(`Registering socket ${socket.id} for payment ${paymentId}`);
    paymentSockets.set(paymentId, socket.id);
  });
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const [paymentId, socketId] of paymentSockets.entries()) {
      if (socketId === socket.id) {
        paymentSockets.delete(paymentId);
        break;
      }
    }
  });
});

// --- API ROUTES ---

// 1. Initiate Payment Route
app.post("/api/initiate-payment", async (req, res) => {
  const { phoneNumber, amount } = req.body;
  if (!phoneNumber || !amount) {
    return res
      .status(400)
      .json({ error: "Phone number and amount are required." });
  }

  try {
    const payment = await prisma.payment.create({ data: { amount } });
    console.log(`Created pending payment in DB: ${payment.id}`);

    const paypackResponse = await paypackService.cashin({
      number: phoneNumber,
      amount,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { paypackRef: paypackResponse.ref },
    });
    console.log(
      `Updated payment ${payment.id} with Paypack ref: ${paypackResponse.ref}`
    );

    res.status(200).json({ paymentId: payment.id });
  } catch (error: any) {
    console.error(
      "Error initiating payment:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to initiate payment." });
  }
});

// 2. Paypack Webhook Route
app.post("/api/webhook", async (req, res) => {
  const signature = req.get("x-paypack-signature");
  const rawBody = (req as any).rawBody;

  try {
    // SECURITY: Always verify the signature
    if (!paypackService.verifyWebhookSignature(signature, rawBody)) {
      console.warn("Invalid webhook signature received.");
      return res.status(401).send("Invalid signature.");
    }

    const { data } = req.body;
    console.log("Webhook received:", data);

    const payment = await prisma.payment.findFirst({
      where: { paypackRef: data.ref },
    });
    if (!payment) {
      console.warn(`Payment with ref ${data.ref} not found.`);
      return res.status(404).send("Payment not found.");
    }

    const newStatus = data.status === "successful" ? "SUCCESSFUL" : "FAILED";
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: newStatus },
    });
    console.log(`Payment ${payment.id} updated to ${newStatus}`);

    // REAL-TIME UPDATE: Notify the frontend via WebSocket
    const socketId = paymentSockets.get(payment.id);
    if (socketId) {
      io.to(socketId).emit("payment:update", { status: newStatus });
      console.log(
        `Sent WebSocket update for payment ${payment.id} to socket ${socketId}`
      );
      paymentSockets.delete(payment.id); // Clean up
    }

    res.status(200).send("Webhook processed.");
  } catch (error: any) {
    console.error("Error processing webhook:", error.message);
    res.status(500).send("Error processing webhook.");
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
