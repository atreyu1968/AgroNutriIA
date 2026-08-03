import { useListFertilizers, useCreateFertilizer, useUpdateFertilizer, getListFertilizersQueryKey, useGetMe } from "@workspace/api-client-react";
import type { Fertilizer } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FlaskConical, Info, Pencil, Plus, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Fertilizantes() {
  const { data: fertilizers, isLoading } = useListFertilizers();
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = fertilizers?.filter(f => 
    f.name.toLowerCase().includes(search.toLowerCase()) || 
    (f.formulaType && f.formulaType.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catálogo de Fertilizantes</h1>
          <p className="text-muted-foreground mt-1">Base de datos de abonos disponibles para recomendaciones.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar..." 
              className="pl-9 bg-background" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isAdmin && <CreateFertilizerDialog open={open} onOpenChange={setOpen} />}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[250px]">Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead className="text-center bg-blue-500/10">N</TableHead>
                <TableHead className="text-center bg-amber-500/10">P₂O₅</TableHead>
                <TableHead className="text-center bg-red-500/10">K₂O</TableHead>
                <TableHead className="text-center bg-slate-300/30">CaO</TableHead>
                <TableHead className="text-center bg-green-500/10">MgO</TableHead>
                <TableHead className="text-center hidden md:table-cell">SO₃</TableHead>
                <TableHead className="text-center hidden md:table-cell">CE (dS/m)</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j} className={j > 4 ? "hidden md:table-cell" : ""}><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    ))}
                    <TableCell></TableCell>
                  </TableRow>
                ))
              ) : filtered && filtered.length > 0 ? (
                filtered.map(fert => (
                  <TableRow key={fert.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FlaskConical className="w-4 h-4 text-muted-foreground shrink-0" />
                        {fert.name}
                        {hasNoDeclaredRichness(fert) && (
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-800 border-yellow-500/30 gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Sin riqueza declarada
                          </Badge>
                        )}
                        {fert.notes && <ProductNoteInfo name={fert.name} notes={fert.notes} />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={fert.formulaType === 'liquid' ? "bg-blue-500/10 text-blue-700" : "bg-orange-500/10 text-orange-700"}>
                        {fert.formulaType === 'liquid' ? 'Líquido' : 'Sólido'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={fert.usage === 'enmienda' ? "bg-amber-500/10 text-amber-800" : "bg-emerald-500/10 text-emerald-700"}>
                        {fert.usage === 'enmienda' ? 'Enmienda' : 'Fertirrigación'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono">{fert.nPct || '-'}</TableCell>
                    <TableCell className="text-center font-mono">{fert.p2o5Pct || '-'}</TableCell>
                    <TableCell className="text-center font-mono">{fert.k2oPct || '-'}</TableCell>
                    <TableCell className="text-center font-mono">{fert.caoPct || '-'}</TableCell>
                    <TableCell className="text-center font-mono">{fert.mgoPct || '-'}</TableCell>
                    <TableCell className="text-center font-mono hidden md:table-cell">{fert.so3Pct || '-'}</TableCell>
                    <TableCell className="text-center hidden md:table-cell text-muted-foreground">{fert.ecContribution || '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isAdmin && <EditFertilizerButton fertilizer={fert} />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                    No se encontraron fertilizantes
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function hasNoDeclaredRichness(f: Fertilizer): boolean {
  return [f.nPct, f.p2o5Pct, f.k2oPct, f.caoPct, f.mgoPct, f.so3Pct, f.boronPct].every(v => !v);
}

const fertilizerSchema = z.object({
  name: z.string().min(1, "Requerido"),
  formulaType: z.enum(["solid", "liquid"]).default("solid"),
  usage: z.enum(["fertirrigacion", "enmienda"]).default("fertirrigacion"),
  nPct: z.coerce.number().optional(),
  p2o5Pct: z.coerce.number().optional(),
  k2oPct: z.coerce.number().optional(),
  caoPct: z.coerce.number().optional(),
  mgoPct: z.coerce.number().optional(),
  densityKgL: z.coerce.number().optional(),
});

function CreateFertilizerDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const form = useForm<z.infer<typeof fertilizerSchema>>({
    resolver: zodResolver(fertilizerSchema),
    defaultValues: { name: "", formulaType: "solid", usage: "fertirrigacion" }
  });

  const mutation = useCreateFertilizer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Fertilizante guardado" });
        queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
        form.reset();
        onOpenChange(false);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="shrink-0 gap-2"><Plus className="w-4 h-4" /> Nuevo Abono</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Añadir Fertilizante</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => mutation.mutate({ data: v }))} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control} name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Nombre</FormLabel>
                    <FormControl><Input {...field} placeholder="Ej. Nitrato Potásico" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control} name="formulaType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="solid">Sólido</SelectItem>
                        <SelectItem value="liquid">Líquido</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control} name="usage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Uso</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="fertirrigacion">Fertirrigación (se disuelve en el riego)</SelectItem>
                      <SelectItem value="enmienda">Enmienda (se aplica al suelo)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-5 gap-3 pt-4 border-t">
              <FormField control={form.control} name="nPct" render={({ field }) => (
                <FormItem><FormLabel className="text-blue-600">N %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
              )}/>
              <FormField control={form.control} name="p2o5Pct" render={({ field }) => (
                <FormItem><FormLabel className="text-amber-600">P₂O₅ %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
              )}/>
              <FormField control={form.control} name="k2oPct" render={({ field }) => (
                <FormItem><FormLabel className="text-red-600">K₂O %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
              )}/>
              <FormField control={form.control} name="caoPct" render={({ field }) => (
                <FormItem><FormLabel className="text-slate-500">CaO %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
              )}/>
              <FormField control={form.control} name="mgoPct" render={({ field }) => (
                <FormItem><FormLabel className="text-green-600">MgO %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
              )}/>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={mutation.isPending}>Guardar</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const compositionSchema = z.object({
  formulaType: z.enum(["solid", "liquid"]),
  nPct: z.coerce.number().min(0).max(100),
  p2o5Pct: z.coerce.number().min(0).max(100),
  k2oPct: z.coerce.number().min(0).max(100),
  caoPct: z.coerce.number().min(0).max(100),
  mgoPct: z.coerce.number().min(0).max(100),
  so3Pct: z.coerce.number().min(0).max(100),
  boronPct: z.coerce.number().min(0).max(100),
});

const NUTRIENT_FIELDS = [
  { name: "nPct", label: "N %", className: "text-blue-600" },
  { name: "p2o5Pct", label: "P₂O₅ %", className: "text-amber-600" },
  { name: "k2oPct", label: "K₂O %", className: "text-red-600" },
  { name: "caoPct", label: "CaO %", className: "text-slate-500" },
  { name: "mgoPct", label: "MgO %", className: "text-green-600" },
  { name: "so3Pct", label: "SO₃ %", className: "text-purple-600" },
  { name: "boronPct", label: "B %", className: "text-teal-600" },
] as const;

function EditFertilizerButton({ fertilizer }: { fertilizer: Fertilizer }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof compositionSchema>>({
    resolver: zodResolver(compositionSchema),
    defaultValues: {
      formulaType: fertilizer.formulaType === "liquid" ? "liquid" : "solid",
      nPct: fertilizer.nPct ?? 0,
      p2o5Pct: fertilizer.p2o5Pct ?? 0,
      k2oPct: fertilizer.k2oPct ?? 0,
      caoPct: fertilizer.caoPct ?? 0,
      mgoPct: fertilizer.mgoPct ?? 0,
      so3Pct: fertilizer.so3Pct ?? 0,
      boronPct: fertilizer.boronPct ?? 0,
    },
  });

  const mutation = useUpdateFertilizer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Composición actualizada" });
        queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
        setOpen(false);
      },
      onError: (err: unknown) => {
        const message = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo actualizar", description: message, variant: "destructive" });
      },
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          form.reset({
            formulaType: fertilizer.formulaType === "liquid" ? "liquid" : "solid",
            nPct: fertilizer.nPct ?? 0,
            p2o5Pct: fertilizer.p2o5Pct ?? 0,
            k2oPct: fertilizer.k2oPct ?? 0,
            caoPct: fertilizer.caoPct ?? 0,
            mgoPct: fertilizer.mgoPct ?? 0,
            so3Pct: fertilizer.so3Pct ?? 0,
            boronPct: fertilizer.boronPct ?? 0,
          });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Editar composición de ${fertilizer.name}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar composición · {fertilizer.name}</DialogTitle>
        </DialogHeader>
        {hasNoDeclaredRichness(fertilizer) && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Este producto se incorporó sin riqueza declarada. Introduce su composición para que los cálculos de nutrientes sean correctos.
          </div>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => mutation.mutate({ fertilizerId: fertilizer.id, data: v }))} className="space-y-4">
            <FormField
              control={form.control} name="formulaType"
              render={({ field }) => (
                <FormItem className="max-w-[200px]">
                  <FormLabel>Tipo</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="solid">Sólido</SelectItem>
                      <SelectItem value="liquid">Líquido</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-4 gap-3 pt-4 border-t">
              {NUTRIENT_FIELDS.map(({ name, label, className }) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel className={className}>{label}</FormLabel>
                    <FormControl><Input type="number" step="0.1" min="0" max="100" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}/>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Guardando..." : "Guardar composición"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ProductNoteInfo({ name, notes }: { name: string; notes: string }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Nota de ${name}`}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <Info className="w-4 h-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {!popoverOpen && (
            <TooltipContent className="max-w-xs whitespace-pre-wrap">
              {notes}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="max-w-xs w-auto text-sm whitespace-pre-wrap">
        {notes}
      </PopoverContent>
    </Popover>
  );
}
