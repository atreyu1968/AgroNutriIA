import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRegister, useGetMe, getGetMeQueryKey, useGetAuthConfig, getGetAuthConfigQueryKey } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { AuthLayout } from "@/components/layout/auth-layout";
import { useEffect } from "react";

const registerSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  email: z.string().email("Correo electrónico inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  company: z.string().optional(),
  phone: z.string().optional(),
});

export default function Register() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const { data: authConfig } = useGetAuthConfig({ query: { queryKey: getGetAuthConfigQueryKey() } });

  useEffect(() => {
    if (user && !isLoading) {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      company: "",
      phone: "",
    },
  });

  const registerMutation = useRegister({
    mutation: {
      onSuccess: () => {
        toast({ title: "Cuenta creada con éxito" });
        setLocation("/");
      },
      onError: (error) => {
        toast({ 
          title: "Error al registrarse", 
          description: "Puede que el correo ya esté en uso", 
          variant: "destructive" 
        });
      }
    }
  });

  function onSubmit(values: z.infer<typeof registerSchema>) {
    registerMutation.mutate({ data: values });
  }

  if (isLoading || user) return null;

  if (authConfig && !authConfig.registrationEnabled) {
    return (
      <AuthLayout>
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold">Registro desactivado</h2>
          <p className="text-sm text-muted-foreground">
            En esta instalación las cuentas las crea el administrador. Si necesitas acceso, ponte en contacto con él.
          </p>
          <Link href="/login" className="inline-block font-medium text-primary hover:underline text-sm">
            Volver a iniciar sesión
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre Completo</FormLabel>
                <FormControl>
                  <Input placeholder="Juan Pérez" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Correo Electrónico</FormLabel>
                <FormControl>
                  <Input placeholder="tecnico@finca.es" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contraseña</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="company"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Empresa / Cooperativa (Opcional)</FormLabel>
                <FormControl>
                  <Input placeholder="Cooperativa Agrícola" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full mt-2" disabled={registerMutation.isPending}>
            {registerMutation.isPending ? "Creando cuenta..." : "Crear Cuenta"}
          </Button>
        </form>
      </Form>

      <div className="mt-6 text-center text-sm">
        <span className="text-muted-foreground">¿Ya tienes cuenta? </span>
        <Link href="/login" className="font-medium text-primary hover:underline">
          Inicia sesión
        </Link>
      </div>
    </AuthLayout>
  );
}
