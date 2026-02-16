import { Controller, Post, Body } from '@nestjs/common';
import { ReservationService } from '../../reservation/reservation.service';
import { HoldSeatRequest, ReservationResponse } from '../dto/reservation.dto';

@Controller('api/reservations')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @Post()
  async holdSeat(@Body() body: HoldSeatRequest): Promise<ReservationResponse> {
    const reservation = await this.reservationService.holdSeat(
      body.userId,
      body.scheduleId,
      body.seatNo,
    );
    return {
      reservationId: reservation.reservationId,
      userId: reservation.userId,
      seatId: reservation.seatId,
      status: reservation.status,
      heldAt: reservation.heldAt,
      expiresAt: reservation.expiresAt,
    };
  }
}
