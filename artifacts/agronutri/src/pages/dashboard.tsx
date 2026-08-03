import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Sprout, ListChecks, Euro, AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: dashboard, isLoading } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (!dashboard) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard General</h1>
        <p className="text-muted-foreground mt-2">Visión global de tus fincas y actividad reciente.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fincas Gestionadas</CardTitle>
            <MapPin className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.farmCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Con {dashboard.sectorCount || 0} sectores en total</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Plantas</CardTitle>
            <svg className="w-4 h-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatNumber(dashboard.totalPlants, 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">Estimación en producción</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500 hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recomendaciones Pendientes</CardTitle>
            <ListChecks className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.pendingRecommendations}</div>
            <p className="text-xs text-muted-foreground mt-1">Requieren revisión</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-accent-foreground hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Coste IA del Mes</CardTitle>
            <Euro className="w-4 h-4 text-accent-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatNumber(dashboard.aiCostThisMonthEur, 2)}€</div>
            <p className="text-xs text-muted-foreground mt-1">Estimación actual</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Actividad Reciente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.recentActivity && dashboard.recentActivity.length > 0 ? (
              <div className="space-y-4">
                {dashboard.recentActivity.map((activity) => (
                  <div key={activity.id} className="flex gap-4 items-start pb-4 border-b last:border-0 last:pb-0">
                    <div className="w-2 h-2 mt-2 rounded-full bg-primary shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {activity.userName} <span className="text-muted-foreground font-normal">ha {translateAction(activity.action)}</span> {activity.detail && <span className="text-muted-foreground font-normal">({activity.detail})</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{formatDateTime(activity.createdAt)}</span>
                        {activity.farmName && (
                          <>
                            <span>•</span>
                            <span className="font-medium text-secondary">{activity.farmName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p>No hay actividad reciente.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-md border-t-4 border-t-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Alertas y Avisos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.alerts && dashboard.alerts.length > 0 ? (
              <ul className="space-y-3">
                {dashboard.alerts.map((alert, i) => (
                  <li key={i} className="flex gap-3 text-sm p-3 bg-destructive/10 text-destructive-foreground/90 rounded-md border border-destructive/20">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                    <span>{alert}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <ShieldCheck className="w-12 h-12 text-primary/20 mb-3" />
                <p className="text-sm font-medium text-foreground">Todo en orden</p>
                <p className="text-xs mt-1">No hay alertas activas en tus fincas.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function translateAction(action: string) {
  const map: Record<string, string> = {
    'create': 'creado',
    'update': 'actualizado',
    'delete': 'eliminado',
    'login': 'iniciado sesión',
    'status_change': 'cambiado el estado',
  };
  return map[action] || action;
}
