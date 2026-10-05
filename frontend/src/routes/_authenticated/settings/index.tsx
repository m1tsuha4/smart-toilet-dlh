import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  dashboardService,
  type GateDevice,
} from "@/services/dashboard.service";
import {
  DoorOpen,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
  KeyRound,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const [amount, setAmount] = useState<number>(0);
  const [amountInput, setAmountInput] = useState<string>("");
  const [loadingAmount, setLoadingAmount] = useState(true);
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountFeedback, setAmountFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [gates, setGates] = useState<GateDevice[]>([]);
  const [loadingGates, setLoadingGates] = useState(true);

  const [newGateName, setNewGateName] = useState("");
  const [newGateCode, setNewGateCode] = useState("");
  const [creatingGate, setCreatingGate] = useState(false);
  const [gateFeedback, setGateFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [selectedGate, setSelectedGate] = useState<GateDevice | null>(null);
  const [transactionIdInput, setTransactionIdInput] = useState("");
  const [openingGate, setOpeningGate] = useState(false);
  const [openFeedback, setOpenFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchData = async () => {
    try {
      setLoadingAmount(true);
      const resAmount = await dashboardService.getAmountSetting();
      const rawAmount = resAmount.data as any;
      const val = rawAmount?.data ?? rawAmount;
      const parsed = typeof val === "number" ? val : val?.amount;
      if (parsed !== undefined) {
        setAmount(Number(parsed));
        setAmountInput(String(parsed));
      }
    } catch (err) {
      console.error("Gagal memuat setting amount:", err);
    } finally {
      setLoadingAmount(false);
    }

    try {
      setLoadingGates(true);
      const resGates = await dashboardService.getGates();
      const rawGates = resGates.data as any;
      const gateList = rawGates?.data || rawGates || [];
      setGates(Array.isArray(gateList) ? gateList : []);
    } catch (err) {
      console.error("Gagal memuat daftar gate:", err);
    } finally {
      setLoadingGates(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveAmount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAmountFeedback(null);
    const num = Number(amountInput);

    if (isNaN(num) || num < 0) {
      setAmountFeedback({
        type: "error",
        message: "Nominal tarif tidak valid",
      });
      return;
    }

    try {
      setSavingAmount(true);
      await dashboardService.updateAmountSetting({ amount: num });
      setAmount(num);
      setAmountFeedback({
        type: "success",
        message: "Tarif berhasil diperbarui",
      });
      setTimeout(() => setAmountFeedback(null), 3000);
    } catch (err: unknown) {
      const error = err as Error;
      setAmountFeedback({
        type: "error",
        message: error.message || "Gagal menyimpan tarif",
      });
    } finally {
      setSavingAmount(false);
    }
  };
  const handleCreateGate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateFeedback(null);

    if (!newGateName.trim() || !newGateCode.trim()) {
      setGateFeedback({
        type: "error",
        message: "Nama gate dan Device Code wajib diisi",
      });
      return;
    }

    try {
      setCreatingGate(true);
      await dashboardService.createGate({
        name: newGateName.trim(),
        deviceCode: newGateCode.trim(),
      });
      setGateFeedback({
        type: "success",
        message: "Gate baru berhasil didaftarkan",
      });
      setNewGateName("");
      setNewGateCode("");
      const res = await dashboardService.getGates();
      const raw = res.data as any;
      setGates(raw?.data || raw || []);
      setTimeout(() => setGateFeedback(null), 3000);
    } catch (err: unknown) {
      const error = err as Error;
      setGateFeedback({
        type: "error",
        message: error.message || "Gagal mendaftarkan gate",
      });
    } finally {
      setCreatingGate(false);
    }
  };

  const handleOpenGate = async () => {
    if (!selectedGate) return;
    setOpenFeedback(null);

    try {
      setOpeningGate(true);
      await dashboardService.openGate({
        deviceCode: selectedGate.deviceCode,
        transactionId:
          transactionIdInput.trim() || `MANUAL-${Date.now().toString().slice(-6)}`,
      });
      setOpenFeedback({
        type: "success",
        message: `Sinyal buka berhasil dikirim ke ${selectedGate.name}`,
      });
      setTimeout(() => {
        setSelectedGate(null);
        setTransactionIdInput("");
        setOpenFeedback(null);
      }, 1500);
    } catch (err: unknown) {
      const error = err as Error;
      setOpenFeedback({
        type: "error",
        message: error.message || "Gagal membuka gate",
      });
    } finally {
      setOpeningGate(false);
    }
  };

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="space-y-3.5 p-3 md:p-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
          Pengaturan Sistem
        </h1>
        <p className="text-[11px] text-gray-500">
          Kelola tarif retribusi kios dan kontrol perangkat pintu toilet otomatis.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <div className="space-y-3.5 lg:col-span-1">
          <div className="rounded-xl border border-gray-100 bg-white p-3.5 shadow-xs">
            <div className="flex items-center gap-1.5 font-semibold text-gray-800 text-xs">
              Tarif Retribusi
            </div>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Tarif yang tampil secara publik di layar QRIS kios.
            </p>

            {loadingAmount ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1D408C]" />
                Memuat tarif...
              </div>
            ) : (
              <form onSubmit={handleSaveAmount} className="mt-2.5 space-y-2.5">
                <div className="rounded-lg bg-gray-50 p-2 text-center">
                  <span className="text-[10px] text-gray-400">Tarif Saat Ini</span>
                  <p className="text-base font-bold text-[#1D408C]">
                    {formatRupiah(amount)}
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-700">
                    Perbarui Nominal (Rp)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="Contoh: 2000"
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none transition focus:border-[#1D408C] focus:ring-1 focus:ring-blue-100"
                  />
                </div>

                {amountFeedback && (
                  <div
                    className={`flex items-center gap-1.5 rounded-md p-2 text-[10px] ${
                      amountFeedback.type === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {amountFeedback.type === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {amountFeedback.message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={savingAmount}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#1D408C] py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-blue-900 disabled:opacity-50"
                >
                  {savingAmount ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    "Simpan Perubahan Tarif"
                  )}
                </button>
              </form>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-3.5 shadow-xs">
            <div className="flex items-center gap-1.5 font-semibold text-gray-800 text-xs">
              Tambah Perangkat Gate
            </div>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Daftarkan Perangkat Gate terbaru.
            </p>

            <form onSubmit={handleCreateGate} className="mt-2.5 space-y-2">
              <div>
                <label className="text-[11px] font-medium text-gray-700">
                  Nama Gate
                </label>
                <input
                  type="text"
                  value={newGateName}
                  onChange={(e) => setNewGateName(e.target.value)}
                  placeholder="Gate Pintu Masuk Barat"
                  className="mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none transition focus:border-[#1D408C] focus:ring-1 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-700">
                  Device Code
                </label>
                <input
                  type="text"
                  value={newGateCode}
                  onChange={(e) => setNewGateCode(e.target.value)}
                  placeholder="GATE-01"
                  className="mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-mono outline-none transition focus:border-[#1D408C] focus:ring-1 focus:ring-blue-100"
                />
              </div>

              {gateFeedback && (
                <div
                  className={`flex items-center gap-1.5 rounded-md p-2 text-[10px] ${
                    gateFeedback.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {gateFeedback.type === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {gateFeedback.message}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingGate}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-black disabled:opacity-50"
              >
                {creatingGate ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Mendaftarkan...
                  </>
                ) : (
                  "Daftarkan Gate"
                )}
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="h-full rounded-xl border border-gray-100 bg-white p-3.5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-800 text-xs flex items-center gap-1.5">
                    <DoorOpen className="h-4 w-4 text-[#1D408C]" />
                    Daftar Perangkat Gate & Kontrol Pintu
                  </h2>
                  <p className="mt-0.5 text-[10px] text-gray-500">
                    Monitoring koneksi perangkat dan override buka pintu secara manual.
                  </p>
                </div>
                <button
                  onClick={fetchData}
                  className="rounded-lg bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 transition"
                >
                  Refresh Data
                </button>
              </div>

              <div className="mt-3 overflow-hidden rounded-lg border border-gray-100">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-semibold text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Nama Gate</th>
                      <th className="px-3 py-2">Device Code</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Aksi Kontrol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-[11px]">
                    {loadingGates ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-gray-400">
                          <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#1D408C]" />
                          <span className="mt-1 block text-[10px]">Memuat daftar gate...</span>
                        </td>
                      </tr>
                    ) : gates.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-[10px] text-gray-400">
                          Belum ada gate yang terdaftar. Tambahkan gate di formulir sebelah kiri.
                        </td>
                      </tr>
                    ) : (
                      gates.map((device) => {
                        const isOnline =
                          device.status?.toUpperCase() === "ACTIVE";

                        return (
                          <tr key={device.id || device.deviceCode} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2 font-medium text-gray-900">
                              {device.name}
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-700">
                                {device.deviceCode}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                                  isOnline
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700"
                                }`}
                              >
                                {isOnline ? (
                                  <Wifi className="h-2.5 w-2.5" />
                                ) : (
                                  <WifiOff className="h-2.5 w-2.5" />
                                )}
                                {isOnline ? "ACTIVE" : "OFFLINE"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => {
                                  setSelectedGate(device);
                                  setOpenFeedback(null);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-[#1D408C] hover:bg-blue-100 transition shadow-2xs"
                              >
                                <DoorOpen className="h-3 w-3" />
                                Buka Gate
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-xs rounded-xl bg-white p-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-blue-50 p-2 text-[#1D408C]">
                <DoorOpen className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-gray-900">Buka Gate Manual</h3>
                <p className="text-[10px] text-gray-500">
                  Target: <span className="font-semibold text-gray-800">{selectedGate.name}</span> ({selectedGate.deviceCode})
                </p>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[10px] font-medium text-gray-700">
                Transaction ID
              </label>
              <div className="relative mt-1">
                <input
                  type="text"
                  value={transactionIdInput}
                  onChange={(e) => setTransactionIdInput(e.target.value)}
                  placeholder={`MANUAL-${Date.now().toString().slice(-6)}`}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-[#1D408C] focus:ring-1 focus:ring-blue-100"
                />
                <KeyRound className="absolute right-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            {openFeedback && (
              <div
                className={`mt-2.5 flex items-center gap-1.5 rounded-md p-2 text-[10px] ${
                  openFeedback.type === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {openFeedback.type === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                {openFeedback.message}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={openingGate}
                onClick={() => setSelectedGate(null)}
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-100"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={openingGate}
                onClick={handleOpenGate}
                className="flex items-center gap-1.5 rounded-lg bg-[#1D408C] px-3 py-1.5 text-[11px] font-semibold text-white shadow-2xs hover:bg-blue-900 disabled:opacity-50"
              >
                {openingGate ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Mengirim...
                  </>
                ) : (
                  "Konfirmasi Buka Gate"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
