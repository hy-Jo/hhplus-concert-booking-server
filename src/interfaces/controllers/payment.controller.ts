import { Controller, Post, Body } from '@nestjs/common';
import { PaymentService } from '../../payment/payment.service';
import { ProcessPaymentRequest, PaymentResponse } from '../dto/payment.dto';

@Controller('api/payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  async processPayment(@Body() body: ProcessPaymentRequest): Promise<PaymentResponse> {
    const payment = await this.paymentService.processPayment(
      body.userId,
      body.reservationId,
      body.amount,
    );
    return {
      paymentId: payment.paymentId,
      reservationId: payment.reservationId,
      userId: payment.userId,
      amount: Number(payment.amount),
      status: payment.status,
      paidAt: payment.paidAt,
    };
  }
}
