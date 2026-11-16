import 'dotenv/config';

const { PrismaClient } = require('../generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL not found in environment variables or .env file',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString })),
});

async function main() {
  const seedUsers = [
    {
      email: process.env.SUPERADMIN_EMAIL ?? 'superadmin@gate-qris.com',
      password: process.env.SUPERADMIN_PASSWORD ?? 'SuperAdmin123!',
      name: 'Super Admin',
      role: 'SUPERADMIN',
    },
    {
      email: process.env.VENDOR_EMAIL ?? 'vendor@gate-qris.com',
      password: process.env.VENDOR_PASSWORD ?? 'VendorPass123!',
      name: 'Vendor',
      role: 'VENDOR',
    },
  ] as const;

  for (const seedUser of seedUsers) {
    const existingUser = await prisma.user.findUnique({
      where: { email: seedUser.email },
    });

    if (existingUser) {
      console.log(`${seedUser.name} already exists: ${seedUser.email}`);
      continue;
    }

    const hashedPassword = await bcrypt.hash(seedUser.password, 10);

    await prisma.user.create({
      data: {
        email: seedUser.email,
        password: hashedPassword,
        name: seedUser.name,
        role: seedUser.role,
      },
    });

    console.log(`${seedUser.name} created successfully: ${seedUser.email}`);
  }
}

main()
  .catch((error) => {
    console.error('Failed to seed users', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
