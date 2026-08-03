import { useState } from "react";
import {
  useListPhytoProducts,
  getListPhytoProductsQueryKey,
  useDeletePhytoProduct,
  useGetMe,
  type PhytoProduct,
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
import { SprayCan, Search, Trash2, Info, AlertTriangle, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/utils";

function isExpired(p: PhytoProduct): boolean {
  return !!p.expiryDate && p.expiryDate < new Date().toISOString().slice(0, 10);
}

export default function FitosanitariosCatalogo() {
  const { data: products, isLoading } = useListPhytoProducts();
  const { data: me } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
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
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto, materia, plaga..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[240px]">Producto</TableHead>
                <TableHead>Nº registro</TableHead>
                <TableHead>Materia activa</TableHead>
                <TableHead className="hidden lg:table-cell">Plagas</TableHead>
                <TableHead className="hidden md:table-cell">Dosis</TableHead>
                <TableHead className="text-center hidden md:table-cell">Máx/año</TableHead>
                <TableHead className="text-center hidden md:table-cell">Plazo seg.</TableHead>
                <TableHead>Autorización</TableHead>
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
              ) : filtered && filtered.length > 0 ? (
                filtered.map((p) => (
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
                    <TableCell className="text-right">
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
