import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { GateService } from '../gate/gate.service';
import { BRI_CONFIG } from '../common/vault/vault-bri-config.service';
import type { BriConfig } from '../common/vault/vault-bri-config.service';

@Injectable()
export class BriService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
    private readonly gateService: GateService,
    @Inject(BRI_CONFIG) private readonly config: BriConfig,
  ) {}

  private accessToken: string | null = null;
  private accessTokenExpiredAt = 0;

  /**
   * Generate timestamp ISO 8601
   */
  private generateTimestamp(): string {
    const now = new Date();

    const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    return jakartaTime.toISOString().slice(0, 19) + '+07:00';
  }
  /**
   * Generate unique external ID.
   *
   * BRI requires X-EXTERNAL-ID to be unique.
   */
  private generateExternalId(): string {
    return Date.now().toString() + crypto.randomInt(100000, 999999);
  }

  /**
   * Generate access token.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Buffer 30 detik sebelum expired
    if (this.accessToken && now < this.accessTokenExpiredAt - 30_000) {
      return this.accessToken;
    }

    const timestamp = this.generateTimestamp();

    const stringToSign = `${this.config.BRI_CLIENT_ID}|${timestamp}`;

    /**
     * Signature OAuth:
     * SHA256withRSA
     */
    const signer = crypto.createSign('RSA-SHA256');

    signer.update(stringToSign);
    signer.end();

    const signature = signer.sign(this.config.BRI_PRIVATE_KEY, 'base64');

    const response = await axios.post(
      `${this.config.BRI_BASE_URL}/snap/v1.0/access-token/b2b`,
      {
        grantType: 'client_credentials',
        additionalInfo: {},
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-TIMESTAMP': timestamp,
          'X-CLIENT-KEY': this.config.BRI_CLIENT_ID,
          'X-SIGNATURE': signature,
        },
      },
    );

    const data = response.data;

    if (!data.accessToken) {
      throw new InternalServerErrorException(
        `Gagal mendapatkan BRI access token: ${JSON.stringify(data)}`,
      );
    }

    this.accessToken = data.accessToken;

    const expiresIn = Number(data.expiresIn ?? 900);

    this.accessTokenExpiredAt = Date.now() + expiresIn * 1000;

    return data.accessToken;
  }

  async getAccessTokenResponse() {
    const accessToken = await this.getAccessToken();

    return {
      accessToken,
      tokenType: 'BearerToken',
      expiresIn: String(
        Math.max(
          0,
          Math.floor((this.accessTokenExpiredAt - Date.now()) / 1000),
        ),
      ),
    };
  }

  /**
   * Generate BRI transactional signature.
   */
  private generateSignature(
    method: string,
    endpoint: string,
    accessToken: string,
    timestamp: string,
    body: unknown,
  ): string {
    const minifiedBody = JSON.stringify(body);

    const bodyHash = crypto
      .createHash('sha256')
      .update(minifiedBody)
      .digest('hex')
      .toLowerCase();

    const stringToSign = `${method}:${endpoint}:${accessToken}:${bodyHash}:${timestamp}`;

    return crypto
      .createHmac('sha512', this.config.BRI_CLIENT_SECRET)
      .update(stringToSign)
      .digest('base64');
  }

  /**
   * Generate QR MPM Dynamic
   */
  async generateQR(deviceCode?: string) {
    const gateDevice = await this.gateService.resolveDevice(deviceCode);
    const endpoint = '/snap/v1.1/qr/qr-mpm-generate';

    const accessToken = await this.getAccessToken();

    const timestamp = this.generateTimestamp();
    const qrAmount = await this.dashboardService.getQrAmount();
    const partnerReferenceNo = `${Date.now()}${Math.floor(Math.random() * 900000) + 100000}`;

    const body = {
      partnerReferenceNo,

      amount: {
        value: qrAmount.toFixed(2),
        currency: 'IDR',
      },

      merchantId: this.config.BRI_MERCHANT_ID,

      terminalId: this.config.BRI_TERMINAL_ID,
    };

    const signature = this.generateSignature(
      'POST',
      endpoint,
      accessToken,
      timestamp,
      body,
    );

    const externalId = this.generateExternalId();

    const response = await axios.post(
      `${this.config.BRI_BASE_URL}${endpoint}`,
      body,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',

          Authorization: `Bearer ${accessToken}`,

          'X-TIMESTAMP': timestamp,
          'X-SIGNATURE': signature,

          'X-PARTNER-ID': this.config.BRI_PARTNER_ID,
          'X-EXTERNAL-ID': externalId,
          'CHANNEL-ID': this.config.BRI_CHANNEL_ID,
        },
      },
    );

    const responseData = response.data as Record<string, unknown>;
    const referenceNo =
      typeof responseData.referenceNo === 'string'
        ? responseData.referenceNo
        : '';
    const qrContent =
      typeof responseData.qrContent === 'string' ? responseData.qrContent : '';

    if (!referenceNo || !qrContent) {
      return response.data;
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        partnerReferenceNo,
        externalId,
        referenceNo,
        amount: qrAmount,
        status: 'PENDING',
        qrContent,
        terminalId: this.config.BRI_TERMINAL_ID,
        gateDeviceId: gateDevice.id,
        expiredAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    return {
      ...responseData,
      transactionId: transaction.id,
      transactionStatus: transaction.status,
      gateDeviceCode: gateDevice.deviceCode,
    };
  }

  async inquiry(partnerReferenceNo: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { partnerReferenceNo },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const endpoint = '/snap/v1.1/qr/qr-mpm-query';
    const accessToken = await this.getAccessToken();
    const timestamp = this.generateTimestamp();
    const body = {
      originalReferenceNo: transaction.referenceNo,
      serviceCode: '47',
      additionalInfo: {
        terminalId: transaction.terminalId,
      },
    };
    const signature = this.generateSignature(
      'POST',
      endpoint,
      accessToken,
      timestamp,
      body,
    );
    const response = await axios.post(
      `${this.config.BRI_BASE_URL}${endpoint}`,
      body,
      {
        headers: this.buildTransactionHeaders(
          accessToken,
          timestamp,
          signature,
        ),
      },
    );

    const responseAmount = this.getAmount(response.data);
    if (
      responseAmount !== undefined &&
      responseAmount !== Number(transaction.amount).toFixed(2)
    ) {
      throw new BadRequestException(
        'Inquiry amount does not match transaction',
      );
    }

    return this.applyPaymentStatus(transaction, response.data);
  }

  async handleNotification(
    payload: Record<string, unknown>,
    signature?: string,
    requestInfo: {
      rawBody?: Buffer;
      timestamp?: string;
      authorization?: string;
    } = {},
  ) {
    this.verifyWebhookSignature(signature, requestInfo);

    const partnerReferenceNo =
      this.getString(payload, 'originalPartnerReferenceNo') ??
      this.getString(payload, 'partnerReferenceNo');

    if (!partnerReferenceNo) {
      throw new BadRequestException(
        'originalPartnerReferenceNo or partnerReferenceNo is required',
      );
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { partnerReferenceNo },
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const amount = this.getAmount(payload);
    if (
      amount !== undefined &&
      amount !== Number(transaction.amount).toFixed(2)
    ) {
      throw new BadRequestException(
        'Notification amount does not match transaction',
      );
    }

    return this.applyPaymentStatus(transaction, payload);
  }

  private async applyPaymentStatus(
    transaction: {
      partnerReferenceNo: string;
      amount: unknown;
      status: string;
    },
    payload: Record<string, unknown>,
  ) {
    const statusCode = this.getString(payload, 'latestTransactionStatus');
    const responseCode = this.getString(payload, 'responseCode');
    const status = statusCode
      ? this.mapTransactionStatus(statusCode)
      : responseCode === '2000000'
        ? 'SUCCESS'
        : undefined;

    if (!status) {
      return {
        ...payload,
        localTransactionStatus: transaction.status,
        ...(statusCode === '04'
          ? {
              externalTransactionStatus: statusCode,
              transactionStatusDesc: 'Refunded status requires local handling',
            }
          : {}),
      };
    }

    if (status === transaction.status) {
      return transaction;
    }

    const updateResult = await this.prisma.transaction.updateMany({
      where: {
        partnerReferenceNo: transaction.partnerReferenceNo,
        status: status === 'SUCCESS' ? { not: 'SUCCESS' } : 'PENDING',
      },
      data: {
        status,
        ...(status === 'SUCCESS' ? { paidAt: new Date() } : {}),
      },
    });

    const updatedTransaction = await this.prisma.transaction.findUnique({
      where: { partnerReferenceNo: transaction.partnerReferenceNo },
    });
    if (!updatedTransaction || updateResult.count === 0) {
      return updatedTransaction ?? transaction;
    }

    if (status === 'SUCCESS') {
      this.gateService.emitPaymentStatus({
        partnerReferenceNo: updatedTransaction.partnerReferenceNo,
        transactionId: updatedTransaction.id,
        status: 'SUCCESS',
        amount: Number(updatedTransaction.amount).toFixed(2),
      });
      await this.gateService.openGateForTransaction(
        updatedTransaction.gateDeviceId,
        updatedTransaction.id,
      );
    }
    return updatedTransaction;
  }

  private mapTransactionStatus(
    statusCode: string,
  ): 'SUCCESS' | 'PENDING' | 'FAILED' | 'CANCELLED' | undefined {
    switch (statusCode) {
      case '00':
        return 'SUCCESS';
      case '01':
      case '02':
      case '03':
        return 'PENDING';
      case '05':
        return 'CANCELLED';
      case '06':
        return 'FAILED';
      default:
        return undefined;
    }
  }

  private verifyWebhookSignature(
    signature: string | undefined,
    requestInfo: {
      rawBody?: Buffer;
      timestamp?: string;
      authorization?: string;
    },
  ) {
    if (!signature) {
      throw new UnauthorizedException('BRI webhook signature is required');
    }

    const timestamp = requestInfo.timestamp?.trim();
    const accessToken = requestInfo.authorization
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!timestamp || !accessToken) {
      throw new UnauthorizedException(
        'BRI webhook timestamp and bearer token are required',
      );
    }

    const body = requestInfo.rawBody?.toString('utf8');
    if (body === undefined) {
      throw new UnauthorizedException('BRI webhook raw body is unavailable');
    }

    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const bodyHashAscii = Buffer.from(bodyHash, 'utf8').toString('hex');
    const stringToSign = `POST:/v1.1/qr-dynamic/qr-mpm-notify:${accessToken}:${bodyHashAscii}:${timestamp}`;
    const normalizedSignature = signature.trim();
    const receivedBuffer = Buffer.from(normalizedSignature, 'base64');
    const isCanonicalBase64 =
      receivedBuffer.toString('base64') === normalizedSignature;
    const expectedBuffer = crypto
      .createHmac('sha512', this.config.BRI_WEBHOOK_SECRET)
      .update(stringToSign, 'utf8')
      .digest();
    const matches =
      isCanonicalBase64 &&
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    if (!matches) {
      throw new UnauthorizedException('Invalid BRI webhook signature');
    }
  }

  private buildTransactionHeaders(
    accessToken: string,
    timestamp: string,
    signature: string,
  ) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-TIMESTAMP': timestamp,
      'X-SIGNATURE': signature,
      'X-PARTNER-ID': this.config.BRI_PARTNER_ID,
      'X-EXTERNAL-ID': this.generateExternalId(),
      'CHANNEL-ID': this.config.BRI_CHANNEL_ID,
    };
  }

  private getString(payload: Record<string, unknown>, key: string) {
    return typeof payload[key] === 'string' ? payload[key] : undefined;
  }

  private getAmount(payload: Record<string, unknown>) {
    const amount = payload.amount;
    if (!amount || typeof amount !== 'object') {
      return undefined;
    }
    const value = (amount as Record<string, unknown>).value;
    return typeof value === 'string' || typeof value === 'number'
      ? Number(value).toFixed(2)
      : undefined;
  }
}
