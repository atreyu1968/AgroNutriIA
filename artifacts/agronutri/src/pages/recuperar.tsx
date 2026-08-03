import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForgotPassword } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { AuthLayout } from "@/components/layout/auth-layout";

const schema = z.object({
  email: z.string().email("Correo electrónico inválido"),
});

export default function Recuperar() {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const forgotMutation = useForgotPassword({
    mutation: {
      onSuccess: () => setSent(true),
      onError: () => {
        toast({
          title: "No se pudo enviar la solicitud",
          description: "Inténtalo de nuevo en unos minutos",
          variant: "destructive",
        });
      },
    },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    forgotMutation.mutate({ data: values });
  }

  return (
    <AuthLayout>
      {sent ? (
        <div className="space-y-4 text-center">
          <h2 className="text-lg font-semibold">Revisa tu correo</h2>
          <p className="text-sm text-muted-foreground">
            Si existe una cuenta con ese correo, te hemos enviado un enlace para
            restablecer la contraseña. El enlace caduca en 1 hora.
          </p>
          <Link href="/login" className="inline-block text-sm font-medium text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6 space-y-1 text-center">
            <h2 className="text-lg font-semibold">¿Has olvidado tu contraseña?</h2>
            <p className="text-sm text-muted-foreground">
              Escribe tu correo y te enviaremos un enlace para restablecerla.
            </p>
          </div>
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
              <Button type="submit" className="w-full" disabled={forgotMutation.isPending}>
                {forgotMutation.isPending ? "Enviando..." : "Enviar enlace de recuperación"}
              </Button>
            </form>
          </Form>
          <div className="mt-6 text-center text-sm">
            <Link href="/login" className="font-medium text-primary hover:underline">
              Volver a iniciar sesión
            </Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
