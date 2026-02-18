import { Controller, Post, Get, Body, Headers } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { IssueTokenRequest, IssueTokenResponse, QueueStatusResponse } from '../dto/queue.dto';

@Controller('api/queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post('token')
  async issueToken(@Body() body: IssueTokenRequest): Promise<IssueTokenResponse> {
    const token = await this.queueService.issueToken(body.userId);
    return {
      token: token.tokenValue,
      userId: token.userId,
      queuePosition: token.queuePosition,
      expiresAt: token.expiresAt,
    };
  }

  @Get('status')
  async getQueueStatus(@Headers('authorization') authorization: string): Promise<QueueStatusResponse> {
    const tokenValue = authorization?.replace('Bearer ', '');
    const status = await this.queueService.getQueueStatus(tokenValue);
    return {
      queuePosition: status.position,
      status: status.status,
    };
  }
}
