import { ApiProperty } from '@nestjs/swagger';

export class ResponseUserDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'User ID',
  })
  id: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'User email',
  })
  email: string;

  @ApiProperty({
    example: 'John Doe',
    description: 'User name',
  })
  name: string;

  @ApiProperty({
    example: 'ADMIN',
    description: 'User role',
    enum: ['SUPERADMIN', 'ADMIN', 'VENDOR'],
  })
  role: string;

  @ApiProperty({
    example: '2022-01-01T00:00:00.000Z',
    description: 'User creation date',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2022-01-01T00:00:00.000Z',
    description: 'User update date',
  })
  updatedAt: Date;

  @ApiProperty({
    example: '2022-01-01T00:00:00.000Z',
    description: 'User delete date',
  })
  deletedAt: Date;
}
