import { useGetMe, useUpdateMe, useListCredentials, useCreateCredential, useUpdateCredential, useDeleteCredential, useTestCredential, useGetMobileAppUrl, getListCredentialsQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useEffect } from "react";
import { Key, User, Shield, CheckCircle2, XCircle, Trash2, Edit2, Play, Plus, Smartphone, AlertTriangle } from "lucide-react";

function MobileAppCard() {
  const { data, isLoading } = useGetMobileAppUrl();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-primary" /> AgroNutri Móvil
        </CardTitle>
        <CardDescription>
          Funciona como aplicación web: no necesitas tienda de aplicaciones. Tras abrirla, usa "Añadir a pantalla de inicio" en tu navegador para instalarla como una app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row items-center gap-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : data?.url ? (
          <>
            <div className="bg-white p-3 rounded-lg border shadow-sm">
              <QRCodeSVG value={data.url} size={160} />
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium">Cómo instalarla:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Escanea el QR con la cámara del móvil.</li>
                <li>Se abrirá la aplicación en el navegador.</li>
                <li>En el menú del navegador, elige "Añadir a pantalla de inicio".</li>
              </ol>
              <a href={data.url} target="_blank" rel="noreferrer" className="text-primary underline break-all block pt-1">
                {data.url}
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            La dirección de la aplicación móvil no está disponible en este entorno.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Ajustes() {
  const { data: user } = useGetMe();

  if (!user) return null;

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-muted-foreground mt-1">Gestiona tu perfil y credenciales de inteligencia artificial.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h2 className="text-lg font-semibold mb-2">Perfil de Usuario</h2>
          <p className="text-sm text-muted-foreground">Actualiza tu información personal y preferencias.</p>
        </div>
        <div className="md:col-span-2">
          <ProfileForm user={user} />
        </div>
      </div>

      <div className="h-px bg-border my-4" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h2 className="text-lg font-semibold mb-2">Aplicación móvil</h2>
          <p className="text-sm text-muted-foreground">Escanea el código QR con la cámara del móvil para abrir AgroNutri en el navegador e instalarla como aplicación.</p>
        </div>
        <div className="md:col-span-2">
          <MobileAppCard />
        </div>
      </div>

      <div className="h-px bg-border my-4" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" /> Credenciales AI
          </h2>
          <p className="text-sm text-muted-foreground">Configura tus claves de API de OpenAI para usar el asistente y generar informes.</p>
        </div>
        <div className="md:col-span-2">
          <CredentialsManager />
        </div>
      </div>
    </div>
  );
}

const profileSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  company: z.string().optional(),
  phone: z.string().optional(),
  unitsPreference: z.string().optional(),
});

function ProfileForm({ user }: { user: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user.name || "",
      company: user.company || "",
      phone: user.phone || "",
      unitsPreference: user.unitsPreference || "metric",
    },
  });

  const updateMutation = useUpdateMe({
    mutation: {
      onSuccess: () => {
        toast({ title: "Perfil actualizado correctamente" });
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      }
    }
  });

  function onSubmit(values: z.infer<typeof profileSchema>) {
    updateMutation.mutate({ data: values });
  }

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle>Información Personal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input value={user.email} disabled className="bg-muted" /></FormControl>
              </FormItem>
              <FormField
                control={form.control}
                name="company"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Empresa</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unitsPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sistema de Unidades</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="metric">Métrico (Kg, L, Ha)</SelectItem>
                        <SelectItem value="imperial">Imperial (lb, gal, ac)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Rol</FormLabel>
                <div><Badge variant="outline" className="mt-2">{user.role}</Badge></div>
              </FormItem>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t p-4 bg-muted/20">
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

function CredentialsManager() {
  const { data: credentials, isLoading } = useListCredentials();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <Card><CardContent className="p-6">Cargando credenciales...</CardContent></Card>
      ) : credentials && credentials.length > 0 ? (
        <div className="space-y-4">
          {credentials.map(cred => (
            <CredentialItem key={cred.id} credential={cred} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/10">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <Key className="w-8 h-8 mb-2 opacity-20" />
            <p>No tienes credenciales configuradas.</p>
            <p className="text-sm">Necesitas una API Key de OpenAI para habilitar las funciones de IA.</p>
          </CardContent>
        </Card>
      )}

      <CredentialDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CredentialItem({ credential }: { credential: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const testMutation = useTestCredential({
    mutation: {
      onSuccess: (data) => {
        if (data.ok) {
          toast({ title: "Conexión exitosa", description: data.message, variant: "default" });
          queryClient.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
        } else {
          toast({ title: "Error de conexión", description: data.message, variant: "destructive" });
        }
      }
    }
  });

  const deleteMutation = useDeleteCredential({
    mutation: {
      onSuccess: () => {
        toast({ title: "Credencial eliminada" });
        queryClient.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
      }
    }
  });

  return (
    <Card className={credential.isDefault ? "border-primary shadow-sm" : ""}>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold">{credential.name}</h3>
            {credential.isDefault && <Badge className="text-[10px] px-1.5 py-0">Predeterminada</Badge>}
            {credential.status === 'valid' ? (
              <Badge variant="success" className="text-[10px] px-1.5 py-0 flex gap-1"><CheckCircle2 className="w-3 h-3"/> Válida</Badge>
            ) : credential.status === 'invalid' ? (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 flex gap-1"><XCircle className="w-3 h-3"/> Inválida</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">Sin probar</Badge>
            )}
          </div>
          <div className="text-sm font-mono bg-muted px-2 py-1 rounded inline-block text-muted-foreground">
            {credential.maskedKey}
          </div>
          <div className="text-xs text-muted-foreground mt-2 flex gap-4">
            <span>{AI_PROVIDERS[credential.provider]?.label ?? credential.provider}</span>
            <span>Modelo: {credential.selectedModel || 'Por defecto'}</span>
            {credential.monthlyLimitEur && <span>Límite: {credential.monthlyLimitEur}€/mes</span>}
          </div>
          <ProviderLimitations provider={credential.provider} className="mt-2" />
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => testMutation.mutate({ credentialId: credential.id })}
            disabled={testMutation.isPending}
            className="w-full justify-start"
          >
            <Play className="w-3.5 h-3.5 mr-2" /> Probar
          </Button>
          <EditCredentialDialog credential={credential} />
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => deleteMutation.mutate({ credentialId: credential.id })}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Eliminar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const AI_PROVIDERS: Record<string, { label: string; defaultModel: string; models: { value: string; label: string }[]; limitations: string[] }> = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o",
    limitations: [],
    models: [
      { value: "gpt-4o", label: "GPT-4o (Recomendado)" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (Rápido)" },
      { value: "gpt-4.1", label: "GPT-4.1" },
      { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { value: "gpt-5", label: "GPT-5" },
      { value: "gpt-5-mini", label: "GPT-5 Mini" },
    ],
  },
  mistral: {
    label: "Mistral",
    defaultModel: "mistral-small-latest",
    limitations: [
      "Verificación de fitosanitarios no disponible (requiere búsqueda web)",
    ],
    models: [
      { value: "mistral-large-latest", label: "Mistral Large" },
      { value: "mistral-medium-latest", label: "Mistral Medium" },
      { value: "mistral-small-latest", label: "Mistral Small (Económico)" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    limitations: [
      "Verificación de fitosanitarios no disponible (requiere búsqueda web)",
      "Análisis de fotos y PDF escaneados no disponible (sin visión)",
    ],
    models: [
      { value: "deepseek-chat", label: "DeepSeek Chat" },
      { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    ],
  },
};

function ProviderLimitations({ provider, className }: { provider: string; className?: string }) {
  const limitations = AI_PROVIDERS[provider]?.limitations;
  if (!limitations || limitations.length === 0) return null;
  return (
    <div
      className={`rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 ${className ?? ""}`}
      data-testid={`provider-limitations-${provider}`}
    >
      <div className="flex items-center gap-1.5 font-medium mb-1">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Funciones no disponibles con {AI_PROVIDERS[provider]?.label ?? provider}
      </div>
      <ul className="list-disc list-inside space-y-0.5">
        {limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

const editCredentialSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  provider: z.enum(["openai", "mistral", "deepseek"]),
  selectedModel: z.string().min(1, "Elige un modelo"),
  monthlyLimitEur: z.coerce.number().optional(),
});

function EditCredentialDialog({ credential }: { credential: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof editCredentialSchema>>({
    resolver: zodResolver(editCredentialSchema),
    values: {
      name: credential.name ?? "",
      provider: AI_PROVIDERS[credential.provider] ? credential.provider : "openai",
      selectedModel:
        credential.selectedModel ??
        (AI_PROVIDERS[credential.provider]?.defaultModel ?? AI_PROVIDERS.openai.defaultModel),
      monthlyLimitEur: credential.monthlyLimitEur ?? undefined,
    },
  });
  const provider = form.watch("provider");
  const providerInfo = AI_PROVIDERS[provider] ?? AI_PROVIDERS.openai;

  const updateMutation = useUpdateCredential({
    mutation: {
      onSuccess: () => {
        toast({ title: "Credencial actualizada" });
        queryClient.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
        setOpen(false);
      },
      onError: (err: any) => {
        toast({
          title: "Error al guardar",
          description: err?.data?.error,
          variant: "destructive",
        });
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start" data-testid={`button-edit-credential-${credential.id}`}>
          <Edit2 className="w-3.5 h-3.5 mr-2" /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar credencial de IA</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) =>
              updateMutation.mutate({ credentialId: credential.id, data: v }),
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <Select
                    onValueChange={(v) => {
                      field.onChange(v);
                      const info = AI_PROVIDERS[v];
                      // Al cambiar de proveedor, el modelo se reajusta al por defecto.
                      if (info) form.setValue("selectedModel", info.defaultModel);
                    }}
                    value={field.value}
                  >
                    <FormControl><SelectTrigger data-testid="select-edit-provider"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(AI_PROVIDERS).map(([value, info]) => (
                        <SelectItem key={value} value={value}>{info.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre identificativo</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="selectedModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo Preferido</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-edit-model"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {providerInfo.models.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monthlyLimitEur"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Límite Mensual (€)</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} /></FormControl>
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-credential">
                {updateMutation.isPending ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const credentialSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  apiKey: z.string().min(10, "API Key inválida"),
  provider: z.enum(["openai", "mistral", "deepseek"]).default("openai"),
  selectedModel: z.string().optional(),
  monthlyLimitEur: z.coerce.number().optional(),
  isDefault: z.boolean().default(true),
});

function CredentialDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const form = useForm<z.infer<typeof credentialSchema>>({
    resolver: zodResolver(credentialSchema),
    defaultValues: {
      name: "OpenAI Clave Principal",
      apiKey: "",
      provider: "openai",
      selectedModel: "gpt-4o",
      monthlyLimitEur: 20,
      isDefault: true,
    }
  });
  const provider = form.watch("provider") ?? "openai";
  const providerInfo = AI_PROVIDERS[provider] ?? AI_PROVIDERS.openai;

  const createMutation = useCreateCredential({
    mutation: {
      onSuccess: () => {
        toast({ title: "Credencial guardada" });
        queryClient.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
        form.reset();
        onOpenChange(false);
      },
      onError: () => {
        toast({ title: "Error al guardar", variant: "destructive" });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="w-full"><Plus className="w-4 h-4 mr-2" /> Añadir Credencial de IA</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir clave de IA</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => createMutation.mutate({ data: v }))} className="space-y-4">
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <Select
                    onValueChange={(v) => {
                      field.onChange(v);
                      const info = AI_PROVIDERS[v];
                      if (info) form.setValue("selectedModel", info.defaultModel);
                    }}
                    value={field.value}
                  >
                    <FormControl><SelectTrigger data-testid="select-provider"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(AI_PROVIDERS).map(([value, info]) => (
                        <SelectItem key={value} value={value}>{info.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  <ProviderLimitations provider={provider} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre identificativo</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl><Input type="password" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="selectedModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo Preferido</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-model"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {providerInfo.models.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monthlyLimitEur"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Límite Mensual (€)</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Guardando..." : "Guardar Credencial"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
