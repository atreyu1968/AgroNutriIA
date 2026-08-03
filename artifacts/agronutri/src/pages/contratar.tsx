import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useSignup,
  useCheckSubdomain,
  getCheckSubdomainQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Leaf, Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

function errorMessage(err: unknown): string {
  const anyErr = err as { data?: { error?: string }; message?: string };
  return anyErr?.data?.error ?? anyErr?.message ?? "Se ha producido un error";
}

function normalizeSubdomain(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export default function Contratar() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [debounced, setDebounced] = useState("");

  // El subdominio se propone a partir del nombre mientras no se edite a mano.
  useEffect(() => {
    if (!subdomainTouched) setSubdomain(normalizeSubdomain(name));
  }, [name, subdomainTouched]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(subdomain), 400);
    return () => clearTimeout(t);
  }, [subdomain]);

  const availability = useCheckSubdomain(
    { subdomain: debounced },
    {
      query: {
        queryKey: getCheckSubdomainQueryKey({ subdomain: debounced }),
        enabled: debounced.length >= 3,
      },
    },
  );

  const signup = useSignup({
    mutation: {
      onSuccess: (data) => {
        // A PayPal para aprobar la suscripción; a la vuelta, /contratar/gracias.
        window.location.href = data.approvalUrl;
      },
      onError: (err) => toast({ title: "No se pudo iniciar la contratación", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const returnUrls = useMemo(() => {
    const origin = window.location.origin;
    const base = BASE.replace(/\/$/, "");
    return {
      returnUrl: `${origin}${base}/contratar/gracias`,
      cancelUrl: `${origin}${base}/contratar?cancelado=1`,
    };
  }, []);

  const canSubmit =
    name.trim().length >= 2 &&
    contactName.trim().length >= 2 &&
    /.+@.+\..+/.test(contactEmail) &&
    subdomain.length >= 3 &&
    acceptTerms &&
    availability.data?.available === true &&
    !signup.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    signup.mutate({
      data: {
        name: name.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        phone: phone.trim() || null,
        subdomain,
        acceptTerms,
        ...returnUrls,
      },
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 via-white to-white text-gray-900">
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/landing"><img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-9" /></Link>
          <Link href="/landing" className="text-sm font-medium text-green-700 hover:underline">Volver a la web</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800 bg-green-100 rounded-full px-4 py-1.5">
            <Leaf className="w-4 h-4" /> Plan cooperativa / OPP
          </span>
          <h1 className="mt-4 text-3xl md:text-4xl font-extrabold tracking-tight">Contrata tu instalación</h1>
          <p className="mt-3 text-gray-600 max-w-xl mx-auto">
            100 €/mes por instalación + 2,50 €/finca activa/mes. Tu cooperativa tendrá su propia
            instalación independiente en <strong>tusubdominio</strong>.agronutri, con alta automática
            tras el pago por PayPal.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Datos de la cooperativa</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="coop-name">Nombre de la cooperativa u OPP</Label>
                  <Input id="coop-name" data-testid="input-coop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cooperativa Platanera del Norte" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-name">Persona de contacto</Label>
                  <Input id="contact-name" data-testid="input-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-email">Email de contacto</Label>
                  <Input id="contact-email" data-testid="input-contact-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
                  <p className="text-xs text-gray-500">Aquí enviaremos la cuenta de administrador inicial.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Teléfono (opcional)</Label>
                  <Input id="phone" data-testid="input-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subdomain">Subdominio deseado</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="subdomain"
                      data-testid="input-subdomain"
                      value={subdomain}
                      onChange={(e) => { setSubdomainTouched(true); setSubdomain(normalizeSubdomain(e.target.value)); }}
                      placeholder="micooperativa"
                      required
                    />
                  </div>
                  {debounced.length >= 3 && availability.data && (
                    availability.data.available ? (
                      <p className="text-xs text-green-700 inline-flex items-center gap-1" data-testid="text-subdomain-ok">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Disponible: {debounced}.tudominio
                      </p>
                    ) : (
                      <p className="text-xs text-red-600 inline-flex items-center gap-1" data-testid="text-subdomain-ko">
                        <XCircle className="w-3.5 h-3.5" /> {availability.data.reason ?? "No disponible"}
                      </p>
                    )
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <Checkbox id="terms" data-testid="checkbox-terms" checked={acceptTerms} onCheckedChange={(v) => setAcceptTerms(v === true)} />
                <Label htmlFor="terms" className="text-sm font-normal leading-relaxed cursor-pointer">
                  He leído y acepto los{" "}
                  <Link href="/terminos" className="text-green-700 underline" target="_blank">términos y condiciones</Link>,
                  incluido el precio (100 €/mes + 2,50 €/finca activa/mes, sin impuestos) y que el
                  consumo de OpenAI corre por cuenta de la cooperativa.
                </Label>
              </div>

              <Button type="submit" size="lg" className="w-full bg-green-700 hover:bg-green-800 h-12" disabled={!canSubmit} data-testid="button-signup-submit">
                {signup.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Conectando con PayPal…</>
                ) : (
                  <>Continuar al pago con PayPal <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
              <p className="text-xs text-gray-500 text-center">
                El pago se gestiona con una suscripción de PayPal. La cuota variable por fincas
                activas se factura mensualmente según el uso real.
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
