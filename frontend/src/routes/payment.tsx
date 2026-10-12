import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { ScanLine, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { aspiService } from "@/services/aspi.service";
import { dashboardService } from "@/services/dashboard.service";

export const Route = createFileRoute("/payment")({
  component: PaymentComponent,
});

const API_URL = import.meta.env.VITE_API_BASE_URL;

function PaymentComponent() {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingAmount, setLoadingAmount] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [gateStatusText, setGateStatusText] = useState(
    "Pintu gate terbuka otomatis"
  );
  const [amount, setAmount] = useState<number>(2000);

  const paymentSocketRef = useRef<Socket | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(false);

  useEffect(() => {
    const fetchAmount = async () => {
      try {
        setLoadingAmount(true);
        const res = await dashboardService.getAmountSetting();
        const raw = res.data as any;
        const val = raw?.data ?? raw;
        const parsed = typeof val === "number" ? val : val?.amount;
        if (parsed !== undefined) {
          setAmount(Number(parsed));
        }
      } catch (err) {
        console.error("Gagal mengambil tarif setting:", err);
      } finally {
        setLoadingAmount(false);
      }
    };

    fetchAmount();
  }, []);

  const connectPaymentRealtime = useCallback((partnerReferenceNo: string) => {
    if (paymentSocketRef.current) {
      paymentSocketRef.current.disconnect();
    }

    if (!API_URL) {
      console.error("VITE_API_URL belum disetel di file .env");
      setErrorMsg("Konfigurasi API URL belum tersedia.");
      return;
    }

    const sanitizedBaseUrl = API_URL.replace(/\/+$/, "");

    const paymentSocket = io(`${sanitizedBaseUrl}/realtime`, {
      auth: { partnerReferenceNo },
      transports: ["websocket", "polling"],
    });

    paymentSocket.on("connect", () => {
      console.log(
        `[Socket] Terhubung untuk partnerReferenceNo: ${partnerReferenceNo}`
      );
    });

    paymentSocket.on("payment:status", (event: any) => {
      if (event.partnerReferenceNo !== partnerReferenceNo) return;

      const status = event.status || event.transactionStatus;

      if (status === "SUCCESS") {
        setIsSuccess(true);
        setGateStatusText("Pembayaran berhasil dikonfirmasi");

        if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => {
          initQr();
        }, 5000);
      }
    });

    paymentSocket.on("gate:ack", () => {
      setGateStatusText("Gate berhasil dibuka oleh hardware");
    });

    paymentSocket.on("connect_error", (error: any) => {
      console.error("Payment realtime error:", error.message);
    });

    paymentSocketRef.current = paymentSocket;
  }, []);

  const initQr = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      setIsSuccess(false);
      setGateStatusText("Pintu gate terbuka otomatis");

      const res = await aspiService.generateQr();
      const raw = res.data as any;
      const data = raw?.data || raw;

      const content = data?.qrContent;
      const partnerRef = data?.partnerReferenceNo;

      if (content && partnerRef) {
        setQrSrc(
          `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=4&data=${encodeURIComponent(
            content
          )}`
        );
        connectPaymentRealtime(partnerRef);
      } else {
        setErrorMsg("Data QRIS atau Partner Reference tidak valid.");
      }
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || "Gagal memuat QRIS.");
    } finally {
      setLoading(false);
    }
  }, [connectPaymentRealtime]);

  useEffect(() => {
    if (!isInitialMount.current) {
      isInitialMount.current = true;
      initQr();
    }
  }, [initQr]);

  useEffect(() => {
    return () => {
      if (paymentSocketRef.current) {
        paymentSocketRef.current.disconnect();
      }
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-[#1D408C] p-4 text-white select-none sm:p-8">
      <img
        src="/images/bg-pattern.svg"
        alt="Background Pattern"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60"
      />
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center justify-between gap-8 md:-mt-8 md:flex-row md:items-center lg:gap-16">
        
        <div className="flex flex-1 flex-col justify-center text-center md:text-left">
          <div className="flex items-center justify-center gap-4 md:justify-start">
            <img
              src="/images/logodlh.svg"
              alt="Logo DLH"
              className="h-12 w-auto object-contain drop-shadow sm:h-14 lg:h-16"
            />
            <div>
              <h1 className="text-xl font-bold leading-tight tracking-wide lg:text-3xl">
                Smart Toilet
              </h1>
              <p className="text-sm text-blue-100/90 lg:text-base">
                DLH Kota Padang
              </p>
            </div>
          </div>

          <div className="mt-8 md:mt-10 lg:mt-12">
            <p className="text-sm font-light text-blue-100 lg:text-lg">
              Tarif Retribusi Kebersihan
            </p>

            <div className="mt-1 flex items-center justify-center h-12 md:justify-start">
              {loadingAmount ? (
                <div className="flex items-center gap-2 text-blue-200">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-base font-normal text-blue-200/80">
                    Memuat tarif...
                  </span>
                </div>
              ) : (
                <p className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                  {formatRupiah(amount)}{" "}
                  <span className="text-base font-normal text-blue-200 lg:text-xl">
                    /akses
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="flex w-full max-w-[290px] flex-col rounded-[24px] bg-white p-4 text-gray-900 shadow-2xl transition-all sm:max-w-[340px] md:max-w-[360px] lg:max-w-[400px] lg:p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold tracking-wider text-[#1D408C] uppercase lg:text-base">
                QRIS
              </p>
            </div>

            <div className="mt-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-gray-50 bg-white p-2 shadow-inner lg:p-3">
              {loading ? (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <Loader2 className="h-10 w-10 animate-spin text-[#1D408C] lg:h-12 lg:w-12" />
                  <span className="text-xs font-medium lg:text-sm">
                    Membuat QRIS baru...
                  </span>
                </div>
              ) : isSuccess ? (
                <div className="flex flex-col items-center gap-2 text-center text-emerald-600">
                  <CheckCircle2 className="h-14 w-14 animate-bounce lg:h-20 lg:w-20" />
                  <span className="text-base font-bold lg:text-xl">
                    Pembayaran Berhasil!
                  </span>
                  <span className="text-xs text-gray-500 lg:text-sm">
                    {gateStatusText}
                  </span>
                  <span className="mt-2 text-[10px] text-gray-400 lg:text-xs">
                    Layar akan reset otomatis
                  </span>
                </div>
              ) : errorMsg ? (
                <div className="flex flex-col items-center gap-2 px-4 text-center text-rose-500">
                  <AlertCircle className="h-8 w-8 lg:h-10 lg:w-10" />
                  <span className="text-xs lg:text-sm">{errorMsg}</span>
                </div>
              ) : qrSrc ? (
                <img
                  src={qrSrc}
                  alt="QRIS Code"
                  className="h-full w-full object-contain"
                  onError={() => setErrorMsg("Gagal memuat QR.")}
                />
              ) : (
                <div className="text-center text-xs text-gray-400 lg:text-sm">
                  QRIS tidak ditemukan. Silakan refresh.
                </div>
              )}
            </div>

            <p className="mt-3 text-center text-[11px] font-semibold text-gray-400 lg:mt-4 lg:text-xs">
              BCA, Mandiri, GoPay, OVO, ShopeePay
            </p>
          </div>

          <div className="mt-4 flex w-full max-w-[280px] items-center justify-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-center text-blue-100 backdrop-blur-md sm:max-w-[340px] md:max-w-[360px] lg:max-w-[400px]">
            <ScanLine className="h-5 w-5 shrink-0 text-white lg:h-6 lg:w-6" />
            <span className="text-left text-xs leading-snug font-medium lg:text-sm">
              Pindai dengan aplikasi pembayaran apa saja untuk membuka pintu otomatis.
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}