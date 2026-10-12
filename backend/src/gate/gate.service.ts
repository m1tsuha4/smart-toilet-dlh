import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GateService {
  private server?: Server;
  private readonly defaultDeviceCode =
    process.env.DEFAULT_GATE_DEVICE_CODE?.trim() || 'GATE-001';

  constructor(private readonly prisma: PrismaService) {}

  setServer(server: Server) {
    this.server = server;
  }

  registerDevice(name: string, deviceCode: string) {
    return this.prisma.gateDevices.create({
      data: {
        name,
        deviceCode,
        status: 'OFFLINE',
      },
      select: {
        id: true,
        name: true,
        deviceCode: true,
        authToken: true,
        status: true,
      },
    });
  }

  async listDevices() {
    const devices = await this.prisma.gateDevices.findMany({
      orderBy: { name: 'asc' },
    });
    const activeSince = new Date(Date.now() - 30_000);

    return devices.map((device) => ({
      id: device.id,
      name: device.name,
      deviceCode: device.deviceCode,
      authToken: device.authToken,
      status:
        device.lastConnectedAt && device.lastConnectedAt >= activeSince
          ? 'ACTIVE'
          : 'OFFLINE',
      lastConnectedAt: device.lastConnectedAt,
    }));
  }

  async listDeviceCodes() {
    const devices = await this.prisma.gateDevices.findMany({
      select: { deviceCode: true },
      orderBy: { deviceCode: 'asc' },
    });

    return devices.map((device) => device.deviceCode);
  }

  async setDeviceStatus(deviceCode: string, status: string) {
    await this.prisma.gateDevices.update({
      where: { deviceCode },
      data: { status, lastConnectedAt: new Date() },
    });
    this.server?.to('dashboard').emit('gate:status', {
      deviceCode,
      status,
      lastConnectedAt: new Date().toISOString(),
    });
  }

  async resolveDevice(deviceCode?: string) {
    const resolvedDeviceCode = deviceCode?.trim() || this.defaultDeviceCode;
    const device = await this.prisma.gateDevices.findUnique({
      where: { deviceCode: resolvedDeviceCode },
      select: { id: true, deviceCode: true },
    });

    if (!device) {
      throw new BadRequestException(
        `Gate device "${resolvedDeviceCode}" is not registered`,
      );
    }

    return device;
  }

  async openGateForTransaction(
    gateDeviceId: string | null | undefined,
    transactionId: string,
  ) {
    const device = gateDeviceId
      ? await this.prisma.gateDevices.findUnique({
          where: { id: gateDeviceId },
          select: { deviceCode: true },
        })
      : null;

    return this.openGate(
      device?.deviceCode ?? this.defaultDeviceCode,
      transactionId,
      'PAYMENT',
    );
  }

  emitPaymentStatus(payload: Record<string, unknown>) {
    this.server?.to('dashboard').emit('payment:status', payload);
    const partnerReferenceNo = payload.partnerReferenceNo;
    if (typeof partnerReferenceNo === 'string') {
      this.server?.to(`payment:${partnerReferenceNo}`).emit('payment:status', payload);
    }
  }

  async sendSystemCommand(
    deviceCode: string,
    action: 'shutdown' | 'reboot' | 'set-shutdown-schedule',
    time?: string | null,
  ) {
    const normalizedTime = typeof time === 'string' ? time.trim() : time;
    if (
      action === 'set-shutdown-schedule' &&
      normalizedTime !== null &&
      (typeof normalizedTime !== 'string' ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime))
    ) {
      throw new BadRequestException('time must be HH:MM or null to disable');
    }

    const device = await this.prisma.gateDevices.findUnique({
      where: { deviceCode },
      select: { deviceCode: true },
    });
    if (!device) {
      throw new BadRequestException(`Gate device "${deviceCode}" is not registered`);
    }
    if (!this.server) {
      throw new BadRequestException('WebSocket server unavailable');
    }

    const room = `device:${deviceCode}`;
    const connectedSockets = await this.server.in(room).fetchSockets();
    if (connectedSockets.length === 0) {
      throw new BadRequestException('Gate device is not connected');
    }

    const commandId = randomUUID();
    this.server.to(room).emit('system:command', {
      commandId,
      deviceCode,
      action,
      ...(action === 'set-shutdown-schedule' ? { time: normalizedTime } : {}),
    });

    return { commandId, deviceCode, action, sent: true };
  }

  async getShutdownSchedule(deviceCode: string) {
    const device = await this.prisma.gateDevices.findUnique({
      where: { deviceCode },
      select: { deviceCode: true },
    });
    if (!device) {
      throw new BadRequestException(`Gate device "${deviceCode}" is not registered`);
    }
    if (!this.server) {
      throw new ServiceUnavailableException('WebSocket server unavailable');
    }

    const room = `device:${deviceCode}`;
    const connectedSockets = await this.server.in(room).fetchSockets();
    if (connectedSockets.length === 0) {
      throw new ServiceUnavailableException('Gate device is not connected');
    }

    try {
      const responses = (await this.server
        .to(room)
        .timeout(5_000)
        .emitWithAck('system:command', {
          commandId: randomUUID(),
          deviceCode,
          action: 'get-shutdown-schedule',
        })) as unknown as Array<Record<string, unknown>>;
      const response = responses[0];
      if (
        !response ||
        response.success !== true ||
        (response.time !== null &&
          (typeof response.time !== 'string' ||
            !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(response.time)))
      ) {
        throw new ServiceUnavailableException(
          typeof response?.error === 'string'
            ? response.error
            : 'Raspberry Pi returned an invalid shutdown schedule',
        );
      }

      return { deviceCode, time: response.time };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new GatewayTimeoutException(
        'Raspberry Pi did not respond with its shutdown schedule',
      );
    }
  }

  async openGate(
    deviceCode: string,
    transactionId: string,
    source: 'PAYMENT' | 'MANUAL' = 'MANUAL',
  ) {
    const log = await this.prisma.gateOpenLog.create({
      data: { transactionId, deviceCode, source },
    });
    const device = await this.prisma.gateDevices.findUnique({
      where: { deviceCode },
    });

    if (!device) {
      await this.prisma.gateOpenLog.update({
        where: { id: log.id },
        data: { status: 'DEVICE_NOT_FOUND', error: 'Gate device not found' },
      });
      return false;
    }

    if (!this.server) {
      await this.prisma.gateOpenLog.update({
        where: { id: log.id },
        data: {
          status: 'SERVER_UNAVAILABLE',
          error: 'WebSocket server unavailable',
        },
      });
      return false;
    }

    const room = `device:${deviceCode}`;
    const connectedSockets = await this.server.in(room).fetchSockets();
    if (connectedSockets.length === 0) {
      await this.prisma.gateOpenLog.update({
        where: { id: log.id },
        data: { status: 'DEVICE_OFFLINE', error: 'Gate device is offline' },
      });
      return false;
    }

    this.server.to(room).emit('gate:open', {
      commandId: log.id,
      transactionId,
      deviceCode,
      durationMs: 1000,
    });
    return true;
  }

  async acknowledgeOpenGate(payload: Record<string, unknown>) {
    const deviceCode = payload.deviceCode;
    const transactionId = payload.transactionId;
    const commandId = payload.commandId;
    if (typeof deviceCode !== 'string') return null;

    const log =
      typeof commandId === 'string'
        ? await this.prisma.gateOpenLog.findFirst({
            where: { id: commandId, deviceCode, status: 'PENDING' },
          })
        : typeof transactionId === 'string'
          ? await this.prisma.gateOpenLog.findFirst({
              where: { transactionId, deviceCode, status: 'PENDING' },
              orderBy: { createdAt: 'desc' },
            })
          : null;

    if (!log) return null;

    const succeeded = payload.success === true;
    const error = payload.error;
    return this.prisma.gateOpenLog.update({
      where: { id: log.id },
      data: {
        status: succeeded ? 'SUCCESS' : 'FAILED',
        acknowledgedAt: new Date(),
        ...(!succeeded
          ? {
              error:
                typeof error === 'string' && error.length > 0
                  ? error
                  : 'Gate device reported that opening failed',
            }
          : {}),
      },
    });
  }

  async listOpenLogs(page = 1, limit = 20) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const [data, total] = await Promise.all([
      this.prisma.gateOpenLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.gateOpenLog.count(),
    ]);

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }
}