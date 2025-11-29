import axios, { AxiosInstance, AxiosError } from "axios";
import crypto from "crypto";
import { addSeconds, isBefore } from "date-fns";
import dotenv from "dotenv";


// 1. Minimal Logger (replaces your external logger)
const logger = {
  info: (obj: any, msg: string) => console.log(`[INFO] ${msg}`, obj),
  error: (obj: any, msg: string) => console.error(`[ERROR] ${msg}`, obj),
  warn: (obj: any, msg: string) => console.warn(`[WARN] ${msg}`, obj),
  debug: (obj: any, msg: string) => console.log(`[DEBUG] ${msg}`, obj),
  fatal: (obj: any, msg: string) => console.error(`[FATAL] ${msg}`, obj),
};

dotenv.config();
const config = {
  PAYPACK_CLIENT_ID: process.env.PAYPACK_CLIENT_ID || "",
  PAYPACK_CLIENT_SECRET: process.env.PAYPACK_CLIENT_SECRET || "",
  PAYPACK_WEBHOOK_SECRET: process.env.PAYPACK_WEBHOOK_SECRET || "",
};

// 3. Minimal ApiError Class (replaces your external types)
class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, any> | null;

  constructor(
    statusCode: number,
    message: string,
    code: string = "GENERIC_API_ERROR",
    details?: Record<string, any> | null
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details || null;
  }
}

// --- TYPE DEFINITIONS (Self-contained for Demo) ---

interface PaypackAuthResponse {
  access: string;
  refresh: string;
  expires: number;
}
interface CashinParams {
  number: string;
  amount: number;
}
interface CashinResponse {
  ref: string;
  status: string;
  amount: number;
  provider: string;
  kind: "CASHIN";
  created_at: string;
}


class PaypackService {
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private isRefreshingToken = false;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: "https://payments.paypack.rw/api",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });
  }

  public async cashin(params: CashinParams): Promise<CashinResponse> {
    if (params.amount < 100) {
      throw new ApiError(
        400,
        "Payment amount must be at least 100 RWF.",
        "INVALID_AMOUNT"
      );
    }
    if (!/^07\d{8}$/.test(params.number)) {
      throw new ApiError(
        400,
        "Invalid Rwandan phone number format. Must be 07XXXXXXXX.",
        "INVALID_PHONE"
      );
    }

    const token = await this.getValidAccessToken();

    try {
      logger.info(
        { amount: params.amount, number: params.number },
        "Initiating Paypack cash-in."
      );
      const response = await this.axiosInstance.post<CashinResponse>(
        "/transactions/cashin",
        { amount: params.amount, number: params.number },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Webhook-Mode": "production",
          },
        }
      );
      logger.info(
        { ref: response.data.ref, status: response.data.status },
        "Paypack cash-in initiated successfully."
      );
      return response.data;
    } catch (error) {
      this.handleApiError(error, "Cash-in failed");
      throw new ApiError(500, "An unexpected error occurred during cash-in.");
    }
  }

  public verifyWebhookSignature(
    signature: string | undefined,
    rawBody: Buffer
  ): boolean {
    if (!signature) {
      logger.warn({}, "Webhook received without 'x-paypack-signature' header.");
      throw new ApiError(
        403,
        "Missing webhook signature.",
        "INVALID_SIGNATURE"
      );
    }

    try {
      const expectedSignature = crypto
        .createHmac("sha256", config.PAYPACK_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("base64");

      const sigBuffer = Buffer.from(signature);
      const expectedSigBuffer = Buffer.from(expectedSignature);

      if (
        sigBuffer.length !== expectedSigBuffer.length ||
        !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)
      ) {
        logger.warn(
          { received: signature, expected: expectedSignature },
          "Invalid webhook signature."
        );
        throw new ApiError(
          401,
          "Invalid webhook signature.",
          "INVALID_SIGNATURE"
        );
      }
      return true;
    } catch (error) {
      logger.error({ error }, "Error during webhook signature verification.");
      throw new ApiError(
        500,
        "Could not verify webhook signature.",
        "SIGNATURE_VERIFICATION_FAILED"
      );
    }
  }

  private async getValidAccessToken(): Promise<string> {
    if (this.isRefreshingToken && this.tokenRefreshPromise) {
      logger.debug({}, "Waiting for in-progress token refresh...");
      return this.tokenRefreshPromise;
    }

    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      isBefore(new Date(), addSeconds(this.tokenExpiresAt, -60))
    ) {
      return this.accessToken;
    }

    logger.info(
      {},
      "Paypack access token is expired or missing. Authenticating..."
    );
    this.isRefreshingToken = true;
    this.tokenRefreshPromise = this.authenticate();

    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.isRefreshingToken = false;
      this.tokenRefreshPromise = null;
    }
  }

  private async authenticate(): Promise<string> {
    try {
      const response = await this.axiosInstance.post<PaypackAuthResponse>(
        "/auth/agents/authorize",
        {
          client_id: config.PAYPACK_CLIENT_ID,
          client_secret: config.PAYPACK_CLIENT_SECRET,
        }
      );

      const { access, expires } = response.data;
      if (!access) {
        throw new Error(
          "Authentication response did not include an access token."
        );
      }

      this.accessToken = access;
      this.tokenExpiresAt = new Date(expires * 1000);

      logger.info(
        { expiresAt: this.tokenExpiresAt.toISOString() },
        "Successfully authenticated with Paypack and cached new token."
      );
      return this.accessToken;
    } catch (error) {
      this.accessToken = null;
      this.tokenExpiresAt = null;
      this.handleApiError(error, "Paypack authentication failed");
      throw new ApiError(
        500,
        "An unexpected error occurred during authentication."
      );
    }
  }

  private handleApiError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string; error?: any }>;
      const status = axiosError.response?.status || 500;
      const message =
        axiosError.response?.data?.message ||
        axiosError.response?.data?.error ||
        axiosError.message;
      const responseData = axiosError.response?.data;

      logger.error(
        { status, message, responseData, context },
        `Paypack API Error: ${context}`
      );
      throw new ApiError(
        status,
        `Payment Provider Error: ${message}`,
        "PAYPACK_API_ERROR",
        responseData
      );
    }

    logger.error(
      { error: (error as Error).message, context },
      `Non-Axios Error in Paypack Service: ${context}`
    );
    throw new ApiError(
      500,
      (error as Error).message || "An unknown error occurred.",
      "UNKNOWN_PAYPACK_ERROR"
    );
  }
}


function createPaypackService(): PaypackService {
  if (!config.PAYPACK_CLIENT_ID || !config.PAYPACK_CLIENT_SECRET) {
    logger.fatal(
      {},
      "PAYPACK_CLIENT_ID and PAYPACK_CLIENT_SECRET environment variables are required."
    );
    throw new Error(
      "Paypack service is not configured. Missing API credentials."
    );
  }
  if (!config.PAYPACK_WEBHOOK_SECRET) {
    logger.fatal(
      {},
      "PAYPACK_WEBHOOK_SECRET environment variable is required for security."
    );
    throw new Error(
      "Paypack service is not configured. Missing Webhook Secret."
    );
  }
  return new PaypackService();
}

export const paypackService = createPaypackService();
