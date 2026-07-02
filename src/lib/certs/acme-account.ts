import * as acme from 'acme-client';
import { getAcmeAccount, getAccountSecrets, setAccountRegistration } from './store';
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

  const client = new acme.Client({ directoryUrl: account.directoryUrl, accountKey: accountKeyPem });

  const createOpts: { contact?: string[]; termsOfServiceAgreed: boolean; externalAccountBinding?: { kid: string; hmacKey: string } } = {
    termsOfServiceAgreed: true,
    contact: account.contactEmail ? [`mailto:${account.contactEmail}`] : undefined,
  };
  if (account.eabKid && secrets?.eabHmacKey) {
    createOpts.externalAccountBinding = { kid: account.eabKid, hmacKey: secrets.eabHmacKey };
  }

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
