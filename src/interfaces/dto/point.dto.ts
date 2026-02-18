export class ChargePointRequest {
  userId: string;
  amount: number;
}

export class PointBalanceResponse {
  userId: string;
  balance: number;
  updatedAt: Date;
}
