// Next.js runs register() once when a server instance starts (stable in v15;
// no experimental flag needed). Must start the timer and return — never await
// the loop, since Next waits for register() before serving requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip edge/build

  if (process.env.INTEGRATION_RECONCILE_ENABLED !== 'false') {
    const { startReconcileWorker } = await import('@/lib/integrations/reconcile-worker');
    startReconcileWorker();
  }

  const { isCertsEnabled, isCertRenewalEnabled } = await import('@/lib/certs/config');
  if (isCertsEnabled()) {
    const { startCertWorker } = await import('@/lib/certs/cert-worker');
    startCertWorker();
    if (isCertRenewalEnabled()) {
      const { startRenewalWorker } = await import('@/lib/certs/renewal-worker');
      startRenewalWorker();
    }
  }
}
