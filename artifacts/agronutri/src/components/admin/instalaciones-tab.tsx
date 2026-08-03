import { useState } from "react";
import {
  useAdminListInstallations,
  getAdminListInstallationsQueryKey,
  useAdminListInstallationEvents,
  getAdminListInstallationEventsQueryKey,
  useAdminProvisionInstallation,
  useAdminGetPaypalSettings,
  getAdminGetPaypalSettingsQueryKey,
  useAdminUpdatePaypalSettings,
  type AdminInstallation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Info, Loader2, RefreshCcw, Server, CreditCard, ExternalLink } from "lucide-react";

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending_payment: { label: "Pendiente de pago", className: "bg-amber-100 text-amber-800" },
  provisioning: { label: "Aprovisionando", className: "bg-blue-100 text-blue-800" },
  active: { label: "Activa", className: "bg-green-100 text-green-800" },
  suspended: { label: "Suspendida (impago)", className: "bg-orange-100 text-orange-800" },
  cancelled: { label: "Baja", className: "bg-gray-200 text-gray-700" },
  error: { label: "Error", className: "bg-red-100 text-red-800" },
};

function eur(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function errorMessage(err: unknown): string {
  const anyErr = err as { data?: { error?: string }; message?: string };
  return anyErr?.data?.error ?? anyErr?.message ?? "Se ha producido un error";
}

function EventsDialog({ installation, onClose }: { installation: AdminInstallation; onClose: () => void }) {
  const { data: events, isLoading } = useAdminListInstallationEvents(installation.id, {
    query: { queryKey: getAdminListInstallationEventsQueryKey(installation.id) },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Eventos — {installation.subdomain}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !events?.length ? (
          <p className="text-sm text-muted-foreground">Sin eventos todavía.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {e.status === "ok" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                ) : e.status === "error" ? (
                  <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                )}
                <span>
                  <span className="font-medium">{e.step}</span>
                  {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
                  <span className="block text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString("es-ES")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaypalSettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useAdminGetPaypalSettings({
    query: { queryKey: getAdminGetPaypalSettingsQueryKey() },
  });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [mode, setMode] = useState<string>("");
  const [webhookId, setWebhookId] = useState("");

  const update = useAdminUpdatePaypalSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Configuración de PayPal guardada" });
        setClientId(""); setClientSecret(""); setWebhookId(""); setMode("");
        queryClient.invalidateQueries({ queryKey: getAdminGetPaypalSettingsQueryKey() });
      },
      onError: (err) => toast({ title: "No se pudo guardar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const save = () => {
    const data: Record<string, string | null> = {};
    if (clientId.trim()) data.clientId = clientId.trim();
    if (clientSecret.trim()) data.clientSecret = clientSecret.trim();
    if (mode) data.mode = mode;
    if (webhookId.trim()) data.webhookId = webhookId.trim();
    if (Object.keys(data).length === 0) {
      toast({ title: "No hay cambios que guardar" });
      return;
    }
    update.mutate({ data });
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="w-4 h-4" /> PayPal (contratación online)
          {settings?.configured ? (
            <Badge className="bg-green-100 text-green-800">Configurado ({settings.source === "env" ? "entorno" : "BD"}, {settings.mode})</Badge>
          ) : (
            <Badge variant="outline" className="text-amber-700">Sin configurar</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Credenciales REST de PayPal para las suscripciones (100 €/mes por instalación). El
          variable por fincas activas se registra en la facturación mensual de cada instalación.
          {settings?.planId && <> Plan actual: <span className="font-mono text-xs">{settings.planId}</span></>}
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Client ID</Label>
            <Input data-testid="input-paypal-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={settings?.clientId ?? "AXxxxxxxxx"} />
          </div>
          <div className="space-y-2">
            <Label>Client secret</Label>
            <Input data-testid="input-paypal-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={settings?.clientSecretMasked ?? "••••••••"} />
          </div>
          <div className="space-y-2">
            <Label>Entorno</Label>
            <Select value={mode || settings?.mode || "sandbox"} onValueChange={setMode}>
              <SelectTrigger data-testid="select-paypal-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (pruebas)</SelectItem>
                <SelectItem value="live">Producción (live)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Webhook ID</Label>
            <Input data-testid="input-paypal-webhook-id" value={webhookId} onChange={(e) => setWebhookId(e.target.value)} placeholder={settings?.webhookId ?? "Para verificar la firma de los webhooks"} />
          </div>
        </div>
        <Button onClick={save} disabled={update.isPending} data-testid="button-save-paypal">
          {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Guardar
        </Button>
      </CardContent>
    </Card>
  );
}

export function InstalacionesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: installations, isLoading } = useAdminListInstallations({
    query: { queryKey: getAdminListInstallationsQueryKey(), refetchInterval: 15000 },
  });
  const [eventsFor, setEventsFor] = useState<AdminInstallation | null>(null);

  const provision = useAdminProvisionInstallation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Aprovisionamiento lanzado" });
        queryClient.invalidateQueries({ queryKey: getAdminListInstallationsQueryKey() });
      },
      onError: (err) => toast({ title: "No se pudo reintentar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6">
      <PaypalSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="w-4 h-4" /> Instalaciones contratadas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !installations?.length ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-installations">
              Todavía no hay instalaciones contratadas. Cuando una cooperativa contrate desde
              /contratar aparecerá aquí con su estado y facturación.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Cooperativa</th>
                    <th className="py-2 pr-4">Subdominio</th>
                    <th className="py-2 pr-4">Estado</th>
                    <th className="py-2 pr-4">Fincas activas</th>
                    <th className="py-2 pr-4">Mes en curso</th>
                    <th className="py-2 pr-4">Facturado total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {installations.map((i) => {
                    const badge = STATUS_BADGES[i.status] ?? { label: i.status, className: "" };
                    return (
                      <tr key={i.id} className="border-b last:border-0" data-testid={`row-installation-${i.id}`}>
                        <td className="py-3 pr-4">
                          <div className="font-medium">{i.name}</div>
                          <div className="text-xs text-muted-foreground">{i.contactName} · {i.contactEmail}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline font-mono text-xs">
                            {i.subdomain} <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge className={badge.className} data-testid={`badge-status-${i.id}`}>{badge.label}</Badge>
                        </td>
                        <td className="py-3 pr-4">{i.activeFarmCount}</td>
                        <td className="py-3 pr-4">{i.currentMonthCents != null ? eur(i.currentMonthCents) : "—"}</td>
                        <td className="py-3 pr-4">{eur(i.totalBilledCents)}</td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => setEventsFor(i)} data-testid={`button-events-${i.id}`}>
                            Eventos
                          </Button>
                          {(i.status === "error" || i.status === "pending_payment" || i.status === "provisioning") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => provision.mutate({ installationId: i.id })}
                              disabled={provision.isPending}
                              data-testid={`button-provision-${i.id}`}
                            >
                              <RefreshCcw className="w-3.5 h-3.5 mr-1" /> Reintentar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {eventsFor && <EventsDialog installation={eventsFor} onClose={() => setEventsFor(null)} />}
    </div>
  );
}
