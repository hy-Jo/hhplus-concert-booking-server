import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PointService } from './point.service';
import { PointRepository } from './point.repository';
import { UserPointBalance } from './domain/user-point-balance.entity';

const createBalance = (overrides: Partial<UserPointBalance> = {}): UserPointBalance =>
  ({
    userId: 'user-1',
    balance: 50000,
    updatedAt: new Date(),
    ...overrides,
  }) as UserPointBalance;

describe('PointService', () => {
  let service: PointService;
  let mockPointRepository: jest.Mocked<PointRepository>;
  let mockManager: { findOne: jest.Mock; save: jest.Mock; query: jest.Mock };
  let mockDataSource: Partial<DataSource>;

  beforeEach(() => {
    mockPointRepository = {
      findBalanceByUserId: jest.fn(),
      saveBalance: jest.fn(),
      saveTransaction: jest.fn(),
    };

    mockManager = {
      findOne: jest.fn(),
      save: jest.fn(),
      query: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn((cb: any) => cb(mockManager)),
    };

    service = new PointService(mockPointRepository, mockDataSource as DataSource);
  });

  describe('chargePoints', () => {
    it('포인트를 정상적으로 충전한다', async () => {
      // given
      mockManager.query.mockResolvedValue(undefined);
      mockManager.findOne.mockResolvedValue(createBalance({ balance: 15000 }));
      mockManager.save.mockResolvedValueOnce({} as any); // saveTransaction

      // when
      const result = await service.chargePoints('user-1', 10000);

      // then
      expect(result.balance).toBe(15000);
      expect(mockManager.query).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalledTimes(1);
    });

    it('잔액이 없는 유저에게 포인트를 충전한다 (신규 유저)', async () => {
      // given
      mockManager.query.mockResolvedValue(undefined);
      mockManager.findOne.mockResolvedValue(createBalance({ userId: 'new-user', balance: 10000 }));
      mockManager.save.mockResolvedValueOnce({} as any); // saveTransaction

      // when
      const result = await service.chargePoints('new-user', 10000);

      // then
      expect(result.balance).toBe(10000);
    });

    it('충전 금액이 0 이하이면 BadRequestException을 던진다', async () => {
      // when & then
      await expect(service.chargePoints('user-1', 0)).rejects.toThrow(BadRequestException);
      await expect(service.chargePoints('user-1', -1000)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBalance', () => {
    it('유저의 포인트 잔액을 조회한다', async () => {
      // given
      mockPointRepository.findBalanceByUserId.mockResolvedValue(createBalance());

      // when
      const result = await service.getBalance('user-1');

      // then
      expect(result.balance).toBe(50000);
      expect(result.userId).toBe('user-1');
    });

    it('존재하지 않는 유저의 잔액을 조회하면 NotFoundException을 던진다', async () => {
      // given
      mockPointRepository.findBalanceByUserId.mockResolvedValue(null);

      // when & then
      await expect(service.getBalance('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('usePoints', () => {
    it('포인트를 정상적으로 사용(차감)한다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(createBalance());
      mockManager.save
        .mockResolvedValueOnce(createBalance({ balance: 20000 })) // saveBalance
        .mockResolvedValueOnce({} as any); // saveTransaction

      // when
      await service.usePoints('user-1', 30000, 'payment-1');

      // then
      expect(mockManager.save).toHaveBeenCalledTimes(2);
    });

    it('잔액이 부족하면 BadRequestException을 던진다', async () => {
      // given
      mockManager.findOne.mockResolvedValue(createBalance({ balance: 1000 }));

      // when & then
      await expect(
        service.usePoints('user-1', 50000, 'payment-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
