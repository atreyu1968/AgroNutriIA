import { useState } from "react";
import {
  useAdminListUsers,
  getAdminListUsersQueryKey,
  useAdminCreateUser,
  useAdminUpdateUser,
  useAdminDeleteUser,
  useAdminListFarms,
  getAdminListFarmsQueryKey,
  useAdminDeleteFarm,
  useGetMe,
  getGetMeQueryKey,
  useAdminGetEmailSettings,
  getAdminGetEmailSettingsQueryKey,
  useAdminUpdateEmailSettings,
  type AdminUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Users, MapPin, ShieldCheck, Pencil, Trash2, UserPlus, Mail, Loader2 } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Propietario",
  technician: "Técnico",
  manager: "Encargado",
  viewer: "Solo lectura",
};

function errorMessage(err: unknown): string {
  const anyErr = err as { response?: { data?: { error?: string } }; data?: { error?: string }; message?: string };
  return anyErr?.response?.data?.error ?? anyErr?.data?.error ?? anyErr?.message ?? "Se ha producido un error";
}

export default function Administracion() {
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users, isLoading: loadingUsers } = useAdminListUsers({
    query: { queryKey: getAdminListUsersQueryKey(), enabled: !!me?.isAdmin },
  });
  const { data: farms, isLoading: loadingFarms } = useAdminListFarms({
    query: { queryKey: getAdminListFarmsQueryKey(), enabled: !!me?.isAdmin },
  });

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [deleteFarmId, setDeleteFarmId] = useState<number | null>(null);

  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("owner");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [editLimit, setEditLimit] = useState<string>("");
  const [editPassword, setEditPassword] = useState("");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("owner");
  const [newIsAdmin, setNewIsAdmin] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getAdminListFarmsQueryKey() });
  };

  const createUser = useAdminCreateUser({
    mutation: {
      onSuccess: () => {
        invalidate();
        setCreating(false);
        toast({ title: "Usuario creado" });
      },
      onError: (err) => toast({ title: "No se pudo crear", description: errorMessage(err), variant: "destructive" }),
    },
  });
  const updateUser = useAdminUpdateUser({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditingUser(null);
        toast({ title: "Usuario actualizado" });
      },
      onError: (err) => toast({ title: "No se pudo actualizar", description: errorMessage(err), variant: "destructive" }),
    },
  });
  const deleteUser = useAdminDeleteUser({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteUserId(null);
        toast({ title: "Usuario eliminado" });
      },
      onError: (err) => {
        setDeleteUserId(null);
        toast({ title: "No se pudo eliminar", description: errorMessage(err), variant: "destructive" });
      },
    },
  });
  const deleteFarm = useAdminDeleteFarm({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteFarmId(null);
        toast({ title: "Finca eliminada" });
      },
      onError: (err) => {
        setDeleteFarmId(null);
        toast({ title: "No se pudo eliminar", description: errorMessage(err), variant: "destructive" });
      },
    },
  });

  if (me && !me.isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-2">
        <ShieldCheck className="w-10 h-10 mx-auto text-muted-foreground opacity-40" />
        <h2 className="text-xl font-semibold">Acceso restringido</h2>
        <p className="text-muted-foreground">Esta sección es solo para administradores.</p>
      </div>
    );
  }

  const openEdit = (u: AdminUser) => {
    setEditingUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditIsAdmin(u.isAdmin);
    setEditActive(u.active);
    setEditLimit(u.aiMonthlyLimitEur != null ? String(u.aiMonthlyLimitEur) : "");
    setEditPassword("");
  };

  const saveUser = () => {
    if (!editingUser) return;
    const parsedLimit = editLimit === "" ? null : parseFloat(editLimit);
    if (parsedLimit != null && (!Number.isFinite(parsedLimit) || parsedLimit < 0)) {
      toast({ title: "Límite no válido", description: "El límite mensual debe ser un número mayor o igual que 0.", variant: "destructive" });
      return;
    }
    updateUser.mutate({
      userId: editingUser.id,
      data: {
        name: editName,
        role: editRole as "owner" | "technician" | "manager" | "viewer",
        isAdmin: editIsAdmin,
        active: editActive,
        aiMonthlyLimitEur: editLimit === "" ? null : parseFloat(editLimit),
        // parsedLimit validated above
        ...(editPassword ? { password: editPassword } : {}),
      },
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Administración</h1>
        <p className="text-muted-foreground mt-1">Gestión global de usuarios y fincas de la plataforma.</p>
      </div>

      <Tabs defaultValue="usuarios">
        <TabsList>
          <TabsTrigger value="usuarios" className="gap-2"><Users className="w-4 h-4" /> Usuarios</TabsTrigger>
          <TabsTrigger value="fincas" className="gap-2"><MapPin className="w-4 h-4" /> Fincas</TabsTrigger>
          <TabsTrigger value="configuracion" className="gap-2"><Mail className="w-4 h-4" /> Configuración</TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Usuarios registrados</CardTitle>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => {
                  setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("owner"); setNewIsAdmin(false);
                  setCreating(true);
                }}
              >
                <UserPlus className="w-4 h-4" /> Crear usuario
              </Button>
            </CardHeader>
            <CardContent>
              {loadingUsers ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
              ) : (
                <div className="divide-y">
                  {users?.map(u => (
                    <div key={u.id} className="flex items-center gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          {u.name}
                          {u.isAdmin && <Badge variant="secondary" className="gap-1"><ShieldCheck className="w-3 h-3" /> Admin</Badge>}
                          {!u.active && <Badge variant="outline" className="text-destructive border-destructive/40">Desactivado</Badge>}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">{u.email}{u.company ? ` · ${u.company}` : ""}</div>
                      </div>
                      <div className="hidden md:block text-sm text-muted-foreground w-28">{ROLE_LABELS[u.role] ?? u.role}</div>
                      <div className="hidden md:block text-sm text-muted-foreground w-20 text-right tabular-nums">{u.farmCount} finca{u.farmCount === 1 ? "" : "s"}</div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(u)} aria-label="Editar usuario">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={u.id === me?.id}
                          onClick={() => setDeleteUserId(u.id)}
                          aria-label="Eliminar usuario"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fincas" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Todas las fincas</CardTitle></CardHeader>
            <CardContent>
              {loadingFarms ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
              ) : (
                <div className="divide-y">
                  {farms?.map(f => (
                    <div key={f.id} className="flex items-center gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{f.name}</div>
                        <div className="text-sm text-muted-foreground truncate">
                          {[f.companyName, f.municipality, f.island].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <div className="hidden md:block text-sm text-muted-foreground w-40 truncate">Propietario: {f.ownerName}</div>
                      <div className="hidden md:block text-sm text-muted-foreground w-24 text-right tabular-nums">
                        {f.plantCount != null ? `${f.plantCount.toLocaleString("es-ES")} pl.` : "—"}
                      </div>
                      <div className="hidden md:block text-sm text-muted-foreground w-20 text-right tabular-nums">{f.memberCount} miembro{f.memberCount === 1 ? "" : "s"}</div>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteFarmId(f.id)} aria-label="Eliminar finca">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {farms?.length === 0 && <p className="text-sm text-muted-foreground py-4">No hay fincas registradas.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configuracion" className="mt-6">
          <EmailSettingsCard />
        </TabsContent>
      </Tabs>

      {/* Edit user dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rol por defecto</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Administrador</Label>
                <p className="text-xs text-muted-foreground">Acceso total a usuarios, fincas y auditoría.</p>
              </div>
              <Switch
                checked={editIsAdmin}
                onCheckedChange={setEditIsAdmin}
                disabled={editingUser?.id === me?.id}
              />
            </div>
            <div className="space-y-2">
              <Label>Límite mensual de IA (€)</Label>
              <Input type="number" min="0" step="1" value={editLimit} placeholder="Sin límite" onChange={e => setEditLimit(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Nueva contraseña (opcional)</Label>
              <Input type="password" value={editPassword} placeholder="Mínimo 8 caracteres" onChange={e => setEditPassword(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Cuenta activa</Label>
                <p className="text-xs text-muted-foreground">Si se desactiva, el usuario no podrá iniciar sesión y sus sesiones dejarán de funcionar.</p>
              </div>
              <Switch
                checked={editActive}
                onCheckedChange={setEditActive}
                disabled={editingUser?.id === me?.id}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancelar</Button>
            <Button onClick={saveUser} disabled={updateUser.isPending || (editPassword.length > 0 && editPassword.length < 8)}>
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create user dialog */}
      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Correo electrónico</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Contraseña</Label>
              <Input type="password" value={newPassword} placeholder="Mínimo 8 caracteres" onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rol por defecto</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Administrador</Label>
                <p className="text-xs text-muted-foreground">Acceso total a usuarios, fincas y auditoría.</p>
              </div>
              <Switch checked={newIsAdmin} onCheckedChange={setNewIsAdmin} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button
              disabled={
                createUser.isPending ||
                !newName.trim() ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim()) ||
                newPassword.length < 8
              }
              onClick={() =>
                createUser.mutate({
                  data: {
                    name: newName.trim(),
                    email: newEmail.trim(),
                    password: newPassword,
                    role: newRole as "owner" | "technician" | "manager" | "viewer",
                    isAdmin: newIsAdmin,
                  },
                })
              }
            >
              Crear usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete user confirm */}
      <AlertDialog open={deleteUserId != null} onOpenChange={(open) => !open && setDeleteUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán su cuenta, sus claves de IA y sus conversaciones. Esta acción no se puede deshacer.
              Si el usuario es propietario de fincas, primero habrá que eliminarlas o reasignarlas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteUserId != null && deleteUser.mutate({ userId: deleteUserId })}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete farm confirm */}
      <AlertDialog open={deleteFarmId != null} onOpenChange={(open) => !open && setDeleteFarmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta finca?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán sus sectores, analíticas, recomendaciones, conversaciones e informes. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFarmId != null && deleteFarm.mutate({ farmId: deleteFarmId })}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmailSettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useAdminGetEmailSettings({
    query: { queryKey: getAdminGetEmailSettingsQueryKey() },
  });
  const [apiKey, setApiKey] = useState("");
  const [emailFrom, setEmailFrom] = useState<string | null>(null);
  const updateMutation = useAdminUpdateEmailSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Configuración de email guardada" });
        queryClient.invalidateQueries({ queryKey: getAdminGetEmailSettingsQueryKey() });
        setApiKey("");
        setEmailFrom(null);
      },
      onError: (err: unknown) =>
        toast({ title: "No se pudo guardar", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const fromValue = emailFrom ?? settings?.emailFrom ?? "";
  const save = () => {
    updateMutation.mutate({
      data: {
        ...(apiKey.trim() ? { resendApiKey: apiKey.trim() } : {}),
        ...(emailFrom != null ? { emailFrom: emailFrom.trim() ? emailFrom.trim() : null } : {}),
      },
    });
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" /> Envío de emails (Resend)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Se usa para enviar el email de recuperación de contraseña. Crea la clave en{" "}
          <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline">resend.com</a>{" "}
          (API Keys). Si no hay clave configurada, la app no envía emails y deja el enlace de
          recuperación en el registro del servidor.
        </p>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm" data-testid="email-settings-status">
              <Badge variant={settings?.configured ? "default" : "secondary"}>
                {settings?.configured ? "Configurado" : "Sin configurar"}
              </Badge>
              {settings?.source === "db" && (
                <span className="text-muted-foreground">Clave guardada aquí: {settings.apiKeyMasked}</span>
              )}
              {settings?.source === "env" && (
                <span className="text-muted-foreground">Usando la clave del servidor (variable de entorno)</span>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="resend-key">Clave de API de Resend</Label>
              <Input
                id="resend-key"
                type="password"
                placeholder={settings?.apiKeyMasked ? "Escribe una clave nueva para sustituirla" : "re_..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                data-testid="input-resend-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-from">Remitente</Label>
              <Input
                id="email-from"
                placeholder="AgroNutri <no-reply@midominio.com> (vacío = remitente de pruebas de Resend)"
                value={fromValue}
                onChange={(e) => setEmailFrom(e.target.value)}
                data-testid="input-email-from"
              />
              <p className="text-xs text-muted-foreground">
                Para usar tu propio dominio como remitente, verifícalo antes en Resend (apartado Domains).
                Con el remitente de pruebas solo se pueden enviar emails a la dirección de tu cuenta de Resend.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={save}
                disabled={updateMutation.isPending || (!apiKey.trim() && emailFrom == null)}
                data-testid="button-save-email-settings"
              >
                {updateMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</>
                ) : (
                  "Guardar"
                )}
              </Button>
              {settings?.apiKeyMasked && (
                <Button
                  variant="outline"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ data: { resendApiKey: null } })}
                  data-testid="button-clear-resend-key"
                >
                  Quitar clave guardada
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
