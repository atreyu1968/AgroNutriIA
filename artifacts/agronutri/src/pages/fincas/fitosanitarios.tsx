import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPhytoTreatments,
  getListPhytoTreatmentsQueryKey,
  useCreatePhytoTreatment,
  useDeletePhytoTreatment,
  usePhytoConsult,
  useListSectors,
  getListSectorsQueryKey,
  useListPhytoProducts,
  getListPhytoProductsQueryKey,
  useCreatePhytoProduct,
  useDeletePhytoProduct,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { SprayCan, Plus, Trash2, ExternalLink, Bot, Loader2, FlaskConical, AlertTriangle, BookMarked, FileDown } from "lucide-react";
import { formatDate } from "@/lib/utils";

const PESTS = [
  "Cochinilla",
  "Mosca blanca",
  "Araña roja / ácaros",
  "Picudo de la platanera",
  "Trips",
  "Pulgones",
  "Malas hierbas",
  "Enfermedades fúngicas",
  "Nematodos",
];

function errorMessage(err: unknown): string {
  return (err as { data?: { error?: string } })?.data?.error ?? "Error inesperado";
}

export default function FitosanitariosTab({ farmId, canEdit }: { farmId: number; canEdit: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: treatments, isLoading } = useListPhytoTreatments(farmId);
  const { data: sectors } = useListSectors(farmId, { query: { queryKey: getListSectorsQueryKey(farmId) } });

  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));

  // Formulario nueva aplicación
  const [fDate, setFDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fSector, setFSector] = useState<string>("all");
  const [fProduct, setFProduct] = useState("");
  const [fRegistry, setFRegistry] = useState("");
  const [fActive, setFActive] = useState("");
  const [fPest, setFPest] = useState("");
  const [fDose, setFDose] = useState("");
  const [fDoseUnit, setFDoseUnit] = useState("ml/hl");
  const [fWater, setFWater] = useState("");
  const [fArea, setFArea] = useState("");
  const [fSafety, setFSafety] = useState("");
  const [fNotes, setFNotes] = useState("");

  // Asesor IA (selección múltiple de plagas)
  const [question, setQuestion] = useState("");
  const [selectedPests, setSelectedPests] = useState<string[]>([]);
  const [aiSector, setAiSector] = useState<string>("all");
  const [answer, setAnswer] = useState<{ answer: string; sources: string[] } | null>(null);
  const [downloadingPlan, setDownloadingPlan] = useState(false);

  const downloadPlanPdf = async () => {
    if (!answer) return;
    setDownloadingPlan(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/farms/${farmId}/phyto/plan-pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer: answer.answer,
          question: question.trim() || null,
          pests: selectedPests,
          sources: answer.sources,
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plan-tratamiento-fitosanitario.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "No se pudo generar el PDF",
        description: "Vuelve a intentarlo en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setDownloadingPlan(false);
    }
  };

  // Catálogo de productos autorizados
  const { data: products } = useListPhytoProducts({ query: { queryKey: getListPhytoProductsQueryKey() } });
  const [addingProduct, setAddingProduct] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<number | null>(null);
  const [pName, setPName] = useState("");
  const [pRegistry, setPRegistry] = useState("");
  const [pActive, setPActive] = useState("");
  const [pPests, setPPests] = useState("");
  const [pDose, setPDose] = useState("");
  const [pMaxApps, setPMaxApps] = useState("");
  const [pSafety, setPSafety] = useState("");
  const [pExpiry, setPExpiry] = useState("");
  const [pNotes, setPNotes] = useState("");

  // Calculadora de caldo
  const [cDose, setCDose] = useState("");
  const [cVolume, setCVolume] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPhytoTreatmentsQueryKey(farmId) });

  const createTreatment = useCreatePhytoTreatment({
    mutation: {
      onSuccess: () => {
        invalidate();
        setAdding(false);
        toast({ title: "Aplicación registrada" });
      },
      onError: (err) => toast({ title: "No se pudo registrar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const deleteTreatment = useDeletePhytoTreatment({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleting(null);
        toast({ title: "Registro eliminado" });
      },
      onError: (err) => toast({ title: "No se pudo eliminar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const consult = usePhytoConsult({
    mutation: {
      onSuccess: (data) => {
        setAnswer(data);
        // El asesor puede haber guardado productos verificados en el catálogo.
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
      },
      onError: (err) => toast({ title: "Error del asesor", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const createProduct = useCreatePhytoProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
        setAddingProduct(false);
        setPName(""); setPRegistry(""); setPActive(""); setPPests(""); setPDose("");
        setPMaxApps(""); setPSafety(""); setPExpiry(""); setPNotes("");
        toast({ title: "Producto guardado en el catálogo" });
      },
      onError: (err) => toast({ title: "No se pudo guardar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const deleteProduct = useDeletePhytoProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
        setDeletingProduct(null);
        toast({ title: "Producto eliminado del catálogo" });
      },
      onError: (err) => toast({ title: "No se pudo eliminar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  function productStatus(expiryDate: string | null): { label: string; variant: "secondary" | "destructive" | "outline" } {
    if (!expiryDate) return { label: "Sin fecha de caducidad", variant: "outline" };
    const today = new Date().toISOString().slice(0, 10);
    if (expiryDate < today) return { label: `Caducó el ${formatDate(expiryDate)}`, variant: "destructive" };
    const soon = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (expiryDate <= soon) return { label: `Caduca el ${formatDate(expiryDate)}`, variant: "destructive" };
    return { label: `Vigente hasta ${formatDate(expiryDate)}`, variant: "secondary" };
  }

  const years = useMemo(() => {
    const ys = new Set<string>([String(new Date().getFullYear())]);
    for (const t of treatments ?? []) ys.add(t.applicationDate.slice(0, 4));
    return [...ys].sort().reverse();
  }, [treatments]);

  const filtered = useMemo(
    () => (treatments ?? []).filter((t) => t.applicationDate.startsWith(year)),
    [treatments, year],
  );

  // Recuento anual por producto y parcela
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      const key = `${t.productName} — ${t.sectorName ?? "toda la finca"}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const caldoResult = useMemo(() => {
    const d = parseFloat(cDose);
    const v = parseFloat(cVolume);
    if (!isFinite(d) || !isFinite(v) || d <= 0 || v <= 0) return null;
    const total = (d * v) / 100; // dosis por hl → por litros
    return total >= 1000 ? `${(total / 1000).toFixed(2)} L (o kg)` : `${total.toFixed(0)} ml (o g)`;
  }, [cDose, cVolume]);

  function submitTreatment() {
    createTreatment.mutate({
      farmId,
      data: {
        applicationDate: fDate,
        productName: fProduct.trim(),
        sectorId: fSector === "all" ? null : parseInt(fSector, 10),
        registryNumber: fRegistry.trim() || null,
        activeIngredient: fActive.trim() || null,
        targetPest: fPest.trim() || null,
        doseAmount: fDose === "" ? null : parseFloat(fDose),
        doseUnit: fDose === "" ? null : fDoseUnit,
        waterVolumeL: fWater === "" ? null : parseFloat(fWater),
        areaHa: fArea === "" ? null : parseFloat(fArea),
        safetyDays: fSafety === "" ? null : parseInt(fSafety, 10),
        notes: fNotes.trim() || null,
      },
    });
  }

  return (
    <div className="space-y-6 mt-6">
      {/* Asesor IA */}
      <Card className="shadow-sm border-t-4 border-t-primary">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="w-5 h-5" /> Asesor de fitosanitarios
          </CardTitle>
          <CardDescription>
            Consulta qué productos están autorizados hoy en platanera. El asesor verifica en internet el
            Registro Oficial del MAPA y las autorizaciones excepcionales de Sanidad Vegetal del Gobierno de
            Canarias, y tiene en cuenta las aplicaciones ya registradas este año en cada parcela.
          </CardDescription>
        </CardHeader>
        {!canEdit && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              El asesor está disponible para propietarios y técnicos de la finca.
            </p>
          </CardContent>
        )}
        {canEdit && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Plagas o problemas (puedes marcar varias)</Label>
              <div className="flex flex-wrap gap-1.5">
                {PESTS.map((p) => {
                  const active = selectedPests.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setSelectedPests((prev) =>
                          active ? prev.filter((x) => x !== p) : [...prev, p],
                        )
                      }
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              {selectedPests.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  El asesor tratará cada plaga y analizará si los tratamientos se pueden combinar.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Sector</Label>
              <Select value={aiSector} onValueChange={setAiSector}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toda la finca</SelectItem>
                  {(sectors ?? []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tu consulta</Label>
            <Textarea
              rows={3}
              placeholder="Ej.: Tengo un foco de cochinilla algodonosa. ¿Qué productos autorizados puedo usar, con qué dosis y cuánto caldo preparo para 400 plantas?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              disabled={consult.isPending || question.trim().length < 5}
              className="gap-2"
              onClick={() => {
                setAnswer(null);
                consult.mutate({
                  farmId,
                  data: {
                    question: question.trim(),
                    targetPest: selectedPests.length ? selectedPests.join(", ") : null,
                    sectorId: aiSector === "all" ? null : parseInt(aiSector, 10),
                  },
                });
              }}
            >
              {consult.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
              {consult.isPending ? "Consultando registros oficiales..." : "Consultar al asesor"}
            </Button>
            <a
              href="https://www.mapa.gob.es/es/agricultura/temas/sanidad-vegetal/productos-fitosanitarios/registro-productos/"
              target="_blank" rel="noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              Registro del MAPA <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://www.gobiernodecanarias.org/agricultura/temas/sanidad_vegetal/"
              target="_blank" rel="noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              Sanidad Vegetal Canarias <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {answer && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
              {answer.sources.length > 0 && (
                <div className="border-t pt-2 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Fuentes consultadas:</p>
                  {answer.sources.map((s, i) => (
                    <a key={i} href={s} target="_blank" rel="noreferrer" className="block text-xs text-primary hover:underline truncate">
                      {s}
                    </a>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Contrasta siempre esta información con la etiqueta vigente del producto y el Registro del MAPA.
                La decisión final corresponde a un técnico autorizado en gestión integrada de plagas.
              </p>
              <Button variant="outline" size="sm" onClick={downloadPlanPdf} disabled={downloadingPlan} className="gap-1.5">
                {downloadingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                {downloadingPlan ? "Generando PDF..." : "Descargar plan en PDF"}
              </Button>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* Catálogo de productos autorizados */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookMarked className="w-5 h-5" /> Productos autorizados
            </CardTitle>
            <CardDescription>
              Catálogo compartido con la fecha de fin de cada autorización. El asesor IA lo rellena
              automáticamente al verificar productos y lo reutiliza si la verificación es reciente.
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setAddingProduct(true)}>
              <Plus className="w-4 h-4" /> Añadir producto
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {(products ?? []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">
                Aún no hay productos en el catálogo. Consulta al asesor IA y guardará automáticamente
                los productos que verifique en el Registro del MAPA.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(products ?? []).map((p) => {
                const st = productStatus(p.expiryDate);
                return (
                  <div key={p.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.productName}</span>
                        {p.registryNumber && <Badge variant="outline" className="text-xs">Reg. {p.registryNumber}</Badge>}
                        <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                        {p.exceptional && <Badge variant="destructive" className="text-xs">Autorización excepcional</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.activeIngredient ? `${p.activeIngredient}` : ""}
                        {p.pests ? ` • Plagas: ${p.pests}` : ""}
                        {p.doseInfo ? ` • Dosis: ${p.doseInfo}` : ""}
                        {p.maxApplicationsYear ? ` • Máx ${p.maxApplicationsYear} aplic./año` : ""}
                        {p.safetyDays != null ? ` • Plazo seg. ${p.safetyDays} días` : ""}
                      </p>
                      {p.notes && <p className="text-xs text-muted-foreground mt-1 italic">{p.notes}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.lastVerifiedAt ? `Verificado el ${formatDate(p.lastVerifiedAt)}` : "Añadido manualmente (sin verificación IA)"}
                        {p.sourceUrl && (
                          <>
                            {" · "}
                            <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                              fuente <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setDeletingProduct(p.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground pt-1">
                Un producto caducado o verificado hace más de 30 días se vuelve a comprobar en las fuentes
                oficiales antes de recomendarse.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Historial */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <SprayCan className="w-5 h-5" /> Aplicaciones registradas
              </CardTitle>
              <CardDescription>Cuaderno de tratamientos por parcela</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              {canEdit && (
                <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
                  <Plus className="w-4 h-4" /> Registrar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Cargando...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <SprayCan className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Sin aplicaciones registradas en {year}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((t) => (
                  <div key={t.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{t.productName}</span>
                        {t.registryNumber && <Badge variant="outline" className="text-xs">Reg. {t.registryNumber}</Badge>}
                        <Badge variant="secondary" className="text-xs">{t.sectorName ?? "Toda la finca"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(t.applicationDate)}
                        {t.targetPest ? ` • ${t.targetPest}` : ""}
                        {t.activeIngredient ? ` • ${t.activeIngredient}` : ""}
                        {t.doseAmount ? ` • ${t.doseAmount} ${t.doseUnit ?? ""}` : ""}
                        {t.waterVolumeL ? ` • caldo ${t.waterVolumeL} L` : ""}
                        {t.safetyDays != null ? ` • plazo seg. ${t.safetyDays} días` : ""}
                      </p>
                      {t.notes && <p className="text-xs text-muted-foreground mt-1 italic">{t.notes}</p>}
                    </div>
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleting(t.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Recuento anual */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Aplicaciones por producto en {year}</CardTitle>
              <CardDescription>Vigila el máximo anual permitido por parcela</CardDescription>
            </CardHeader>
            <CardContent>
              {counts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos este año.</p>
              ) : (
                <div className="space-y-2">
                  {counts.map(([key, n]) => (
                    <div key={key} className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate" title={key}>{key}</span>
                      <Badge variant={n >= 3 ? "destructive" : "secondary"}>{n}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-2">
                    El máximo legal depende de cada producto: compruébalo en su etiqueta o pregunta al asesor.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Calculadora de caldo */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="w-4 h-4" /> Calculadora de caldo
              </CardTitle>
              <CardDescription>Cantidad de producto según dosis y volumen</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Dosis (ml o g por hl)</Label>
                <Input type="number" min="0" value={cDose} onChange={(e) => setCDose(e.target.value)} placeholder="150" />
              </div>
              <div className="space-y-2">
                <Label>Volumen de caldo (litros)</Label>
                <Input type="number" min="0" value={cVolume} onChange={(e) => setCVolume(e.target.value)} placeholder="400" />
              </div>
              {caldoResult && (
                <div className="rounded-lg bg-primary/10 p-3 text-sm">
                  Producto necesario: <span className="font-semibold">{caldoResult}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Diálogo registrar aplicación */}
      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Registrar aplicación fitosanitaria</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Sector</Label>
                <Select value={fSector} onValueChange={setFSector}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toda la finca</SelectItem>
                    {(sectors ?? []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Producto (nombre comercial)</Label>
              <Input value={fProduct} onChange={(e) => setFProduct(e.target.value)} placeholder="Ej.: Movento 150 O-TEQ" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nº de registro (MAPA)</Label>
                <Input value={fRegistry} onChange={(e) => setFRegistry(e.target.value)} placeholder="Ej.: 25.318" />
              </div>
              <div className="space-y-2">
                <Label>Materia activa</Label>
                <Input value={fActive} onChange={(e) => setFActive(e.target.value)} placeholder="Ej.: spirotetramat 15%" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Plaga o problema tratado</Label>
              <Input value={fPest} onChange={(e) => setFPest(e.target.value)} placeholder="Ej.: cochinilla" list="pests-list" />
              <datalist id="pests-list">{PESTS.map((p) => <option key={p} value={p} />)}</datalist>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Dosis</Label>
                <Input type="number" min="0" value={fDose} onChange={(e) => setFDose(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Unidad</Label>
                <Select value={fDoseUnit} onValueChange={setFDoseUnit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["ml/hl", "g/hl", "cc/l", "l/ha", "kg/ha", "%"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Caldo (L)</Label>
                <Input type="number" min="0" value={fWater} onChange={(e) => setFWater(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Superficie tratada (ha)</Label>
                <Input type="number" min="0" step="0.01" value={fArea} onChange={(e) => setFArea(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Plazo de seguridad (días)</Label>
                <Input type="number" min="0" value={fSafety} onChange={(e) => setFSafety(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea rows={2} value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="Aplicador, condiciones, observaciones..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancelar</Button>
            <Button disabled={createTreatment.isPending || !fProduct.trim() || !fDate} onClick={submitTreatment}>
              Guardar registro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo añadir producto al catálogo */}
      <Dialog open={addingProduct} onOpenChange={(open) => !open && setAddingProduct(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Añadir producto al catálogo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Producto (nombre comercial)</Label>
              <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Ej.: Movento 150 O-TEQ" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nº de registro (MAPA)</Label>
                <Input value={pRegistry} onChange={(e) => setPRegistry(e.target.value)} placeholder="Ej.: 25.318" />
              </div>
              <div className="space-y-2">
                <Label>Materia activa</Label>
                <Input value={pActive} onChange={(e) => setPActive(e.target.value)} placeholder="Ej.: spirotetramat 15%" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Plagas autorizadas en platanera</Label>
              <Input value={pPests} onChange={(e) => setPPests(e.target.value)} placeholder="Ej.: cochinilla, mosca blanca" />
            </div>
            <div className="space-y-2">
              <Label>Dosis y condiciones</Label>
              <Input value={pDose} onChange={(e) => setPDose(e.target.value)} placeholder="Ej.: 150 ml/hl, intervalo 14 días" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Máx aplic./año</Label>
                <Input type="number" min="0" value={pMaxApps} onChange={(e) => setPMaxApps(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Plazo seg. (días)</Label>
                <Input type="number" min="0" value={pSafety} onChange={(e) => setPSafety(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Autorizado hasta</Label>
                <Input type="date" value={pExpiry} onChange={(e) => setPExpiry(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea rows={2} value={pNotes} onChange={(e) => setPNotes(e.target.value)} placeholder="Condiciones, limitaciones, islas..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingProduct(false)}>Cancelar</Button>
            <Button
              disabled={createProduct.isPending || !pName.trim()}
              onClick={() =>
                createProduct.mutate({
                  data: {
                    productName: pName.trim(),
                    registryNumber: pRegistry.trim() || null,
                    activeIngredient: pActive.trim() || null,
                    pests: pPests.trim() || null,
                    doseInfo: pDose.trim() || null,
                    maxApplicationsYear: pMaxApps === "" ? null : parseInt(pMaxApps, 10),
                    safetyDays: pSafety === "" ? null : parseInt(pSafety, 10),
                    expiryDate: pExpiry || null,
                    notes: pNotes.trim() || null,
                  },
                })
              }
            >
              Guardar producto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado de producto del catálogo */}
      <AlertDialog open={deletingProduct !== null} onOpenChange={(open) => !open && setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este producto del catálogo?</AlertDialogTitle>
            <AlertDialogDescription>
              El catálogo es compartido: dejará de estar disponible para todos. Solo el administrador o
              quien lo añadió puede eliminarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingProduct && deleteProduct.mutate({ productId: deletingProduct })}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación de borrado */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará del cuaderno de tratamientos. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteTreatment.mutate({ farmId, treatmentId: deleting })}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
