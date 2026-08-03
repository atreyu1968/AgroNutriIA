import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { Link, Redirect, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  Sprout, LayoutDashboard, MapPin, FlaskConical, 
  Activity, ShieldCheck, Settings, LogOut, Menu, User, Users 
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/fincas", label: "Mis Fincas", icon: MapPin },
  { href: "/fertilizantes", label: "Fertilizantes", icon: FlaskConical },
  { href: "/consumo", label: "Consumo IA", icon: Activity },
  { href: "/auditoria", label: "Auditoría", icon: ShieldCheck, adminOnly: true },
  { href: "/administracion", label: "Administración", icon: Users, adminOnly: true },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: user, isLoading, error } = useGetMe({ 
    query: { 
      queryKey: getGetMeQueryKey(),
      retry: false,
    } 
  });

  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        queryClient.removeQueries();
        setLocation("/login");
      }
    }
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Sprout className="w-8 h-8 text-primary animate-pulse" /></div>;
  }

  if (error || (!isLoading && !user)) {
    return <Redirect to="/login" />;
  }

  if (!user) {
    return null;
  }

  const visibleNavItems = NAV_ITEMS.filter(item => !item.adminOnly || user.isAdmin);
  const logoIconUrl = `${import.meta.env.BASE_URL}favicon.png`;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2 text-primary">
          <img src={logoIconUrl} alt="" className="w-6 h-6 object-contain" />
          <span className="font-bold text-lg">AgroNutri</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          <Menu className="w-6 h-6" />
        </Button>
      </header>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-transform duration-200 ease-in-out flex flex-col md:translate-x-0 md:static md:w-64 md:shrink-0",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6">
          <img
            src={`${import.meta.env.BASE_URL}logo-blanco.png`}
            alt="AgroNutri AI"
            className="w-full max-w-[190px] object-contain"
          />
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors font-medium text-sm",
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-md bg-sidebar-accent/50">
            <div className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-semibold shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">{user.role}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-y-auto bg-muted/20 relative">
        {/* Mobile backdrop */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
        <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
