import axios from 'axios';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as https from 'node:https';
import { BriConfig, VaultBriConfigService } from './vault-bri-config.service';

const privateKey = crypto
  .generateKeyPairSync('rsa', { modulusLength: 1024 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .trim();

const validConfig: BriConfig = {
  BRI_BASE_URL: 'https://sandbox.partner.api.bri.co.id',
  BRI_CLIENT_ID: 'client-id',
  BRI_CLIENT_SECRET: 'client-secret',
  BRI_PARTNER_ID: 'partner-id',
  BRI_CHANNEL_ID: 'channel-id',
  BRI_MERCHANT_ID: 'merchant-id',
  BRI_TERMINAL_ID: 'terminal-id',
  BRI_PRIVATE_KEY: privateKey,
  BRI_WEBHOOK_SECRET: 'webhook-secret',
};

describe('VaultBriConfigService', () => {
  let service: VaultBriConfigService;
  let tempDirectory: string;
  let originalEnvironment: Record<string, string | undefined>;
  let postSpy: jest.SpiedFunction<typeof axios.post>;
  let getSpy: jest.SpiedFunction<typeof axios.get>;
  let requestAgent: https.Agent | undefined;

  beforeEach(() => {
    service = new VaultBriConfigService();
    postSpy = jest.spyOn(axios, 'post');
    getSpy = jest.spyOn(axios, 'get');
    requestAgent = undefined;
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-bri-test-'));
    originalEnvironment = {
      VAULT_ADDR: process.env.VAULT_ADDR,
      VAULT_APPROLE_FILE: process.env.VAULT_APPROLE_FILE,
      VAULT_CA_CERT: process.env.VAULT_CA_CERT,
    };

    const approleFile = path.join(tempDirectory, 'approle.json');
    const caFile = path.join(tempDirectory, 'ca.crt');
    fs.writeFileSync(
      approleFile,
      JSON.stringify({ role_id: 'role-id', secret_id: 'secret-id' }),
    );
    fs.writeFileSync(caFile, 'test CA certificate');

    process.env.VAULT_ADDR = 'https://vault.test:8200/';
    process.env.VAULT_APPROLE_FILE = approleFile;
    process.env.VAULT_CA_CERT = caFile;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDirectory, { recursive: true, force: true });

    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  function mockVaultSuccess(config: unknown = validConfig) {
    postSpy.mockImplementationOnce((_url, _body, options) => {
      if (options?.httpsAgent instanceof https.Agent) {
        requestAgent = options.httpsAgent;
      }
      return Promise.resolve({
        data: { auth: { client_token: 'vault-token' } },
      } as never);
    });
    getSpy.mockResolvedValueOnce({
      data: { data: { data: config } },
    } as never);
  }

  it('authenticates with AppRole and reads KV v2 over TLS', async () => {
    mockVaultSuccess();

    await expect(service.loadBriConfig()).resolves.toEqual(validConfig);

    expect(postSpy).toHaveBeenCalledWith(
      'https://vault.test:8200/v1/auth/approle/login',
      { role_id: 'role-id', secret_id: 'secret-id' },
      expect.objectContaining({
        timeout: 5000,
      }),
    );
    expect(getSpy).toHaveBeenCalledWith(
      'https://vault.test:8200/v1/secret/data/brisnap',
      expect.objectContaining({
        headers: { 'X-Vault-Token': 'vault-token' },
        timeout: 5000,
      }),
    );

    expect(requestAgent).toBeInstanceOf(https.Agent);
    if (!requestAgent) {
      throw new Error('Vault request did not use an HTTPS agent');
    }
    expect(requestAgent.options.ca).toBe('test CA certificate');
    expect(requestAgent.options.rejectUnauthorized).toBe(true);
  });

  it('fails with sanitized errors when Vault HTTPS validation fails', async () => {
    postSpy.mockRejectedValueOnce(new Error('certificate validation detail'));

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Vault AppRole authentication failed',
    );
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('fails with sanitized errors when AppRole authentication is denied', async () => {
    postSpy.mockRejectedValueOnce(
      new Error('denied: secret-id must not appear'),
    );

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Vault AppRole authentication failed',
    );
  });

  it('fails with sanitized errors when the Vault policy denies the KV read', async () => {
    postSpy.mockResolvedValueOnce({
      data: { auth: { client_token: 'vault-token' } },
    } as never);
    getSpy.mockRejectedValueOnce(
      new Error('permission denied for vault-token'),
    );

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Unable to read BRI configuration from Vault',
    );
  });

  it('rejects malformed AppRole credentials without exposing their values', async () => {
    fs.writeFileSync(
      process.env.VAULT_APPROLE_FILE!,
      JSON.stringify({ role_id: 'role-only' }),
    );

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Unable to read valid Vault AppRole credentials',
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed Vault response structures', async () => {
    mockVaultSuccess(null);

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Vault returned malformed BRI configuration',
    );
  });

  it.each([
    'BRI_BASE_URL',
    'BRI_CLIENT_ID',
    'BRI_CLIENT_SECRET',
    'BRI_PARTNER_ID',
    'BRI_CHANNEL_ID',
    'BRI_MERCHANT_ID',
    'BRI_TERMINAL_ID',
    'BRI_PRIVATE_KEY',
    'BRI_WEBHOOK_SECRET',
  ] as const)('rejects Vault data missing %s', async (key) => {
    const incompleteConfig: Record<string, unknown> = { ...validConfig };
    delete incompleteConfig[key];
    mockVaultSuccess(incompleteConfig);

    await expect(service.loadBriConfig()).rejects.toThrow(
      `Vault BRI configuration is missing ${key}`,
    );
  });

  it('rejects private keys without a PEM header', async () => {
    mockVaultSuccess({ ...validConfig, BRI_PRIVATE_KEY: 'not-a-private-key' });

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Vault BRI private key is not a PEM private key',
    );
  });

  it('rejects unparseable PEM private keys', async () => {
    mockVaultSuccess({
      ...validConfig,
      BRI_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----',
    });

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Vault BRI private key must be a valid RSA PEM key',
    );
  });

  it('rejects valid PEM keys that are not RSA keys', async () => {
    const ecPrivateKey = crypto
      .generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString()
      .trim();
    mockVaultSuccess({ ...validConfig, BRI_PRIVATE_KEY: ecPrivateKey });

    await expect(service.loadBriConfig()).rejects.toThrow(
      'Vault BRI private key must be a valid RSA PEM key',
    );
  });

  it('rejects non-HTTPS Vault addresses before making requests', async () => {
    process.env.VAULT_ADDR = 'http://vault.test:8200';

    await expect(service.loadBriConfig()).rejects.toThrow(
      'VAULT_ADDR must be a valid HTTPS URL',
    );
    expect(postSpy).not.toHaveBeenCalled();
  });
});
