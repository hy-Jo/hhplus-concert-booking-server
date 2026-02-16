export class HoldSeatRequest {
  userId: string;
  scheduleId: string;
  seatNo: number;
}

export class ReservationResponse {
  reservationId: string;
  userId: string;
  seatId: string;
  status: string;
  heldAt: Date;
  expiresAt: Date;
}
