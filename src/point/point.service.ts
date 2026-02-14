import { Injectable, Inject } from '@nestjs/common';
import { PointRepository } from './point.repository';
import { UserPointBalance } from './domain/user-point-balance.entity';

@Injectable()
export class PointService {
  constructor(
    @Inject('PointRepository')
    private readonly pointRepository: PointRepository,
  ) {}

  async chargePoints(userId: string, amount: number): Promise<UserPointBalance> {
    throw new Error('Not implemented');
  }

  async getBalance(userId: string): Promise<UserPointBalance> {
    throw new Error('Not implemented');
  }

  async usePoints(userId: string, amount: number, paymentId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
