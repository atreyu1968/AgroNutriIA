import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, useGetMe, getGetMeQueryKey, useGetAuthConfig, getGetAuthConfigQueryKey } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { AuthLayout } from "@/components/layout/auth-layout";
import { useEffect } from "react";

const loginSchema = z.object({
  email: z.string().email("Correo electrónico inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export default function Login() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const { data: authConfig } = useGetAuthConfig({ query: { queryKey: getGetAuthConfigQueryKey() } });

  useEffect(() => {
    if (user && !isLoading) {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: () => {
        toast({ title: "Bienvenido a AgroNutri" });
        setLocation("/");
      },
      onError: (error) => {
        toast({ 
          title: "Error al iniciar sesión", 
          description: "Verifica tus credenciales", 
          variant: "destructive" 
        });
      }
    }
  });

  function onSubmit(values: z.infer<typeof loginSchema>) {
    loginMutation.mutate({ data: values });
  }

  if (isLoading || user) return null;

  return (
    <AuthLayout>
      {authConfig?.demoMode && (
        <div
          className="mb-6 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-2 text-center"
          data-testid="banner-demo-mode"
        >
          <p>
            Instalación de demostración — limitada a 1 finca y 1 informe de cada tipo.{" "}
            <Link href="/landing" className="font-medium underline underline-offset-2 hover:text-amber-700">
              Contrata AgroNutri AI
            </Link>
          </p>
          {authConfig.demoEmail && authConfig.demoPassword && (
            <div className="mt-3 space-y-2">
              <p data-testid="text-demo-credentials">
                Usuario: <span className="font-mono font-medium">{authConfig.demoEmail}</span>
                {" · "}
                Contraseña: <span className="font-mono font-medium">{authConfig.demoPassword}</span>
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                data-testid="button-demo-login"
                disabled={loginMutation.isPending}
                onClick={() =>
                  loginMutation.mutate({
                    data: { email: authConfig.demoEmail!, password: authConfig.demoPassword! },
                  })
                }
              >
                {loginMutation.isPending ? "Entrando..." : "Probar la demo"}
              </Button>
            </div>
          )}
        </div>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

          <div className="text-right text-sm">
            <Link href="/recuperar" className="font-medium text-primary hover:underline">
              ¿Has olvidado tu contraseña?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Iniciando sesión..." : "Iniciar Sesión"}
          </Button>
        </form>
      </Form>

      {authConfig?.registrationEnabled !== false && (
        <div className="mt-6 text-center text-sm">
          <span className="text-muted-foreground">¿No tienes cuenta? </span>
          <Link href="/registro" className="font-medium text-primary hover:underline">
            Regístrate aquí
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
