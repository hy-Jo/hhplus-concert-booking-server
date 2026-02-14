import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PointRepository } from './point.repository';
import { UserPointBalance } from './domain/user-point-balance.entity';
import { PointTransaction, PointTxType } from './domain/point-transaction.entity';

@Injectable()
export class PointService {
  constructor(
    @Inject('PointRepository')
    private readonly pointRepository: PointRepository,
  ) {}

  async chargePoints(userId: string, amount: number): Promise<UserPointBalance> {
    if (amount <= 0) {
      throw new BadRequestException('충전 금액은 0보다 커야 합니다.');
    }

    let balance = await this.pointRepository.findBalanceByUserId(userId);

    if (!balance) {
      balance = new UserPointBalance();
      balance.userId = userId;
      balance.balance = 0;
    }

    balance.balance = Number(balance.balance) + amount;

    const saved = await this.pointRepository.saveBalance(balance);

    const tx = new PointTransaction();
    tx.userId = userId;
    tx.txType = PointTxType.CHARGE;
    tx.amount = amount;
    tx.balanceAfter = saved.balance;
    await this.pointRepository.saveTransaction(tx);

    return saved;
  }

  async getBalance(userId: string): Promise<UserPointBalance> {
    const balance = await this.pointRepository.findBalanceByUserId(userId);
    if (!balance) {
      throw new NotFoundException('유저의 포인트 정보를 찾을 수 없습니다.');
    }
    return balance;
  }

  async usePoints(userId: string, amount: number, paymentId: string): Promise<void> {
    const balance = await this.pointRepository.findBalanceByUserId(userId);
    if (!balance) {
      throw new NotFoundException('유저의 포인트 정보를 찾을 수 없습니다.');
    }

    if (Number(balance.balance) < amount) {
      throw new BadRequestException('포인트 잔액이 부족합니다.');
    }

    balance.balance = Number(balance.balance) - amount;
    const saved = await this.pointRepository.saveBalance(balance);

    const tx = new PointTransaction();
    tx.userId = userId;
    tx.txType = PointTxType.PAYMENT;
    tx.amount = amount;
    tx.balanceAfter = saved.balance;
    tx.refPaymentId = paymentId;
    await this.pointRepository.saveTransaction(tx);
  }
}
