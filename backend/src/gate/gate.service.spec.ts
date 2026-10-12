import { GateService } from './gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { Server } from 'socket.io';

describe('GateService', () => {
  let service: GateService;
  let prisma: {
    gateDevices: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
    gateOpenLog: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
  };
  let emit: jest.Mock;
  let emitWithAck: jest.Mock;
  let fetchSockets: jest.Mock;

  beforeEach(() => {
    prisma = {
      gateDevices: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'device-1', deviceCode: 'GATE-001' }),
        delete: jest.fn().mockResolvedValue({ id: 'device-1' }),
      },
      gateOpenLog: {
        create: jest.fn().mockResolvedValue({ id: 'command-1' }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
    };
    emit = jest.fn();
    emitWithAck = jest.fn().mockResolvedValue([
      { success: true, time: '21:50' },
    ]);
    fetchSockets = jest.fn().mockResolvedValue([{}]);

    service = new GateService(prisma as unknown as PrismaService);
    service.setServer({
      in: jest.fn().mockReturnValue({ fetchSockets }),
      to: jest.fn().mockReturnValue({
        emit,
        timeout: jest.fn().mockReturnValue({ emitWithAck }),
      }),
    } as unknown as Server);
  });

  it('records a payment command and emits its correlation ID', async () => {
    await expect(
      service.openGate('GATE-001', 'transaction-1', 'PAYMENT'),
    ).resolves.toBe(true);

    expect(prisma.gateOpenLog.create).toHaveBeenCalledWith({
      data: {
        transactionId: 'transaction-1',
        deviceCode: 'GATE-001',
        source: 'PAYMENT',
      },
    });
    expect(emit).toHaveBeenCalledWith('gate:open', {
      commandId: 'command-1',
      transactionId: 'transaction-1',
      deviceCode: 'GATE-001',
      durationMs: 1000,
    });
  });

  it('uses GATE-001 as the default and validates the selected device code', async () => {
    await expect(service.resolveDevice()).resolves.toEqual({
      id: 'device-1',
      deviceCode: 'GATE-001',
    });
    expect(prisma.gateDevices.findUnique).toHaveBeenCalledWith({
      where: { deviceCode: 'GATE-001' },
      select: { id: true, deviceCode: true },
    });

    await service.resolveDevice('GATE-002');
    expect(prisma.gateDevices.findUnique).toHaveBeenLastCalledWith({
      where: { deviceCode: 'GATE-002' },
      select: { id: true, deviceCode: true },
    });
  });

  it('returns only sorted device codes for public transaction selection', async () => {
    prisma.gateDevices.findMany.mockResolvedValue([
      { deviceCode: 'GATE-001' },
      { deviceCode: 'GATE-002' },
    ]);

    await expect(service.listDeviceCodes()).resolves.toEqual([
      'GATE-001',
      'GATE-002',
    ]);
    expect(prisma.gateDevices.findMany).toHaveBeenCalledWith({
      select: { deviceCode: true },
      orderBy: { deviceCode: 'asc' },
    });
  });

  it('deletes a registered gate device by ID', async () => {
    await expect(service.removeDevice('device-1')).resolves.toEqual({
      id: 'device-1',
    });
    expect(prisma.gateDevices.delete).toHaveBeenCalledWith({
      where: { id: 'device-1' },
    });
  });

  it('rejects deleting a gate device referenced by transactions', async () => {
    prisma.gateDevices.delete.mockRejectedValue({ code: 'P2003' });

    await expect(service.removeDevice('device-1')).rejects.toThrow(
      'Gate device cannot be deleted because transactions reference it',
    );
  });

  it('opens the gate associated with the transaction', async () => {
    await expect(
      service.openGateForTransaction('device-1', 'transaction-1'),
    ).resolves.toBe(true);

    expect(prisma.gateOpenLog.create).toHaveBeenCalledWith({
      data: {
        transactionId: 'transaction-1',
        deviceCode: 'GATE-001',
        source: 'PAYMENT',
      },
    });
  });

  it('sends a validated shutdown schedule command to the connected device', async () => {
    await expect(
      service.sendSystemCommand('GATE-001', 'set-shutdown-schedule', '21:50'),
    ).resolves.toMatchObject({
      deviceCode: 'GATE-001',
      action: 'set-shutdown-schedule',
      sent: true,
    });

    expect(emit).toHaveBeenCalledWith(
      'system:command',
      expect.objectContaining({
        deviceCode: 'GATE-001',
        action: 'set-shutdown-schedule',
        time: '21:50',
      }),
    );
  });

  it('rejects invalid schedule times before emitting a command', async () => {
    await expect(
      service.sendSystemCommand('GATE-001', 'set-shutdown-schedule', '25:99'),
    ).rejects.toThrow('time must be HH:MM or null to disable');
    expect(emit).not.toHaveBeenCalled();
  });

  it('reads the shutdown schedule from the connected device', async () => {
    await expect(service.getShutdownSchedule('GATE-001')).resolves.toEqual({
      deviceCode: 'GATE-001',
      time: '21:50',
    });
    expect(emitWithAck).toHaveBeenCalledWith(
      'system:command',
      expect.objectContaining({
        deviceCode: 'GATE-001',
        action: 'get-shutdown-schedule',
      }),
    );
  });

  it('returns null when the device has no managed shutdown schedule', async () => {
    emitWithAck.mockResolvedValue([{ success: true, time: null }]);

    await expect(service.getShutdownSchedule('GATE-001')).resolves.toEqual({
      deviceCode: 'GATE-001',
      time: null,
    });
  });

  it('rejects unregistered gate device codes', async () => {
    prisma.gateDevices.findUnique.mockResolvedValueOnce(null);

    await expect(service.resolveDevice('GATE-MISSING')).rejects.toThrow(
      'Gate device "GATE-MISSING" is not registered',
    );
  });

  it('records an offline device instead of reporting the command as sent', async () => {
    fetchSockets.mockResolvedValue([]);

    await expect(service.openGate('GATE-001', 'manual-1')).resolves.toBe(false);

    expect(prisma.gateOpenLog.update).toHaveBeenCalledWith({
      where: { id: 'command-1' },
      data: { status: 'DEVICE_OFFLINE', error: 'Gate device is offline' },
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('stores the Raspberry Pi acknowledgement outcome', async () => {
    prisma.gateOpenLog.findFirst.mockResolvedValue({ id: 'command-1' });

    await service.acknowledgeOpenGate({
      commandId: 'command-1',
      deviceCode: 'GATE-001',
      success: false,
      error: 'Relay unavailable',
    });

    expect(prisma.gateOpenLog.update).toHaveBeenCalledTimes(1);
    const updateCalls = prisma.gateOpenLog.update.mock
      .calls as unknown as Array<
      [
        {
          data: {
            status: string;
            error?: string;
            acknowledgedAt?: Date;
          };
        },
      ]
    >;
    const updateData = updateCalls[0][0].data;
    expect(updateData.status).toBe('FAILED');
    expect(updateData.error).toBe('Relay unavailable');
    expect(updateData.acknowledgedAt).toBeInstanceOf(Date);
  });

  it('paginates gate-open logs and returns pagination metadata', async () => {
    prisma.gateOpenLog.findMany.mockResolvedValue([{ id: 'command-1' }]);
    prisma.gateOpenLog.count.mockResolvedValue(41);

    await expect(service.listOpenLogs(3, 15)).resolves.toEqual({
      data: [{ id: 'command-1' }],
      meta: { page: 3, limit: 15, total: 41, totalPages: 3 },
    });
    expect(prisma.gateOpenLog.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      skip: 30,
      take: 15,
    });
    expect(prisma.gateOpenLog.count).toHaveBeenCalledWith();
  });
});
