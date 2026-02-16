import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { PointService } from '../../point/point.service';
import { ChargePointRequest, PointBalanceResponse } from '../dto/point.dto';

@Controller('api/points')
export class PointController {
  constructor(private readonly pointService: PointService) {}

  @Post('charge')
  async chargePoints(@Body() body: ChargePointRequest): Promise<PointBalanceResponse> {
    const balance = await this.pointService.chargePoints(body.userId, body.amount);
    return {
      userId: balance.userId,
      balance: Number(balance.balance),
      updatedAt: balance.updatedAt,
    };
  }

  @Get('balance')
  async getBalance(@Query('userId') userId: string): Promise<PointBalanceResponse> {
    const balance = await this.pointService.getBalance(userId);
    return {
      userId: balance.userId,
      balance: Number(balance.balance),
      updatedAt: balance.updatedAt,
    };
  }
}
