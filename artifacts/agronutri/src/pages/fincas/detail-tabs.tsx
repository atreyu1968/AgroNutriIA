import { useRef, useState } from "react";
import { 
  useListSectors, useCreateSector, useDeleteSector,
  useListAnalyses, useCreateAnalysis, useImportAnalysisPdf,
  useListRecommendations, useChangeRecommendationStatus,
  useListReports, useCreateReport,
  useListMembers, useAddMember, useRemoveMember,
  useGetFarmApiConfig, useSetFarmApiConfig, useListCredentials,
  getListSectorsQueryKey, getListAnalysesQueryKey, 
  getListRecommendationsQueryKey, getListReportsQueryKey, 
  getListMembersQueryKey, getGetFarmApiConfigQueryKey
} from "@workspace/api-client-react";
import type { AnalysisInput } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatDateTime, formatDate, formatNumber } from "@/lib/utils";

// --- Sectors Tab ---
import { Trash2, Plus, FileText, Droplets, TestTube, Sprout, Users, Settings, Download, Upload, Loader2, Bot } from "lucide-react";
export function SectorsTab({ farmId }: { farmId: number }) {
  const { data: sectors, isLoading } = useListSectors(farmId);
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Sectores de Riego</h3>
        <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-2" /> Añadir Sector</Button>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
            ) : sectors && sectors.length > 0 ? (
              sectors.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.surfaceHa ? `${s.surfaceHa} Ha` : '-'}</TableCell>
                  <TableCell>{formatNumber(s.plantCount, 0)}</TableCell>
                  <TableCell>{s.phenologicalStage || '-'}</TableCell>
                  <TableCell>{s.weeklyLitresPerPlant || '-'}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No hay sectores definidos.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Analyses Tab ---
export function ImportAnalysisButton({ farmId }: { farmId: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<AnalysisInput | null>(null);

  const errorDescription = (err: unknown) => {
    const anyErr = err as { response?: { data?: { error?: string } }; data?: { error?: string }; message?: string };
    return anyErr?.response?.data?.error ?? anyErr?.data?.error ?? anyErr?.message ?? "Inténtalo de nuevo.";
  };

  const importPdf = useImportAnalysisPdf({
    mutation: {
      onSuccess: (extracted) => setDraft(extracted),
      onError: (err: unknown) =>
        toast({ title: "No se pudo importar el PDF", description: errorDescription(err), variant: "destructive" }),
    },
  });

  const saveAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(farmId) });
        setDraft(null);
        toast({
          title: "Analítica guardada",
          description: "La analítica importada ya se usa en la calculadora y en las recomendaciones.",
        });
      },
      onError: (err: unknown) =>
        toast({ title: "No se pudo guardar la analítica", description: errorDescription(err), variant: "destructive" }),
    },
  });

  const tipo = draft?.type === "soil" ? "suelo" : draft?.type === "leaf" ? "foliar" : "agua de riego";

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

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Revisa los datos extraídos</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                El técnico virtual ha identificado una analítica de <span className="font-medium text-foreground">{tipo}</span>
                {draft.reference ? <> con referencia <span className="font-medium text-foreground">{draft.reference}</span></> : null}
                {draft.laboratory ? <> del laboratorio {draft.laboratory}</> : null}
                {draft.sampleDate ? <> (muestreo: {formatDate(draft.sampleDate)})</> : null}.
                Comprueba los valores antes de guardarla.
              </p>
              <div className="max-h-80 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parámetro</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Unidad</TableHead>
                      <TableHead>Rango ref.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.parameters.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{formatNumber(p.value)}</TableCell>
                        <TableCell className="text-muted-foreground">{p.unit || "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {p.refLow != null || p.refHigh != null ? `${p.refLow ?? "…"} – ${p.refHigh ?? "…"}` : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)} disabled={saveAnalysis.isPending}>
                  Descartar
                </Button>
                <Button onClick={() => saveAnalysis.mutate({ farmId, data: draft })} disabled={saveAnalysis.isPending}>
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
    </>
  );
}

export function AnalysesTab({ farmId }: { farmId: number }) {
  const { data: analyses, isLoading } = useListAnalyses(farmId);
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Analíticas</h3>
        <div className="flex gap-2">
          <ImportAnalysisButton farmId={farmId} />
          <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-2" /> Nueva Analítica</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Sube el PDF del laboratorio y el técnico virtual extraerá los parámetros automáticamente (requiere clave de OpenAI en Ajustes).
      </p>
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
            ) : analyses && analyses.length > 0 ? (
              analyses.map(a => (
                <TableRow key={a.id}>
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
                  <TableCell className="text-muted-foreground text-xs">{a.parameters?.length || 0} analizados</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No hay analíticas registradas.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
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
  const { data: reports, isLoading } = useListReports(farmId);
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
