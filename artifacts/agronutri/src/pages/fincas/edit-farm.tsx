import { useState } from "react";
import {
  useUpdateFarm,
  useDeleteFarm,
  getListFarmsQueryKey,
  getGetFarmSummaryQueryKey,
  type Farm,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Pencil, Trash2 } from "lucide-react";

const numField = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number().finite().optional(),
);

const editFarmSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  companyName: z.string().optional(),
  municipality: z.string().optional(),
  island: z.string().optional(),
  surfaceHa: numField,
  plantCount: numField,
  variety: z.string().optional(),
  phenologicalStage: z.string().optional(),
  soilType: z.string().optional(),
  weeklyLitresPerPlant: numField,
  maxEcDsM: numField,
  responsibleTechnician: z.string().optional(),
  managementNotes: z.string().optional(),
});

type EditFarmValues = z.infer<typeof editFarmSchema>;

export function EditFarmButton({ farm }: { farm: Farm }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const canDelete = farm.myRole === "owner";

  const form = useForm<EditFarmValues>({
    resolver: zodResolver(editFarmSchema),
    values: {
      name: farm.name ?? "",
      companyName: farm.companyName ?? "",
      municipality: farm.municipality ?? "",
      island: farm.island ?? "",
      surfaceHa: farm.surfaceHa ?? undefined,
      plantCount: farm.plantCount ?? undefined,
      variety: farm.variety ?? "",
      phenologicalStage: farm.phenologicalStage ?? "",
      soilType: farm.soilType ?? "",
      weeklyLitresPerPlant: farm.weeklyLitresPerPlant ?? undefined,
      maxEcDsM: farm.maxEcDsM ?? undefined,
      responsibleTechnician: farm.responsibleTechnician ?? "",
      managementNotes: farm.managementNotes ?? "",
    },
  });

  const updateMutation = useUpdateFarm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Finca actualizada" });
        queryClient.invalidateQueries({ queryKey: getGetFarmSummaryQueryKey(farm.id) });
        queryClient.invalidateQueries({ queryKey: getListFarmsQueryKey() });
        setOpen(false);
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({
          title: "No se pudo actualizar la finca",
          description: msg ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteFarm({
    mutation: {
      onSuccess: () => {
        toast({ title: "Finca eliminada", description: `«${farm.name}» y todos sus datos se han eliminado.` });
        queryClient.invalidateQueries({ queryKey: getListFarmsQueryKey() });
        setLocation("/");
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({
          title: "No se pudo eliminar la finca",
          description: msg ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
      },
    },
  });

  const numericKeys = ["surfaceHa", "plantCount", "weeklyLitresPerPlant", "maxEcDsM"] as const;

  const onSubmit = (values: EditFarmValues) => {
    // Trim strings; for numeric fields, an emptied input means "clear the value" → send null.
    const clean = Object.fromEntries(
      Object.entries(values).map(([k, v]) => {
        if (typeof v === "string") return [k, v.trim()];
        if ((numericKeys as readonly string[]).includes(k) && v == null) return [k, null];
        return [k, v];
      }),
    );
    updateMutation.mutate({ farmId: farm.id, data: clean });
  };

  const textField = (
    name: keyof EditFarmValues,
    label: string,
    placeholder = "",
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input placeholder={placeholder} {...field} value={(field.value as string | number | undefined) ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const numberField = (name: keyof EditFarmValues, label: string, step = "any") => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              step={step}
              {...field}
              value={(field.value as number | undefined) ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 shrink-0">
          <Pencil className="w-4 h-4" /> Editar finca
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar datos de la finca</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {textField("name", "Nombre de la finca *")}
            <div className="grid grid-cols-2 gap-4">
              {textField("companyName", "Empresa / titular")}
              {textField("responsibleTechnician", "Técnico responsable")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {textField("municipality", "Municipio")}
              {textField("island", "Isla")}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {numberField("surfaceHa", "Superficie (ha)")}
              {numberField("plantCount", "Nº plantas", "1")}
              {numberField("weeklyLitresPerPlant", "L/planta/semana")}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {textField("variety", "Variedad", "Pequeña enana...")}
              {textField("phenologicalStage", "Fase fenológica", "pre-parición...")}
              {numberField("maxEcDsM", "CE máx. (dS/m)")}
            </div>
            {textField("soilType", "Tipo de suelo")}
            <FormField
              control={form.control}
              name="managementNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas de manejo</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex items-center justify-between pt-2 gap-4">
              {canDelete ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" className="gap-2" disabled={deleteMutation.isPending}>
                      <Trash2 className="w-4 h-4" />
                      {deleteMutation.isPending ? "Eliminando..." : "Eliminar finca"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar la finca «{farm.name}»?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminarán de forma permanente la finca y todos sus datos asociados:
                        sectores, analíticas, programas de abonado, conversaciones, informes y miembros.
                        Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => deleteMutation.mutate({ farmId: farm.id })}
                      >
                        Sí, eliminar definitivamente
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
