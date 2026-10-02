import { useQuery } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { rangeToInstants, type CommandCenterData } from "@/lib/admin/commandCenter";
import type { PeriodRange } from "@/lib/admin/periodPresets";

export function useCommandCenter(range: PeriodRange) {
  return useQuery<CommandCenterData>({
    queryKey: ["admin-command-center", range.from, range.to],
    queryFn: () => callAdminRpc<CommandCenterData>("admin_v4_command_center", rangeToInstants(range)),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
