import * as acme from 'acme-client';
import { getAcmeAccount, getAccountSecrets, setAccountRegistration } from './store';
import { reloadAcmeTrust } from './acme-trust';
import type { AcmeAccount } from './types';

/** Register (or re-register) an ACME account with its CA. Requires tosAgreed. */
export async function registerAccount(id: string): Promise<AcmeAccount> {
  const account = getAcmeAccount(id);
  if (!account) throw new Error('account not found');
  if (!account.tosAgreed) throw new Error('Terms of Service must be agreed before registration');

  const secrets = getAccountSecrets(id);
  // Generate an account key if none stored yet.
  let accountKeyPem = secrets?.accountKeyPem;
  if (!accountKeyPem) {
    accountKeyPem = (await acme.crypto.createPrivateKey()).toString();
  }

  // EAB is a Client-constructor option, NOT part of the createAccount() data:
  // acme-client signs the EAB JWS itself (HttpClient#signedRequest) from
  // opts.externalAccountBinding and overwrites whatever is in the createAccount
  // payload — passing {kid, hmacKey} inside createAccount()'s data would send an
  // unsigned, invalid EAB object to the CA.
  const externalAccountBinding =
    account.eabKid && secrets?.eabHmacKey ? { kid: account.eabKid, hmacKey: secrets.eabHmacKey } : undefined;
  // Ensure the shared axios trusts this account's pinned root (step-ca / private CA) before we talk to the CA.
  reloadAcmeTrust();
  const client = new acme.Client({
    directoryUrl: account.directoryUrl,
    accountKey: accountKeyPem,
    externalAccountBinding,
  });

  const createOpts: { contact?: string[]; termsOfServiceAgreed: boolean } = {
    termsOfServiceAgreed: true,
    contact: account.contactEmail ? [`mailto:${account.contactEmail}`] : undefined,
  };

  try {
    await client.createAccount(createOpts);
    const accountUrl = client.getAccountUrl();
    setAccountRegistration(id, { accountKeyPem, accountUrl, status: 'registered', clearEab: true });
  } catch (err) {
    setAccountRegistration(id, { accountKeyPem, accountUrl: account.accountUrl ?? '', status: 'error', clearEab: false });
    throw err;
  }
  return getAcmeAccount(id)!;
}
