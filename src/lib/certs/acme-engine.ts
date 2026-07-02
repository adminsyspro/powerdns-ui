import * as acme from 'acme-client';
import * as dns from 'dns';
import type { RRSet } from '@/types/powerdns';
import { getJob, recordJobOrder, recordJobChallenges, markJobCleanupDone, finishJob } from './job-store';
import { getCertificate as getCert, updateCertificateIssuance, setCertificateRenewalFailure } from './cert-store';
import { getAcmeAccount, getAccountSecrets } from './store';
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
    if (!account || account.status !== 'registered') throw new Error('account not registered');
    const secrets = getAccountSecrets(account.id);
    if (!secrets?.accountKeyPem) throw new Error('account key missing');
    if (!pdns) throw new Error('PowerDNS connection missing (dns-write)');
    // Fail fast, before touching the CA, if any SAN isn't in a managed zone.
    resolveZonesForSans(cert.serverUrl, cert.sans);

    const client = new acme.Client({ directoryUrl: account.directoryUrl, accountKey: secrets.accountKeyPem });

    // 1. Create or resume the order. client.getOrder() only reads order.url at
    // runtime (it re-fetches the order from the CA), so a minimal placeholder
    // object satisfying the Order shape is safe and avoids persisting the full
    // order JSON just to resume.
    const identifiers = cert.sans.map((value) => ({ type: 'dns' as const, value }));
    let order: acme.Order;
    if (job.orderUrl) {
      order = await client.getOrder({
        url: job.orderUrl,
        status: 'pending',
        identifiers: [],
        authorizations: [],
        finalize: '',
      });
    } else {
      order = await client.createOrder({ identifiers });
      recordJobOrder(jobId, order.url);
    }

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

    // 3. Write TXT records (UNION with existing), record what we added
    const byFqdn = groupChallengesByFqdn(challengeItems.map((c) => ({ fqdn: c.fqdn, value: c.value })));
    const added: { fqdn: string; value: string }[] = [];
    for (const [fqdn, values] of byFqdn) {
      const zone = zoneFor(cert.serverUrl, fqdn);
      const existing = await readTxt(pdns, zone, fqdn);
      const merged = mergeTxtValues(existing, values);
      await patch(pdns, zone, buildTxtRrset(fqdn, merged));
      for (const v of values) added.push({ fqdn, value: v });
    }
    recordJobChallenges(jobId, added);

    // 4. Wait for DNS propagation, then complete + validate
    for (const [fqdn, values] of byFqdn) {
      await waitForPropagation(fqdn, values, account.propagationResolver);
    }
    for (const item of challengeItems) {
      await client.completeChallenge(item.challenge);
      await client.waitForValidStatus(item.challenge);
    }

    // 5. Finalize: new keypair + CSR, then fetch the cert chain.
    // acme.crypto.createCsr always generates an RSA key internally UNLESS a
    // keyPem is passed in — so ECDSA certs must generate the EC key first via
    // createPrivateEcdsaKey() and hand it to createCsr as the second arg.
    let keyPem: Buffer;
    let csr: Buffer;
    if (cert.keyType === 'rsa') {
      [keyPem, csr] = await acme.crypto.createCsr({ altNames: cert.sans, keySize: 2048 });
    } else {
      keyPem = await acme.crypto.createPrivateEcdsaKey();
      [, csr] = await acme.crypto.createCsr({ altNames: cert.sans }, keyPem);
    }
    await client.finalizeOrder(order, csr);
    const fullchain = await client.getCertificate(order);

    // 6. Persist + materialize
    const { leaf, chain } = splitPemChain(fullchain);
    const info = parseCertInfo(leaf);
    updateCertificateIssuance(cert.id, {
      certPem: leaf, chainPem: chain, privkeyPem: keyPem.toString(),
      notBefore: info.notBefore, notAfter: info.notAfter,
      serial: info.serial, fingerprint: info.fingerprintSha256, issuer: info.issuer,
    });
    materializeCert({ name: cert.name, leafPem: leaf, chainPem: chain, privkeyPem: keyPem.toString() });
    appendCertEvent({
      certificateId: cert.id,
      type: job.kind === 'renew' ? 'renew' : 'issue',
      status: 'ok',
      message: `issued (expires ${new Date(info.notAfter * 1000).toISOString()})`,
    });

    // 7. Cleanup TXT + finish
    await cleanup(pdns, cert.serverUrl, added).catch(() => {});
    markJobCleanupDone(jobId);
    finishJob(jobId, 'succeeded');
  } catch (err) {
    const { errorClass, message, retryDelayMs } = classifyError(err);
    const j = getJob(jobId);
    if (pdns && j && j.challenges.length) {
      await cleanup(pdns, cert.serverUrl, j.challenges).catch(() => {});
      markJobCleanupDone(jobId);
    }
    const nextAttemptAt = Math.floor(Date.now() / 1000) + Math.floor(retryDelayMs / 1000);
    setCertificateRenewalFailure(job.certificateId, { errorClass, message, nextAttemptAt });
    appendCertEvent({ certificateId: job.certificateId, type: 'error', status: errorClass, message });
    finishJob(jobId, 'failed', { errorClass, message, nextAttemptAt });
  }
}

// --- helpers (module-private) ---

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
 * others, and a stale/deleted zone is skipped rather than throwing (a later
 * crash-recovery pass, or the operator, can retry).
 */
async function cleanup(
  pdns: PowerDNSClient,
  serverUrl: string,
  added: { fqdn: string; value: string }[]
): Promise<void> {
  const byFqdn = groupChallengesByFqdn(added);
  for (const [fqdn, values] of byFqdn) {
    try {
      const zone = resolveZoneForFqdn(serverUrl, fqdn);
      if (!zone) continue;
      const existing = await readTxt(pdns, zone, fqdn);
      const remainder = removeTxtValues(existing, values);
      if (remainder.length === 0) {
        await patch(pdns, zone, buildTxtDelete(fqdn));
      } else {
        await patch(pdns, zone, buildTxtRrset(fqdn, remainder));
      }
    } catch {
      // best-effort; see doc comment above
    }
  }
}

async function waitForPropagation(fqdn: string, expectedUnquoted: string[], resolverIp?: string | null): Promise<void> {
  const resolver = new dns.promises.Resolver();
  resolver.setServers(resolverIp ? [resolverIp] : ['1.1.1.1', '8.8.8.8']);
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
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`DNS propagation timeout for ${fqdn} (propagation)`);
}
