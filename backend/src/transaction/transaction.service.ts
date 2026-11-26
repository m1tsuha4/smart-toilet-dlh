import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Status } from '../../generated/prisma/enums';
import * as XLSX from 'xlsx';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  create(createTransactionDto: CreateTransactionDto) {
    return 'This action adds a new transaction';
  }

  async findAll(page = 1, limit = 20, status?: string) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const transactionStatus = this.parseStatus(status);
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: transactionStatus ? { status: transactionStatus } : undefined,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.transaction.count({
        where: transactionStatus ? { status: transactionStatus } : undefined,
      }),
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

  private parseStatus(status?: string): Status | undefined {
    if (!status) return undefined;

    if (Object.values(Status).includes(status as Status)) {
      return status as Status;
    }

    throw new BadRequestException(
      `Invalid status. Use one of: ${Object.values(Status).join(', ')}`,
    );
  }

  async exportExcel() {
    const transactions = await this.prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const rows = transactions.map((transaction) => ({
      id: transaction.id,
      partnerReferenceNo: transaction.partnerReferenceNo,
      externalId: transaction.externalId ?? '',
      referenceNo: transaction.referenceNo,
      amount: Number(transaction.amount),
      status: transaction.status,
      note: transaction.note ?? '',
      terminalId: transaction.terminalId,
      createdAt: transaction.createdAt.toISOString(),
      paidAt: transaction.paidAt?.toISOString() ?? '',
      expiredAt: transaction.expiredAt?.toISOString() ?? '',
    }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }

  update(id: number, updateTransactionDto: UpdateTransactionDto) {
    return `This action updates a #${id} transaction`;
  }

  remove(id: number) {
    return `This action removes a #${id} transaction`;
  }
}
