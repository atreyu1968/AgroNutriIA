import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useResetPassword } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { AuthLayout } from "@/components/layout/auth-layout";

const schema = z
  .object({
    password: z.string().min(8, "Mínimo 8 caracteres"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Las contraseñas no coinciden",
  });

export default function Restablecer() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const search = useSearch();
  const token = useMemo(() => new URLSearchParams(search).get("token") ?? "", [search]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const resetMutation = useResetPassword({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Contraseña restablecida",
          description: "Ya puedes iniciar sesión con tu nueva contraseña",
        });
        setLocation("/login");
      },
      onError: (error) => {
        const message =
          (error as { data?: { error?: string } })?.data?.error ??
          "El enlace no es válido o ha caducado";
        toast({ title: "No se pudo restablecer", description: message, variant: "destructive" });
      },
    },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    resetMutation.mutate({ data: { token, password: values.password } });
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="space-y-4 text-center">
          <h2 className="text-lg font-semibold">Enlace incompleto</h2>
          <p className="text-sm text-muted-foreground">
            Este enlace no contiene el código de recuperación. Solicita uno nuevo.
          </p>
          <Link href="/recuperar" className="inline-block text-sm font-medium text-primary hover:underline">
            Solicitar un nuevo enlace
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-6 space-y-1 text-center">
        <h2 className="text-lg font-semibold">Elige una nueva contraseña</h2>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nueva contraseña</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Repite la contraseña</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
            {resetMutation.isPending ? "Guardando..." : "Guardar nueva contraseña"}
          </Button>
        </form>
      </Form>
      <div className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    </AuthLayout>
  );
}
