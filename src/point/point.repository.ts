import { UserPointBalance } from './domain/user-point-balance.entity';
import { PointTransaction } from './domain/point-transaction.entity';

export interface PointRepository {
  findBalanceByUserId(userId: string): Promise<UserPointBalance | null>;
  saveBalance(balance: UserPointBalance): Promise<UserPointBalance>;
  saveTransaction(tx: PointTransaction): Promise<PointTransaction>;
}
