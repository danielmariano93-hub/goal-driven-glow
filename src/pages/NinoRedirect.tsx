import { Navigate, useSearchParams } from "react-router-dom";
import { ninoRedirectTarget } from "@/lib/navigation/ninoRedirect";

/** Rota legada `/app/nino`: só redireciona (ver `ninoRedirectTarget`). */
export default function NinoRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={ninoRedirectTarget(params.get("section"))} replace />;
}
