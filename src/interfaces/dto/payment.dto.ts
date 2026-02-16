export class ProcessPaymentRequest {
  userId: string;
  reservationId: string;
  amount: number;
}

export class PaymentResponse {
  paymentId: string;
  reservationId: string;
  userId: string;
  amount: number;
  status: string;
  paidAt: Date;
}
