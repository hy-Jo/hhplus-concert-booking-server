import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PointRepository } from './point.repository';
import { UserPointBalance } from './domain/user-point-balance.entity';
import { PointTransaction, PointTxType } from './domain/point-transaction.entity';
import { DI_TOKENS } from '../common/di-tokens';
import { DistributedLockService } from '../infrastructure/distributed-lock/distributed-lock.service';

@Injectable()
export class PointService {
  constructor(
    @Inject(DI_TOKENS.POINT_REPOSITORY)
    private readonly pointRepository: PointRepository,
    private readonly dataSource: DataSource,
    private readonly distributedLockService: DistributedLockService,
  ) {}

  async chargePoints(userId: string, amount: number): Promise<UserPointBalance> {
    if (amount <= 0) {
      throw new BadRequestException('충전 금액은 0보다 커야 합니다.');
    }

    // 분산락: 같은 유저의 동시 충전으로 인한 Lost Update 방지
    // 키: point:{userId} — 유저 단위로 락을 걸어 포인트 연산 직렬화
    return this.distributedLockService.withLock(
      `point:${userId}`,
      async () => {
        return this.dataSource.transaction(async (manager) => {
          await manager.query(
            `INSERT INTO user_point_balance (userId, balance) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE balance = balance + ?`,
            [userId, amount, amount],
          );

          const balance = await manager.findOne(UserPointBalance, {
            where: { userId },
          });

          const tx = new PointTransaction();
          tx.userId = userId;
          tx.txType = PointTxType.CHARGE;
          tx.amount = amount;
          tx.balanceAfter = balance.balance;
          await manager.save(tx);

          return balance;
        });
      },
    );
  }

  async getBalance(userId: string): Promise<UserPointBalance> {
    const balance = await this.pointRepository.findBalanceByUserId(userId);
    if (!balance) {
      throw new NotFoundException('유저의 포인트 정보를 찾을 수 없습니다.');
    }
    return balance;
  }

  async usePoints(userId: string, amount: number, paymentId: string): Promise<void> {
    // 분산락: 같은 유저의 동시 포인트 사용으로 인한 잔액 부족 미감지 방지
    // 키: point:{userId} — chargePoints와 동일한 키로 충전/사용 직렬화
    await this.distributedLockService.withLock(
      `point:${userId}`,
      async () => {
        await this.dataSource.transaction(async (manager) => {
          const balance = await manager.findOne(UserPointBalance, {
            where: { userId },
          });

          if (!balance) {
            throw new NotFoundException('유저의 포인트 정보를 찾을 수 없습니다.');
          }

          if (Number(balance.balance) < amount) {
            throw new BadRequestException('포인트 잔액이 부족합니다.');
          }

          balance.balance = Number(balance.balance) - amount;
          const saved = await manager.save(balance);

          const tx = new PointTransaction();
          tx.userId = userId;
          tx.txType = PointTxType.PAYMENT;
          tx.amount = amount;
          tx.balanceAfter = saved.balance;
          tx.refPaymentId = paymentId;
          await manager.save(tx);
        });
      },
    );
  }
}
