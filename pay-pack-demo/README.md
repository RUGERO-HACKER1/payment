# 💸 Paypack Payment Demo Application

This is a minimal yet professional demonstration application showcasing the complete payment flow for [Paypack](https://paypack.rw/), a popular payment gateway in Rwanda. The demo simulates the purchase of a digital product using a Vite (React) frontend and an Express.js backend.

The primary goal of this project is to provide a clear, practical example of:
1.  Initiating a "cash-in" (payment request) from a server.
2.  Securely handling and verifying Paypack webhooks.
3.  Providing real-time UI updates to the user via WebSockets.

## ✨ Core Features

-   **Clean Frontend/Backend Separation:** A modern Vite frontend and a robust Express backend.
-   **Paypack Cash-in Integration:** Demonstrates how to trigger a USSD push payment to a user's phone.
-   **Secure Webhook Handling:** Includes HMAC-SHA256 signature verification to ensure webhooks are genuinely from Paypack.
-   **Real-time UI Updates:** Uses **WebSockets (`socket.io`)** to instantly update the payment status on the frontend without needing to refresh the page.
-   **Robust Token Management:** The backend service automatically caches and refreshes its Paypack authentication token, preventing race conditions.
-   **Simple Database Layer:** Uses Prisma with SQLite for easy setup and persistence of payment records.
-   **Production-Ready Code:** The backend service is structured with professional error handling, logging, and security practices.

## 🛠️ Technology Stack

-   **Frontend:** Vite, React, TypeScript, Tailwind CSS, `socket.io-client`, `axios`
-   **Backend:** Express.js, TypeScript, Prisma, SQLite, `socket.io`, `axios`, `dotenv`
-   **Payment Gateway:** Paypack
-   **Development:** `pnpm`, `tsx`, `ngrok`

---

##  Prerequisites

Before you begin, ensure you have the following installed and configured:

1.  **Node.js:** Version 18 or higher.
2.  **pnpm:** This project uses `pnpm` for package management. Install it via `npm install -g pnpm`.
3.  **Paypack Business Account:** You need a Paypack account to get your API credentials.
    -   `Client ID`
    -   `Client Secret`
    -   `Webhook Secret`
4.  **ngrok:** A tool to expose your local server to the internet. This is **essential** for Paypack's webhook to reach your machine. [Download ngrok here](https://ngrok.com/download).

---

## 🚀 Getting Started: Setup and Running the Application

Follow these steps carefully to get the demo running locally.

### 1. Project Setup

First, clone the repository and install all necessary dependencies for both the frontend and backend.

```bash
# Clone the repository
git clone https://github.com/ChristianRukundo/pay-pack-demo.git

# Navigate into the project directory
cd pay-pack-demo

# Install backend dependencies
cd backend
pnpm install

# Install frontend dependencies
cd ../frontend
pnpm install
```

### 2. Backend Configuration (`.env` file)

The backend requires API keys to connect to Paypack.

1.  Navigate to the `backend` directory.
2.  Create a copy of the example environment file:
    ```bash
    cp .env.example .env
    ```
3.  Open the newly created `.env` file and fill in your credentials from your Paypack dashboard:

    ```dotenv
    # backend/.env

    # Keep this for the SQLite database
    DATABASE_URL="file:./prisma/dev.db"

    # Get these from your Paypack Application dashboard
    PAYPACK_CLIENT_ID="your_client_id_from_paypack"
    PAYPACK_CLIENT_SECRET="your_client_secret_from_paypack"

    # Get this from your Webhook configuration in the Paypack dashboard
    PAYPACK_WEBHOOK_SECRET="your_webhook_secret_from_paypack"

    # Server Configuration (default is fine for local dev)
    PORT=4000
    FRONTEND_URL=http://localhost:5173
    ```

### 3. Running the Application

You will need **three separate terminal windows** for this process.

#### **Terminal 1: Start the Backend Server**

1.  Navigate to the `backend` directory.
2.  Set up the SQLite database using Prisma:
    ```bash
    pnpm exec prisma migrate dev --name init
    ```
3.  Start the development server:
    ```bash
    pnpm dev
    ```
    You should see a message indicating the server is running on `http://localhost:4000`.

#### **Terminal 2: Expose Backend with ngrok**

1.  Run `ngrok` to create a public URL for your local backend server.
    ```bash
    ngrok http 4000
    ```
2.  `ngrok` will provide a "Forwarding" URL that looks like `https://random-string.ngrok-free.app`. **Copy this HTTPS URL.**

#### **Step 3: Configure the Paypack Webhook**

1.  Go to your **Paypack Dashboard**.
2.  Navigate to **Applications** and select the application you are using.
3.  Go to the **Webhooks** section.
4.  Set the **URL** to your `ngrok` URL, followed by `/api/webhook`.
    -   Example: `https://random-string.ngrok-free.app/api/webhook`
5.  Set the **Mode** to **Production**.
6.  Ensure the **Status** is **Active**.
7.  Save the changes.

#### **Terminal 4: Start the Frontend Server**

1.  Navigate to the `frontend` directory.
2.  Start the Vite development server:
    ```bash
    pnpm dev
    ```
3.  Open your browser and go to **`http://localhost:5173`**.

You are now ready to test the payment flow!

---

## ⚙️ How It Works: The Payment Flow

1.  **Initiation (Frontend → Backend):** When you click "Pay Now" on the frontend, it sends your phone number and the product amount to the backend's `/api/initiate-payment` endpoint.
2.  **Database Record (Backend):** The backend creates a `Payment` record in the SQLite database with a `PENDING` status and returns its unique `paymentId` to the frontend.
3.  **Paypack API Call (Backend → Paypack):** The backend uses its credentials to call Paypack's `/transactions/cashin` API, triggering the USSD push to your phone. It then updates the local payment record with the `paypackRef` returned by Paypack.
4.  **Real-time Link (Frontend ↔ Backend):** The frontend receives the `paymentId` and immediately sends it to the backend via a WebSocket connection using the `registerPayment` event. This tells the backend which socket connection is waiting for an update on that specific payment.
5.  **User Approval (Phone):** You approve the transaction on your phone by entering your Mobile Money PIN.
6.  **Webhook Notification (Paypack → Backend):** Paypack processes the transaction and sends an automated POST request (a webhook) to the public `ngrok` URL you configured.
7.  **Webhook Verification & DB Update (Backend):** The backend's `/api/webhook` endpoint receives the request. It first **verifies the HMAC signature** to ensure the request is genuinely from Paypack. If valid, it finds the payment record using the `ref` and updates its status to `SUCCESSFUL` or `FAILED`.
8.  **Real-time Update (Backend → Frontend):** After updating the database, the backend finds the socket connection associated with the `paymentId` and emits a `payment:update` event with the final status.
9.  **UI Update (Frontend):** The frontend, which has been listening for this event, receives the update and changes the UI to show the success or failure message.

## 🩺 Troubleshooting

-   **Webhook Not Received:**
    -   Ensure your backend is running and `ngrok` is active.
    -   Double-check that the URL in your Paypack webhook settings is the correct `https` URL from `ngrok` and ends with `/api/webhook`.
    -   Confirm the webhook **Mode** is set to **Production** in the Paypack dashboard.
-   **Invalid Signature Error (in backend logs):**
    -   Make sure the `PAYPACK_WEBHOOK_SECRET` in your `.env` file exactly matches the secret key shown in your Paypack webhook settings.
-   **CORS Errors:**
    -   Ensure the `FRONTEND_URL` in your `.env` file matches the URL your frontend is running on (e.g., `http://localhost:5173`).
