import { useEffect, useState } from 'react';
import { App } from './App';
import { Workbench } from './Workbench';

export function Root() {
  const isDashboard = () => !window.location.hash || window.location.hash.startsWith('#dashboard');
  const [dashboard, setDashboard] = useState(isDashboard);
  useEffect(() => {
    const update = () => setDashboard(isDashboard());
    window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update);
  }, []);
  return dashboard ? <Workbench /> : <App />;
}
