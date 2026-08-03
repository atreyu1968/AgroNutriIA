import { useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import {
  useConfirmSignup,
  useGetSignupStatus,
  getGetSignupStatusQueryKey,
  type SignupStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, Info, ExternalLink } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Esperando confirmación del pago",
  provisioning: "Creando tu instalación…",
  active: "¡Instalación lista!",
  suspended: "Suscripción suspendida",
  cancelled: "Contratación cancelada",
  error: "Ha habido un problema",
};

const STEP_LABELS: Record<string, string> = {
  start: "Inicio del aprovisionamiento",
  dns: "Subdominio y DNS",
  database: "Base de datos propia",
  service: "Servicio de la aplicación",
  tls: "Certificado TLS",
  admin_account: "Cuenta de administrador",
  email: "Envío de credenciales",
  done: "Finalizado",
  error: "Error",
};

export default function ContratarGracias() {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );
  const confirm = useConfirmSignup();
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (token && !confirmedRef.current) {
      confirmedRef.current = true;
      confirm.mutate({ publicToken: token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const status = useGetSignupStatus(token, {
    query: {
      queryKey: getGetSignupStatusQueryKey(token),
      enabled: Boolean(token),
      refetchInterval: (q) => {
        const s = (q.state.data as SignupStatus | undefined)?.status;
        return s === "pending_payment" || s === "provisioning" ? 3000 : false;
      },
    },
  });

  const data = status.data;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <XCircle className="w-10 h-10 text-red-500 mx-auto" />
            <p>Falta el identificador de la contratación.</p>
            <Link href="/contratar"><Button variant="outline">Volver a contratar</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 via-white to-white text-gray-900">
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center">
          <Link href="/landing"><img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-9" /></Link>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2" data-testid="text-signup-status">
              {!data ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Consultando el estado…</>
              ) : data.status === "active" ? (
                <><CheckCircle2 className="w-5 h-5 text-green-600" /> {STATUS_LABELS[data.status]}</>
              ) : data.status === "error" || data.status === "cancelled" ? (
                <><XCircle className="w-5 h-5 text-red-500" /> {STATUS_LABELS[data.status]}</>
              ) : (
                <><Loader2 className="w-5 h-5 animate-spin text-green-700" /> {STATUS_LABELS[data.status] ?? data.status}</>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {data && (
              <>
                <p className="text-gray-600">
                  Instalación de <strong>{data.name}</strong> en{" "}
                  <span className="font-mono text-sm">{data.subdomain}</span>.
                  {data.status === "pending_payment" &&
                    " En cuanto PayPal confirme la suscripción, el alta empezará automáticamente."}
                  {data.status === "provisioning" &&
                    " Estamos creando el subdominio, la base de datos y el servicio. Esta página se actualiza sola."}
                  {data.status === "active" &&
                    " Te hemos enviado por email la cuenta de administrador inicial."}
                </p>

                {data.status === "active" && data.url && (
                  <a href={data.url} target="_blank" rel="noreferrer">
                    <Button className="bg-green-700 hover:bg-green-800" data-testid="button-open-installation">
                      Entrar en tu instalación <ExternalLink className="w-4 h-4 ml-2" />
                    </Button>
                  </a>
                )}

                {data.events.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-700">Progreso del alta</h3>
                    <ul className="space-y-1.5">
                      {data.events.map((e, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          {e.status === "ok" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                          ) : e.status === "error" ? (
                            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          ) : (
                            <Info className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                          )}
                          <span>
                            <span className="font-medium">{STEP_LABELS[e.step] ?? e.step}</span>
                            {e.detail && <span className="text-gray-500"> — {e.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.status === "error" && (
                  <p className="text-sm text-gray-600">
                    No te preocupes: el pago está registrado y nuestro equipo reintentará el alta.
                    Si tarda, escríbenos indicando tu subdominio.
                  </p>
                )}
                <Badge variant="outline" className="font-mono text-xs">Ref.: {token.slice(0, 10)}…</Badge>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
