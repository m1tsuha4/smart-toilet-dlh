import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DashboardController } from './dashboard.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-guard.auth';
import { RolesGuard } from '../auth/guard/roles.guard';

describe('DashboardController access', () => {
  it('requires an authenticated vendor for every dashboard endpoint', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController)).toEqual([
      'VENDOR',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, DashboardController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });
});
