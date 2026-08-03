import { useState, useEffect, useRef } from "react";
import {
  useRunCalculation,
  useListFertilizers,
  useListSectors,
  useGenerateAiDraftRecommendation,
  useCreateRecommendation,
  useUpdateRecommendation,
  getListRecommendationsQueryKey,
} from "@workspace/api-client-react";
import { ChatTecnicoPanel } from "@/components/chat-tecnico";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, Plus, Trash2, Droplets, FlaskConical, AlertTriangle, ArrowRight, Bot, Save, Send, Globe, BookmarkPlus, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ImportAnalysisButton } from "@/pages/fincas/detail-tabs";

export default function CalculadoraTab({
  farmId,
  defaultPlantCount,
  defaultWeeklyLitres,
}: {
  farmId: number;
  defaultPlantCount?: number | null;
  defaultWeeklyLitres?: number | null;
}) {
  const { data: fertilizers } = useListFertilizers();
  const { data: sectors } = useListSectors(farmId);
  const [aiSectorId, setAiSectorId] = useState<string>("global");
  const [useAcid, setUseAcid] = useState(false);

  const [plantCount, setPlantCount] = useState(defaultPlantCount ?? 1000);
  const [weeklyLitresPerPlant, setWeeklyLitresPerPlant] = useState(defaultWeeklyLitres ?? 150);
  useEffect(() => {
    if (defaultPlantCount != null) setPlantCount(defaultPlantCount);
    if (defaultWeeklyLitres != null) setWeeklyLitresPerPlant(defaultWeeklyLitres);
  }, [defaultPlantCount, defaultWeeklyLitres]);
  
  const [items, setItems] = useState<Array<{id: number, fertId: string, dose: number}>>([
    { id: Date.now(), fertId: "", dose: 0 }
  ]);

  const calcMutation = useRunCalculation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aiDraft, setAiDraft] = useState<{ id: number; title: string; rationale: string | null; sectorId: number | null } | null>(null);
  const [edited, setEdited] = useState(false);

  const aiMutation = useGenerateAiDraftRecommendation({
    mutation: {
      onSuccess: (rec) => {
        setAiDraft({ id: rec.id, title: rec.title ?? "Programa propuesto por IA", rationale: rec.rationale ?? null, sectorId: rec.sectorId ?? null });
        setEdited(false);
        setItems(
          rec.items.map((i, idx) => ({
            id: Date.now() + idx,
            fertId: i.fertilizerId != null ? String(i.fertilizerId) : "",
            dose: i.weeklyDose,
          })),
        );
        queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
        toast({
          title: "Plan generado con IA",
          description: "Guardado como borrador en Nutrición. Revísalo y ajústalo antes de usarlo.",
        });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo generar el plan", description: msg ?? "Inténtalo de nuevo.", variant: "destructive" });
      },
    },
  });

  const saveMutation = useCreateRecommendation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
        toast({
          title: "Programa del técnico guardado",
          description: "Disponible en la pestaña Nutrición y al generar informes.",
        });
      },
    },
  });

  const updateMutation = useUpdateRecommendation({
    mutation: {
      onSuccess: () => {
        setEdited(false);
        queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
        toast({
          title: "Borrador IA actualizado",
          description: "Se han guardado tus ajustes sobre el borrador original, sin crear una copia.",
        });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo actualizar el borrador", description: msg ?? "Inténtalo de nuevo.", variant: "destructive" });
      },
    },
  });

  const buildValidItems = () =>
    items
      .filter(i => i.fertId && i.dose > 0)
      .map(i => {
        const fert = fertilizers?.find(f => f.id.toString() === i.fertId);
        return {
          fertilizerId: parseInt(i.fertId),
          fertilizerName: fert?.name || "Desconocido",
          weeklyDose: i.dose,
          unit: fert?.formulaType === 'liquid' ? 'L' : 'kg'
        };
      });

  const handleSaveAsTechnician = () => {
    const validItems = buildValidItems();
    if (validItems.length === 0) return;
    saveMutation.mutate({
      farmId,
      data: {
        title: aiDraft ? `${aiDraft.title} (ajustado por el técnico)` : "Programa del técnico",
        rationale: aiDraft?.rationale ?? undefined,
        // Conserva el ámbito del borrador IA: un programa sectorial no debe volverse global.
        ...(aiDraft?.sectorId != null ? { sectorId: aiDraft.sectorId } : {}),
        items: validItems,
      },
    });
  };

  const handleUpdateAiDraft = () => {
    if (!aiDraft) return;
    const validItems = buildValidItems();
    if (validItems.length === 0) return;
    updateMutation.mutate({
      farmId,
      recommendationId: aiDraft.id,
      data: { items: validItems },
    });
  };

  const handleCalculate = () => {
    const validItems = buildValidItems();
    if (validItems.length === 0 || !farmId) return;

    calcMutation.mutate({
      farmId,
      data: {
        plantCount,
        weeklyLitresPerPlant,
        items: validItems
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Calculadora de abonado</h2>
        <p className="text-muted-foreground mt-1 text-sm">Simulador determinista de aportes nutricionales e incompatibilidades para esta finca.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Side: Inputs */}
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Droplets className="w-4 h-4 text-primary" /> Parámetros de Riego
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <div className="flex items-center gap-2">
                  <ImportAnalysisButton farmId={farmId} />
                  <p className="text-xs text-muted-foreground">
                    Sube una analítica en PDF y el técnico virtual incorporará sus datos (agua, suelo, foliar) al cálculo.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Número de Plantas</Label>
                <Input 
                  type="number" 
                  value={plantCount} 
                  onChange={e => setPlantCount(parseInt(e.target.value) || 0)} 
                />
              </div>
              <div className="space-y-2">
                <Label>L/planta/semana</Label>
                <Input 
                  type="number" 
                  value={weeklyLitresPerPlant} 
                  onChange={e => setWeeklyLitresPerPlant(parseInt(e.target.value) || 0)} 
                />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-secondary" /> Plan de Abonado Semanal
              </CardTitle>
              <div className="flex gap-2 items-center flex-wrap justify-end">
                <label
                  className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                  data-testid="label-use-acid"
                >
                  <input
                    type="checkbox"
                    checked={useAcid}
                    onChange={(e) => setUseAcid(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                    data-testid="checkbox-use-acid"
                  />
                  Uso de ácido para bajar el pH del agua
                </label>
                {sectors && sectors.length > 0 && (
                  <Select value={aiSectorId} onValueChange={setAiSectorId}>
                    <SelectTrigger className="h-8 w-[170px] text-xs" data-testid="select-ai-sector">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Toda la finca</SelectItem>
                      {sectors.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>Sector: {s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    aiMutation.mutate({
                      farmId,
                      data: {
                        ...(aiSectorId === "global" ? {} : { sectorId: Number(aiSectorId) }),
                        ...(useAcid ? { useAcid: true } : {}),
                      },
                    })
                  }
                  disabled={aiMutation.isPending}
                  className="h-8 gap-1"
                >
                  <Bot className="w-3.5 h-3.5" /> {aiMutation.isPending ? "Generando..." : "Generar con IA"}
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setItems([...items, { id: Date.now(), fertId: "", dose: 0 }])}
                  className="h-8 gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {aiDraft && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <p className="font-medium flex items-center gap-2">
                    <Bot className="w-4 h-4 text-primary" /> {aiDraft.title}
                    {edited && <Badge variant="outline" className="text-[10px]">modificado</Badge>}
                  </p>
                  {aiDraft.rationale && <p className="text-muted-foreground text-xs">{aiDraft.rationale}</p>}
                  <p className="text-xs text-muted-foreground">
                    Propuesta basada en las últimas analíticas, guardada como borrador IA en Nutrición. Si haces cambios, puedes actualizar el propio borrador o guardar una copia como programa del técnico.
                  </p>
                </div>
              )}
              {items.map((item, index) => (
                <div key={item.id} className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Fertilizante</Label>
                    <Select 
                      value={item.fertId} 
                      onValueChange={(val) => {
                        const newItems = [...items];
                        newItems[index].fertId = val;
                        setItems(newItems);
                        setEdited(true);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {fertilizers?.map(f => (
                          <SelectItem key={f.id} value={f.id.toString()}>
                            {f.name}
                            {[f.nPct, f.p2o5Pct, f.k2oPct, f.caoPct, f.mgoPct, f.so3Pct, f.boronPct].every(v => !v) && (
                              <span className="text-yellow-700"> · sin riqueza declarada</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1.5">
                    <Label className="text-xs">Dosis</Label>
                    <div className="relative">
                      <Input 
                        type="number" 
                        step="0.5"
                        value={item.dose || ""} 
                        onChange={e => {
                          const newItems = [...items];
                          newItems[index].dose = parseFloat(e.target.value) || 0;
                          setItems(newItems);
                          setEdited(true);
                        }} 
                      />
                      <span className="absolute right-3 top-2 text-xs text-muted-foreground">
                        {fertilizers?.find(f => f.id.toString() === item.fertId)?.formulaType === 'liquid' ? 'L' : 'kg'}
                      </span>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:bg-destructive/10 shrink-0 mb-0.5"
                    onClick={() => setItems(items.filter(i => i.id !== item.id))}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}

              <Button 
                className="w-full mt-4" 
                size="lg"
                onClick={handleCalculate}
                disabled={calcMutation.isPending || !items.some(i => i.fertId && i.dose > 0)}
              >
                {calcMutation.isPending ? "Calculando..." : (
                  <>Calcular Aportes <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
              {aiDraft && (
                <Button
                  variant="secondary"
                  className="w-full gap-2"
                  onClick={handleUpdateAiDraft}
                  disabled={updateMutation.isPending || !edited || !items.some(i => i.fertId && i.dose > 0)}
                >
                  <Bot className="w-4 h-4" />
                  {updateMutation.isPending ? "Actualizando..." : "Actualizar borrador IA con mis ajustes"}
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleSaveAsTechnician}
                disabled={saveMutation.isPending || !items.some(i => i.fertId && i.dose > 0)}
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? "Guardando..." : "Guardar como programa del técnico"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Results */}
        <div>
          {calcMutation.data ? (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Volumen de Agua</p>
                    <p className="text-2xl font-bold text-primary">{formatNumber(calcMutation.data.weeklyWaterM3)} <span className="text-sm font-normal text-muted-foreground">m³/sem</span></p>
                  </CardContent>
                </Card>
                <Card className="bg-secondary/5 border-secondary/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">CE Estimada</p>
                    <p className="text-2xl font-bold text-secondary">{formatNumber(calcMutation.data.estimatedEcDsM)} <span className="text-sm font-normal text-muted-foreground">dS/m</span></p>
                  </CardContent>
                </Card>
              </div>

              <Card className="shadow-sm">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-lg">Aportes Nutricionales (kg/sem)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-4 sm:grid-cols-5 divide-y divide-x">
                    <NutrientBox label="N Total" value={calcMutation.data.nutrients.n} color="text-blue-600" />
                    <NutrientBox label="N Nitr" value={calcMutation.data.nutrients.nNitric} color="text-blue-500" sub />
                    <NutrientBox label="N Amon" value={calcMutation.data.nutrients.nAmmoniacal} color="text-blue-400" sub />
                    <NutrientBox label="P₂O₅" value={calcMutation.data.nutrients.p2o5} color="text-amber-600" />
                    <NutrientBox label="K₂O" value={calcMutation.data.nutrients.k2o} color="text-red-600" />
                    <NutrientBox label="CaO" value={calcMutation.data.nutrients.cao} color="text-slate-600" />
                    <NutrientBox label="MgO" value={calcMutation.data.nutrients.mgo} color="text-green-600" />
                    <NutrientBox label="SO₃" value={calcMutation.data.nutrients.so3} color="text-yellow-600" />
                    <NutrientBox label="B" value={calcMutation.data.nutrients.b} color="text-purple-600" />
                  </div>
                </CardContent>
              </Card>

              {(calcMutation.data.warnings.length > 0 || calcMutation.data.compatibilityIssues.length > 0) && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="p-4">
                    {calcMutation.data.compatibilityIssues.length > 0 && (
                      <div className="mb-3">
                        <h4 className="font-semibold text-destructive flex items-center gap-2 text-sm mb-1">
                          <AlertTriangle className="w-4 h-4" /> Incompatibilidades Detectadas
                        </h4>
                        <ul className="text-sm list-disc list-inside text-destructive/90 pl-2">
                          {calcMutation.data.compatibilityIssues.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                    {calcMutation.data.warnings.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-amber-600 flex items-center gap-2 text-sm mb-1">
                          <AlertTriangle className="w-4 h-4" /> Avisos
                        </h4>
                        <ul className="text-sm list-disc list-inside text-amber-700/80 pl-2">
                          {calcMutation.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/10 p-12 text-center min-h-[400px]">
              <Calculator className="w-16 h-16 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground">Resultados del Cálculo</h3>
              <p className="max-w-xs mt-2 text-sm">
                Añade los parámetros y pulsa calcular para ver los aportes semanales de nutrientes y alertas de incompatibilidad.
              </p>
            </div>
          )}
        </div>
      </div>

      <ChatTecnicoPanel
        farmId={farmId}
        conversationTitle="Chat del plan de abonado"
        description="Consulta dudas sobre el plan que estás preparando. El técnico IA conoce las analíticas de la finca y tu borrador actual, puede buscar en la web productos de nutrición vegetal y guardar sus fichas para usarlas en las recomendaciones."
        buildDraftContext={() => {
          const lines = items
            .filter((i) => i.fertId && i.dose > 0)
            .map((i) => {
              const fert = fertilizers?.find((f) => f.id.toString() === i.fertId);
              return `- ${fert?.name ?? "?"}: ${i.dose} ${fert?.formulaType === "liquid" ? "L" : "kg"}/semana`;
            });
          if (!lines.length) return null;
          return `Plantas: ${plantCount}, riego ${weeklyLitresPerPlant} L/planta/semana.\nFertilizantes del plan actual:\n${lines.join("\n")}`;
        }}
      />
    </div>
  );
}

function NutrientBox({ label, value, color, sub = false }: { label: string, value: number, color: string, sub?: boolean }) {
  if (value === 0 && sub) return null;
  
  return (
    <div className={`p-4 flex flex-col items-center justify-center ${sub ? 'bg-muted/30' : ''}`}>
      <span className={`text-xs uppercase tracking-wider mb-1 ${sub ? 'text-muted-foreground' : 'font-medium'}`}>{label}</span>
      <span className={`text-xl font-bold ${value > 0 ? color : 'text-muted-foreground/30'}`}>
        {formatNumber(value, value < 10 ? 2 : 1)}
      </span>
    </div>
  );
}
