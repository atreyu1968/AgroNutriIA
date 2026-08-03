import { AppLayout } from '@/components/layout/app-layout';
import { Route, Switch } from 'wouter';

import FincasIndex from '@/pages/fincas/index';
import FincaDetail from '@/pages/fincas/detail';
import TecnicoVirtual from '@/pages/fincas/tecnico';

export function FincasRouter() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/fincas" component={FincasIndex} />
        <Route path="/fincas/:id" component={FincaDetail} />
        <Route path="/fincas/:id/tecnico" component={TecnicoVirtual} />
      </Switch>
    </AppLayout>
  );
}
