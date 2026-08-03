import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ReferenceArea, ReferenceLine,
} from "recharts";
import { 
  useListSectors, useCreateSector, useDeleteSector,
  useListAnalyses, useCreateAnalysis, useImportAnalysisPdf, useDeleteAnalysis,
  useListRecommendations, useChangeRecommendationStatus,
  useListReports, useCreateReport,
  useListMembers, useAddMember, useRemoveMember,
  useGetFarmApiConfig, useSetFarmApiConfig, useListCredentials,
  getListSectorsQueryKey, getListAnalysesQueryKey, 
  getListRecommendationsQueryKey, getListReportsQueryKey, 
  getListMembersQueryKey, getGetFarmApiConfigQueryKey
} from "@workspace/api-client-react";
import type { AnalysisInput, Analysis } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatDateTime, formatDate, formatNumber } from "@/lib/utils";

// --- Sectors Tab ---
import { Trash2, Plus, FileText, Droplets, TestTube, Sprout, Users, Settings, Download, Upload, Loader2, Bot, TrendingUp } from "lucide-react";
export function SectorsTab({ farmId }: { farmId: number }) {
  const { data: sectors, isLoading } = useListSectors(farmId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof sectorSchema>>({
    resolver: zodResolver(sectorSchema),
    defaultValues: { name: "", surfaceHa: "", plantCount: "", phenologicalStage: "", weeklyLitresPerPlant: "" },
  });

  const createMutation = useCreateSector({
    mutation: {
      onSuccess: () => {
        toast({ title: "Sector añadido" });
        queryClient.invalidateQueries({ queryKey: getListSectorsQueryKey(farmId) });
        setOpen(false);
        form.reset();
      },
      onError: () =>
        toast({ title: "No se pudo crear el sector", description: "Inténtalo de nuevo.", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteSector({
    mutation: {
      onSuccess: () => {
        toast({ title: "Sector eliminado" });
        queryClient.invalidateQueries({ queryKey: getListSectorsQueryKey(farmId) });
      },
      onError: () =>
        toast({ title: "No se pudo eliminar el sector", description: "Inténtalo de nuevo.", variant: "destructive" }),
    },
  });

  const onSubmit = (v: z.infer<typeof sectorSchema>) => {
    createMutation.mutate({
      farmId,
      data: {
        name: v.name.trim(),
        ...(v.surfaceHa && isNumeric(v.surfaceHa) ? { surfaceHa: parseNum(v.surfaceHa) } : {}),
        ...(v.plantCount && isNumeric(v.plantCount) ? { plantCount: parseNum(v.plantCount) } : {}),
        ...(v.phenologicalStage?.trim() ? { phenologicalStage: v.phenologicalStage.trim() } : {}),
        ...(v.weeklyLitresPerPlant && isNumeric(v.weeklyLitresPerPlant) ? { weeklyLitresPerPlant: parseNum(v.weeklyLitresPerPlant) } : {}),
      },
    });
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Sectores de Riego</h3>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) form.reset(); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-2" /> Añadir Sector</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Añadir Sector de Riego</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl><Input placeholder="Sector 1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}/>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="surfaceHa" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Superficie (Ha)</FormLabel>
                      <FormControl><Input inputMode="decimal" placeholder="Opcional" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <FormField control={form.control} name="plantCount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nº plantas</FormLabel>
                      <FormControl><Input inputMode="numeric" placeholder="Opcional" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <FormField control={form.control} name="phenologicalStage" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fase fenológica</FormLabel>
                      <FormControl><Input placeholder="Ej: Floración" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <FormField control={form.control} name="weeklyLitresPerPlant" render={({ field }) => (
                    <FormItem>
                      <FormLabel>L/pl/sem</FormLabel>
                      <FormControl><Input inputMode="decimal" placeholder="Opcional" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}/>
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</>
                  ) : (
                    "Crear sector"
                  )}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Superficie</TableHead>
              <TableHead>Plantas</TableHead>
              <TableHead>Fase</TableHead>
              <TableHead>L/pl/sem</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
            ) : sectors && sectors.length > 0 ? (
              sectors.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.surfaceHa ? `${s.surfaceHa} Ha` : '-'}</TableCell>
                  <TableCell>{formatNumber(s.plantCount, 0)}</TableCell>
                  <TableCell>{s.phenologicalStage || '-'}</TableCell>
                  <TableCell>{s.weeklyLitresPerPlant || '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Eliminar sector ${s.name}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => { if (confirm(`¿Eliminar el sector "${s.name}"?`)) deleteMutation.mutate({ farmId, sectorId: s.id }); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No hay sectores definidos.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Analyses Tab ---
type EditableParam = { name: string; value: string; unit: string; refLow: string; refHigh: string };
type EditableDraft = {
  type: "soil" | "leaf" | "water";
  sampleDate: string;
  reference: string;
  laboratory: string;
  parameters: EditableParam[];
};

function toEditableDraft(input: AnalysisInput): EditableDraft {
  return {
    type: (input.type as EditableDraft["type"]) ?? "soil",
    sampleDate: input.sampleDate ?? "",
    reference: input.reference ?? "",
    laboratory: input.laboratory ?? "",
    parameters: (input.parameters ?? []).map((p) => ({
      name: p.name ?? "",
      value: p.value != null ? String(p.value) : "",
      unit: p.unit ?? "",
      refLow: p.refLow != null ? String(p.refLow) : "",
      refHigh: p.refHigh != null ? String(p.refHigh) : "",
    })),
  };
}

const isNumeric = (s: string) => s.trim() !== "" && !Number.isNaN(Number(s.trim().replace(",", ".")));
const parseNum = (s: string) => Number(s.trim().replace(",", "."));

const emptyDraft = (): EditableDraft => ({
  type: "soil",
  sampleDate: "",
  reference: "",
  laboratory: "",
  parameters: [{ name: "", value: "", unit: "", refLow: "", refHigh: "" }],
});
export function ImportAnalysisButton({ farmId }: { farmId: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [draft, setDraft] = useState<EditableDraft | null>(null);

  const importPdf = useImportAnalysisPdf({
    mutation: {
      onSuccess: (extracted) => setDraft(toEditableDraft(extracted)),
      onError: (err: unknown) =>
        toast({ title: "No se pudo importar el PDF", description: errorDescription(err), variant: "destructive" }),
    },
  });

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importPdf.mutate({ farmId, data: { file } });
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" disabled={importPdf.isPending} onClick={() => fileRef.current?.click()}>
        {importPdf.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extrayendo datos…</>
        ) : (
          <><Upload className="w-4 h-4 mr-2" /> Importar PDF</>
        )}
      </Button>
      <AnalysisDraftDialog
        farmId={farmId}
        draft={draft}
        setDraft={setDraft}
        title="Revisa los datos extraídos"
        description="El técnico virtual ha extraído estos datos del PDF. Corrige lo que necesites antes de guardar."
        successDescription="La analítica importada ya se usa en la calculadora y en las recomendaciones."
      />
    </>
  );
}

export function NewAnalysisButton({ farmId }: { farmId: number }) {
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
        <Plus className="w-4 h-4 mr-2" /> Nueva Analítica
      </Button>
      <AnalysisDraftDialog
        farmId={farmId}
        draft={draft}
        setDraft={setDraft}
        title="Nueva analítica manual"
        description="Introduce los datos de la analítica tal y como aparecen en el informe del laboratorio."
        successDescription="La analítica ya se usa en la calculadora y en las recomendaciones."
      />
    </>
  );
}
type AnalysisRow = Analysis;

const paramStatusLabel: Record<string, { label: string; className: string }> = {
  muy_bajo: { label: "Muy bajo", className: "bg-red-500/10 text-red-700" },
  bajo: { label: "Bajo", className: "bg-amber-500/10 text-amber-700" },
  normal: { label: "Normal", className: "bg-green-500/10 text-green-700" },
  alto: { label: "Alto", className: "bg-amber-500/10 text-amber-700" },
  muy_alto: { label: "Muy alto", className: "bg-red-500/10 text-red-700" },
};

function AnalysisDetailDialog({
  farmId,
  analysis,
  canEdit,
  onClose,
}: {
  farmId: number;
  analysis: AnalysisRow | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useDeleteAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        setConfirmOpen(false);
        onClose();
        toast({ title: "Analítica eliminada" });
      },
      onError: (err: unknown) => {
        const anyErr = err as { response?: { data?: { error?: string } }; data?: { error?: string }; message?: string };
        toast({
          title: "No se pudo eliminar la analítica",
          description: anyErr?.response?.data?.error ?? anyErr?.data?.error ?? anyErr?.message ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const tipo = analysis?.type === "soil" ? "Suelo" : analysis?.type === "leaf" ? "Foliar" : "Agua de riego";

  return (
    <Dialog open={analysis !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detalle de la analítica</DialogTitle>
        </DialogHeader>
        {analysis && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><span className="text-muted-foreground">Tipo:</span> <span className="font-medium">{tipo}</span></span>
              <span><span className="text-muted-foreground">Fecha de muestreo:</span> <span className="font-medium">{formatDate(analysis.sampleDate)}</span></span>
              {analysis.reference && <span><span className="text-muted-foreground">Referencia:</span> <span className="font-medium">{analysis.reference}</span></span>}
              {analysis.laboratory && <span><span className="text-muted-foreground">Laboratorio:</span> <span className="font-medium">{analysis.laboratory}</span></span>}
            </div>
            {analysis.description && <p className="text-sm text-muted-foreground">{analysis.description}</p>}
            {analysis.notes && <p className="text-sm text-muted-foreground italic">{analysis.notes}</p>}
            <div className="max-h-80 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parámetro</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead>Rango ref.</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(analysis.parameters ?? []).map((p, i) => {
                    const st = p.status ? paramStatusLabel[p.status] : undefined;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{formatNumber(p.value)}</TableCell>
                        <TableCell className="text-muted-foreground">{p.unit || "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {p.refLow != null || p.refHigh != null ? `${p.refLow ?? "…"} – ${p.refHigh ?? "…"}` : "-"}
                        </TableCell>
                        <TableCell>
                          {st ? <Badge variant="outline" className={st.className}>{st.label}</Badge> : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(analysis.parameters ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sin parámetros registrados.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between items-center">
              {canEdit ? (
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}>
                      <Trash2 className="w-4 h-4 mr-2" /> Eliminar analítica
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar esta analítica?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminará la analítica de {tipo.toLowerCase()} del {formatDate(analysis.sampleDate)}
                        {analysis.reference ? ` (ref. ${analysis.reference})` : ""}. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={deleteMutation.isPending}
                        onClick={(e) => {
                          e.preventDefault();
                          deleteMutation.mutate({ farmId, analysisId: analysis.id });
                        }}
                      >
                        {deleteMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Eliminando…</>
                        ) : (
                          "Eliminar"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : <span />}
              <Button variant="outline" onClick={onClose}>Cerrar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const analysisTypeLabel: Record<string, string> = { soil: "Suelo", leaf: "Foliar", water: "Agua de riego" };

function ParameterTrendCard({ analyses }: { analyses: AnalysisRow[] }) {
  const [type, setType] = useState<"soil" | "leaf" | "water">("soil");
  const [paramName, setParamName] = useState<string>("");

  const typed = useMemo(
    () =>
      (analyses ?? [])
        .filter((a) => a.type === type)
        .slice()
        .sort((a, b) => (a.sampleDate < b.sampleDate ? -1 : 1)),
    [analyses, type],
  );

  const paramNames = useMemo(() => {
    const names = new Set<string>();
    typed.forEach((a) => (a.parameters ?? []).forEach((p) => { if (p.name) names.add(p.name); }));
    return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
  }, [typed]);

  const effectiveParam = paramNames.includes(paramName) ? paramName : (paramNames[0] ?? "");

  const points = useMemo(
    () =>
      typed.flatMap((a) => {
        const p = (a.parameters ?? []).find((pp) => pp.name === effectiveParam);
        if (!p || p.value == null) return [];
        return [{
          date: a.sampleDate,
          label: formatDate(a.sampleDate),
          value: p.value,
          unit: p.unit,
          refLow: p.refLow ?? null,
          refHigh: p.refHigh ?? null,
          reference: a.reference,
        }];
      }),
    [typed, effectiveParam],
  );

  const latestWithRef = [...points].reverse().find((p) => p.refLow != null || p.refHigh != null);
  const refLow = latestWithRef?.refLow ?? null;
  const refHigh = latestWithRef?.refHigh ?? null;
  const unit = points.find((p) => p.unit)?.unit ?? "";

  const values = points.map((p) => p.value);
  const domainCandidates = [...values];
  if (refLow != null) domainCandidates.push(refLow);
  if (refHigh != null) domainCandidates.push(refHigh);
  const min = Math.min(...domainCandidates);
  const max = Math.max(...domainCandidates);
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.15 || 1;
  const yDomain: [number, number] = [Math.min(0, min - pad) === 0 && min - pad > 0 ? 0 : min - pad, max + pad];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Evolución de parámetros
            </CardTitle>
            <CardDescription>Compara un parámetro entre analíticas del mismo tipo.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="soil">Suelo</SelectItem>
                <SelectItem value="leaf">Foliar</SelectItem>
                <SelectItem value="water">Agua de riego</SelectItem>
              </SelectContent>
            </Select>
            <Select value={effectiveParam} onValueChange={setParamName} disabled={paramNames.length === 0}>
              <SelectTrigger className="w-48 h-9">
                <SelectValue placeholder="Parámetro" />
              </SelectTrigger>
              <SelectContent>
                {paramNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {paramNames.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No hay analíticas de {analysisTypeLabel[type].toLowerCase()} con parámetros registrados.
          </p>
        ) : points.length < 2 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Se necesitan al menos dos analíticas de {analysisTypeLabel[type].toLowerCase()} con «{effectiveParam}» para ver la evolución.
            {points.length === 1 && (
              <span className="block mt-1">
                Único valor: <span className="font-medium text-foreground">{formatNumber(points[0].value)} {unit}</span> ({points[0].label})
              </span>
            )}
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis domain={yDomain} tick={{ fontSize: 12 }} width={55} tickFormatter={(v: number) => formatNumber(v)} />
                <RechartsTooltip
                  formatter={(value: number) => [`${formatNumber(value)}${unit ? ` ${unit}` : ""}`, effectiveParam]}
                  labelFormatter={(label) => `Muestreo: ${label}`}
                />
                {refLow != null && refHigh != null && (
                  <ReferenceArea y1={refLow} y2={refHigh} fill="hsl(142 70% 45%)" fillOpacity={0.08} stroke="none" />
                )}
                {refLow != null && (
                  <ReferenceLine y={refLow} stroke="hsl(142 60% 40%)" strokeDasharray="4 4" label={{ value: `Mín ${formatNumber(refLow)}`, fontSize: 11, position: "insideBottomLeft", fill: "hsl(142 60% 30%)" }} />
                )}
                {refHigh != null && (
                  <ReferenceLine y={refHigh} stroke="hsl(142 60% 40%)" strokeDasharray="4 4" label={{ value: `Máx ${formatNumber(refHigh)}`, fontSize: 11, position: "insideTopLeft", fill: "hsl(142 60% 30%)" }} />
                )}
                <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {points.length >= 2 && (refLow != null || refHigh != null) && (
          <p className="text-xs text-muted-foreground mt-2">
            Rango de referencia{unit ? ` (${unit})` : ""}: {refLow != null ? formatNumber(refLow) : "…"} – {refHigh != null ? formatNumber(refHigh) : "…"}, según la analítica más reciente que lo indica.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalysesTab({ farmId, canEdit = false }: { farmId: number; canEdit?: boolean }) {
  const { data: analyses, isLoading } = useListAnalyses(farmId);
  const [selected, setSelected] = useState<AnalysisRow | null>(null);
  const [onlyOutOfRange, setOnlyOutOfRange] = useState(false);
  const filteredAnalyses = useMemo(() => {
    if (!analyses) return analyses;
    if (!onlyOutOfRange) return analyses;
    return analyses.filter(a => (a.parameters ?? []).some(p => p.status && p.status !== 'normal'));
  }, [analyses, onlyOutOfRange]);
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold">Analíticas</h3>
          <div className="flex items-center gap-2">
            <Switch
              id="only-out-of-range"
              checked={onlyOutOfRange}
              onCheckedChange={setOnlyOutOfRange}
              data-testid="switch-only-out-of-range"
            />
            <Label htmlFor="only-out-of-range" className="text-sm font-normal text-muted-foreground cursor-pointer">
              Solo fuera de rango
            </Label>
          </div>
        </div>
        <div className="flex gap-2">
          <ImportAnalysisButton farmId={farmId} />
          <NewAnalysisButton farmId={farmId} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Sube el PDF del laboratorio y el técnico virtual extraerá los parámetros automáticamente (requiere clave de OpenAI en Ajustes).
      </p>
      {!isLoading && analyses && analyses.length > 0 && <ParameterTrendCard analyses={analyses} />}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Laboratorio</TableHead>
              <TableHead>Parámetros</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
            ) : filteredAnalyses && filteredAnalyses.length > 0 ? (
              filteredAnalyses.map(a => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                  <TableCell>{formatDate(a.sampleDate)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      a.type === 'soil' ? 'bg-amber-500/10 text-amber-700' :
                      a.type === 'leaf' ? 'bg-green-500/10 text-green-700' :
                      'bg-blue-500/10 text-blue-700'
                    }>
                      {a.type === 'soil' ? 'Suelo' : a.type === 'leaf' ? 'Foliar' : 'Agua'}
                    </Badge>
                  </TableCell>
                  <TableCell>{a.reference || '-'}</TableCell>
                  <TableCell>{a.laboratory || '-'}</TableCell>
                  <TableCell className="text-xs">
                    <span className="text-muted-foreground">{a.parameters?.length || 0} analizados</span>
                    {(() => {
                      const params = a.parameters ?? [];
                      const outOfRange = params.filter(p => p.status && p.status !== 'normal');
                      if (outOfRange.length === 0) return null;
                      const severe = outOfRange.some(p => p.status === 'muy_bajo' || p.status === 'muy_alto');
                      return (
                        <Badge
                          variant="outline"
                          className={`ml-2 ${severe ? 'bg-red-500/10 text-red-700 border-red-300' : 'bg-amber-500/10 text-amber-700 border-amber-300'}`}
                        >
                          {outOfRange.length} fuera de rango
                        </Badge>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{onlyOutOfRange && analyses && analyses.length > 0 ? "No hay analíticas con parámetros fuera de rango." : "No hay analíticas registradas."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <AnalysisDetailDialog farmId={farmId} analysis={selected} canEdit={canEdit} onClose={() => setSelected(null)} />
    </div>
  );
}

// --- Recommendations Tab ---
export function RecommendationsTab({ farmId }: { farmId: number }) {
  const { data: recommendations, isLoading } = useListRecommendations(farmId);
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Programas de Nutrición</h3>
        <Button size="sm"><Plus className="w-4 h-4 mr-2" /> Crear Programa</Button>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : recommendations && recommendations.length > 0 ? (
          recommendations.map(r => (
            <Card key={r.id}>
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold">{r.title || 'Recomendación sin título'}</h4>
                    <Badge variant={r.status === 'applying' ? 'success' : r.status === 'draft' ? 'outline' : 'secondary'}>{r.status}</Badge>
                    {r.source === 'ai' && (
                      <Badge variant="secondary" className="gap-1"><Bot className="w-3 h-3" /> IA</Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground flex gap-4">
                    <span>{formatDate(r.createdAt)}</span>
                    <span>{r.items?.length || 0} fertilizantes</span>
                    {r.estimatedEcDsM && <span>CE: {r.estimatedEcDsM} dS/m</span>}
                  </div>
                </div>
                <Button variant="ghost" size="sm">Ver detalles</Button>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="text-center py-10 border-2 border-dashed rounded-lg bg-muted/10">
            <Sprout className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
            <p className="text-muted-foreground">No hay recomendaciones de nutrición.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Reports Tab ---
export function ReportsTab({ farmId }: { farmId: number }) {
  const { data: reports, isLoading, refetch } = useListReports(farmId);
  const anyGenerating = reports?.some(r => r.status === 'generating') ?? false;
  useEffect(() => {
    if (!anyGenerating) return;
    const t = setInterval(() => { void refetch(); }, 3000);
    return () => clearInterval(t);
  }, [anyGenerating, refetch]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const createMutation = useCreateReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Informe en generación", description: "Estará listo en unos momentos." });
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(farmId) });
      }
    }
  });

  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Informes Generados</h3>
        <Button size="sm" onClick={() => createMutation.mutate({ farmId, data: { format: 'pdf', title: 'Informe de Estado' } })} disabled={createMutation.isPending}>
          <FileText className="w-4 h-4 mr-2" /> Generar PDF General
        </Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Formato</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
            ) : reports && reports.length > 0 ? (
              reports.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell><Badge variant="outline" className="uppercase">{r.format}</Badge></TableCell>
                  <TableCell>
                    {r.status === 'ready' ? <span className="text-green-600 font-medium">Listo</span> : 
                     r.status === 'generating' ? <span className="text-amber-600 animate-pulse">Generando...</span> : 
                     <span className="text-destructive">Error</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === 'ready' && r.downloadUrl && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={r.downloadUrl} download><Download className="w-4 h-4 mr-2"/> Descargar</a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No hay informes generados.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Members Tab ---
const memberSchema = z.object({
  email: z.string().email("Email inválido"),
  role: z.enum(["technician", "manager", "viewer"]).default("viewer")
});

export function MembersTab({ farmId }: { farmId: number }) {
  const { data: members, isLoading } = useListMembers(farmId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: { email: "", role: "viewer" }
  });

  const addMutation = useAddMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Miembro invitado" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(farmId) });
        setOpen(false);
        form.reset();
      }
    }
  });

  const removeMutation = useRemoveMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Miembro eliminado" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(farmId) });
      }
    }
  });

  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Miembros de la Finca</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-2" /> Invitar</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invitar Miembro</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(v => addMutation.mutate({ farmId, data: v }))} className="space-y-4">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )}/>
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rol</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="technician">Técnico</SelectItem>
                        <SelectItem value="manager">Encargado</SelectItem>
                        <SelectItem value="viewer">Consulta</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}/>
                <Button type="submit" className="w-full" disabled={addMutation.isPending}>Invitar</Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
            ) : members && members.length > 0 ? (
              members.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                  <TableCell className="text-right">
                    {m.role !== 'owner' && (
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => { if(confirm("¿Eliminar?")) removeMutation.mutate({ farmId, memberId: m.id }) }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Solo el propietario.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Config Tab ---
export function ConfigTab({ farmId }: { farmId: number }) {
  const { data: config, isLoading: loadingConfig } = useGetFarmApiConfig(farmId);
  const { data: credentials, isLoading: loadingCreds } = useListCredentials();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const setConfigMutation = useSetFarmApiConfig({
    mutation: {
      onSuccess: () => {
        toast({ title: "Configuración actualizada" });
        queryClient.invalidateQueries({ queryKey: getGetFarmApiConfigQueryKey(farmId) });
      }
    }
  });

  if (loadingConfig || loadingCreds) return <Skeleton className="h-32 w-full mt-6" />;

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader>
        <CardTitle>Configuración de IA para la Finca</CardTitle>
        <CardDescription>Elige qué credencial de OpenAI se utilizará para el Técnico Virtual y la generación de informes de esta finca.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <label className="text-sm font-medium">Credencial de OpenAI</label>
          <Select 
            defaultValue={config?.credentialId?.toString() || "default"}
            onValueChange={(val) => {
              const valId = val === "default" ? null : parseInt(val);
              setConfigMutation.mutate({ farmId, data: { credentialId: valId } });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                <span className="font-medium text-primary">Usar mi credencial predeterminada global</span>
              </SelectItem>
              {credentials?.map(c => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name} ({c.maskedKey})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

const errorDescription = (err: unknown) => {
  const anyErr = err as { response?: { data?: { error?: string } }; data?: { error?: string }; message?: string };
  return anyErr?.response?.data?.error ?? anyErr?.data?.error ?? anyErr?.message ?? "Inténtalo de nuevo.";
};

const sectorSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  surfaceHa: z.string().optional(),
  plantCount: z.string().optional(),
  phenologicalStage: z.string().optional(),
  weeklyLitresPerPlant: z.string().optional(),
}).superRefine((v, ctx) => {
  (["surfaceHa", "plantCount", "weeklyLitresPerPlant"] as const).forEach((k) => {
    const val = v[k];
    if (val && val.trim() !== "" && !isNumeric(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: "Debe ser un número" });
    }
  });
});

function AnalysisDraftDialog({
  farmId,
  draft,
  setDraft,
  title,
  description,
  successDescription,
}: {
  farmId: number;
  draft: EditableDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<EditableDraft | null>>;
  title: string;
  description: string;
  successDescription: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showErrors, setShowErrors] = useState(false);

  const saveAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        setDraft(null);
        setShowErrors(false);
        toast({ title: "Analítica guardada", description: successDescription });
      },
      onError: (err: unknown) =>
        toast({ title: "No se pudo guardar la analítica", description: errorDescription(err), variant: "destructive" }),
    },
  });

  const updateParam = (i: number, patch: Partial<EditableParam>) =>
    setDraft((d) => d && { ...d, parameters: d.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const removeParam = (i: number) =>
    setDraft((d) => d && { ...d, parameters: d.parameters.filter((_, j) => j !== i) });
  const addParam = () =>
    setDraft((d) => d && { ...d, parameters: [...d.parameters, { name: "", value: "", unit: "", refLow: "", refHigh: "" }] });

  const paramErrors = (p: EditableParam) => ({
    name: p.name.trim() === "",
    value: !isNumeric(p.value),
    refLow: p.refLow.trim() !== "" && !isNumeric(p.refLow),
    refHigh: p.refHigh.trim() !== "" && !isNumeric(p.refHigh),
  });
  const draftErrors = draft
    ? {
        sampleDate: draft.sampleDate.trim() === "",
        noParams: draft.parameters.length === 0,
        params: draft.parameters.some((p) => {
          const e = paramErrors(p);
          return e.name || e.value || e.refLow || e.refHigh;
        }),
      }
    : null;
  const hasErrors = !!draftErrors && (draftErrors.sampleDate || draftErrors.noParams || draftErrors.params);

  const handleSave = () => {
    if (!draft) return;
    if (hasErrors) {
      setShowErrors(true);
      toast({
        title: "Revisa los datos antes de guardar",
        description: "Todos los parámetros necesitan nombre y un valor numérico, y la fecha de muestreo es obligatoria.",
        variant: "destructive",
      });
      return;
    }
    const payload: AnalysisInput = {
      type: draft.type,
      sampleDate: draft.sampleDate.trim(),
      ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
      ...(draft.laboratory.trim() ? { laboratory: draft.laboratory.trim() } : {}),
      parameters: draft.parameters.map((p) => ({
        name: p.name.trim(),
        value: parseNum(p.value),
        ...(p.unit.trim() ? { unit: p.unit.trim() } : {}),
        ...(isNumeric(p.refLow) ? { refLow: parseNum(p.refLow) } : {}),
        ...(isNumeric(p.refHigh) ? { refHigh: parseNum(p.refHigh) } : {}),
      })),
    };
    saveAnalysis.mutate({ farmId, data: payload });
  };

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) { setDraft(null); setShowErrors(false); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {draft && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{description}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Tipo</label>
                  <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as EditableDraft["type"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="soil">Suelo</SelectItem>
                      <SelectItem value="leaf">Foliar</SelectItem>
                      <SelectItem value="water">Agua de riego</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Fecha de muestreo</label>
                  <Input
                    type="date"
                    value={draft.sampleDate}
                    onChange={(e) => setDraft({ ...draft, sampleDate: e.target.value })}
                    className={showErrors && draftErrors?.sampleDate ? "border-destructive" : undefined}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Referencia</label>
                  <Input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="Opcional" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Laboratorio</label>
                  <Input value={draft.laboratory} onChange={(e) => setDraft({ ...draft, laboratory: e.target.value })} placeholder="Opcional" />
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parámetro</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Unidad</TableHead>
                      <TableHead>Ref. mín</TableHead>
                      <TableHead>Ref. máx</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.parameters.map((p, i) => {
                      const errs = paramErrors(p);
                      const errClass = (bad: boolean) => (showErrors && bad ? "border-destructive" : undefined);
                      return (
                        <TableRow key={i}>
                          <TableCell className="p-1.5">
                            <Input className={`h-8 ${errClass(errs.name) ?? ""}`} value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input className={`h-8 w-24 text-right ${errClass(errs.value) ?? ""}`} inputMode="decimal" value={p.value} onChange={(e) => updateParam(i, { value: e.target.value })} />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input className="h-8 w-24" value={p.unit} onChange={(e) => updateParam(i, { unit: e.target.value })} />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input className={`h-8 w-20 ${errClass(errs.refLow) ?? ""}`} inputMode="decimal" value={p.refLow} onChange={(e) => updateParam(i, { refLow: e.target.value })} />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input className={`h-8 w-20 ${errClass(errs.refHigh) ?? ""}`} inputMode="decimal" value={p.refHigh} onChange={(e) => updateParam(i, { refHigh: e.target.value })} />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeParam(i)} aria-label="Eliminar parámetro">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {draft.parameters.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-4 text-sm">
                          No hay parámetros. Añade al menos uno para guardar la analítica.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <Button variant="outline" size="sm" onClick={addParam}>
                <Plus className="w-4 h-4 mr-2" /> Añadir parámetro
              </Button>
              {showErrors && hasErrors && (
                <p className="text-sm text-destructive">
                  Corrige los campos marcados: cada parámetro necesita nombre y valor numérico (los rangos, si se indican, también deben ser numéricos) y la fecha de muestreo es obligatoria.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)} disabled={saveAnalysis.isPending}>
                  Descartar
                </Button>
                <Button onClick={handleSave} disabled={saveAnalysis.isPending}>
                  {saveAnalysis.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</>
                  ) : (
                    "Guardar analítica"
                  )}
                </Button>
              </div>
            </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
