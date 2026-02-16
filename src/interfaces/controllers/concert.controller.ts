import { Controller, Get, Query } from '@nestjs/common';
import { ConcertService } from '../../concert/concert.service';
import { ScheduleResponse, SeatResponse } from '../dto/concert.dto';

@Controller('api/concerts')
export class ConcertController {
  constructor(private readonly concertService: ConcertService) {}

  @Get('dates')
  async getAvailableDates(@Query('concertId') concertId: string): Promise<{ dates: ScheduleResponse[] }> {
    const schedules = await this.concertService.getAvailableSchedules(concertId);
    return {
      dates: schedules.map((s) => ({
        scheduleId: s.scheduleId,
        concertId: s.concertId,
        concertDate: s.concertDate,
      })),
    };
  }

  @Get('seats')
  async getAvailableSeats(@Query('scheduleId') scheduleId: string): Promise<{ seats: SeatResponse[] }> {
    const seats = await this.concertService.getAvailableSeats(scheduleId);
    return {
      seats: seats.map((s) => ({
        seatId: s.seatId,
        scheduleId: s.scheduleId,
        seatNo: s.seatNo,
      })),
    };
  }
}
