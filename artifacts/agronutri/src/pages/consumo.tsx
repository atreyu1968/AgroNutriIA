import { useGetUsage } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatDateTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, Coins, Cpu, FileText, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ConsumoIA() {
  const { data: usage, isLoading } = useGetUsage();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Consumo de IA</h1>
        <p className="text-muted-foreground mt-1">Monitorización del uso y costes de OpenAI de este mes.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : usage ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-primary shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex justify-between">
                  Consultas <MessageSquare className="w-4 h-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{usage.queries}</div>
              </CardContent>
            </Card>
            
            <Card className="border-l-4 border-l-secondary shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex justify-between">
                  Informes Generados <FileText className="w-4 h-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{usage.reports}</div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-amber-500 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex justify-between">
                  Tokens Totales <Cpu className="w-4 h-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatNumber((usage.inputTokens + usage.outputTokens)/1000, 1)}k</div>
                <div className="text-xs text-muted-foreground mt-1 flex gap-2">
                  <span className="text-blue-600/70">In: {formatNumber(usage.inputTokens, 0)}</span>
                  <span className="text-green-600/70">Out: {formatNumber(usage.outputTokens, 0)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-destructive shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex justify-between">
                  Coste Estimado <Coins className="w-4 h-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-2">
                  <div className="text-3xl font-bold text-destructive">{formatNumber(usage.estimatedCostEur, 3)}€</div>
                  {usage.monthlyLimitEur && (
                    <div className="text-sm text-muted-foreground mb-1">/ {usage.monthlyLimitEur}€</div>
                  )}
                </div>
                {usage.limitUsedPct && (
                  <div className="w-full bg-muted rounded-full h-1.5 mt-3 overflow-hidden">
                    <div 
                      className={`h-1.5 rounded-full ${usage.limitUsedPct > 80 ? 'bg-destructive' : 'bg-primary'}`} 
                      style={{ width: `${Math.min(usage.limitUsedPct, 100)}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-8 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" /> Registro de Operaciones
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Finca</TableHead>
                    <TableHead>Operación</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Coste</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.entries.length > 0 ? (
                    usage.entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs">{formatDateTime(entry.createdAt)}</TableCell>
                        <TableCell className="font-medium">{entry.farmName || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={entry.operation === 'chat' ? 'bg-blue-500/10 text-blue-700' : 'bg-amber-500/10 text-amber-700'}>
                            {entry.operation}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{entry.model}</TableCell>
                        <TableCell className="text-right text-xs">
                          {(entry.inputTokens || 0) + (entry.outputTokens || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatNumber(entry.estimatedCostEur, 4)}€
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No hay registros en este mes.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
