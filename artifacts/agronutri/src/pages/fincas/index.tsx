import { useListFarms, useCreateFarm, getListFarmsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MapPin, Plus, Sprout, ChevronRight, Droplets } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatNumber } from "@/lib/utils";

const createFarmSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  municipality: z.string().optional(),
  island: z.string().optional(),
  surfaceHa: z.coerce.number().optional(),
  plantCount: z.coerce.number().optional(),
});

export default function FincasIndex() {
  const { data: farms, isLoading } = useListFarms();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof createFarmSchema>>({
    resolver: zodResolver(createFarmSchema),
    defaultValues: {
      name: "",
      municipality: "",
      island: "",
    },
  });

  const createFarmMutation = useCreateFarm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Finca creada correctamente" });
        queryClient.invalidateQueries({ queryKey: getListFarmsQueryKey() });
        setOpen(false);
        form.reset();
      },
      onError: () => {
        toast({ title: "Error al crear la finca", variant: "destructive" });
      }
    }
  });

  function onSubmit(values: z.infer<typeof createFarmSchema>) {
    createFarmMutation.mutate({ data: values });
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mis Fincas</h1>
          <p className="text-muted-foreground mt-1">Gestiona tus explotaciones agrícolas de platanera.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0 gap-2">
              <Plus className="w-4 h-4" />
              Nueva Finca
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Añadir Nueva Finca</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre de la Finca *</FormLabel>
                      <FormControl>
                        <Input placeholder="Finca Las plataneras" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="municipality"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Municipio</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej. Los Llanos" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="island"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Isla</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej. La Palma" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="surfaceHa"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Superficie (Ha)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="plantCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nº Plantas</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createFarmMutation.isPending}>
                    {createFarmMutation.isPending ? "Guardando..." : "Guardar Finca"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : farms && farms.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {farms.map(farm => (
            <Link key={farm.id} href={`/fincas/${farm.id}`}>
              <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer group flex flex-col">
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-xl group-hover:text-primary transition-colors line-clamp-1">{farm.name}</CardTitle>
                    <Badge variant={farm.myRole === 'viewer' ? 'secondary' : 'default'} className="shrink-0 ml-2">
                      {roleLabel(farm.myRole)}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {farm.municipality || 'Municipio no definido'} {farm.island ? `(${farm.island})` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    <div className="flex items-center gap-1.5" title="Sectores">
                      <Droplets className="w-4 h-4 text-primary/70" />
                      <span className="font-medium text-foreground">{farm.sectorCount || 0}</span> sec.
                    </div>
                    <div className="flex items-center gap-1.5" title="Plantas">
                      <Sprout className="w-4 h-4 text-secondary/70" />
                      <span className="font-medium text-foreground">{formatNumber(farm.plantCount, 0) || '-'}</span> pl.
                    </div>
                  </div>
                  <div className="flex items-center text-sm font-medium text-primary mt-4 group-hover:underline">
                    Gestionar finca <ChevronRight className="w-4 h-4 ml-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 border-2 border-dashed rounded-xl bg-muted/10">
          <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
          <h3 className="text-lg font-semibold">Aún no tienes fincas</h3>
          <p className="text-muted-foreground max-w-md mx-auto mt-2">
            Crea tu primera finca para empezar a gestionar análisis, sectores y recibir recomendaciones nutricionales.
          </p>
          <Button className="mt-6" onClick={() => setOpen(true)}>Crear Primera Finca</Button>
        </div>
      )}
    </div>
  );
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    owner: "Propietario",
    technician: "Técnico",
    manager: "Encargado",
    viewer: "Consulta"
  };
  return map[role] || role;
}
