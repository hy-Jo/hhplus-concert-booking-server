export class PaymentCompletedEvent {
  static readonly EVENT_NAME = 'payment.completed';

  constructor(
    public readonly paymentId: string,
    public readonly userId: string,
    public readonly reservationId: string,
    public readonly seatId: string,
    public readonly amount: number,
  ) {}
}
