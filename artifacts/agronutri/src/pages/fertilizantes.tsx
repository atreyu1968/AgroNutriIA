import { useListFertilizers, useCreateFertilizer, useDeleteFertilizer, getListFertilizersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlaskConical, Plus, Search, Trash2 } from "lucide-react";
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
          <CreateFertilizerDialog open={open} onOpenChange={setOpen} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[250px]">Nombre</TableHead>
                <TableHead>Tipo</TableHead>
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
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-muted-foreground shrink-0" />
                        {fert.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={fert.formulaType === 'liquid' ? "bg-blue-500/10 text-blue-700" : "bg-orange-500/10 text-orange-700"}>
                        {fert.formulaType === 'liquid' ? 'Líquido' : 'Sólido'}
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
                      <DeleteFertilizerButton id={fert.id} name={fert.name} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
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

const fertilizerSchema = z.object({
  name: z.string().min(1, "Requerido"),
  formulaType: z.enum(["solid", "liquid"]).default("solid"),
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
    defaultValues: { name: "", formulaType: "solid" }
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

function DeleteFertilizerButton({ id, name }: { id: number, name: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutation = useDeleteFertilizer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Eliminado correctamente" });
        queryClient.invalidateQueries({ queryKey: getListFertilizersQueryKey() });
      }
    }
  });

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      className="text-destructive hover:bg-destructive/10"
      onClick={() => { if(confirm(`¿Eliminar ${name}?`)) mutation.mutate({ fertilizerId: id }) }}
      disabled={mutation.isPending}
    >
      <Trash2 className="w-4 h-4" />
    </Button>
  );
}
