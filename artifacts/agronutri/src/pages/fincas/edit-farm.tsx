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
import { Switch } from "@/components/ui/switch";
import { Pencil, Trash2 } from "lucide-react";

/** Rangos orientativos por defecto (g/planta/semana), espejo de los del servidor. */
const DEFAULT_STAGE_RANGES: { key: string; label: string; n: [number, number]; k2o: [number, number] }[] = [
  { key: "prefloracion", label: "Pre-floración / parición", n: [15, 25], k2o: [25, 40] },
  { key: "engorde", label: "Engorde / llenado del racimo", n: [10, 18], k2o: [30, 50] },
  { key: "paron", label: "Parón invernal", n: [3, 8], k2o: [5, 15] },
  { key: "postcosecha", label: "Postcosecha / arranque vegetativo", n: [12, 20], k2o: [15, 30] },
];

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
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z
    .string()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Email no válido"),
  managementNotes: z.string().optional(),
});

type EditFarmValues = z.infer<typeof editFarmSchema>;

export function EditFarmButton({ farm }: { farm: Farm }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const canDelete = farm.myRole === "owner";
  const savedRanges = (farm as { stageNutrientRanges?: Record<string, { n: number[]; k2o: number[] }> | null })
    .stageNutrientRanges;
  const [customRanges, setCustomRanges] = useState(!!savedRanges);
  // Los valores se guardan como texto para poder detectar campos vacíos o no numéricos.
  const [ranges, setRanges] = useState<Record<string, { n: [string, string]; k2o: [string, string] }>>(() =>
    Object.fromEntries(
      DEFAULT_STAGE_RANGES.map((d) => {
        const s = savedRanges?.[d.key];
        const toStr = (pair: number[]) => [String(pair[0]), String(pair[1])] as [string, string];
        return [
          d.key,
          {
            n: s?.n?.length === 2 ? toStr(s.n) : toStr(d.n),
            k2o: s?.k2o?.length === 2 ? toStr(s.k2o) : toStr(d.k2o),
          },
        ];
      }),
    ),
  );
  const setRangeVal = (key: string, nutrient: "n" | "k2o", idx: 0 | 1, value: string) =>
    setRanges((prev) => {
      const cur = prev[key];
      const next = [...cur[nutrient]] as [string, string];
      next[idx] = value;
      return { ...prev, [key]: { ...cur, [nutrient]: next } };
    });

  const parseRangeVal = (s: string): number | null => {
    if (s.trim() === "") return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  /** Espejo de validStageRange del servidor: devuelve errores por campo y de rango. */
  const rangePairError = ([minS, maxS]: [string, string]): {
    fields: [boolean, boolean];
    message: string | null;
  } => {
    const min = parseRangeVal(minS);
    const max = parseRangeVal(maxS);
    const minBad = min == null || min < 0;
    const maxBad = max == null || max < 0;
    if (minBad || maxBad) {
      return {
        fields: [minBad, maxBad],
        message: "Introduce un número igual o mayor que 0.",
      };
    }
    if ((min as number) > (max as number)) {
      return { fields: [true, true], message: "El mínimo no puede superar el máximo." };
    }
    return { fields: [false, false], message: null };
  };
  const rangeErrors: Record<string, { n: ReturnType<typeof rangePairError>; k2o: ReturnType<typeof rangePairError> }> =
    Object.fromEntries(
      DEFAULT_STAGE_RANGES.map((d) => [
        d.key,
        { n: rangePairError(ranges[d.key].n), k2o: rangePairError(ranges[d.key].k2o) },
      ]),
    );
  const rangesValid =
    !customRanges ||
    DEFAULT_STAGE_RANGES.every(
      (d) => !rangeErrors[d.key].n.message && !rangeErrors[d.key].k2o.message,
    );

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
      contactName: farm.contactName ?? "",
      contactPhone: farm.contactPhone ?? "",
      contactEmail: farm.contactEmail ?? "",
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
    if (!rangesValid) {
      toast({
        title: "Rangos por fase no válidos",
        description: "Revisa los campos marcados en rojo antes de guardar.",
        variant: "destructive",
      });
      return;
    }
    const numericRanges = Object.fromEntries(
      DEFAULT_STAGE_RANGES.map((d) => [
        d.key,
        {
          n: [Number(ranges[d.key].n[0]), Number(ranges[d.key].n[1])] as [number, number],
          k2o: [Number(ranges[d.key].k2o[0]), Number(ranges[d.key].k2o[1])] as [number, number],
        },
      ]),
    );
    updateMutation.mutate({
      farmId: farm.id,
      data: { ...clean, stageNutrientRanges: customRanges ? numericRanges : null },
    });
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
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Rangos por fase fenológica (g/planta/semana)</p>
                  <p className="text-xs text-muted-foreground">
                    Por defecto se usan rangos orientativos generales de platanera. Actívalo para que el técnico
                    los module para esta finca; se aplican en la calculadora, los avisos y los informes.
                  </p>
                </div>
                <Switch
                  checked={customRanges}
                  onCheckedChange={setCustomRanges}
                  data-testid="switch-custom-stage-ranges"
                />
              </div>
              {customRanges && (
                <div className="space-y-2">
                  <div className="grid grid-cols-5 gap-2 text-xs text-muted-foreground">
                    <span>Fase</span>
                    <span>N mín</span>
                    <span>N máx</span>
                    <span>K₂O mín</span>
                    <span>K₂O máx</span>
                  </div>
                  {DEFAULT_STAGE_RANGES.map((d) => {
                    const errs = rangeErrors[d.key];
                    const messages = [
                      errs.n.message ? `N: ${errs.n.message}` : null,
                      errs.k2o.message ? `K₂O: ${errs.k2o.message}` : null,
                    ].filter(Boolean);
                    return (
                      <div key={d.key} className="space-y-1">
                        <div className="grid grid-cols-5 gap-2 items-center">
                          <span className="text-xs">{d.label}</span>
                          {([["n", 0], ["n", 1], ["k2o", 0], ["k2o", 1]] as const).map(([nu, idx]) => (
                            <Input
                              key={`${nu}${idx}`}
                              type="number"
                              step="0.5"
                              min={0}
                              value={ranges[d.key][nu][idx]}
                              onChange={(e) => setRangeVal(d.key, nu, idx, e.target.value)}
                              aria-invalid={errs[nu].fields[idx] || undefined}
                              className={
                                errs[nu].fields[idx]
                                  ? "border-destructive focus-visible:ring-destructive"
                                  : undefined
                              }
                              data-testid={`input-range-${d.key}-${nu}-${idx === 0 ? "min" : "max"}`}
                            />
                          ))}
                        </div>
                        {messages.length > 0 && (
                          <p
                            className="text-xs text-destructive text-right"
                            data-testid={`error-range-${d.key}`}
                          >
                            {messages.join(" · ")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium text-muted-foreground">Persona de contacto</p>
              {textField("contactName", "Nombre de contacto")}
              <div className="grid grid-cols-2 gap-4">
                {textField("contactPhone", "Teléfono")}
                {textField("contactEmail", "Email")}
              </div>
            </div>
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
