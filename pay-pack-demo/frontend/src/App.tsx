// frontend/src/App.tsx
import { useState, useEffect } from "react";
import axios from "axios";
import { io, Socket } from "socket.io-client";
import { Loader2, CheckCircle, XCircle, ShoppingCart } from "lucide-react";
import "./index.css"; // Assuming Tailwind base styles are imported here

// Define types for clarity
type PaymentStatus = "idle" | "form" | "processing" | "success" | "failed";

const API_URL = "http://localhost:4000/api";
const PRODUCT = {
  name: "PayPack demo",
  price: 100, 
  description: "A demo used to show how paypack works",
  downloadUrl: "/guide.pdf", // A mock file in the public folder
};

export default function App() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Connect to WebSocket server when the component mounts
    const newSocket = io(
      import.meta.env.VITE_BACKEND_URL || "http://localhost:4000"
    );
    setSocket(newSocket);

    newSocket.on("connect", () => console.log("Socket connected!"));

    // Listen for payment updates from the backend
    newSocket.on(
      "payment:update",
      (data: { status: "SUCCESSFUL" | "FAILED" }) => {
        console.log("Received payment update:", data);
        if (data.status === "SUCCESSFUL") {
          setPaymentStatus("success");
        } else {
          setPaymentStatus("failed");
          setErrorMessage("Payment was not approved or failed.");
        }
      }
    );

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleInitiatePayment = async () => {
    if (!/07\d{8}/.test(phoneNumber)) {
      setErrorMessage("Please enter a valid Rwandan phone number.");
      return;
    }
    setErrorMessage("");
    setPaymentStatus("processing");

    try {
      const response = await axios.post(`${API_URL}/initiate-payment`, {
        phoneNumber,
        amount: PRODUCT.price,
      });
      const { paymentId: newPaymentId } = response.data;
      setPaymentId(newPaymentId);

      // Register this payment with the WebSocket server
      if (socket && newPaymentId) {
        socket.emit("registerPayment", newPaymentId);
        console.log(`Registered payment ID ${newPaymentId} with socket.`);
      }
    } catch (error) {
      console.error(error);
      setPaymentStatus("failed");
      setErrorMessage("Could not initiate payment. Please try again.");
    }
  };

  const openDialog = () => {
    setPaymentStatus("form");
    setPhoneNumber("");
    setErrorMessage("");
    setPaymentId(null);
    setDialogOpen(true);
  };

  const renderDialogContent = () => {
    switch (paymentStatus) {
      case "form":
        return (
          <>
            <h3 className="text-lg font-medium">
              Pay {PRODUCT.price.toLocaleString("fr-RW")} RWF
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Enter your Mobile Money number to proceed.
            </p>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="07..."
              className="w-full p-2 border rounded-md"
            />
            {errorMessage && (
              <p className="text-red-500 text-sm mt-2">{errorMessage}</p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setDialogOpen(false)}
                className="px-4 py-2 bg-gray-200 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleInitiatePayment}
                className="px-4 py-2 bg-blue-600 text-white rounded-md"
              >
                Pay Now
              </button>
            </div>
          </>
        );
      case "processing":
        return (
          <div className="text-center p-8">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-blue-600" />
            <h3 className="font-semibold mt-4">Processing Payment...</h3>
            <p className="text-sm text-gray-500 mt-2">
              Please check your phone and enter your PIN to approve the
              transaction.
            </p>
          </div>
        );
      case "success":
        return (
          <div className="text-center p-8">
            <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
            <h3 className="font-semibold mt-4">Payment Successful!</h3>
            <p className="text-sm text-gray-500 mt-2">
              Your guide is ready for download.
            </p>
            <a href={PRODUCT.downloadUrl} download>
              <button className="mt-6 px-4 py-2 bg-green-600 text-white rounded-md">
                Download Guide
              </button>
            </a>
          </div>
        );
      case "failed":
        return (
          <div className="text-center p-8">
            <XCircle className="h-12 w-12 mx-auto text-red-500" />
            <h3 className="font-semibold mt-4">Payment Failed</h3>
            <p className="text-sm text-red-500 mt-2">{errorMessage}</p>
            <button
              onClick={() => setPaymentStatus("form")}
              className="mt-6 px-4 py-2 bg-gray-300 rounded-md"
            >
              Try Again
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white shadow-lg rounded-xl p-8 max-w-sm w-full">
        <h2 className="text-2xl font-bold mb-2">{PRODUCT.name}</h2>
        <p className="text-gray-600 mb-4">{PRODUCT.description}</p>
        <div className="text-3xl font-extrabold mb-6">
          {PRODUCT.price.toLocaleString("fr-RW")} RWF
        </div>
        <button
          onClick={openDialog}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
        >
          <ShoppingCart className="h-5 w-5" /> Buy Now
        </button>
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            {renderDialogContent()}
          </div>
        </div>
      )}
    </div>
  );
}
