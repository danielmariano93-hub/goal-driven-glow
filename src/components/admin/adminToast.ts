import { toast } from "sonner";
import { mapAdminActionError } from "@/lib/admin/errorMapper";

type Opts = { description?: string };

export const adminToast = {
  success(message: string, opts?: Opts) {
    toast.success(message, opts);
  },
  info(message: string, opts?: Opts) {
    toast(message, opts);
  },
  warn(message: string, opts?: Opts) {
    toast.warning(message, opts);
  },
  error(message: string, opts?: Opts) {
    toast.error(message, opts);
  },
  /**
   * Show a friendly error toast for backend/admin errors — never leaks raw messages,
   * always includes the support reference code (e.g. "Não foi possível salvar · AB12-34").
   */
  fromError(err: unknown, fallbackTitle?: string) {
    const fe = mapAdminActionError(err);
    const title = fallbackTitle ?? fe.title;
    toast.error(`${title} · ${fe.code}`, { description: fe.hint });
  },
};
