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
  generateQr: async () => {
    return apiClient.post<AspiQrData>("/aspi/qr", {});
  },

  processPayment: async (payload: Record<string, unknown>) => {
    return apiClient.post<AspiPaymentResponse>("/aspi/payment", payload);
  },
};