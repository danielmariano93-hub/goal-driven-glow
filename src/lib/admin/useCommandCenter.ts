import { useQuery } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import type { CommandCenterData } from "@/lib/admin/commandCenter";

export function useCommandCenter(days: number) {
  return useQuery<CommandCenterData>({
    queryKey: ["admin-command-center", days],
    queryFn: () => callAdminRpc<CommandCenterData>("admin_v4_command_center", { p_days: days }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

