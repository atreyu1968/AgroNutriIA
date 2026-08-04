import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Redirect, Router as WouterRouter } from 'wouter';
import { AppLayout } from '@/components/layout/app-layout';
import { UpdatePrompt } from '@/components/update-prompt';

import Login from '@/pages/login';
import Register from '@/pages/register';
import Recuperar from '@/pages/recuperar';
import Restablecer from '@/pages/restablecer';
import Dashboard from '@/pages/dashboard';
import Landing from '@/pages/landing';
import Terminos from '@/pages/terminos';

import { FincasRouter } from '@/pages/fincas/router';

import Ajustes from '@/pages/ajustes';
import Fertilizantes from '@/pages/fertilizantes';
import FitosanitariosCatalogo from '@/pages/fitosanitarios-catalogo';
import ConsumoIA from '@/pages/consumo';
import Auditoria from '@/pages/auditoria';
import Administracion from '@/pages/administracion';
import Contratar from '@/pages/contratar';
import ContratarGracias from '@/pages/contratar-gracias';

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
      <Route path="/landing" component={Landing} />
      <Route path="/terminos" component={Terminos} />
      <Route path="/contratar/gracias" component={ContratarGracias} />
      <Route path="/contratar" component={Contratar} />
      <Route path="/login" component={Login} />
      <Route path="/registro" component={Register} />
      <Route path="/recuperar" component={Recuperar} />
      <Route path="/restablecer" component={Restablecer} />
      
      {/* Protected Routes inside AppLayout */}
      <Route path="/">
        <AppLayout><Dashboard /></AppLayout>
      </Route>
      
      <Route path="/fincas" nest>
        <FincasRouter />
      </Route>
      
      <Route path="/calculadora">
        <Redirect to="/fincas" />
      </Route>

      <Route path="/fitosanitarios">
        <AppLayout><FitosanitariosCatalogo /></AppLayout>
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
      <UpdatePrompt />
    </QueryClientProvider>
  );
}

export default App;
