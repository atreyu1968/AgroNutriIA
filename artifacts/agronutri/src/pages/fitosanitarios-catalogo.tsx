import { useState } from "react";
import {
  useListPhytoProducts,
  getListPhytoProductsQueryKey,
  useDeletePhytoProduct,
  useRefreshPhytoProducts,
  useSplitPhytoProduct,
  useSplitAllPhytoProducts,
  useCreatePhytoProduct,
  useUpdatePhytoProduct,
  useGetMe,
  type PhytoProduct,
  type PhytoProductCreate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { SprayCan, Search, Trash2, Info, AlertTriangle, ExternalLink, RefreshCw, Plus, Pencil, CalendarIcon, X, ArrowUp, ArrowDown, ArrowUpDown, Ungroup } from "lucide-react";

function SortableHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === k;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none"
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        <Icon className={`w-3.5 h-3.5 ${active ? "" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

type SortKey =
  | "productName"
  | "registryNumber"
  | "activeIngredient"
  | "maxApplicationsYear"
  | "safetyDays"
  | "expiryDate";
import { formatDate, cn } from "@/lib/utils";

function isExpired(p: PhytoProduct): boolean {
  return !!p.expiryDate && p.expiryDate < new Date().toISOString().slice(0, 10);
}

function splitNames(productName: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of productName.split(/[,;/]/)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
export default function FitosanitariosCatalogo() {
  const { data: products, isLoading } = useListPhytoProducts();
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("productName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [splitProduct, setSplitProduct] = useState<PhytoProduct | null>(null);
  const [splitAllOpen, setSplitAllOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<PhytoProduct | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const q = search.toLowerCase();
  const filtered = products?.filter(
    (p) =>
      p.productName.toLowerCase().includes(q) ||
      (p.activeIngredient ?? "").toLowerCase().includes(q) ||
      (p.pests ?? "").toLowerCase().includes(q) ||
      (p.registryNumber ?? "").toLowerCase().includes(q),
  );

  // Ordenación por cabecera: clic alterna ascendente/descendente.
  const sortValue = (p: PhytoProduct, key: SortKey): string | number | null => {
    switch (key) {
      case "productName":
        return p.productName;
      case "registryNumber":
        return p.registryNumber ?? null;
      case "activeIngredient":
        return p.activeIngredient ?? null;
      case "maxApplicationsYear":
        return p.maxApplicationsYear ?? null;
      case "safetyDays":
        return p.safetyDays ?? null;
      case "expiryDate":
        return p.expiryDate ?? null;
    }
  };
  const sorted = filtered
    ? [...filtered].sort((a, b) => {
        const va = sortValue(a, sortKey);
        const vb = sortValue(b, sortKey);
        // Los valores vacíos siempre al final, sea cual sea el sentido.
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        const cmp =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const canEdit = !!(me?.isAdmin || me?.role === "owner" || me?.role === "technician");

  const refreshMutation = useRefreshPhytoProducts({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
        if (r.processed === 0) {
          toast({ title: "Catálogo al día", description: "No hay productos con datos pendientes de completar." });
        } else {
          const parts = [`${r.updated} actualizado(s)`];
          if (r.skipped) parts.push(`${r.skipped} omitido(s)`);
          toast({
            title: "Catálogo actualizado",
            description:
              parts.join(", ") +
              (r.remaining > 0
                ? `. Quedan ${r.remaining} por completar: pulsa de nuevo para continuar.`
                : ". Todos los productos están completos."),
          });
        }
      },
      onError: (err) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo actualizar", description: msg, variant: "destructive" });
      },
    },
  });

  const splitMutation = useSplitPhytoProduct({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
        setSplitProduct(null);
        toast({
          title: "Ficha dividida",
          description:
            `Ahora hay ${r.products.length} ficha(s): ${r.products.map((p) => p.productName).join(", ")}.` +
            (r.skippedNames.length
              ? ` Ya existían y no se han duplicado: ${r.skippedNames.join(", ")}.`
              : "") +
            ' Usa "Actualizar con IA" para completar el nº de registro y la fecha de cada marca.',
        });
      },
      onError: (err) => {
        setSplitProduct(null);
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo dividir la ficha", description: msg, variant: "destructive" });
      },
    },
  });

  // Fichas cuyo nombre agrupa varias marcas; sobre todas ellas actúa "Dividir todas".
  const groupedProducts = products?.filter((p) => splitNames(p.productName).length > 1) ?? [];

  const splitAllMutation = useSplitAllPhytoProducts({
    mutation: {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
        setSplitAllOpen(false);
        if (r.totalGrouped === 0) {
          toast({ title: "Nada que dividir", description: "No hay fichas que agrupen varios nombres comerciales." });
          return;
        }
        const parts: string[] = [`${r.splitProducts.length} de ${r.totalGrouped} ficha(s) divididas`];
        if (r.skippedNames.length) {
          parts.push(`nombres omitidos por existir ya: ${r.skippedNames.join(", ")}`);
        }
        if (r.notOwned.length) {
          parts.push(`sin permiso para modificar (no divididas): ${r.notOwned.join(", ")}`);
        }
        toast({
          title: "División completada",
          description:
            parts.join(". ") +
            '. Usa "Actualizar con IA" para completar el nº de registro y la fecha de cada marca.',
        });
      },
      onError: (err) => {
        setSplitAllOpen(false);
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudieron dividir las fichas", description: msg, variant: "destructive" });
      },
    },
  });

  const deleteMutation = useDeletePhytoProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
        setDeleteId(null);
        toast({ title: "Producto eliminado del catálogo" });
      },
      onError: (err) => {
        setDeleteId(null);
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: "No se pudo eliminar", description: msg, variant: "destructive" });
      },
    },
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catálogo de Fitosanitarios</h1>
          <p className="text-muted-foreground mt-1">
            Productos con autorización verificada en platanera. El asesor IA lo alimenta y lo consulta al recomendar tratamientos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto, materia, plaga..."
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {canEdit && groupedProducts.length > 0 && (
            <Button
              variant="outline"
              className="shrink-0 gap-2"
              onClick={() => setSplitAllOpen(true)}
              disabled={splitAllMutation.isPending}
            >
              <Ungroup className="w-4 h-4" />
              {splitAllMutation.isPending ? "Dividiendo..." : `Dividir todas (${groupedProducts.length})`}
            </Button>
          )}
          {canEdit && (
            <Button
              variant="outline"
              className="shrink-0 gap-2"
              onClick={() => refreshMutation.mutate({ data: {} })}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              {refreshMutation.isPending ? "Actualizando..." : "Actualizar con IA"}
            </Button>
          )}
          <Button
            className="shrink-0 gap-2"
            onClick={() => {
              setEditProduct(null);
              setFormOpen(true);
            }}
          >
            <Plus className="w-4 h-4" /> Nuevo producto
          </Button>
        </div>
      </div>

      {canEdit && (
        <p className="text-sm text-muted-foreground -mt-2">
          "Actualizar con IA" busca en el Registro del MAPA y en Sanidad Vegetal de Canarias los datos que faltan
          (nº de registro, fin de autorización, dosis y plazo de seguridad) y completa la tabla por tandas.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <SortableHead label="Producto" k="productName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-[240px]" />
                <SortableHead label="Nº registro" k="registryNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHead label="Materia activa" k="activeIngredient" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead className="hidden lg:table-cell">Plagas</TableHead>
                <TableHead className="hidden md:table-cell">Dosis</TableHead>
                <SortableHead label="Máx/año" k="maxApplicationsYear" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="text-center hidden md:table-cell" />
                <SortableHead label="Plazo seg." k="safetyDays" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="text-center hidden md:table-cell" />
                <SortableHead label="Autorización" k="expiryDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j} className={j >= 3 && j <= 6 ? "hidden md:table-cell" : ""}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sorted && sorted.length > 0 ? (
                sorted.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <SprayCan className="w-4 h-4 text-muted-foreground shrink-0" />
                        {p.productName}
                        {p.exceptional && (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-500/30">
                            Excepcional
                          </Badge>
                        )}
                        {(p.notes || p.sourceUrl || p.lastVerifiedAt || p.createdByName) && <ProductInfo product={p} />}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{p.registryNumber || "—"}</TableCell>
                    <TableCell className="text-sm">{p.activeIngredient || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[220px] truncate" title={p.pests ?? undefined}>
                      {p.pests || "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm max-w-[160px] truncate" title={p.doseInfo ?? undefined}>
                      {p.doseInfo || "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono hidden md:table-cell">{p.maxApplicationsYear ?? "—"}</TableCell>
                    <TableCell className="text-center font-mono hidden md:table-cell">
                      {p.safetyDays != null ? `${p.safetyDays} d` : "—"}
                    </TableCell>
                    <TableCell>
                      {p.expiryDate ? (
                        isExpired(p) ? (
                          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/30 gap-1">
                            <AlertTriangle className="w-3 h-3" /> Caducada {formatDate(p.expiryDate)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                            Hasta {formatDate(p.expiryDate)}
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted-foreground text-sm">Sin fecha</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canEdit && splitNames(p.productName).length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSplitProduct(p)}
                          aria-label={`Dividir ${p.productName} en una ficha por marca`}
                          title="Dividir en una ficha por marca"
                        >
                          <Ungroup className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditProduct(p);
                          setFormOpen(true);
                        }}
                        aria-label={`Editar ${p.productName}`}
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)} aria-label={`Eliminar ${p.productName}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    {search
                      ? "No se encontraron productos con esa búsqueda"
                      : "El catálogo está vacío. Se irá llenando con los productos que el asesor IA verifique en el Registro del MAPA."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductFormDialog
        key={editProduct?.id ?? "new"}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditProduct(null);
        }}
        product={editProduct}
      />

      <AlertDialog open={splitProduct != null} onOpenChange={(open) => !open && setSplitProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dividir esta ficha en una por marca?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Esta ficha agrupa varios nombres comerciales. Se creará una ficha por marca,
                  conservando la materia activa, las plagas y las notas comunes:
                </p>
                <ul className="list-disc pl-5">
                  {splitProduct && splitNames(splitProduct.productName).map((n) => <li key={n}>{n}</li>)}
                </ul>
                <p>
                  El nº de registro y la fecha de autorización son propios de cada marca:
                  complétalos después con "Actualizar con IA".
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={splitMutation.isPending}
              onClick={() => splitProduct && splitMutation.mutate({ productId: splitProduct.id })}
            >
              {splitMutation.isPending ? "Dividiendo..." : "Dividir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={splitAllOpen} onOpenChange={setSplitAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dividir todas las fichas agrupadas?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Hay {groupedProducts.length} ficha(s) cuyo nombre agrupa varias marcas. Cada una se
                  dividirá en una ficha por marca, conservando la materia activa, las plagas y las
                  notas comunes.
                </p>
                <p>
                  Los nombres que ya existan en el catálogo se omitirán y las fichas que no puedas
                  modificar se saltarán. Al terminar verás un resumen.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={splitAllMutation.isPending}
              onClick={() => splitAllMutation.mutate()}
            >
              {splitAllMutation.isPending ? "Dividiendo..." : "Dividir todas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este producto del catálogo?</AlertDialogTitle>
            <AlertDialogDescription>
              El asesor IA dejará de considerarlo verificado y tendrá que volver a comprobarlo en el Registro si se consulta de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId != null && deleteMutation.mutate({ productId: deleteId })}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const productSchema = z.object({
  productName: z.string().trim().min(1, "El nombre es obligatorio").max(200),
  registryNumber: z.string().trim().max(50).optional(),
  activeIngredient: z.string().trim().max(200).optional(),
  pests: z.string().trim().max(500).optional(),
  doseInfo: z.string().trim().max(500).optional(),
  maxApplicationsYear: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  safetyDays: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  expiryDate: z.date().optional(),
  exceptional: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine((v) => !v || /^https?:\/\/\S+$/.test(v), "Debe ser una URL http(s) válida"),
});
function ProductInfo({ product: p }: { product: PhytoProduct }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Detalles de ${p.productName}`}>
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm space-y-2">
        {p.notes && <p>{p.notes}</p>}
        {p.lastVerifiedAt && (
          <p className="text-muted-foreground">Verificado el {formatDate(p.lastVerifiedAt.slice(0, 10))}</p>
        )}
        {p.createdByName && <p className="text-muted-foreground">Añadido por {p.createdByName}</p>}
        {p.sourceUrl && /^https?:\/\//.test(p.sourceUrl) && (
          <a
            href={p.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Fuente oficial <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}

function toLocalIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ProductFormDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: PhytoProduct | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = product != null;

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      productName: product?.productName ?? "",
      registryNumber: product?.registryNumber ?? "",
      activeIngredient: product?.activeIngredient ?? "",
      pests: product?.pests ?? "",
      doseInfo: product?.doseInfo ?? "",
      maxApplicationsYear: product?.maxApplicationsYear ?? "",
      safetyDays: product?.safetyDays ?? "",
      expiryDate: product?.expiryDate ? parseLocalDate(product.expiryDate) : undefined,
      exceptional: product?.exceptional ?? false,
      notes: product?.notes ?? "",
      sourceUrl: product?.sourceUrl ?? "",
    },
  });

  const onSaved = (title: string) => {
    queryClient.invalidateQueries({ queryKey: getListPhytoProductsQueryKey() });
    toast({ title });
    form.reset();
    onOpenChange(false);
  };
  const onError = (err: unknown) => {
    const msg = (err as { data?: { error?: string } })?.data?.error;
    toast({ title: "No se pudo guardar el producto", description: msg, variant: "destructive" });
  };

  const createMutation = useCreatePhytoProduct({
    mutation: { onSuccess: () => onSaved("Producto añadido al catálogo"), onError },
  });
  const updateMutation = useUpdatePhytoProduct({
    mutation: { onSuccess: () => onSaved("Producto actualizado"), onError },
  });
  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (v: ProductFormValues) => {
    const data: PhytoProductCreate = {
      productName: v.productName,
      registryNumber: v.registryNumber || null,
      activeIngredient: v.activeIngredient || null,
      pests: v.pests || null,
      doseInfo: v.doseInfo || null,
      maxApplicationsYear: v.maxApplicationsYear === "" || v.maxApplicationsYear == null ? null : v.maxApplicationsYear,
      safetyDays: v.safetyDays === "" || v.safetyDays == null ? null : v.safetyDays,
      expiryDate: v.expiryDate ? toLocalIsoDate(v.expiryDate) : null,
      exceptional: v.exceptional,
      notes: v.notes || null,
      sourceUrl: v.sourceUrl || null,
    };
    if (isEdit) {
      updateMutation.mutate({ productId: product.id, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar ${product.productName}` : "Nuevo producto fitosanitario"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control} name="productName"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Nombre comercial *</FormLabel>
                    <FormControl><Input {...field} placeholder="Ej. Fungicida XYZ" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control} name="registryNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nº registro MAPA</FormLabel>
                    <FormControl><Input {...field} placeholder="Ej. 25519" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control} name="activeIngredient"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Materia activa</FormLabel>
                  <FormControl><Input {...field} placeholder="Ej. Azoxistrobin 25%" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control} name="pests"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plagas autorizadas</FormLabel>
                  <FormControl><Input {...field} placeholder="Ej. Sigatoka, picudo, araña roja" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control} name="doseInfo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dosis</FormLabel>
                    <FormControl><Input {...field} placeholder="Ej. 150 ml/hl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control} name="maxApplicationsYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Máx. aplicaciones/año</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control} name="safetyDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plazo de seguridad (días)</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <FormField
                control={form.control} name="expiryDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fin de autorización</FormLabel>
                    <div className="flex items-center gap-1">
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? formatDate(toLocalIsoDate(field.value)) : "Sin fecha"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={field.value} onSelect={field.onChange} />
                        </PopoverContent>
                      </Popover>
                      {field.value && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => field.onChange(undefined)}
                          aria-label="Quitar fecha"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control} name="exceptional"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0 pb-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                    </FormControl>
                    <FormLabel className="font-normal cursor-pointer">Autorización excepcional (Canarias)</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control} name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl><Textarea {...field} rows={3} placeholder="Condiciones, limitaciones, islas, intervalos..." /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control} name="sourceUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL de la fuente oficial</FormLabel>
                  <FormControl><Input {...field} placeholder="https://www.mapa.gob.es/..." /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                Si ya existe un producto con el mismo nº de registro o nombre, se actualizarán sus datos.
              </p>
            )}

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

type ProductFormValues = z.infer<typeof productSchema>;

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
