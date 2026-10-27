import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { QrisModule } from './qris/qris.module';
import { TransactionModule } from './transaction/transaction.module';
import { BriModule } from './bri/bri.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { GateModule } from './gate/gate.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    PrismaModule,
    UserModule,
    AuthModule,
    QrisModule,
    TransactionModule,
    BriModule,
    DashboardModule,
    GateModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformResponseInterceptor,
    },
    AppService,
  ],
})
export class AppModule {}
