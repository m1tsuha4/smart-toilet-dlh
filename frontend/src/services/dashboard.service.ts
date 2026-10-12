import { apiClient } from "@/lib/api-client";

export interface GateDevice {
  id: string;
  name: string;
  deviceCode: string;
  status: "ONLINE" | "OFFLINE" | string;
  lastConnectedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WeeklyTrendItem {
  label: string;
  value: number;
}

export interface DashboardSummaryData {
  todayRevenue: number;
  monthRevenue: number;
  totalVisitors: number;
  successRate: number;
  gateStatus: {
    total: number;
    active: number;
    inactive: number;
    devices: GateDevice[];
  };
  weeklyTrend: WeeklyTrendItem[];
  activeGateCount: number;
  totalGateCount: number;
}

export interface DashboardSummaryResponse {
  success: boolean;
  message: string;
  data: DashboardSummaryData;
}

export interface CreateGatePayload {
  name: string;
  deviceCode: string;
}

export interface OpenGatePayload {
  deviceCode: string;
  transactionId: string;
}

export interface DeviceActionPayload {
  deviceCode: string;
}

export interface ScheduleShutdownPayload {
  deviceCode: string;
  time: string;
}

export interface SettingsAmountPayload {
  amount: number;
}

export interface SettingsAmountData {
  amount: number;
  [key: string]: unknown;
}

export const dashboardService = {
  getSummary: async () => {
    return apiClient.get<DashboardSummaryResponse>("/dashboard/summary");
  },

  getGates: async () => {
    return apiClient.get<{ success: boolean; data: GateDevice[] }>("/dashboard/gates");
  },

  createGate: async (payload: CreateGatePayload) => {
    return apiClient.post<{ success: boolean; data: GateDevice }>("/dashboard/gates", payload);
  },

  openGate: async (payload: OpenGatePayload) => {
    return apiClient.post<{ success: boolean; message: string }>("/dashboard/gate-open", payload);
  },

  shutdownGate: async (payload: DeviceActionPayload) => {
    return apiClient.post<{ success: boolean; message: string }>("/dashboard/gates/shutdown", payload);
  },

  rebootGate: async (payload: DeviceActionPayload) => {
    return apiClient.post<{ success: boolean; message: string }>("/dashboard/gates/reboot", payload);
  },

  getShutdownSchedule: async (deviceCode: string) => {
    return apiClient.get<{ success: boolean; data: any }>(`/dashboard/gates/shutdown-schedule?deviceCode=${deviceCode}`);
  },

  setShutdownSchedule: async (payload: ScheduleShutdownPayload) => {
    return apiClient.post<{ success: boolean; message: string }>("/dashboard/gates/shutdown-schedule", payload);
  },

  getAmountSetting: async () => {
    return apiClient.get<{ success: boolean; data: SettingsAmountData }>("/dashboard/settings/amount");
  },

  updateAmountSetting: async (payload: SettingsAmountPayload) => {
    return apiClient.patch<{ success: boolean; message: string; data?: SettingsAmountData }>(
      "/dashboard/settings/amount",
      { amount: Number(payload.amount) }
    );
  },
};