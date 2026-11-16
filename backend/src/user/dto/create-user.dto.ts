import { createZodDto } from '@anatine/zod-nestjs';
import z from 'zod';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[0-9]/, 'Password must include a number')
    .regex(/[^A-Za-z0-9]/, 'Password must include a symbol'),
  name: z.string().min(3).max(255),
  role: z.enum(['SUPERADMIN', 'ADMIN', 'VENDOR']).optional().default('ADMIN'),
});

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
