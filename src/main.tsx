import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Landing from './Landing';
import './styles.css';

const loadSimulator = () => import('./App');
const Simulator = lazy(loadSimulator);

const isSim = () => window.location.pathname.startsWith('/simulate');

function Root() {
  const [sim, setSim] = useState(isSim);
  useEffect(() => {
    const onPop = () => setSim(isSim());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    document.title = sim ? 'Domino Sky · Simulator' : 'Domino Sky · Airline disruption simulator';
  }, [sim]);
  const go = (to: '/' | '/simulate') => {
    window.history.pushState({}, '', to);
    window.scrollTo(0, 0);
    setSim(to === '/simulate');
  };
  return sim ? (
    <Suspense fallback={<div className="boot">Loading simulator…</div>}>
      <Simulator onHome={() => go('/')} />
    </Suspense>
  ) : (
    <Landing onLaunch={() => go('/simulate')} prefetch={loadSimulator} />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
