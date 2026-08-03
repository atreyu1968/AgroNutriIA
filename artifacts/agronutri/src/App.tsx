import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppLayout } from '@/components/layout/app-layout';

import Login from '@/pages/login';
import Register from '@/pages/register';
import Dashboard from '@/pages/dashboard';

import { FincasRouter } from '@/pages/fincas/router';

import Ajustes from '@/pages/ajustes';
import Fertilizantes from '@/pages/fertilizantes';
import ConsumoIA from '@/pages/consumo';
import Auditoria from '@/pages/auditoria';
import Calculadora from '@/pages/calculadora';
import Administracion from '@/pages/administracion';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function NotFound() {
  return (
    <div className="flex h-[50vh] w-full flex-col items-center justify-center gap-4">
      <h2 className="text-4xl font-bold">404</h2>
      <p className="text-muted-foreground">Página no encontrada</p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/registro" component={Register} />
      
      {/* Protected Routes inside AppLayout */}
      <Route path="/">
        <AppLayout><Dashboard /></AppLayout>
      </Route>
      
      <Route path="/fincas" nest>
        <FincasRouter />
      </Route>
      
      <Route path="/fertilizantes">
        <AppLayout><Fertilizantes /></AppLayout>
      </Route>
      <Route path="/consumo">
        <AppLayout><ConsumoIA /></AppLayout>
      </Route>
      <Route path="/auditoria">
        <AppLayout><Auditoria /></AppLayout>
      </Route>
      <Route path="/calculadora">
        <AppLayout><Calculadora /></AppLayout>
      </Route>
      <Route path="/administracion">
        <AppLayout><Administracion /></AppLayout>
      </Route>
      <Route path="/ajustes">
        <AppLayout><Ajustes /></AppLayout>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
