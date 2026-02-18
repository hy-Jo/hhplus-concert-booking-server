import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PointRepository } from '../../../point/point.repository';
import { UserPointBalance } from '../../../point/domain/user-point-balance.entity';
import { PointTransaction } from '../../../point/domain/point-transaction.entity';

@Injectable()
export class PointRepositoryImpl implements PointRepository {
  constructor(
    @InjectRepository(UserPointBalance)
    private readonly balanceRepo: Repository<UserPointBalance>,
    @InjectRepository(PointTransaction)
    private readonly txRepo: Repository<PointTransaction>,
  ) {}

  async findBalanceByUserId(userId: string): Promise<UserPointBalance | null> {
    return this.balanceRepo.findOne({ where: { userId } });
  }

  async saveBalance(balance: UserPointBalance): Promise<UserPointBalance> {
    return this.balanceRepo.save(balance);
  }

  async saveTransaction(tx: PointTransaction): Promise<PointTransaction> {
    return this.txRepo.save(tx);
  }
}
