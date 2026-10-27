import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import * as crypto from 'crypto';
import { BriService } from './bri.service';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { GateService } from '../gate/gate.service';
import {
  BRI_CONFIG,
  BriConfig,
} from '../common/vault/vault-bri-config.service';

const signingKeyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 1024,
});
const signingPrivateKey = signingKeyPair.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .trim();

const briConfig: BriConfig = {
  BRI_BASE_URL: 'https://bri.test',
  BRI_CLIENT_ID: 'test-client-id',
  BRI_CLIENT_SECRET: 'test-client-secret',
  BRI_PARTNER_ID: 'test-partner-id',
  BRI_CHANNEL_ID: 'test-channel-id',
  BRI_MERCHANT_ID: 'test-merchant-id',
  BRI_TERMINAL_ID: 'test-terminal-id',
  BRI_PRIVATE_KEY: signingPrivateKey,
  BRI_WEBHOOK_SECRET: 'test-webhook-secret',
};

describe('BriService', () => {
  let service: BriService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BriService,
        { provide: PrismaService, useValue: {} },
        { provide: DashboardService, useValue: {} },
        { provide: GateService, useValue: {} },
        { provide: BRI_CONFIG, useValue: briConfig },
      ],
    }).compile();

    service = module.get<BriService>(BriService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('signs the access-token request with the injected RSA private key', async () => {
    let requestTimestamp: string | undefined;
    let requestSignature: string | undefined;
    let requestUrl: string | undefined;
    const postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementationOnce((url, _body, options) => {
        requestUrl = url;
        const timestamp: unknown = options?.headers?.['X-TIMESTAMP'];
        const signature: unknown = options?.headers?.['X-SIGNATURE'];
        if (typeof timestamp === 'string') {
          requestTimestamp = timestamp;
        }
        if (typeof signature === 'string') {
          requestSignature = signature;
        }
        return {
          data: { accessToken: 'access-token', expiresIn: 900 },
        } as never;
      });

    await expect(service.getAccessToken()).resolves.toBe('access-token');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(requestUrl).toBe(
      `${briConfig.BRI_BASE_URL}/snap/v1.0/access-token/b2b`,
    );
    expect(requestTimestamp).toBeDefined();
    expect(requestSignature).toBeDefined();

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${briConfig.BRI_CLIENT_ID}|${requestTimestamp}`);
    verifier.end();
    expect(
      verifier.verify(signingKeyPair.publicKey, requestSignature!, 'base64'),
    ).toBe(true);
  });

  it('returns the BRI access-token response format with string expiry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T00:00:00Z'));
    (service as any).accessToken = 'token-123';
    (service as any).accessTokenExpiredAt = Date.now() + 899_000;

    try {
      await expect(service.getAccessTokenResponse()).resolves.toEqual({
        accessToken: 'token-123',
        tokenType: 'BearerToken',
        expiresIn: '899',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['00', 'SUCCESS'],
    ['01', 'PENDING'],
    ['02', 'PENDING'],
    ['03', 'PENDING'],
    ['05', 'CANCELLED'],
    ['06', 'FAILED'],
  ])('maps BRI status %s to %s', async (statusCode, localStatus) => {
    const existingTransaction = {
      id: 'transaction-1',
      partnerReferenceNo: 'partner-1',
      amount: 2000,
      status: 'PENDING',
    };
    const prisma = {
      transaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          ...existingTransaction,
          status: localStatus,
          gateDeviceId: 'gate-1',
        }),
      },
    };
    const gate = {
      emitPaymentStatus: jest.fn(),
      openGateForTransaction: jest.fn(),
    };
    const svc = new BriService(
      prisma as any,
      { getQrAmount: jest.fn() } as any,
      gate as any,
      briConfig,
    );

    await expect(
      (svc as any).applyPaymentStatus(existingTransaction, {
        latestTransactionStatus: statusCode,
      }),
    ).resolves.toMatchObject({ status: localStatus });

    if (localStatus === 'PENDING') {
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    } else {
      expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: localStatus }),
        }),
      );
    }
    if (statusCode === '00') {
      expect(gate.openGateForTransaction).toHaveBeenCalledWith(
        'gate-1',
        'transaction-1',
      );
    } else {
      expect(gate.openGateForTransaction).not.toHaveBeenCalled();
    }
  });

  it('preserves local status for refunded notifications', async () => {
    const prisma = { transaction: { updateMany: jest.fn() } };
    const svc = new BriService(prisma as any, {} as any, {} as any, briConfig);

    await expect(
      (svc as any).applyPaymentStatus(
        { partnerReferenceNo: 'partner-1', amount: 2000, status: 'SUCCESS' },
        { latestTransactionStatus: '04' },
      ),
    ).resolves.toMatchObject({
      localTransactionStatus: 'SUCCESS',
      externalTransactionStatus: '04',
      transactionStatusDesc: 'Refunded status requires local handling',
    });
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('processes duplicate success and late failure notifications idempotently', async () => {
    const pendingTransaction = {
      id: 'transaction-1',
      partnerReferenceNo: 'partner-1',
      amount: 2000,
      status: 'PENDING',
      gateDeviceId: 'gate-1',
    };
    const successfulTransaction = {
      ...pendingTransaction,
      status: 'SUCCESS',
    };
    const prisma = {
      transaction: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(successfulTransaction),
      },
    };
    const gate = {
      emitPaymentStatus: jest.fn(),
      openGateForTransaction: jest.fn(),
    };
    const svc = new BriService(
      prisma as any,
      {} as any,
      gate as any,
      briConfig,
    );

    await expect(
      (svc as any).applyPaymentStatus(pendingTransaction, {
        latestTransactionStatus: '00',
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS' });
    await expect(
      (svc as any).applyPaymentStatus(pendingTransaction, {
        latestTransactionStatus: '00',
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS' });
    await expect(
      (svc as any).applyPaymentStatus(pendingTransaction, {
        latestTransactionStatus: '06',
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS' });

    expect(prisma.transaction.updateMany).toHaveBeenCalledTimes(3);
    expect(prisma.transaction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { partnerReferenceNo: 'partner-1', status: 'PENDING' },
      }),
    );
    expect(gate.emitPaymentStatus).toHaveBeenCalledTimes(1);
    expect(gate.openGateForTransaction).toHaveBeenCalledTimes(1);
  });

  it('matches the vendor webhook body-hash and hex-ASCII examples', () => {
    const rawBody =
      '{"originalReferenceNo":"648681020722","originalPartnerReferenceNo":"000008526196","latestTransactionStatus":"00","transactionStatusDesc":"success","customerNumber":"9360000213214291591","accountType":"Unspecified Acct","destinationAccountName":"LAILI SEPTIAN ZUFRI YAHYA","amount":{"value":"5000.00","currency":"IDR"},"bankCode":"002","AdditionalInfo":{"ReffId":"2004429726","issuerName":"BRI","issuerRrn":"296259544768"}}';
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');

    expect(bodyHash).toBe(
      '35db209a558de1f69c240b9202d99d9995fdfb9a52f0193b2abfe46f208b525f',
    );
    expect(Buffer.from(bodyHash, 'utf8').toString('hex')).toBe(
      '33356462323039613535386465316636396332343062393230326439396439393935666466623961353266303139336232616266653436663230386235323566',
    );
  });

  it('should accept notification payload using partnerReferenceNo alias', async () => {
    const payload = {
      partnerReferenceNo: 'test-ref-1',
      latestTransactionStatus: '00',
      amount: { value: '2000.00', currency: 'IDR' },
    };

    const prisma = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          partnerReferenceNo: 'test-ref-1',
          amount: '2000.00',
          status: 'PENDING',
          terminalId: 'ABC123',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.transaction.findUnique
      .mockResolvedValueOnce({
        partnerReferenceNo: 'test-ref-1',
        amount: '2000.00',
        status: 'PENDING',
        terminalId: 'ABC123',
      })
      .mockResolvedValueOnce({
        partnerReferenceNo: 'test-ref-1',
        amount: '2000.00',
        status: 'SUCCESS',
        terminalId: 'ABC123',
        gateDeviceId: 'gate-1',
        id: 'txn-1',
      });

    const gate = {
      emitPaymentStatus: jest.fn(),
      openGateForTransaction: jest.fn(),
    };

    const secret = 'test-secret';
    const svc = new BriService(
      prisma as any,
      { getQrAmount: jest.fn() } as any,
      gate as any,
      { ...briConfig, BRI_WEBHOOK_SECRET: secret },
    );

    const timestamp = '2026-10-02T15:32:22+07:00';
    const accessToken = 'test-access-token';
    const rawBody = Buffer.from(JSON.stringify(payload));
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const bodyHashAscii = Buffer.from(bodyHash, 'utf8').toString('hex');
    const stringToSign = `POST:/v1.1/qr-dynamic/qr-mpm-notify:${accessToken}:${bodyHashAscii}:${timestamp}`;
    const signature = crypto
      .createHmac('sha512', secret)
      .update(stringToSign)
      .digest('base64');

    await expect(
      svc.handleNotification(payload as any, signature, {
        rawBody,
        timestamp,
        authorization: `Bearer ${accessToken}`,
      }),
    ).resolves.toBeDefined();
    expect(gate.openGateForTransaction).toHaveBeenCalledWith('gate-1', 'txn-1');
  });
});
