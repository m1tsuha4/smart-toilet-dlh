import { apiClient } from "@/lib/api-client";

export interface AspiQrData {
  responseCode: string;
  responseMessage: string;
  referenceNo: string;
  partnerReferenceNo: string;
  qrContent: string;
  qrUrl?: string;
  qrImage?: string;
  terminalId?: string;
}

export interface AspiPaymentResponse {
  success: boolean;
  message: string;
  data: {
    responseCode: string;
    responseMessage: string;
    referenceNo: string;
    partnerReferenceNo: string;
    verificationId: string;
    localTransactionStatus: string;
    amountMatched: boolean;
    [key: string]: unknown;
  };
}

export const aspiService = {
  
  generateQr: async (payload: Record<string, unknown> = { deviceCode: "GATE-001" }) => {
        const token =
      typeof window !== "undefined" ? localStorage.getItem("auth-token") : null;

    const authHeader = token
      ? token.startsWith("Bearer ")
        ? token
        : `Bearer ${token}`
      : "";
    return apiClient.post<AspiQrData>("/bri/generate-qr", payload,{
      headers: {
        Authorization: authHeader,
      },
    });
  },

  processPayment: async (payload: Record<string, unknown>) => {
    return apiClient.post<AspiPaymentResponse>("/aspi/payment", payload);
  },
};