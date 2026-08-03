import { Sprout } from "lucide-react";
import { Link } from "wouter";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/10 rounded-full blur-3xl pointer-events-none" />
      
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
            <Sprout className="w-10 h-10 text-primary-foreground" />
          </div>
        </div>
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground">
          AgroNutri AI
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Sistema Inteligente de Precisión para el Cultivo de Platanera
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-card py-8 px-4 shadow-xl shadow-foreground/5 sm:rounded-xl sm:px-10 border border-card-border">
          {children}
        </div>
      </div>
    </div>
  );
}
