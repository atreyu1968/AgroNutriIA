import { useState } from "react";
import { useRunCalculation, useListFertilizers, useListFarms } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, Plus, Trash2, Droplets, FlaskConical, AlertTriangle, ArrowRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ImportAnalysisButton } from "@/pages/fincas/detail-tabs";

export default function Calculadora() {
  const { data: fertilizers } = useListFertilizers();
  const { data: farms } = useListFarms();
  const [selectedFarmId, setSelectedFarmId] = useState<string>("");
  const farmId = selectedFarmId ? parseInt(selectedFarmId, 10) : farms?.[0]?.id ?? null;
  
  const [plantCount, setPlantCount] = useState(1000);
  const [weeklyLitresPerPlant, setWeeklyLitresPerPlant] = useState(150);
  
  const [items, setItems] = useState<Array<{id: number, fertId: string, dose: number}>>([
    { id: Date.now(), fertId: "", dose: 0 }
  ]);

  const calcMutation = useRunCalculation();

  const handleCalculate = () => {
    const validItems = items
      .filter(i => i.fertId && i.dose > 0)
      .map(i => {
        const fert = fertilizers?.find(f => f.id.toString() === i.fertId);
        return {
          fertilizerId: parseInt(i.fertId),
          fertilizerName: fert?.name || "Desconocido",
          weeklyDose: i.dose,
          unit: fert?.formulaType === 'liquid' ? 'L' : 'kg'
        };
      });

    if (validItems.length === 0 || !farmId) return;

    calcMutation.mutate({
      farmId,
      data: {
        plantCount,
        weeklyLitresPerPlant,
        items: validItems
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Motor de Cálculo</h1>
        <p className="text-muted-foreground mt-1">Simulador determinista de aportes nutricionales e incompatibilidades.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Side: Inputs */}
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Droplets className="w-4 h-4 text-primary" /> Parámetros de Riego
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Finca</Label>
                <Select
                  value={farmId != null ? String(farmId) : ""}
                  onValueChange={setSelectedFarmId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una finca" />
                  </SelectTrigger>
                  <SelectContent>
                    {farms?.map(f => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {farmId != null && (
                  <div className="flex items-center gap-2 pt-1">
                    <ImportAnalysisButton farmId={farmId} />
                    <p className="text-xs text-muted-foreground">
                      Sube una analítica en PDF y el técnico virtual incorporará sus datos (agua, suelo, foliar) al cálculo.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Número de Plantas</Label>
                <Input 
                  type="number" 
                  value={plantCount} 
                  onChange={e => setPlantCount(parseInt(e.target.value) || 0)} 
                />
              </div>
              <div className="space-y-2">
                <Label>L/planta/semana</Label>
                <Input 
                  type="number" 
                  value={weeklyLitresPerPlant} 
                  onChange={e => setWeeklyLitresPerPlant(parseInt(e.target.value) || 0)} 
                />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-secondary" /> Plan de Abonado Semanal
              </CardTitle>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setItems([...items, { id: Date.now(), fertId: "", dose: 0 }])}
                className="h-8 gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Añadir
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item, index) => (
                <div key={item.id} className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Fertilizante</Label>
                    <Select 
                      value={item.fertId} 
                      onValueChange={(val) => {
                        const newItems = [...items];
                        newItems[index].fertId = val;
                        setItems(newItems);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {fertilizers?.map(f => (
                          <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1.5">
                    <Label className="text-xs">Dosis</Label>
                    <div className="relative">
                      <Input 
                        type="number" 
                        step="0.5"
                        value={item.dose || ""} 
                        onChange={e => {
                          const newItems = [...items];
                          newItems[index].dose = parseFloat(e.target.value) || 0;
                          setItems(newItems);
                        }} 
                      />
                      <span className="absolute right-3 top-2 text-xs text-muted-foreground">
                        {fertilizers?.find(f => f.id.toString() === item.fertId)?.formulaType === 'liquid' ? 'L' : 'kg'}
                      </span>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:bg-destructive/10 shrink-0 mb-0.5"
                    onClick={() => setItems(items.filter(i => i.id !== item.id))}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}

              <Button 
                className="w-full mt-4" 
                size="lg"
                onClick={handleCalculate}
                disabled={calcMutation.isPending || !items.some(i => i.fertId && i.dose > 0)}
              >
                {calcMutation.isPending ? "Calculando..." : (
                  <>Calcular Aportes <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Results */}
        <div>
          {calcMutation.data ? (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Volumen de Agua</p>
                    <p className="text-2xl font-bold text-primary">{formatNumber(calcMutation.data.weeklyWaterM3)} <span className="text-sm font-normal text-muted-foreground">m³/sem</span></p>
                  </CardContent>
                </Card>
                <Card className="bg-secondary/5 border-secondary/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">CE Estimada</p>
                    <p className="text-2xl font-bold text-secondary">{formatNumber(calcMutation.data.estimatedEcDsM)} <span className="text-sm font-normal text-muted-foreground">dS/m</span></p>
                  </CardContent>
                </Card>
              </div>

              <Card className="shadow-sm">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-lg">Aportes Nutricionales (kg/sem)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-4 sm:grid-cols-5 divide-y divide-x">
                    <NutrientBox label="N Total" value={calcMutation.data.nutrients.n} color="text-blue-600" />
                    <NutrientBox label="N Nitr" value={calcMutation.data.nutrients.nNitric} color="text-blue-500" sub />
                    <NutrientBox label="N Amon" value={calcMutation.data.nutrients.nAmmoniacal} color="text-blue-400" sub />
                    <NutrientBox label="P₂O₅" value={calcMutation.data.nutrients.p2o5} color="text-amber-600" />
                    <NutrientBox label="K₂O" value={calcMutation.data.nutrients.k2o} color="text-red-600" />
                    <NutrientBox label="CaO" value={calcMutation.data.nutrients.cao} color="text-slate-600" />
                    <NutrientBox label="MgO" value={calcMutation.data.nutrients.mgo} color="text-green-600" />
                    <NutrientBox label="SO₃" value={calcMutation.data.nutrients.so3} color="text-yellow-600" />
                    <NutrientBox label="B" value={calcMutation.data.nutrients.b} color="text-purple-600" />
                  </div>
                </CardContent>
              </Card>

              {(calcMutation.data.warnings.length > 0 || calcMutation.data.compatibilityIssues.length > 0) && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="p-4">
                    {calcMutation.data.compatibilityIssues.length > 0 && (
                      <div className="mb-3">
                        <h4 className="font-semibold text-destructive flex items-center gap-2 text-sm mb-1">
                          <AlertTriangle className="w-4 h-4" /> Incompatibilidades Detectadas
                        </h4>
                        <ul className="text-sm list-disc list-inside text-destructive/90 pl-2">
                          {calcMutation.data.compatibilityIssues.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                    {calcMutation.data.warnings.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-amber-600 flex items-center gap-2 text-sm mb-1">
                          <AlertTriangle className="w-4 h-4" /> Avisos
                        </h4>
                        <ul className="text-sm list-disc list-inside text-amber-700/80 pl-2">
                          {calcMutation.data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/10 p-12 text-center min-h-[400px]">
              <Calculator className="w-16 h-16 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground">Resultados del Cálculo</h3>
              <p className="max-w-xs mt-2 text-sm">
                Añade los parámetros y pulsa calcular para ver los aportes semanales de nutrientes y alertas de incompatibilidad.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NutrientBox({ label, value, color, sub = false }: { label: string, value: number, color: string, sub?: boolean }) {
  if (value === 0 && sub) return null;
  
  return (
    <div className={`p-4 flex flex-col items-center justify-center ${sub ? 'bg-muted/30' : ''}`}>
      <span className={`text-xs uppercase tracking-wider mb-1 ${sub ? 'text-muted-foreground' : 'font-medium'}`}>{label}</span>
      <span className={`text-xl font-bold ${value > 0 ? color : 'text-muted-foreground/30'}`}>
        {formatNumber(value, value < 10 ? 2 : 1)}
      </span>
    </div>
  );
}
