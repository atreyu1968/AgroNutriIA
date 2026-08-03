import { AppLayout } from '@/components/layout/app-layout';
import { Route, Switch } from 'wouter';

import FincasIndex from '@/pages/fincas/index';
import FincaDetail from '@/pages/fincas/detail';
import TecnicoVirtual from '@/pages/fincas/tecnico';

export function FincasRouter() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={FincasIndex} />
        <Route path="/:id/tecnico" component={TecnicoVirtual} />
        <Route path="/:id" component={FincaDetail} />
      </Switch>
    </AppLayout>
  );
}
