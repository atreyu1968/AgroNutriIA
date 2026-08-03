import { useGetFarmSummary, getGetFarmSummaryQueryKey, useGetFarm } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Droplets, MapPin, Sprout, TestTube, FileText, Settings, Users, ArrowRight, Calculator } from "lucide-react";
import { formatNumber, formatDate } from "@/lib/utils";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

import { SectorsTab, AnalysesTab, RecommendationsTab, ReportsTab, MembersTab, ConfigTab } from "./detail-tabs";
import CalculadoraTab from "@/pages/calculadora";

export default function FincaDetail() {
  const [match, params] = useRoute("/fincas/:id");
  const farmId = match && params.id ? parseInt(params.id, 10) : null;

  const { data: summary, isLoading, error } = useGetFarmSummary(farmId as number, { 
    query: { queryKey: getGetFarmSummaryQueryKey(farmId as number), enabled: !!farmId } 
  });

  if (!farmId) return <div>Finca no encontrada</div>;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Tabs defaultValue="resumen">
          <TabsList>
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-8 w-24 mx-1" />)}
          </TabsList>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
             <Skeleton className="h-64 col-span-2" />
             <Skeleton className="h-64" />
          </div>
        </Tabs>
      </div>
    );
  }

  if (error || !summary) {
    return <div className="text-destructive">Error al cargar los datos de la finca.</div>;
  }

  const { farm } = summary;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{farm.name}</h1>
            <Badge variant="outline" className="text-xs bg-muted/50">{farm.myRole}</Badge>
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            <MapPin className="w-4 h-4" /> 
            {farm.municipality || 'Sin municipio'}, {farm.island || 'Sin isla'} 
            {farm.surfaceHa ? ` • ${farm.surfaceHa} Ha` : ''}
          </p>
        </div>
        
        <Button className="gap-2 shrink-0 shadow-md" asChild>
          <Link href={`/fincas/${farmId}/tecnico`}>
            <Sprout className="w-4 h-4" />
            Consultar al Técnico Virtual
            <ArrowRight className="w-4 h-4 ml-1 opacity-70" />
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="resumen" className="w-full">
        <div className="overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-12 items-center justify-start min-w-max">
            <TabsTrigger value="resumen" className="gap-2"><MapPin className="w-4 h-4" /> Resumen</TabsTrigger>
            <TabsTrigger value="sectores" className="gap-2"><Droplets className="w-4 h-4" /> Sectores</TabsTrigger>
            <TabsTrigger value="analiticas" className="gap-2"><TestTube className="w-4 h-4" /> Analíticas</TabsTrigger>
            <TabsTrigger value="recomendaciones" className="gap-2"><Sprout className="w-4 h-4" /> Nutrición</TabsTrigger>
            <TabsTrigger value="calculadora" className="gap-2"><Calculator className="w-4 h-4" /> Calculadora</TabsTrigger>
            <TabsTrigger value="informes" className="gap-2"><FileText className="w-4 h-4" /> Informes</TabsTrigger>
            <TabsTrigger value="miembros" className="gap-2"><Users className="w-4 h-4" /> Miembros</TabsTrigger>
            {farm.myRole === 'owner' && (
              <TabsTrigger value="config" className="gap-2"><Settings className="w-4 h-4" /> API</TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="resumen" className="space-y-6 mt-6 focus-visible:outline-none focus-visible:ring-0">
          
          {summary.alerts && summary.alerts.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5" /> Alertas Activas
              </h3>
              <ul className="space-y-1 list-disc list-inside pl-5 text-sm text-destructive">
                {summary.alerts.map((alert, i) => <li key={i}>{alert}</li>)}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2 shadow-sm border-t-4 border-t-primary">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Estado Agronómico</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Cultivo</span>
                  <p className="font-medium">{farm.mainCrop || 'Platanera'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Fase</span>
                  <p className="font-medium">{farm.phenologicalStage || '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Plantas</span>
                  <p className="font-medium">{formatNumber(farm.plantCount, 0)}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Agua Semanal</span>
                  <p className="font-medium">{summary.weeklyWaterM3 ? `${formatNumber(summary.weeklyWaterM3)} m³` : '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">L/planta/sem</span>
                  <p className="font-medium">{farm.weeklyLitresPerPlant || '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Suelo</span>
                  <p className="font-medium">{farm.soilType || '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">CE Max</span>
                  <p className="font-medium">{farm.maxEcDsM ? `${farm.maxEcDsM} dS/m` : '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Técnico</span>
                  <p className="font-medium truncate" title={farm.responsibleTechnician || ''}>{farm.responsibleTechnician || '-'}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Recomendación Actual</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.activeRecommendation ? (
                  <div className="space-y-4">
                    <div>
                      <Badge variant="success" className="mb-2">En aplicación</Badge>
                      <p className="font-medium">{summary.activeRecommendation.title || 'Programa semanal'}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Desde: {formatDate(summary.activeRecommendation.createdAt)}
                      </p>
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      {summary.activeRecommendation.items.slice(0, 3).map((item, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-muted-foreground truncate mr-2" title={item.fertilizerName}>{item.fertilizerName}</span>
                          <span className="font-medium shrink-0">{item.weeklyDose} {item.unit}</span>
                        </div>
                      ))}
                      {summary.activeRecommendation.items.length > 3 && (
                        <div className="text-xs text-center text-muted-foreground pt-1">
                          + {summary.activeRecommendation.items.length - 3} fertilizantes más
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <Sprout className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No hay programa activo</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <AnalysisSummaryCard title="Último Análisis Suelo" analysis={summary.latestSoilAnalysis} type="soil" />
            <AnalysisSummaryCard title="Último Análisis Foliar" analysis={summary.latestLeafAnalysis} type="leaf" />
            <AnalysisSummaryCard title="Último Análisis Agua" analysis={summary.latestWaterAnalysis} type="water" />
          </div>

        </TabsContent>

        <TabsContent value="sectores"><SectorsTab farmId={farmId} /></TabsContent>
        <TabsContent value="analiticas"><AnalysesTab farmId={farmId} canEdit={farm.myRole === 'owner' || farm.myRole === 'technician'} /></TabsContent>
        <TabsContent value="recomendaciones"><RecommendationsTab farmId={farmId} /></TabsContent>
        <TabsContent value="calculadora"><CalculadoraTab farmId={farmId} defaultPlantCount={farm.plantCount} defaultWeeklyLitres={farm.weeklyLitresPerPlant} /></TabsContent>
        <TabsContent value="informes"><ReportsTab farmId={farmId} /></TabsContent>
        <TabsContent value="miembros"><MembersTab farmId={farmId} /></TabsContent>
        {farm.myRole === 'owner' && <TabsContent value="config"><ConfigTab farmId={farmId} /></TabsContent>}
      </Tabs>
    </div>
  );
}

function AnalysisSummaryCard({ title, analysis, type }: { title: string, analysis: any, type: string }) {
  if (!analysis) {
    return (
      <Card className="shadow-sm border-dashed border-2 bg-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <TestTube className="w-8 h-8 mb-2 opacity-20" />
          <span className="text-sm">Sin datos recientes</span>
        </CardContent>
      </Card>
    );
  }

  // Get a few key parameters based on type
  const keyParams = analysis.parameters.slice(0, 4);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <span className="text-xs text-muted-foreground">{formatDate(analysis.sampleDate)}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-y-3 gap-x-2 mt-2">
          {keyParams.map((p: any, i: number) => (
            <div key={i} className="flex flex-col">
              <span className="text-[10px] text-muted-foreground uppercase">{p.name}</span>
              <span className="text-sm font-semibold">
                {p.value} <span className="text-xs font-normal text-muted-foreground">{p.unit}</span>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
