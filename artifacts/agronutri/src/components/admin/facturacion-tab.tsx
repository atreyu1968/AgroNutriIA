import { useState } from "react";
import {
  useAdminListInstallations,
  getAdminListInstallationsQueryKey,
  useAdminListInvoices,
  getAdminListInvoicesQueryKey,
  useAdminGetBillingSettings,
  getAdminGetBillingSettingsQueryKey,
  useAdminUpdateBillingSettings,
  useAdminUpdateInstallationBillingInfo,
  useAdminIssueInvoice,
  useAdminSendInvoice,
  useAdminMarkInvoicePaid,
  useAdminGetVerifactuSettings,
  getAdminGetVerifactuSettingsQueryKey,
  useAdminUpdateVerifactuSettings,
  useAdminSubmitInvoiceVerifactu,
  type AdminInstallation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, Loader2, Send, CheckCircle2, Download, Building2, ReceiptText, Pencil,
  ShieldCheck, RefreshCw,
} from "lucide-react";

function eur(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function errorMessage(err: unknown): string {
  const anyErr = err as { data?: { error?: string }; message?: string };
  return anyErr?.data?.error ?? anyErr?.message ?? "Se ha producido un error";
}

const INVOICE_BADGES: Record<string, { label: string; className: string }> = {
  issued: { label: "Emitida", className: "bg-blue-100 text-blue-800" },
  sent: { label: "Enviada", className: "bg-amber-100 text-amber-800" },
  paid: { label: "Pagada", className: "bg-green-100 text-green-800" },
};

const VERIFACTU_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: "AEAT: pendiente", className: "bg-slate-100 text-slate-700" },
  accepted: { label: "AEAT: aceptada", className: "bg-green-100 text-green-800" },
  accepted_with_errors: { label: "AEAT: con errores", className: "bg-amber-100 text-amber-800" },
  rejected: { label: "AEAT: rechazada", className: "bg-red-100 text-red-800" },
  error: { label: "AEAT: error de envío", className: "bg-red-100 text-red-800" },
};
function IssuerSettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useAdminGetBillingSettings({
    query: { queryKey: getAdminGetBillingSettingsQueryKey() },
  });
  const [issuerName, setIssuerName] = useState("");
  const [issuerTaxId, setIssuerTaxId] = useState("");
  const [issuerAddress, setIssuerAddress] = useState("");
  const [series, setSeries] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [taxName, setTaxName] = useState("");

  const update = useAdminUpdateBillingSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Datos del emisor guardados" });
        setIssuerName(""); setIssuerTaxId(""); setIssuerAddress("");
        setSeries(""); setTaxRate(""); setTaxName("");
        queryClient.invalidateQueries({ queryKey: getAdminGetBillingSettingsQueryKey() });
      },
      onError: (err) => toast({ title: "No se pudo guardar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const save = () => {
    const data: Record<string, string | number | null> = {};
    if (issuerName.trim()) data.issuerName = issuerName.trim();
    if (issuerTaxId.trim()) data.issuerTaxId = issuerTaxId.trim();
    if (issuerAddress.trim()) data.issuerAddress = issuerAddress.trim();
    if (series.trim()) data.series = series.trim();
    if (taxRate.trim()) {
      const pct = Number(taxRate.replace(",", "."));
      if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
        toast({ title: "Tipo impositivo no válido", description: "Indica un porcentaje entre 0 y 30", variant: "destructive" });
        return;
      }
      data.taxRateBps = Math.round(pct * 100);
    }
    if (taxName.trim()) data.taxName = taxName.trim();
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
          <Building2 className="w-4 h-4" /> Datos del emisor de facturas
          {settings?.configured ? (
            <Badge className="bg-green-100 text-green-800">Configurado</Badge>
          ) : (
            <Badge variant="outline" className="text-amber-700">Sin configurar</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Estos datos aparecen en todas las facturas. Impuesto por defecto: {settings?.taxName}{" "}
          {settings ? (settings.taxRateBps / 100).toLocaleString("es-ES") : ""} % · Serie: {settings?.series}
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nombre o razón social</Label>
            <Input data-testid="input-issuer-name" value={issuerName} onChange={(e) => setIssuerName(e.target.value)} placeholder={settings?.issuerName ?? "AgroNutri AI S.L."} />
          </div>
          <div className="space-y-2">
            <Label>NIF</Label>
            <Input data-testid="input-issuer-tax-id" value={issuerTaxId} onChange={(e) => setIssuerTaxId(e.target.value)} placeholder={settings?.issuerTaxId ?? "B00000000"} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Dirección fiscal</Label>
            <Input data-testid="input-issuer-address" value={issuerAddress} onChange={(e) => setIssuerAddress(e.target.value)} placeholder={settings?.issuerAddress ?? "Calle, número, CP, municipio, isla"} />
          </div>
          <div className="space-y-2">
            <Label>Serie de facturación</Label>
            <Input data-testid="input-billing-series" value={series} onChange={(e) => setSeries(e.target.value)} placeholder={settings?.series ?? "AGN"} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Impuesto</Label>
              <Input data-testid="input-tax-name" value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder={settings?.taxName ?? "IGIC"} />
            </div>
            <div className="space-y-2">
              <Label>Tipo (%)</Label>
              <Input data-testid="input-tax-rate" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder={settings ? (settings.taxRateBps / 100).toLocaleString("es-ES") : "7"} />
            </div>
          </div>
        </div>
        <Button onClick={save} disabled={update.isPending} data-testid="button-save-billing-settings">
          {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Guardar
        </Button>
        <div className="flex items-start justify-between gap-4 border-t pt-4">
          <div className="space-y-1">
            <Label>Enviar facturas por email automáticamente</Label>
            <p className="text-sm text-muted-foreground">
              Cada mes, al cerrarse el periodo, la factura del cargo (cuota base + fincas
              activas) se emite sola. Con esta opción, además se envía por email a la
              cooperativa sin intervención manual.
            </p>
          </div>
          <Switch
            checked={settings?.autoSendEmail ?? false}
            onCheckedChange={(checked) => update.mutate({ data: { autoSendEmail: checked } })}
            disabled={update.isPending}
            data-testid="switch-auto-send-email"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BillingInfoDialog({ installation, onClose }: { installation: AdminInstallation; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const update = useAdminUpdateInstallationBillingInfo({
    mutation: {
      onSuccess: () => {
        toast({ title: "Datos fiscales guardados" });
        queryClient.invalidateQueries({ queryKey: getAdminListInstallationsQueryKey() });
        onClose();
      },
      onError: (err) => toast({ title: "No se pudo guardar", description: errorMessage(err), variant: "destructive" }),
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Datos fiscales — {installation.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>NIF/CIF</Label>
            <Input data-testid="input-installation-tax-id" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="F00000000" />
          </div>
          <div className="space-y-2">
            <Label>Dirección fiscal</Label>
            <Input data-testid="input-installation-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, número, CP, municipio" />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              update.mutate({
                installationId: installation.id,
                data: {
                  ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
                  ...(address.trim() ? { billingAddress: address.trim() } : {}),
                },
              })
            }
            disabled={update.isPending || (!taxId.trim() && !address.trim())}
            data-testid="button-save-installation-billing"
          >
            {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FacturacionTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: installations, isLoading: loadingInst } = useAdminListInstallations({
    query: { queryKey: getAdminListInstallationsQueryKey() },
  });
  const { data: invoices, isLoading: loadingInv } = useAdminListInvoices({
    query: { queryKey: getAdminListInvoicesQueryKey() },
  });
  const [billingInfoFor, setBillingInfoFor] = useState<AdminInstallation | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getAdminListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getAdminListInstallationsQueryKey() });
  };
  const issue = useAdminIssueInvoice({
    mutation: {
      onSuccess: (inv) => { invalidate(); toast({ title: `Factura ${inv.fullNumber} emitida` }); },
      onError: (err) => toast({ title: "No se pudo emitir", description: errorMessage(err), variant: "destructive" }),
    },
  });
  const send = useAdminSendInvoice({
    mutation: {
      onSuccess: (inv) => { invalidate(); toast({ title: `Factura ${inv.fullNumber} enviada por email` }); },
      onError: (err) => toast({ title: "No se pudo enviar", description: errorMessage(err), variant: "destructive" }),
    },
  });
  const markPaid = useAdminMarkInvoicePaid({
    mutation: {
      onSuccess: (inv) => { invalidate(); toast({ title: `Factura ${inv.fullNumber} marcada como pagada` }); },
      onError: (err) => toast({ title: "No se pudo actualizar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  // Cargos sin factura, listos para emitir.
  const pendingCharges = (installations ?? []).flatMap((i) =>
    i.charges
      .filter((c) => c.status === "pending")
      .map((c) => ({ installation: i, charge: c })),
  );

  const submitVerifactu = useAdminSubmitInvoiceVerifactu({
    mutation: {
      onSuccess: (inv) => {
        invalidate();
        const st = inv.verifactu?.status;
        if (st === "accepted") toast({ title: `Registro de ${inv.fullNumber} aceptado por la AEAT` });
        else toast({ title: `Envío a la AEAT: ${VERIFACTU_BADGES[st ?? ""]?.label ?? st}`, description: inv.verifactu?.lastError ?? undefined });
      },
      onError: (err) => toast({ title: "No se pudo enviar a la AEAT", description: errorMessage(err), variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6">
      <IssuerSettingsCard />
      <VerifactuSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="w-4 h-4" /> Cargos pendientes de facturar
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingInst ? (
            <Skeleton className="h-24 w-full" />
          ) : pendingCharges.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-pending-charges">
              No hay cargos pendientes. Cada mes se genera un cargo por instalación
              (cuota base + fincas activas) que podrás facturar desde aquí.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Cooperativa</th>
                    <th className="py-2 pr-4">Periodo</th>
                    <th className="py-2 pr-4">Base</th>
                    <th className="py-2 pr-4">Fincas</th>
                    <th className="py-2 pr-4">Variable</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pendingCharges.map(({ installation: i, charge: c }) => (
                    <tr key={`${i.id}-${c.period}`} className="border-b last:border-0" data-testid={`row-charge-${i.id}-${c.period}`}>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{i.subdomain}</div>
                      </td>
                      <td className="py-3 pr-4">{c.period}</td>
                      <td className="py-3 pr-4">{eur(c.baseCents)}</td>
                      <td className="py-3 pr-4">{c.farmCount}</td>
                      <td className="py-3 pr-4">{eur(c.variableCents)}</td>
                      <td className="py-3 pr-4 font-medium">{eur(c.totalCents)}</td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setBillingInfoFor(i)} data-testid={`button-billing-info-${i.id}`}>
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Datos fiscales
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => issue.mutate({ installationId: i.id, period: c.period })}
                          disabled={issue.isPending}
                          data-testid={`button-issue-${i.id}-${c.period}`}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" /> Emitir factura
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4" /> Facturas emitidas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingInv ? (
            <Skeleton className="h-24 w-full" />
          ) : !invoices?.length ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-invoices">
              Todavía no hay facturas. Emite la primera desde los cargos pendientes.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Número</th>
                    <th className="py-2 pr-4">Cooperativa</th>
                    <th className="py-2 pr-4">Periodo</th>
                    <th className="py-2 pr-4">Base</th>
                    <th className="py-2 pr-4">Impuesto</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Estado</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const badge = INVOICE_BADGES[inv.status] ?? { label: inv.status, className: "" };
                    return (
                      <tr key={inv.id} className="border-b last:border-0" data-testid={`row-invoice-${inv.id}`}>
                        <td className="py-3 pr-4 font-mono text-xs">{inv.fullNumber}</td>
                        <td className="py-3 pr-4">{inv.installationName}</td>
                        <td className="py-3 pr-4">{inv.period}</td>
                        <td className="py-3 pr-4">{eur(inv.subtotalCents)}</td>
                        <td className="py-3 pr-4">
                          {eur(inv.taxCents)}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({inv.taxName} {(inv.taxRateBps / 100).toLocaleString("es-ES")} %)
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-medium">{eur(inv.totalCents)}</td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-col gap-1 items-start">
                            <Badge className={badge.className} data-testid={`badge-invoice-${inv.id}`}>{badge.label}</Badge>
                            {inv.verifactu && (
                              <Badge
                                className={VERIFACTU_BADGES[inv.verifactu.status]?.className ?? ""}
                                data-testid={`badge-verifactu-${inv.id}`}
                                title={inv.verifactu.lastError ?? inv.verifactu.csv ?? undefined}
                              >
                                {VERIFACTU_BADGES[inv.verifactu.status]?.label ?? inv.verifactu.status}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <Button asChild variant="ghost" size="sm" data-testid={`button-pdf-${inv.id}`}>
                            <a href={`${import.meta.env.BASE_URL}api/admin/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">
                              <Download className="w-3.5 h-3.5 mr-1" /> PDF
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => send.mutate({ invoiceId: inv.id })}
                            disabled={send.isPending}
                            data-testid={`button-send-${inv.id}`}
                          >
                            <Send className="w-3.5 h-3.5 mr-1" /> {inv.status === "issued" ? "Enviar" : "Reenviar"}
                          </Button>
                          {inv.verifactu && ["pending", "error", "rejected"].includes(inv.verifactu.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => submitVerifactu.mutate({ invoiceId: inv.id })}
                              disabled={submitVerifactu.isPending}
                              data-testid={`button-verifactu-${inv.id}`}
                            >
                              <RefreshCw className="w-3.5 h-3.5 mr-1" /> AEAT
                            </Button>
                          )}
                          {inv.status !== "paid" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => markPaid.mutate({ invoiceId: inv.id })}
                              disabled={markPaid.isPending}
                              data-testid={`button-paid-${inv.id}`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Pagada
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

      {billingInfoFor && (
        <BillingInfoDialog installation={billingInfoFor} onClose={() => setBillingInfoFor(null)} />
      )}
    </div>
  );
}

function VerifactuSettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useAdminGetVerifactuSettings({
    query: { queryKey: getAdminGetVerifactuSettingsQueryKey() },
  });
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");

  const update = useAdminUpdateVerifactuSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Configuración VeriFactu guardada" });
        setCertPem("");
        setKeyPem("");
        queryClient.invalidateQueries({ queryKey: getAdminGetVerifactuSettingsQueryKey() });
      },
      onError: (err) =>
        toast({ title: "No se pudo guardar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="w-4 h-4" /> VeriFactu — envío a la AEAT
          {settings?.ready ? (
            <Badge className="bg-green-100 text-green-800">Activo</Badge>
          ) : settings?.certConfigured ? (
            <Badge variant="outline" className="text-amber-700">Desactivado</Badge>
          ) : (
            <Badge variant="outline" className="text-amber-700">Sin certificado</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Con VeriFactu activado, cada factura emitida se remite a la AEAT firmada con el
          certificado digital del emisor y el PDF incluye el QR de «factura verificable».
          Sistema declarado: {settings?.system.systemName} v{settings?.system.version} (ID{" "}
          {settings?.system.systemId}, instalación {settings?.system.installationNumber}).
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Certificado del emisor (PEM)</Label>
            <Textarea
              data-testid="input-verifactu-cert"
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              placeholder={settings?.certConfigured ? "Configurado — pega uno nuevo para sustituirlo" : "-----BEGIN CERTIFICATE-----"}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>Clave privada (PEM)</Label>
            <Textarea
              data-testid="input-verifactu-key"
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              placeholder={settings?.keyConfigured ? "Configurada — pega una nueva para sustituirla" : "-----BEGIN PRIVATE KEY-----"}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              data-testid="switch-verifactu-enabled"
              checked={settings?.enabled ?? false}
              onCheckedChange={(v) => update.mutate({ data: { enabled: v } })}
            />
            <Label>Enviar registros a la AEAT</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              data-testid="switch-verifactu-env"
              checked={settings?.environment === "production"}
              onCheckedChange={(v) =>
                update.mutate({ data: { environment: v ? "production" : "sandbox" } })
              }
            />
            <Label>
              Entorno real{" "}
              <span className="text-muted-foreground font-normal">
                ({settings?.environment === "production" ? "producción" : "pruebas AEAT"})
              </span>
            </Label>
          </div>
          <Button
            onClick={() =>
              update.mutate({
                data: {
                  ...(certPem.trim() ? { certPem: certPem.trim() } : {}),
                  ...(keyPem.trim() ? { keyPem: keyPem.trim() } : {}),
                },
              })
            }
            disabled={update.isPending || (!certPem.trim() && !keyPem.trim())}
            data-testid="button-save-verifactu"
          >
            {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Guardar certificado
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
