import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guard/jwt-guard.auth';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guard/roles.guard';
import { GateService } from '../gate/gate.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly gateService: GateService,
  ) {}

  @Get('gates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  getGates() {
    return this.gateService.listDevices();
  }

  @Get('gate-device-codes')
  getGateDeviceCodes() {
    return this.gateService.listDeviceCodes();
  }

  @Get('gate-open-logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getGateOpenLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.gateService.listOpenLogs(Number(page), Number(limit));
  }

  @Post('gates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiBody({
    schema: {
      example: { name: 'Main Gate', deviceCode: 'GATE-001' },
    },
  })
  registerGate(@Body('name') name: string, @Body('deviceCode') deviceCode: string) {
    return this.gateService.registerDevice(name, deviceCode);
  }

  @Post('gates/shutdown')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiBody({ schema: { example: { deviceCode: 'GATE-001' } } })
  shutdownGateDevice(@Body('deviceCode') deviceCode: string) {
    if (typeof deviceCode !== 'string' || !deviceCode.trim()) {
      throw new BadRequestException('deviceCode is required');
    }
    return this.gateService.sendSystemCommand(deviceCode.trim(), 'shutdown');
  }

  @Post('gates/reboot')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiBody({ schema: { example: { deviceCode: 'GATE-001' } } })
  rebootGateDevice(@Body('deviceCode') deviceCode: string) {
    if (typeof deviceCode !== 'string' || !deviceCode.trim()) {
      throw new BadRequestException('deviceCode is required');
    }
    return this.gateService.sendSystemCommand(deviceCode.trim(), 'reboot');
  }

  @Post('gates/shutdown-schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiBody({
    schema: { example: { deviceCode: 'GATE-001', time: '21:50' } },
  })
  setGateShutdownSchedule(
    @Body('deviceCode') deviceCode: string,
    @Body('time') time: string | null,
  ) {
    if (typeof deviceCode !== 'string' || !deviceCode.trim()) {
      throw new BadRequestException('deviceCode is required');
    }
    if (time !== null && typeof time !== 'string') {
      throw new BadRequestException('time must be HH:MM or null to disable');
    }
    return this.gateService.sendSystemCommand(
      deviceCode.trim(),
      'set-shutdown-schedule',
      time,
    );
  }

  @Get('gates/shutdown-schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiQuery({ name: 'deviceCode', required: true, example: 'GATE-001' })
  getGateShutdownSchedule(@Query('deviceCode') deviceCode?: string) {
    if (!deviceCode?.trim()) {
      throw new BadRequestException('deviceCode is required');
    }
    return this.gateService.getShutdownSchedule(deviceCode.trim());
  }

  @Post('gate-open')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiBody({
    schema: {
      example: { deviceCode: 'GATE-001' },
    },
  })
  async openGate(
    @Body('deviceCode') deviceCode: string,
    @Body('transactionId') transactionId?: string,
  ) {
    if (!deviceCode) {
      throw new BadRequestException('deviceCode is required');
    }

    const commandId = transactionId || `manual-${Date.now()}`;
    const sent = await this.gateService.openGate(
      deviceCode,
      commandId,
      'MANUAL',
    );
    if (!sent) {
      throw new BadRequestException(
        'Gate device was not found or is not connected',
      );
    }

    return {
      deviceCode,
      transactionId: commandId,
      sent: true,
    };
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  getSummary() {
    return this.dashboardService.getSummary();
  }

  @Get('settings/amount')
  getQrAmount() {
    return this.dashboardService.getQrAmount();
  }

  @Patch('settings/amount')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth()
  @ApiBody({ schema: { example: { amount: 2000 } } })
  updateQrAmount(@Body('amount') amount: number) {
    return this.dashboardService.updateQrAmount(Number(amount));
  }
}