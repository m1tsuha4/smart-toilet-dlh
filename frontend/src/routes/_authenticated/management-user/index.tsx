import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  UserPlus,
  Pencil,
  Trash2,
  Loader2,
  Users,
  X,
  AlertCircle,
  Check,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { userService } from "@/services/user.service";
import type { UserItem } from "@/services/user.service";

export const Route = createFileRoute("/_authenticated/management-user/")({
  beforeLoad: ({ context }) => {
    const userRole =
      (context as any)?.auth?.user?.role ||
      JSON.parse(localStorage.getItem("user-data") || "{}")?.role;

    if (!["SUPERADMIN", "VENDOR"].includes(userRole?.toUpperCase())) {
      throw redirect({
        to: "/dashboard",
      });
    }
  },
  component: ManagementUserComponent,
});

function ManagementUserComponent() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "ADMIN",
  });

  const password = formData.password;
  const hasMinLength = password.length >= 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

  const isPasswordValid = selectedUser && !password ? true : (hasMinLength && hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await userService.getUsers();
      const raw = res.data as any;
      const list = raw?.data?.data || raw?.data || raw || [];
      setUsers(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || "Gagal memuat daftar pengguna.");
      toast.error("Gagal memuat daftar pengguna");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleOpenModal = (user?: UserItem) => {
    if (user) {
      setSelectedUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        password: "",
        role: user.role || "ADMIN",
      });
    } else {
      setSelectedUser(null);
      setFormData({
        name: "",
        email: "",
        password: "",
        role: "ADMIN",
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedUser(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) return;

    try {
      setSubmitting(true);
      if (selectedUser) {
        const payload: Record<string, string> = {
          name: formData.name,
          email: formData.email,
          role: formData.role,
        };
        if (formData.password) {
          payload.password = formData.password;
        }
        await userService.updateUser(selectedUser.id, payload);
        toast.success("Pengguna berhasil diperbarui");
      } else {
        await userService.createUser({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role,
        });
        toast.success("Pengguna baru berhasil ditambahkan");
      }
      handleCloseModal();
      fetchUsers();
    } catch (err: any) {
      toast.error(
        "Gagal menyimpan pengguna: " + (err?.response?.data?.message || err.message)
      );
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    try {
      setDeleting(true);
      await userService.deleteUser(userToDelete.id);
      toast.success(`Pengguna ${userToDelete.name} berhasil dihapus`);
      setUserToDelete(null);
      fetchUsers();
    } catch (err: any) {
      toast.error(
        "Gagal menghapus pengguna: " + (err?.response?.data?.message || err.message)
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 p-2 md:p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
            Manajemen Pengguna
          </h1>
          <p className="text-xs text-gray-500 sm:text-sm">
            Kelola data akun administrator dan staf sistem Smart Toilet
          </p>
        </div>

        <button
          type="button"
          onClick={() => handleOpenModal()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1D408C] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#16326e] active:scale-95"
        >
          <UserPlus className="h-4 w-4" />
          <span>Tambah Pengguna</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-100 bg-gray-50/75 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Nama</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-gray-400">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#1D408C]" />
                    <span className="mt-2 block text-xs">Memuat data pengguna...</span>
                  </td>
                </tr>
              ) : errorMsg ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-rose-500">
                    <AlertCircle className="mx-auto h-6 w-6" />
                    <span className="mt-2 block text-xs">{errorMsg}</span>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-gray-400">
                    <Users className="mx-auto h-8 w-8 text-gray-300" />
                    <span className="mt-2 block text-xs">Belum ada data pengguna</span>
                  </td>
                </tr>
              ) : (
                users.map((item) => (
                  <tr key={item.id} className="transition hover:bg-gray-50/50">
                    <td className="px-5 py-4 font-semibold text-gray-900">
                      {item.name}
                    </td>
                    <td className="px-5 py-4 font-mono text-gray-600">
                      {item.email}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenModal(item)}
                          className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-[#1D408C]"
                          title="Edit Pengguna"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setUserToDelete({ id: item.id, name: item.name })}
                          className="rounded-lg p-1.5 text-gray-500 transition hover:bg-rose-50 hover:text-rose-600"
                          title="Hapus Pengguna"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl transition-all">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h2 className="text-base font-bold text-gray-900">
                {selectedUser ? "Edit Pengguna" : "Tambah Pengguna Baru"}
              </h2>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="mb-1 block font-medium text-gray-700">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Username"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-[#1D408C] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-gray-700">
                  Alamat Email
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="email@gmail.com"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-[#1D408C] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-gray-700">
                  Password {selectedUser && "(Kosongkan jika tidak diubah)"}
                </label>
                <input
                  type="password"
                  required={!selectedUser}
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  placeholder="Password"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-[#1D408C] focus:outline-none"
                />

                {(formData.password.length > 0 || !selectedUser) && (
                  <div className="mt-2 rounded-xl bg-gray-50 p-2.5 border border-gray-100 space-y-1">
                    <p className="text-[10px] font-semibold text-gray-600 mb-1">
                      Syarat Keamanan Password:
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-emerald-600 font-medium" : "text-gray-400"}`}>
                        {hasMinLength ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        <span>Minimal 8 karakter</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${hasUpperCase ? "text-emerald-600 font-medium" : "text-gray-400"}`}>
                        {hasUpperCase ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        <span>Huruf besar (A-Z)</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${hasLowerCase ? "text-emerald-600 font-medium" : "text-gray-400"}`}>
                        {hasLowerCase ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        <span>Huruf kecil (a-z)</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${hasNumber ? "text-emerald-600 font-medium" : "text-gray-400"}`}>
                        {hasNumber ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        <span>Angka (0-9)</span>
                      </div>
                      <div className={`flex items-center gap-1.5 col-span-2 ${hasSpecialChar ? "text-emerald-600 font-medium" : "text-gray-400"}`}>
                        {hasSpecialChar ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        <span>Karakter khusus / Simbol (!@#$%^&*)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block font-medium text-gray-700">
                  Role Akses
                </label>
                <select
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:border-[#1D408C] focus:outline-none"
                >
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting || !isPasswordValid}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#1D408C] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#16326e] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{selectedUser ? "Simpan Perubahan" : "Buat Pengguna"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-rose-50 p-2 text-rose-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Konfirmasi Hapus</h3>
                <p className="text-xs text-gray-500">
                  Yakin ingin menghapus akun <span className="font-semibold text-gray-800">{userToDelete.name}</span>?
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setUserToDelete(null)}
                className="rounded-xl px-3.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Hapus Pengguna</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}