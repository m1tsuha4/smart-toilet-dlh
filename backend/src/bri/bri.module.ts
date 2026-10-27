import { Module } from '@nestjs/common';
import { BriService } from './bri.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { BriController, BriWebhookController } from './bri.controller';
import { GateModule } from '../gate/gate.module';
import {
  BRI_CONFIG,
  VaultBriConfigService,
} from '../common/vault/vault-bri-config.service';

@Module({
  imports: [PrismaModule, DashboardModule, GateModule],
  controllers: [BriController, BriWebhookController],
  providers: [
    VaultBriConfigService,
    {
      provide: BRI_CONFIG,
      useFactory: (vaultBriConfig: VaultBriConfigService) =>
        vaultBriConfig.loadBriConfig(),
      inject: [VaultBriConfigService],
    },
    BriService,
  ],
})
export class BriModule {}
