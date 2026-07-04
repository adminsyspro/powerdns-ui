// Next.js runs register() once when a server instance starts (stable in v15;
// no experimental flag needed). Must start the timer and return — never await
// the loop, since Next waits for register() before serving requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip edge/build

  if (process.env.INTEGRATION_RECONCILE_ENABLED !== 'false') {
    const { startReconcileWorker } = await import('@/lib/integrations/reconcile-worker');
    startReconcileWorker();
  }

  const { isCertsEnabled, isCertRenewalEnabled, certSecretsMisconfigured } = await import('@/lib/certs/config');
  if (isCertsEnabled()) {
    if (certSecretsMisconfigured()) {
      console.error(
        '[certs] REFUSING to start certificate workers: CERTS_ENABLED but neither APP_SECRET nor AUTH_SECRET is set — ' +
        'cert secrets would be encrypted under the committed public default key. Set APP_SECRET and restart.',
      );
    } else {
      const { startCertWorker } = await import('@/lib/certs/cert-worker');
      startCertWorker();
      if (isCertRenewalEnabled()) {
        const { startRenewalWorker } = await import('@/lib/certs/renewal-worker');
        startRenewalWorker();
      }
    }
  }
}
