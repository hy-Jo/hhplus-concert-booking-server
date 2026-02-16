export class ScheduleResponse {
  scheduleId: string;
  concertId: string;
  concertDate: string;
}

export class SeatResponse {
  seatId: string;
  scheduleId: string;
  seatNo: number;
}
