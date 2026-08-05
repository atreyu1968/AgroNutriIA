import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ReferenceArea, ReferenceLine,
} from "recharts";
import { 
  useListSectors, useCreateSector, useUpdateSector, useDeleteSector,
  useListAnalyses, useCreateAnalysis, useImportAnalysisPdf, useDeleteAnalysis, useUpdateAnalysis,
  useUploadAnalysisPdf, getGetAnalysisPdfUrl,
  useGetFarmProblems,
  useListRecommendations, useChangeRecommendationStatus, useListConversations, getListConversationsQueryKey,
  useListReports, useCreateReport, usePreviewReportNotes, useDeleteReport, useDeleteRecommendation,
  useListWaterSources, useSetWaterSources, getListWaterSourcesQueryKey,
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
import { ChatTecnicoPanel } from "@/components/chat-tecnico";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ecToUs, formatDateTime, formatDate, formatNumber } from "@/lib/utils";

// --- Sectors Tab ---
import { Trash2, Plus, Pencil, FileText, Droplets, TestTube, Sprout, Users, Settings, Download, Upload, Loader2, Bot, TrendingUp, AlertTriangle } from "lucide-react";
export function SectorsTab({ farmId }: { farmId: number }) {
  const { data: sectors, isLoading } = useListSectors(farmId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingSectorId, setEditingSectorId] = useState<number | null>(null);

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

  const updateMutation = useUpdateSector({
    mutation: {
      onSuccess: () => {
        toast({ title: "Sector actualizado" });
        queryClient.invalidateQueries({ queryKey: getListSectorsQueryKey(farmId) });
        setOpen(false);
        setEditingSectorId(null);
        form.reset();
      },
      onError: () =>
        toast({ title: "No se pudo guardar el sector", description: "Inténtalo de nuevo.", variant: "destructive" }),
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
    if (editingSectorId != null) {
      // Al editar, un campo vacío borra el valor guardado.
      updateMutation.mutate({
        farmId,
        sectorId: editingSectorId,
        data: {
          name: v.name.trim(),
          surfaceHa: v.surfaceHa && isNumeric(v.surfaceHa) ? parseNum(v.surfaceHa) : null,
          plantCount: v.plantCount && isNumeric(v.plantCount) ? parseNum(v.plantCount) : null,
          phenologicalStage: v.phenologicalStage?.trim() ? v.phenologicalStage.trim() : null,
          weeklyLitresPerPlant: v.weeklyLitresPerPlant && isNumeric(v.weeklyLitresPerPlant) ? parseNum(v.weeklyLitresPerPlant) : null,
        },
      });
      return;
    }
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

  const startEdit = (s: NonNullable<typeof sectors>[number]) => {
    setEditingSectorId(s.id);
    form.reset({
      name: s.name,
      surfaceHa: s.surfaceHa != null ? String(s.surfaceHa) : "",
      plantCount: s.plantCount != null ? String(s.plantCount) : "",
      phenologicalStage: s.phenologicalStage ?? "",
      weeklyLitresPerPlant: s.weeklyLitresPerPlant != null ? String(s.weeklyLitresPerPlant) : "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Sectores de Riego</h3>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditingSectorId(null); form.reset({ name: "", surfaceHa: "", plantCount: "", phenologicalStage: "", weeklyLitresPerPlant: "" }); } }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-2" /> Añadir Sector</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingSectorId != null ? "Editar Sector de Riego" : "Añadir Sector de Riego"}</DialogTitle></DialogHeader>
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
                <Button type="submit" className="w-full" disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</>
                  ) : editingSectorId != null ? (
                    "Guardar cambios"
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
                      className="text-muted-foreground"
                      aria-label={`Editar sector ${s.name}`}
                      data-testid={`button-edit-sector-${s.id}`}
                      onClick={() => startEdit(s)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
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
type EditableParam = { name: string; value: string; unit: string; refLow: string; refHigh: string; status?: string | null };
type EditableDraft = {
  type: "soil" | "leaf" | "water";
  sampleDate: string;
  reference: string;
  laboratory: string;
  description: string;
  notes: string;
  sectorId?: number | null;
  waterSourceId?: number | null;
  parameters: EditableParam[];
};

function toEditableDraft(input: {
  type?: string | null;
  sampleDate?: string | null;
  reference?: string | null;
  laboratory?: string | null;
  description?: string | null;
  notes?: string | null;
  sectorId?: number | null;
  waterSourceId?: number | null;
  parameters?: AnalysisInput["parameters"];
}): EditableDraft {
  return {
    type: (input.type as EditableDraft["type"]) ?? "soil",
    sampleDate: input.sampleDate ?? "",
    reference: input.reference ?? "",
    laboratory: input.laboratory ?? "",
    description: input.description ?? "",
    notes: input.notes ?? "",
    sectorId: input.sectorId ?? null,
    waterSourceId: input.waterSourceId ?? null,
    parameters: (input.parameters ?? []).map((p) => ({
      name: p.name ?? "",
      value: p.value != null ? String(p.value) : "",
      unit: p.unit ?? "",
      refLow: p.refLow != null ? String(p.refLow) : "",
      refHigh: p.refHigh != null ? String(p.refHigh) : "",
      status: p.status ?? null,
    })),
  };
}

const isNumeric = (s: string) => s.trim() !== "" && !Number.isNaN(Number(s.trim().replace(",", ".")));
const parseNum = (s: string) => Number(s.trim().replace(",", "."));

const paramFieldErrors = (p: EditableParam) => ({
  name: p.name.trim() === "",
  value: !isNumeric(p.value),
  refLow: p.refLow.trim() !== "" && !isNumeric(p.refLow),
  refHigh: p.refHigh.trim() !== "" && !isNumeric(p.refHigh),
});
const emptyDraft = (): EditableDraft => ({
  type: "soil",
  sampleDate: "",
  reference: "",
  laboratory: "",
  description: "",
  notes: "",
  sectorId: null,
  parameters: [{ name: "", value: "", unit: "", refLow: "", refHigh: "" }],
});
export function ImportAnalysisButton({ farmId }: { farmId: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const pendingFileRef = useRef<File | null>(null);

  const uploadPdf = useUploadAnalysisPdf({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
      },
      onError: () =>
        toast({
          title: "La analítica se guardó, pero no su PDF",
          description: "Puedes volver a importar el PDF o consultarlo en tu archivo original.",
          variant: "destructive",
        }),
    },
  });

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
          if (file) {
            pendingFileRef.current = file;
            importPdf.mutate({ farmId, data: { file } });
          }
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
        onCreated={(created) => {
          const file = pendingFileRef.current;
          pendingFileRef.current = null;
          if (file) uploadPdf.mutate({ farmId, analysisId: created.id, data: { file } });
        }}
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
  const [editDraft, setEditDraft] = useState<EditableDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const errorDescription = (err: unknown) => {
    const anyErr = err as { response?: { data?: { error?: string } }; data?: { error?: string }; message?: string };
    return anyErr?.response?.data?.error ?? anyErr?.data?.error ?? anyErr?.message ?? "Inténtalo de nuevo.";
  };

  const updateMutation = useUpdateAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        setEditDraft(null);
        setShowErrors(false);
        onClose();
        toast({ title: "Analítica actualizada", description: "Los cambios ya se reflejan en la lista." });
      },
      onError: (err: unknown) =>
        toast({ title: "No se pudo guardar la analítica", description: errorDescription(err), variant: "destructive" }),
    },
  });

  const errors = draftValidation(editDraft);
  const hasErrors = !!errors && (errors.sampleDate || errors.noParams || errors.params);

  const handleUpdate = () => {
    if (!analysis || !editDraft) return;
    if (hasErrors) {
      setShowErrors(true);
      toast({
        title: "Revisa los datos antes de guardar",
        description: "Todos los parámetros necesitan nombre y un valor numérico, y la fecha de muestreo es obligatoria.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({ farmId, analysisId: analysis.id, data: draftToPayload(editDraft) });
  };

  const closeAll = () => {
    setEditDraft(null);
    setShowErrors(false);
    onClose();
  };

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
    <Dialog open={analysis !== null} onOpenChange={(open) => { if (!open) closeAll(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editDraft ? "Editar analítica" : "Detalle de la analítica"}</DialogTitle>
        </DialogHeader>
        {analysis && editDraft && (
          <div className="space-y-3">
            <AnalysisDraftEditor farmId={farmId} draft={editDraft} setDraft={setEditDraft} showErrors={showErrors} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setEditDraft(null); setShowErrors(false); }} disabled={updateMutation.isPending}>
                Cancelar
              </Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</>
                ) : (
                  "Guardar cambios"
                )}
              </Button>
            </div>
          </div>
        )}
        {analysis && !editDraft && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><span className="text-muted-foreground">Tipo:</span> <span className="font-medium">{tipo}</span></span>
              <span><span className="text-muted-foreground">Fecha de muestreo:</span> <span className="font-medium">{formatDate(analysis.sampleDate)}</span></span>
              {analysis.reference && <span><span className="text-muted-foreground">Referencia:</span> <span className="font-medium">{analysis.reference}</span></span>}
              {analysis.laboratory && <span><span className="text-muted-foreground">Laboratorio:</span> <span className="font-medium">{analysis.laboratory}</span></span>}
            </div>
            {analysis.description && <p className="text-sm text-muted-foreground">{analysis.description}</p>}
            {analysis.notes && <p className="text-sm text-muted-foreground italic">{analysis.notes}</p>}
            {analysis.hasPdf && (
              <Button
                size="sm"
                variant="outline"
                data-testid="button-view-analysis-pdf"
                onClick={() => window.open(getGetAnalysisPdfUrl(farmId, analysis.id), "_blank", "noopener")}
              >
                <FileText className="w-4 h-4 mr-2" /> Ver PDF del laboratorio
              </Button>
            )}
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
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowErrors(false); setEditDraft(toEditableDraft(analysis)); }}>
                    <Pencil className="w-4 h-4 mr-2" /> Editar
                  </Button>
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
                </div>
              ) : <span />}
              <Button variant="outline" onClick={closeAll}>Cerrar</Button>
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

function WaterSourcesCard({ farmId, canEdit }: { farmId: number; canEdit: boolean }) {
  const { data: waterSources } = useListWaterSources(farmId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mixEdit, setMixEdit] = useState<Record<number, number>>({});
  const [newSourceName, setNewSourceName] = useState("");
  useEffect(() => {
    if (waterSources) setMixEdit(Object.fromEntries(waterSources.map((s) => [s.id, s.sharePct])));
  }, [waterSources]);
  const mixTotal = Object.values(mixEdit).reduce((a, b) => a + (b || 0), 0);
  const saveMutation = useSetWaterSources({
    mutation: {
      onSuccess: () => {
        toast({ title: "Fuentes de agua guardadas" });
        queryClient.invalidateQueries({ queryKey: getListWaterSourcesQueryKey(farmId) });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo guardar el reparto", description: msg ?? "Revisa los porcentajes.", variant: "destructive" });
      },
    },
  });
  const currentPayload = () =>
    (waterSources ?? []).map((x) => ({ id: x.id, name: x.name, sharePct: mixEdit[x.id] ?? x.sharePct }));

  if (!canEdit && (waterSources ?? []).length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Droplets className="w-4 h-4 text-primary" /> Fuentes de agua y mezcla de riego
        </CardTitle>
        <CardDescription>
          Define las fuentes (pozo, desaladora, balsa...) y el % de cada una en el riego actual. Cada fuente
          usa su analítica de agua más reciente y el cálculo, la IA y los informes emplean la mezcla ponderada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(waterSources ?? []).length > 0 ? (
          <>
            {(waterSources ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className="flex-1 text-sm">
                  {s.name}
                  <span className="block text-xs text-muted-foreground">
                    {s.latestAnalysisDate ? `Analítica: ${formatDate(s.latestAnalysisDate)}` : "Sin analítica de agua asociada"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="w-20"
                    value={mixEdit[s.id] ?? s.sharePct}
                    disabled={!canEdit}
                    onChange={(e) => setMixEdit((m) => ({ ...m, [s.id]: parseFloat(e.target.value) || 0 }))}
                    data-testid={`input-source-pct-${s.id}`}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={saveMutation.isPending}
                      onClick={() =>
                        saveMutation.mutate({ farmId, data: currentPayload().filter((x) => x.id !== s.id) })
                      }
                      data-testid={`button-delete-source-${s.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <p className={`text-xs ${Math.abs(mixTotal - 100) > 0.5 && mixTotal > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              Reparto total: {formatNumber(mixTotal)} % {Math.abs(mixTotal - 100) > 0.5 && mixTotal > 0 ? "(debe sumar 100 %)" : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin fuentes definidas: se usa la analítica de agua más reciente de la finca como agua única.
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Nueva fuente (pozo, desaladora...)"
              className="max-w-xs"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              data-testid="input-new-source"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!newSourceName.trim() || saveMutation.isPending}
              onClick={() => {
                saveMutation.mutate({
                  farmId,
                  data: [...currentPayload(), { name: newSourceName.trim(), sharePct: 0 }],
                });
                setNewSourceName("");
              }}
              data-testid="button-add-source"
            >
              <Plus className="w-4 h-4" /> Añadir
            </Button>
            {(waterSources ?? []).length > 0 && (
              <Button
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate({ farmId, data: currentPayload() })}
                data-testid="button-save-sources"
              >
                Guardar reparto
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalysesTab({ farmId, canEdit = false }: { farmId: number; canEdit?: boolean }) {
  const { data: analyses, isLoading } = useListAnalyses(farmId);
  const { data: problemsDiagnosis } = useGetFarmProblems(farmId);
  const { data: sectorsForNames } = useListSectors(farmId);
  const sectorName = (id: number | null | undefined) =>
    id == null ? null : sectorsForNames?.find((s) => s.id === id)?.name ?? `Sector ${id}`;
  const [selected, setSelected] = useState<AnalysisRow | null>(null);
  const [onlyOutOfRange, setOnlyOutOfRange] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'soil' | 'leaf' | 'water'>('all');
  const filteredAnalyses = useMemo(() => {
    if (!analyses) return analyses;
    return analyses.filter(a =>
      (typeFilter === 'all' || a.type === typeFilter) &&
      (!onlyOutOfRange || (a.parameters ?? []).some(p => p.status && p.status !== 'normal'))
    );
  }, [analyses, onlyOutOfRange, typeFilter]);
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
          <div className="flex items-center gap-1">
            {([
              ['all', 'Todas'],
              ['soil', 'Suelo'],
              ['leaf', 'Foliar'],
              ['water', 'Agua'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={typeFilter === value ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setTypeFilter(value)}
                data-testid={`filter-type-${value}`}
              >
                {label}
              </Button>
            ))}
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
      {problemsDiagnosis?.problems?.length ? (
        <div className="rounded-md border border-amber-300 bg-amber-500/10 p-3 space-y-3" data-testid="farm-problems-warning">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Problemas detectados al cruzar las analíticas</p>
              <p className="text-sm text-amber-800/90">Se cruzó la analítica de suelo, la foliar y el agua. Cada problema incluye su recomendación para el abonado, que el programa generado por la IA tiene en cuenta.</p>
            </div>
          </div>
          <div className="space-y-3">
            {problemsDiagnosis.problems.map((p) => (
              <div key={p.id} className="rounded-md border border-amber-300/60 bg-background p-3 space-y-1">
                <div className="flex items-start gap-2">
                  <Badge variant={p.severity === "critical" ? "destructive" : p.severity === "warning" ? "default" : "secondary"} className="shrink-0 mt-0.5">
                    {p.severity === "critical" ? "Crítico" : p.severity === "warning" ? "Aviso" : "Observación"}
                  </Badge>
                  <p className="text-sm font-semibold">{p.title}</p>
                </div>
                <p className="text-sm text-muted-foreground">{p.message}</p>
                <p className="text-sm text-amber-800/90"><span className="font-medium">Recomendación:</span> {p.advice}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <WaterSourcesCard farmId={farmId} canEdit={canEdit} />
      {!isLoading && analyses && analyses.length > 0 && <ParameterTrendCard analyses={analyses} />}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Ámbito</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Laboratorio</TableHead>
              <TableHead>Parámetros</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
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
                  <TableCell>
                    {sectorName(a.sectorId) ? (
                      <Badge variant="outline">{sectorName(a.sectorId)}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Global</span>
                    )}
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
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{(onlyOutOfRange || typeFilter !== 'all') && analyses && analyses.length > 0 ? "No hay analíticas que coincidan con los filtros." : "No hay analíticas registradas."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <AnalysisDetailDialog farmId={farmId} analysis={selected} canEdit={canEdit} onClose={() => setSelected(null)} />
    </div>
  );
}

// --- Recommendations Tab ---
const DELETABLE_REC_STATUSES = ["draft", "pending_review", "rejected"];

export function RecommendationsTab({ farmId, onCreate, canEdit }: { farmId: number; onCreate?: () => void; canEdit?: boolean }) {
  const { data: recommendations, isLoading } = useListRecommendations(farmId);
  const { data: recSectors } = useListSectors(farmId);
  const [selectedRec, setSelectedRec] = useState<NonNullable<typeof recommendations>[number] | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteRecMutation = useDeleteRecommendation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Programa eliminado" });
        queryClient.invalidateQueries({ queryKey: getListRecommendationsQueryKey(farmId) });
      },
      onError: (err: unknown) => {
        const message =
          (err as { data?: { error?: string } })?.data?.error ?? "No se pudo eliminar el programa.";
        toast({ title: "No eliminado", description: message, variant: "destructive" });
      },
    },
  });
  const recSectorName = (id: number | null | undefined) =>
    id == null ? null : recSectors?.find((s) => s.id === id)?.name ?? `Sector ${id}`;
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Programas de Nutrición</h3>
        <Button size="sm" onClick={onCreate} data-testid="button-create-program">
          <Plus className="w-4 h-4 mr-2" /> Crear Programa
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : recommendations && recommendations.length > 0 ? (
          recommendations.map(r => {
            const exceedsCe = r.warnings?.[0]?.startsWith('SUPERA LA CE MÁXIMA') ?? false;
            return (
            <Card key={r.id} className={exceedsCe ? 'border-destructive' : ''}>
              {exceedsCe && (
                <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/30 rounded-t-lg text-destructive text-sm font-semibold" data-testid={`banner-ce-exceeded-${r.id}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{r.warnings![0]}</span>
                </div>
              )}
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold">{r.title || 'Recomendación sin título'}</h4>
                    <Badge variant={r.status === 'applying' ? 'success' : r.status === 'draft' ? 'outline' : 'secondary'}>{r.status}</Badge>
                    {r.source === 'ai' && (
                      <Badge variant="secondary" className="gap-1"><Bot className="w-3 h-3" /> IA</Badge>
                    )}
                    {exceedsCe && (
                      <Badge variant="destructive" className="gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> CE máxima</Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground flex gap-4">
                    <span>{formatDate(r.createdAt)}</span>
                    <span>{r.items?.length || 0} fertilizantes</span>
                    {r.estimatedEcDsM && <span className={exceedsCe ? 'text-destructive font-medium' : ''}>CE: {formatNumber(ecToUs(r.estimatedEcDsM))} µS/cm</span>}
                    {r.updatedByName && <span>Ajustado por {r.updatedByName}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRec(r)}
                    data-testid={`button-view-program-${r.id}`}
                  >
                    Ver detalles
                  </Button>
                  {canEdit && DELETABLE_REC_STATUSES.includes(r.status) && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-delete-program-${r.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar este programa?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminará «{r.title || "Recomendación sin título"}». Solo se pueden eliminar
                            programas que no han sido validados por el técnico. Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteRecMutation.isPending}
                            onClick={() => deleteRecMutation.mutate({ farmId, recommendationId: r.id })}
                          >
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardContent>
            </Card>
          );})
        ) : (
          <div className="text-center py-10 border-2 border-dashed rounded-lg bg-muted/10">
            <Sprout className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
            <p className="text-muted-foreground">No hay recomendaciones de nutrición.</p>
          </div>
        )}
      </div>

      <Dialog open={!!selectedRec} onOpenChange={(open) => !open && setSelectedRec(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRec && (() => {
            const detailExceedsCe = selectedRec.warnings?.[0]?.startsWith('SUPERA LA CE MÁXIMA') ?? false;
            const otherWarnings = detailExceedsCe ? (selectedRec.warnings ?? []).slice(1) : (selectedRec.warnings ?? []);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="pr-8">{selectedRec.title || "Recomendación sin título"}</DialogTitle>
                </DialogHeader>
                {detailExceedsCe && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/40 text-destructive" data-testid="banner-detail-ce-exceeded">
                    <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-semibold text-sm">{selectedRec.warnings![0]}</p>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedRec.status === "applying" ? "success" : selectedRec.status === "draft" ? "outline" : "secondary"}>
                    {selectedRec.status}
                  </Badge>
                  {selectedRec.source === "ai" && (
                    <Badge variant="secondary" className="gap-1"><Bot className="w-3 h-3" /> IA</Badge>
                  )}
                  <Badge variant="outline">
                    {recSectorName(selectedRec.sectorId) ? `Sector: ${recSectorName(selectedRec.sectorId)}` : "Global de la finca"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{formatDate(selectedRec.createdAt)}</span>
                </div>
                <div className="text-sm text-muted-foreground flex flex-wrap gap-4">
                  {selectedRec.estimatedEcDsM != null && (
                    <span className={detailExceedsCe ? 'text-destructive font-semibold' : ''}>CE estimada: {formatNumber(ecToUs(selectedRec.estimatedEcDsM))} µS/cm</span>
                  )}
                  {selectedRec.updatedByName && <span>Ajustado por {selectedRec.updatedByName}</span>}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fertilizante</TableHead>
                      <TableHead className="text-right">Dosis semanal</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedRec.items ?? []).map((it, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{it.fertilizerName}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{it.weeklyDose} {it.unit}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{it.reason || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {(selectedRec.items ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Sin fertilizantes.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                {otherWarnings.length > 0 && (
                  <div className="space-y-1">
                    {otherWarnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-sm text-amber-700">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selectedRec.rationale && (
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold">Justificación agronómica</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedRec.rationale}</p>
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Reports Tab ---
export function ReportsTab({ farmId, canEdit }: { farmId: number; canEdit?: boolean }) {
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
        setGenOpen(false);
      },
      onError: (err: unknown) => {
        const message =
          (err as { data?: { error?: string } })?.data?.error ??
          "No se pudo generar el informe.";
        toast({ title: "Informe no generado", description: message, variant: "destructive" });
      },
    }
  });

  const deleteReportMutation = useDeleteReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Informe eliminado" });
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(farmId) });
      },
      onError: (err: unknown) => {
        const message =
          (err as { data?: { error?: string } })?.data?.error ?? "No se pudo eliminar el informe.";
        toast({ title: "No eliminado", description: message, variant: "destructive" });
      },
    },
  });

  const { data: recommendations } = useListRecommendations(farmId);
  const [genOpen, setGenOpen] = useState(false);
  const [reportKind, setReportKind] = useState<"fertirrigacion" | "enmiendas_arranque" | "enmiendas_lluvias">("fertirrigacion");
  const isAmendment = reportKind !== "fertirrigacion";
  const [selectedRecId, setSelectedRecId] = useState<string>("none");
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [chatConversationId, setChatConversationId] = useState<number | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string>("new");
  const [previewNotes, setPreviewNotes] = useState<string | null>(null);
  const previewMutation = usePreviewReportNotes({
    mutation: {
      onSuccess: (data) => setPreviewNotes(data.notes),
      onError: (err: unknown) => {
        const message =
          (err as { data?: { error?: string } })?.data?.error ??
          "No se pudo generar la previsualización.";
        toast({ title: "Previsualización no disponible", description: message, variant: "destructive" });
      },
    },
  });
  const handlePreview = () => {
    if (chatConversationId == null) return;
    previewMutation.mutate({ farmId, data: { conversationId: chatConversationId } });
  };
  const { data: farmConversations } = useListConversations(farmId, {
    query: { enabled: genOpen, queryKey: getListConversationsQueryKey(farmId) },
  });

  const handleGenerate = () => {
    createMutation.mutate({
      farmId,
      data: isAmendment
        ? {
            format,
            reportType: "enmiendas",
            scenario: reportKind === "enmiendas_arranque" ? "arranque_siembra" : "lluvias",
          }
        : {
            format,
            title: "Informe técnico de fertirrigación",
            ...(selectedRecId !== "none" ? { recommendationId: parseInt(selectedRecId, 10) } : {}),
            ...(chatConversationId != null ? { conversationId: chatConversationId } : {}),
          },
    });
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Informes Generados</h3>
        <Dialog open={genOpen} onOpenChange={setGenOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><FileText className="w-4 h-4 mr-2" /> Generar Informe</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Generar informe</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Tipo de informe</Label>
                <Select value={reportKind} onValueChange={(v) => setReportKind(v as typeof reportKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fertirrigacion">Fertirrigación (programa semanal)</SelectItem>
                    <SelectItem value="enmiendas_arranque">Enmiendas del terreno — arranque y siembra</SelectItem>
                    <SelectItem value="enmiendas_lluvias">Enmiendas del terreno — época de lluvias</SelectItem>
                  </SelectContent>
                </Select>
                {isAmendment && (
                  <p className="text-xs text-muted-foreground">
                    La IA elabora el plan de enmiendas (yeso, cal, materia orgánica...) a partir de las
                    analíticas más recientes de la finca. Se necesita al menos la analítica de suelo y una
                    clave de OpenAI configurada.
                  </p>
                )}
              </div>
              {!isAmendment && (
              <div className="space-y-2">
                <Label>Programa de abonado a incluir</Label>
                <Select value={selectedRecId} onValueChange={setSelectedRecId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Programa vigente (automático)</SelectItem>
                    {recommendations?.map(r => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.source === 'ai' ? '[IA] ' : '[Técnico] '}{r.title} · {formatDate(r.createdAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Elige el programa propuesto por la IA o la versión del técnico (manual o modificada).
                </p>
              </div>
              )}
              <div className="space-y-2">
                <Label>Formato</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as "pdf" | "docx")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="docx">Word (DOCX)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isAmendment && (<>
              <div className="space-y-2">
                <Label>Conversación con el técnico IA</Label>
                <Select
                  value={selectedConvId}
                  onValueChange={(v) => {
                    setSelectedConvId(v);
                    setChatConversationId(v === "new" ? null : parseInt(v, 10));
                    setPreviewNotes(null);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Nueva conversación</SelectItem>
                    {farmConversations?.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.title}{c.updatedAt ? ` · ${formatDate(c.updatedAt)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Reutiliza una conversación anterior (Nutrición o Calculadora) para incluir sus observaciones en el informe, o empieza una nueva abajo.
                </p>
              </div>
              <ChatTecnicoPanel
                farmId={farmId}
                activeConversationId={selectedConvId === "new" ? null : parseInt(selectedConvId, 10)}
                conversationTitle="Chat del informe técnico"
                description="Cuéntale al técnico IA lo que quieres reflejar en el informe y adjunta documentos (PDF) o imágenes (fotos de campo, etiquetas, analíticas escaneadas...). La conversación se resumirá en la sección «Observaciones del técnico» del informe."
                allowAttachments
                compact
                onConversationChange={setChatConversationId}
              />
              {chatConversationId != null && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handlePreview}
                    disabled={previewMutation.isPending}
                    data-testid="button-preview-notes"
                  >
                    {previewMutation.isPending
                      ? "Generando previsualización..."
                      : previewNotes
                        ? "Refrescar previsualización"
                        : "Previsualizar observaciones"}
                  </Button>
                  {previewNotes && (
                    <div className="rounded-md border bg-muted/50 p-3 space-y-1" data-testid="preview-notes">
                      <p className="text-xs font-medium text-muted-foreground">
                        Observaciones del técnico (previsualización)
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{previewNotes}</p>
                      <p className="text-xs text-muted-foreground">
                        Puedes seguir chateando y refrescar la previsualización antes de generar el informe.
                      </p>
                    </div>
                  )}
                </div>
              )}
              </>)}
              <Button className="w-full" onClick={handleGenerate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Generando..." : "Generar informe"}
              </Button>
              {!isAmendment && chatConversationId != null && (
                <p className="text-xs text-muted-foreground text-center">
                  El informe incluirá las observaciones de la conversación con el técnico IA.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
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
                  <TableCell className="font-medium">
                    {r.title}
                    {r.reportType === 'plan_fitosanitario' && (
                      <Badge variant="secondary" className="ml-2">Plan fitosanitario</Badge>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="uppercase">{r.format}</Badge></TableCell>
                  <TableCell>
                    {r.status === 'ready' ? <span className="text-green-600 font-medium">Listo</span> : 
                     r.status === 'generating' ? <span className="text-amber-600 animate-pulse">Generando...</span> : 
                     <span className="text-destructive">Error</span>}
                    {r.warnings && r.warnings.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {r.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-1 text-xs text-amber-700" data-testid={`text-report-warning-${r.id}-${i}`}>
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === 'ready' && r.downloadUrl && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={r.downloadUrl} download><Download className="w-4 h-4 mr-2"/> Descargar</a>
                        </Button>
                      )}
                      {canEdit && r.status !== 'generating' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              data-testid={`button-delete-report-${r.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Eliminar este informe?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Se eliminará «{r.title}» y su fichero generado. Esta acción no se puede deshacer.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={deleteReportMutation.isPending}
                                onClick={() => deleteReportMutation.mutate({ farmId, reportId: r.id })}
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
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
  onCreated,
}: {
  farmId: number;
  draft: EditableDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<EditableDraft | null>>;
  title: string;
  description: string;
  successDescription: string;
  onCreated?: (created: AnalysisRow) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showErrors, setShowErrors] = useState(false);

  const saveAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        setDraft(null);
        setShowErrors(false);
        toast({ title: "Analítica guardada", description: successDescription });
        onCreated?.(created);
      },
      onError: (err: unknown) =>
        toast({ title: "No se pudo guardar la analítica", description: errorDescription(err), variant: "destructive" }),
    },
  });

  const errors = draftValidation(draft);
  const hasErrors = !!errors && (errors.sampleDate || errors.noParams || errors.params);

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
    saveAnalysis.mutate({ farmId, data: draftToPayload(draft) });
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
              <AnalysisDraftEditor farmId={farmId} draft={draft} setDraft={setDraft} showErrors={showErrors} />
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

function draftToPayload(draft: EditableDraft): AnalysisInput {
  return {
    type: draft.type,
    sampleDate: draft.sampleDate.trim(),
    ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
    ...(draft.laboratory.trim() ? { laboratory: draft.laboratory.trim() } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    ...(draft.sectorId != null ? { sectorId: draft.sectorId } : {}),
    ...(draft.type === "water" && draft.waterSourceId != null ? { waterSourceId: draft.waterSourceId } : {}),
    parameters: draft.parameters.map((p) => ({
      name: p.name.trim(),
      value: parseNum(p.value),
      ...(p.unit.trim() ? { unit: p.unit.trim() } : {}),
      ...(isNumeric(p.refLow) ? { refLow: parseNum(p.refLow) } : {}),
      ...(isNumeric(p.refHigh) ? { refHigh: parseNum(p.refHigh) } : {}),
      ...(p.status ? { status: p.status } : {}),
    })),
  };
}

function AnalysisDraftEditor({
  farmId,
  draft,
  setDraft,
  showErrors,
}: {
  farmId: number;
  draft: EditableDraft;
  setDraft: React.Dispatch<React.SetStateAction<EditableDraft | null>>;
  showErrors: boolean;
}) {
  const { data: sectors } = useListSectors(farmId);
  const { data: waterSources } = useListWaterSources(farmId);
  const errors = draftValidation(draft)!;
  const updateParam = (i: number, patch: Partial<EditableParam>) =>
    setDraft((d) => d && { ...d, parameters: d.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const removeParam = (i: number) =>
    setDraft((d) => d && { ...d, parameters: d.parameters.filter((_, j) => j !== i) });
  const addParam = () =>
    setDraft((d) => d && { ...d, parameters: [...d.parameters, { name: "", value: "", unit: "", refLow: "", refHigh: "" }] });
  const hasErrors = errors.sampleDate || errors.noParams || errors.params;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Tipo</label>
          <Select value={draft.type} onValueChange={(v) => setDraft((d) => d && { ...d, type: v as EditableDraft["type"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="soil">Suelo</SelectItem>
              <SelectItem value="leaf">Foliar</SelectItem>
              <SelectItem value="water">Agua de riego</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Ámbito</label>
          <Select
            value={draft.sectorId != null ? String(draft.sectorId) : "global"}
            onValueChange={(v) =>
              setDraft((d) => d && { ...d, sectorId: v === "global" ? null : Number(v) })
            }
          >
            <SelectTrigger data-testid="select-analysis-sector"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global (toda la finca)</SelectItem>
              {(sectors ?? []).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>Sector: {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {draft.type === "water" && (waterSources ?? []).length > 0 && (
          <div className="space-y-1 col-span-2">
            <label className="text-xs font-medium">Fuente de agua</label>
            <Select
              value={draft.waterSourceId != null ? String(draft.waterSourceId) : "none"}
              onValueChange={(v) =>
                setDraft((d) => d && { ...d, waterSourceId: v === "none" ? null : Number(v) })
              }
            >
              <SelectTrigger data-testid="select-analysis-water-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin fuente (agua general de la finca)</SelectItem>
                {(waterSources ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Asocia la analítica a una fuente para que la mezcla de riego se calcule con el % de cada una.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium">Fecha de muestreo</label>
          <Input
            type="date"
            value={draft.sampleDate}
            onChange={(e) => setDraft((d) => d && { ...d, sampleDate: e.target.value })}
            className={showErrors && errors.sampleDate ? "border-destructive" : undefined}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Referencia</label>
          <Input value={draft.reference} onChange={(e) => setDraft((d) => d && { ...d, reference: e.target.value })} placeholder="Opcional" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Laboratorio</label>
          <Input value={draft.laboratory} onChange={(e) => setDraft((d) => d && { ...d, laboratory: e.target.value })} placeholder="Opcional" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Descripción</label>
          <Input value={draft.description} onChange={(e) => setDraft((d) => d && { ...d, description: e.target.value })} placeholder="Opcional" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Notas</label>
          <Input value={draft.notes} onChange={(e) => setDraft((d) => d && { ...d, notes: e.target.value })} placeholder="Opcional" />
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
              const errs = paramFieldErrors(p);
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
    </div>
  );
}

function draftValidation(draft: EditableDraft | null) {
  if (!draft) return null;
  return {
    sampleDate: draft.sampleDate.trim() === "",
    noParams: draft.parameters.length === 0,
    params: draft.parameters.some((p) => {
      const e = paramFieldErrors(p);
      return e.name || e.value || e.refLow || e.refHigh;
    }),
  };
}
