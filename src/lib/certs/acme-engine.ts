import * as acme from 'acme-client';
import * as dns from 'dns';
import type { RRSet } from '@/types/powerdns';
import { getJob, recordJobOrder, recordJobChallenges, markJobCleanupDone, finishJob } from './job-store';
import {
  getCertificate as getCert, updateCertificateIssuance, setCertificateRenewalFailure,
  setCertificatePrivateKey, getCertificatePrivateKey, setCertificateMaterialized, setCertRunLog,
} from './cert-store';
import { getAcmeAccount, getAccountSecrets } from './store';
import { reloadAcmeTrust } from './acme-trust';
import { appendCertEvent } from './event-store';
import { resolveZonesForSans, resolveZoneForFqdn } from './zone-match';
import { challengeFqdn, mergeTxtValues, removeTxtValues, buildTxtRrset, buildTxtDelete } from './dns-txt';
import { splitPemChain, parseCertInfo } from './cert-info';
import { materializeCert } from './materialize';
import { getConnectionById } from '@/lib/integrations/connections';
import { PowerDNSClient } from '@/lib/powerdns-client';
import { classifyError, groupChallengesByFqdn } from './engine-util';

const PROP_TIMEOUT_MS = Math.max(30_000, Number(process.env.CERT_DNS_PROPAGATION_TIMEOUT_MS) || 120_000);

/** Element type of Authorization.challenges — acme-client doesn't export the
 * Challenge/DnsChallenge union by name, so we derive it structurally. */
type ChallengeItem = acme.Authorization['challenges'][number];

// --- verbose per-run generation log (last run only, streamed to the UI) ---
// The worker runs jobs sequentially, so a single module-level sink attributes
// every line (ours + acme-client's internal trace) to the current cert. The
// buffer is reset at run start and written to certificates.last_run_log.
const RUN_LOG_MAX = 64 * 1024;
let runLogCertId: string | null = null;
let runLogBuf = '';
function resetRunLog(certId: string): void {
  runLogCertId = certId;
  runLogBuf = '';
  try { setCertRunLog(certId, ''); } catch { /* best-effort */ }
}
function runLog(msg: string): void {
  if (!runLogCertId) return;
  const line = `[${new Date().toISOString()}] ${msg}`;
  runLogBuf = runLogBuf ? `${runLogBuf}\n${line}` : line;
  if (runLogBuf.length > RUN_LOG_MAX) runLogBuf = runLogBuf.slice(-RUN_LOG_MAX);
  try { setCertRunLog(runLogCertId, runLogBuf); } catch { /* best-effort */ }
}
function endRunLog(): void { runLogCertId = null; }

// Capture acme-client's internal verbose trace (ACME account/order/authz/
// challenge/status-polling messages — the certbot-like detail) into the run log.
// Registered once; no-op between jobs (runLogCertId is null).
acme.setLogger((msg: string) => runLog(`acme: ${msg}`));

export async function runJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  const cert = getCert(job.certificateId);
  if (!cert) { finishJob(jobId, 'failed', { errorClass: 'unknown', message: 'certificate missing' }); return; }

  const account = getAcmeAccount(cert.acmeAccountId);
  const conn = getConnectionById(cert.connectionId);
  const pdns = conn ? new PowerDNSClient(conn.url, conn.apiKey) : null;

  // Crash-recovery: if a prior attempt left TXT records, clean them first.
  if (!job.cleanupDone && job.challenges.length && pdns) {
    await cleanup(pdns, cert.serverUrl, job.challenges).catch(() => {});
  }

  try {
    resetRunLog(cert.id);
    runLog(`▶ ${job.kind} — SANs: ${cert.sans.join(', ')}`);
    if (!account || account.status !== 'registered') throw new Error('account not registered');
    if (!account.accountUrl) throw new Error('account not registered (no account URL)');
    const secrets = getAccountSecrets(account.id);
    if (!secrets?.accountKeyPem) throw new Error('account key missing');
    if (!pdns) throw new Error('PowerDNS connection missing (dns-write)');
    // Fail fast, before touching the CA, if any SAN isn't in a managed zone.
    resolveZonesForSans(cert.serverUrl, cert.sans);

    // accountUrl is required — without it, acme-client can't scope
    // createOrder()/getOrder()/finalizeOrder() etc. to this account.
    // Ensure the shared axios trusts the account's pinned root before ordering.
    reloadAcmeTrust();
    const client = new acme.Client({
      directoryUrl: account.directoryUrl,
      accountKey: secrets.accountKeyPem,
      accountUrl: account.accountUrl,
    });

    // 1. Create or resume the order. client.getOrder() only reads order.url at
    // runtime (it re-fetches the order from the CA), so a minimal placeholder
    // object satisfying the Order shape is safe and avoids persisting the full
    // order JSON just to resume.
    const identifiers = cert.sans.map((value) => ({ type: 'dns' as const, value }));
    let order: acme.Order;
    let resumedValid = false;
    if (job.orderUrl) {
      order = await client.getOrder({
        url: job.orderUrl,
        status: 'pending',
        identifiers: [],
        authorizations: [],
        finalize: '',
      });
      resumedValid = order.status === 'valid';
      runLog(`resuming order ${job.orderUrl} (status ${order.status})`);
    } else {
      order = await client.createOrder({ identifiers });
      recordJobOrder(jobId, order.url);
      runLog(`order created: ${order.url}`);
    }

    let keyPem: Buffer;
    let fullchain: string;
    let added: { fqdn: string; value: string }[];

    if (resumedValid) {
      // The order was already finalized by a prior (crashed) attempt. Don't
      // re-run challenges/finalize — just fetch the cert and pair it with the
      // key persisted before that earlier finalizeOrder call (step 5, below).
      const existingKeyPem = getCertificatePrivateKey(cert.id);
      if (!existingKeyPem) {
        throw new Error('cannot recover issued order: private key missing (invalid-identifier)');
      }
      keyPem = Buffer.from(existingKeyPem);
      fullchain = await downloadFullchain(client, order);
      added = job.challenges; // whatever a prior attempt recorded, for cleanup below
    } else {
      // 2. Authorizations → dns-01 values (skip already-valid)
      const authzs = await client.getAuthorizations(order);
      const challengeItems: { fqdn: string; value: string; challenge: ChallengeItem }[] = [];
      for (const authz of authzs) {
        if (authz.status === 'valid') continue;
        const challenge = authz.challenges.find((c) => c.type === 'dns-01');
        if (!challenge) throw new Error(`no dns-01 challenge for ${authz.identifier.value} (invalid-identifier)`);
        const value = await client.getChallengeKeyAuthorization(challenge);
        challengeItems.push({ fqdn: challengeFqdn(authz.identifier.value), value, challenge });
      }

      // 3. Record challenge ownership BEFORE writing any TXT value. This must
      // happen first: removeTxtValues() is idempotent (removing a value that
      // was never written is a no-op), so recording the full owned set ahead
      // of the write loop is safe and guarantees cleanup / crash-recovery
      // always sees every value we're about to attempt, even if we crash
      // partway through the loop below.
      const byFqdn = groupChallengesByFqdn(challengeItems.map((c) => ({ fqdn: c.fqdn, value: c.value })));
      added = challengeItems.map((c) => ({ fqdn: c.fqdn, value: c.value }));
      recordJobChallenges(jobId, added);

      // 3b. Write TXT records (UNION with existing)
      for (const [fqdn, values] of byFqdn) {
        const zone = zoneFor(cert.serverUrl, fqdn);
        const existing = await readTxt(pdns, zone, fqdn);
        const merged = mergeTxtValues(existing, values);
        await patch(pdns, zone, buildTxtRrset(fqdn, merged));
        runLog(`TXT ${fqdn} ← [${values.join(', ')}] (zone ${zone})`);
      }

      // 4. Wait for DNS propagation (mode-dependent), then complete + validate
      runLog(`waiting for DNS propagation of ${byFqdn.size} challenge record(s)…`);
      await waitForPropagationAllModes(byFqdn, account, cert.serverUrl);
      runLog('DNS propagation confirmed; asking the CA to validate');
      for (const item of challengeItems) {
        await client.completeChallenge(item.challenge);
        await client.waitForValidStatus(item.challenge);
        runLog(`challenge validated: ${item.fqdn}`);
      }

      // 5. Finalize: new keypair + CSR, persist the key, THEN finalize.
      // acme.crypto.createCsr always generates an RSA key internally UNLESS a
      // keyPem is passed in — so ECDSA certs must generate the EC key first via
      // createPrivateEcdsaKey() and hand it to createCsr as the second arg.
      // The key is persisted BEFORE finalizeOrder so a crash between finalize
      // and cert-fetch can be resumed (see the resumedValid branch above)
      // without generating a new keypair that would no longer match the CSR.
      let csr: Buffer;
      if (cert.keyType === 'rsa') {
        [keyPem, csr] = await acme.crypto.createCsr({ altNames: cert.sans, keySize: 2048 });
      } else {
        keyPem = await acme.crypto.createPrivateEcdsaKey();
        [, csr] = await acme.crypto.createCsr({ altNames: cert.sans }, keyPem);
      }
      setCertificatePrivateKey(cert.id, keyPem.toString());
      runLog(`finalizing order (submitting ${cert.keyType.toUpperCase()} CSR)…`);
      order = await client.finalizeOrder(order, csr);
      fullchain = await downloadFullchain(client, order);
    }

    // 6. Persist + materialize
    const { leaf, chain } = splitPemChain(fullchain);
    const info = parseCertInfo(leaf);
    runLog(`certificate issued — serial ${info.serial}, issuer ${info.issuer}, expires ${new Date(info.notAfter * 1000).toISOString()}`);
    updateCertificateIssuance(cert.id, {
      certPem: leaf, chainPem: chain, privkeyPem: keyPem.toString(),
      notBefore: info.notBefore, notAfter: info.notAfter,
      serial: info.serial, fingerprint: info.fingerprintSha256, issuer: info.issuer,
    });
    const liveDir = materializeCert({ name: cert.name, leafPem: leaf, chainPem: chain, privkeyPem: keyPem.toString() });
    setCertificateMaterialized(cert.id);
    runLog(`materialized to ${liveDir}`);
    appendCertEvent({
      certificateId: cert.id,
      type: job.kind === 'renew' ? 'renew' : 'issue',
      status: 'ok',
      message: `issued (expires ${new Date(info.notAfter * 1000).toISOString()})`,
    });

    // 7. Cleanup TXT + finish. Only mark cleanup done when every per-fqdn
    // PATCH actually succeeded — otherwise leave cleanup_done=0 so a later
    // cycle (crash-recovery pass at the top of this function) retries it.
    if (added.length) runLog('cleaning up challenge TXT records…');
    const cleanedUp = added.length ? await cleanup(pdns, cert.serverUrl, added).catch(() => false) : true;
    if (cleanedUp) markJobCleanupDone(jobId);
    runLog('✔ issuance complete');
    finishJob(jobId, 'succeeded');
  } catch (err) {
    const { errorClass, message, retryDelayMs } = classifyError(err);
    runLog(`✖ failed [${errorClass}]: ${message}`);
    const j = getJob(jobId);
    if (pdns && j && j.challenges.length) {
      const cleanedUp = await cleanup(pdns, cert.serverUrl, j.challenges).catch(() => false);
      if (cleanedUp) markJobCleanupDone(jobId);
    }
    const nextAttemptAt = Math.floor(Date.now() / 1000) + Math.floor(retryDelayMs / 1000);
    setCertificateRenewalFailure(job.certificateId, { errorClass, message, nextAttemptAt });
    appendCertEvent({ certificateId: job.certificateId, type: 'error', status: errorClass, message });
    finishJob(jobId, 'failed', { errorClass, message, nextAttemptAt });
  } finally {
    endRunLog();
  }
}

// --- helpers (module-private) ---

// acme-client's getCertificate() throws "Unable to download certificate, URL
// not found" when the order it is handed already has status 'valid' but no
// `certificate` URL — e.g. a resumed placeholder order, or a stale order object
// after finalizeOrder. Re-fetch the order in that case so the URL is populated;
// otherwise getCertificate() re-fetches internally while the order isn't valid.
async function downloadFullchain(client: acme.Client, order: acme.Order): Promise<string> {
  runLog('downloading certificate…');
  if (order.status === 'valid' && !order.certificate) {
    order = await client.getOrder(order);
  }
  return client.getCertificate(order);
}

function zoneFor(serverUrl: string, fqdn: string): string {
  const z = resolveZoneForFqdn(serverUrl, fqdn);
  if (!z) throw new Error(`no managed zone for ${fqdn} (dns-write)`);
  return z;
}

async function readTxt(pdns: PowerDNSClient, zone: string, fqdn: string): Promise<string[]> {
  const res = await pdns.getZone(zone);
  const rr = res.data?.rrsets?.find((r) => r.name === fqdn && r.type === 'TXT');
  return rr ? rr.records.map((x) => x.content) : [];
}

async function patch(pdns: PowerDNSClient, zone: string, rrset: RRSet): Promise<void> {
  const res = await pdns.updateRecords(zone, [rrset]);
  if (res.error) throw new Error(`PowerDNS PATCH failed: ${res.error} (dns-write)`);
}

/**
 * Value-level TXT cleanup: for each fqdn we touched, read the CURRENT rrset,
 * remove only the values we added (byte-comparison via removeTxtValues), and
 * either PATCH the remainder back or DELETE the rrset entirely if nothing is
 * left. Never blind-overwrites — a third party's TXT value at the same name
 * survives. Best-effort per fqdn: one failure doesn't stop cleanup of the
 * others.
 *
 * Returns true only if every per-fqdn PATCH/DELETE actually succeeded (a
 * missing zone counts as success — the zone, and any TXT in it, is already
 * gone). Callers must only mark the job's cleanup as done when this returns
 * true; otherwise a later crash-recovery pass should retry.
 */
async function cleanup(
  pdns: PowerDNSClient,
  serverUrl: string,
  added: { fqdn: string; value: string }[]
): Promise<boolean> {
  const byFqdn = groupChallengesByFqdn(added);
  let allOk = true;
  for (const [fqdn, values] of byFqdn) {
    try {
      const zone = resolveZoneForFqdn(serverUrl, fqdn);
      if (!zone) continue; // zone gone entirely — nothing left to clean up
      const existing = await readTxt(pdns, zone, fqdn);
      const remainder = removeTxtValues(existing, values);
      if (remainder.length === 0) {
        await patch(pdns, zone, buildTxtDelete(fqdn));
      } else {
        await patch(pdns, zone, buildTxtRrset(fqdn, remainder));
      }
    } catch {
      allOk = false; // best-effort; see doc comment above — keep trying the rest
    }
  }
  return allOk;
}

/** DNS lookup functions used for authoritative-NS discovery (injectable for tests). */
type NsLookup = Pick<typeof dns.promises, 'resolveNs' | 'resolve4' | 'resolve6'>;

/**
 * Discover the authoritative nameserver IPs for the managed zone containing
 * fqdn: look the zone up in our own zone cache, then resolve its NS hostnames
 * to IPs via the system resolver. Returns [] when the zone is unknown, has no
 * discoverable NS records, or any lookup fails; callers treat an empty list
 * as "use the system-configured resolvers". Never throws. Exported for tests.
 */
export async function authoritativeResolvers(
  serverUrl: string,
  fqdn: string,
  lookup: NsLookup = dns.promises,
  zoneForFqdn: typeof resolveZoneForFqdn = resolveZoneForFqdn
): Promise<string[]> {
  try {
    const zone = zoneForFqdn(serverUrl, fqdn);
    if (!zone) return [];
    const nsHosts = await lookup.resolveNs(zone.replace(/\.$/, ''));
    const ips: string[] = [];
    for (const host of nsHosts) {
      const name = host.replace(/\.$/, '');
      const [v4, v6] = await Promise.all([
        lookup.resolve4(name).catch(() => [] as string[]),
        lookup.resolve6(name).catch(() => [] as string[]),
      ]);
      ips.push(...v4, ...v6);
    }
    return ips;
  } catch {
    return []; // fall back to the system-configured resolvers
  }
}

/** Dispatches DNS-01 propagation waiting to the account's configured mode. Exported for tests. */
export async function waitForPropagationAllModes(
  byFqdn: Map<string, string[]>,
  account: { propagationMode: string; propagationResolver: string | null },
  serverUrl: string,
  wait: typeof waitForPropagation = waitForPropagation,
  discover: typeof authoritativeResolvers = authoritativeResolvers
): Promise<void> {
  if (account.propagationMode === 'delay') {
    await sleep(Number(process.env.CERT_PROPAGATION_DELAY_MS) || 20_000);
    return;
  }
  if (account.propagationMode === 'resolver') {
    // Comma-separated list supported (e.g. "10.10.10.251,10.10.10.252") for
    // redundancy; setServers() queries them with failover.
    const resolvers = (account.propagationResolver ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (resolvers.length === 0) {
      throw new Error('propagationResolver required for resolver mode (account)');
    }
    for (const [fqdn, values] of byFqdn) {
      await wait(fqdn, values, resolvers);
    }
    return;
  }
  // 'authoritative' (default): discover the zone's authoritative nameservers
  // via the system resolver and query them directly. When the zone has no
  // discoverable NS (e.g. a private native zone without apex NS records),
  // discovery returns [] and waitForPropagation falls back to the
  // system-configured resolvers.
  for (const [fqdn, values] of byFqdn) {
    const resolvers = await discover(serverUrl, fqdn);
    await wait(fqdn, values, resolvers);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPropagation(fqdn: string, expectedUnquoted: string[], resolvers: string[]): Promise<void> {
  const resolver = new dns.promises.Resolver();
  // An empty list means "no explicit resolvers": keep the Resolver on the
  // system-configured servers (the container's /etc/resolv.conf).
  if (resolvers.length > 0) resolver.setServers(resolvers);
  const deadline = Date.now() + PROP_TIMEOUT_MS;
  const want = new Set(expectedUnquoted);
  while (Date.now() < deadline) {
    try {
      const recs = await resolver.resolveTxt(fqdn.replace(/\.$/, ''));
      const seen = new Set(recs.map((chunks) => chunks.join('')));
      if ([...want].every((v) => seen.has(v))) return;
    } catch {
      /* NXDOMAIN/not-yet-propagated */
    }
    await sleep(5000);
  }
  throw new Error(`DNS propagation timeout for ${fqdn} (propagation)`);
}
