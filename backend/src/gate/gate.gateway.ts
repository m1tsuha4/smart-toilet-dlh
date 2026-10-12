import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { GateService } from './gate.service';

type DeviceAuth = {
  deviceCode?: string;
  deviceToken?: string;
  partnerReferenceNo?: string;
};

@Injectable()
@WebSocketGateway({ namespace: 'realtime', cors: { origin: '*' } })
export class GateGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GateGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateService: GateService,
    private readonly jwtService: JwtService,
  ) {}

  afterInit() {
    this.gateService.setServer(this.server);
  }

  async handleConnection(client: Socket) {
    const auth = client.handshake.auth as DeviceAuth & { token?: string };
    if (auth.deviceCode && auth.deviceToken) {
      const device = await this.prisma.gateDevices.findUnique({
        where: { deviceCode: auth.deviceCode },
      });
      if (!device || device.authToken !== auth.deviceToken) {
        client.disconnect(true);
        return;
      }
      client.join(`device:${device.deviceCode}`);
      await this.gateService.setDeviceStatus(device.deviceCode, 'ACTIVE');
      return;
    }

    if (auth.partnerReferenceNo) {
      const transaction = await this.prisma.transaction.findUnique({
        where: { partnerReferenceNo: auth.partnerReferenceNo },
        select: { partnerReferenceNo: true },
      });
      if (!transaction) {
        client.disconnect(true);
        return;
      }
      client.join(`payment:${transaction.partnerReferenceNo}`);
      return;
    }

    try {
      const token = auth.token?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Missing dashboard token');
      this.jwtService.verify(token);
      client.join('dashboard');
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const auth = client.handshake.auth as DeviceAuth;
    if (auth.deviceCode) {
      await this.gateService.setDeviceStatus(auth.deviceCode, 'OFFLINE');
    }
  }

  @SubscribeMessage('gate:heartbeat')
  async heartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deviceCode?: string },
  ) {
    const auth = client.handshake.auth as DeviceAuth;
    const deviceCode = body.deviceCode;
    if (!deviceCode || auth.deviceCode !== deviceCode) return { ok: false };
    await this.gateService.setDeviceStatus(deviceCode, 'ACTIVE');
    return { ok: true, at: new Date().toISOString() };
  }

  @SubscribeMessage('gate:ack')
  async acknowledge(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: Record<string, unknown>,
  ) {
    const deviceCode = body.deviceCode;
    if (
      typeof deviceCode !== 'string' ||
      !client.rooms.has(`device:${deviceCode}`)
    ) {
      return;
    }

    const log = await this.gateService.acknowledgeOpenGate(body);
    this.logger.log(`Gate acknowledged command: ${JSON.stringify(body)}`);
    this.server.to('dashboard').emit('gate:ack', {
      ...body,
      ...(log ? { status: log.status, error: log.error } : {}),
    });
  }

  @SubscribeMessage('system:ack')
  acknowledgeSystemCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: Record<string, unknown>,
  ) {
    const deviceCode = body.deviceCode;
    if (
      typeof deviceCode !== 'string' ||
      !client.rooms.has(`device:${deviceCode}`)
    ) {
      return;
    }

    this.server.to('dashboard').emit('system:ack', body);
  }
}