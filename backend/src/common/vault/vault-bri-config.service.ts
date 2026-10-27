import { Injectable } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';

export const BRI_CONFIG = Symbol('BRI_CONFIG');

export interface BriConfig {
  BRI_BASE_URL: string;
  BRI_CLIENT_ID: string;
  BRI_CLIENT_SECRET: string;
  BRI_PARTNER_ID: string;
  BRI_CHANNEL_ID: string;
  BRI_MERCHANT_ID: string;
  BRI_TERMINAL_ID: string;
  BRI_PRIVATE_KEY: string;
  BRI_WEBHOOK_SECRET: string;
}

interface AppRoleCredentials {
  role_id: string;
  secret_id: string;
}

interface VaultLoginResponse {
  auth?: {
    client_token?: unknown;
  };
}

interface VaultSecretResponse {
  data?: {
    data?: unknown;
  };
}

const REQUIRED_BRI_KEYS: (keyof BriConfig)[] = [
  'BRI_BASE_URL',
  'BRI_CLIENT_ID',
  'BRI_CLIENT_SECRET',
  'BRI_PARTNER_ID',
  'BRI_CHANNEL_ID',
  'BRI_MERCHANT_ID',
  'BRI_TERMINAL_ID',
  'BRI_PRIVATE_KEY',
  'BRI_WEBHOOK_SECRET',
];

const VAULT_REQUEST_TIMEOUT_MS = 5_000;

@Injectable()
export class VaultBriConfigService {
  async loadBriConfig(): Promise<BriConfig> {
    const vaultAddress = this.getVaultAddress();
    const approleFile = this.requireEnvironmentValue('VAULT_APPROLE_FILE');
    const caFile = this.requireEnvironmentValue('VAULT_CA_CERT');

    const credentials = this.readAppRoleCredentials(approleFile);
    const caCertificate = this.readCaCertificate(caFile);
    const agent = new https.Agent({
      ca: caCertificate,
      rejectUnauthorized: true,
      timeout: VAULT_REQUEST_TIMEOUT_MS,
    });

    try {
      let loginResponse: AxiosResponse<VaultLoginResponse>;
      try {
        loginResponse = await axios.post<VaultLoginResponse>(
          `${vaultAddress}/v1/auth/approle/login`,
          credentials,
          {
            httpsAgent: agent,
            timeout: VAULT_REQUEST_TIMEOUT_MS,
          },
        );
      } catch {
        throw new Error('Vault AppRole authentication failed');
      }
      const token = loginResponse.data?.auth?.client_token;
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('Vault AppRole response did not contain a token');
      }

      let secretResponse: AxiosResponse<VaultSecretResponse>;
      try {
        secretResponse = await axios.get<VaultSecretResponse>(
          `${vaultAddress}/v1/secret/data/brisnap`,
          {
            headers: { 'X-Vault-Token': token },
            httpsAgent: agent,
            timeout: VAULT_REQUEST_TIMEOUT_MS,
          },
        );
      } catch {
        throw new Error('Unable to read BRI configuration from Vault');
      }

      return this.validateBriConfig(secretResponse.data?.data?.data);
    } finally {
      agent.destroy();
    }
  }

  private getVaultAddress(): string {
    const address = this.requireEnvironmentValue('VAULT_ADDR');

    try {
      const parsed = new URL(address);
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error();
      }

      return parsed.toString().replace(/\/+$/, '');
    } catch {
      throw new Error('VAULT_ADDR must be a valid HTTPS URL');
    }
  }

  private requireEnvironmentValue(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  }

  private readAppRoleCredentials(filePath: string): AppRoleCredentials {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') {
        throw new Error();
      }

      const { role_id, secret_id } = parsed as Record<string, unknown>;
      if (
        typeof role_id !== 'string' ||
        !role_id.trim() ||
        typeof secret_id !== 'string' ||
        !secret_id.trim()
      ) {
        throw new Error();
      }

      return { role_id, secret_id };
    } catch {
      throw new Error('Unable to read valid Vault AppRole credentials');
    }
  }

  private readCaCertificate(filePath: string): string {
    try {
      const caCertificate = fs.readFileSync(filePath, 'utf8');
      if (!caCertificate.trim()) {
        throw new Error();
      }
      return caCertificate;
    } catch {
      throw new Error('Unable to read Vault CA certificate');
    }
  }

  private validateBriConfig(value: unknown): BriConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Vault returned malformed BRI configuration');
    }

    const data = value as Record<string, unknown>;
    const config = {} as BriConfig;

    for (const key of REQUIRED_BRI_KEYS) {
      const field = data[key];
      if (typeof field !== 'string' || !field.trim()) {
        throw new Error(`Vault BRI configuration is missing ${key}`);
      }
      config[key] = field.trim();
    }

    if (!config.BRI_PRIVATE_KEY.includes('-----BEGIN')) {
      throw new Error('Vault BRI private key is not a PEM private key');
    }

    try {
      const privateKey = crypto.createPrivateKey(config.BRI_PRIVATE_KEY);
      if (privateKey.asymmetricKeyType !== 'rsa') {
        throw new Error();
      }
    } catch {
      throw new Error('Vault BRI private key must be a valid RSA PEM key');
    }

    return config;
  }
}
