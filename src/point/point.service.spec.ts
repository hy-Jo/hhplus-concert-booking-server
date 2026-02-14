import { PointService } from './point.service';
import { PointRepository } from './point.repository';
import { UserPointBalance } from './domain/user-point-balance.entity';

describe('PointService', () => {
  let service: PointService;
  let mockPointRepository: jest.Mocked<PointRepository>;

  beforeEach(() => {
    mockPointRepository = {
      findBalanceByUserId: jest.fn(),
      saveBalance: jest.fn(),
      saveTransaction: jest.fn(),
    };

    service = new PointService(mockPointRepository);
  });

  describe('chargePoints', () => {
    it('포인트를 정상적으로 충전한다', async () => {
      // given
      const userId = 'user-1';
      const chargeAmount = 10000;
      const currentBalance: UserPointBalance = {
        userId,
        balance: 5000,
        updatedAt: new Date(),
      } as UserPointBalance;

      mockPointRepository.findBalanceByUserId.mockResolvedValue(currentBalance);
      mockPointRepository.saveBalance.mockResolvedValue({
        userId,
        balance: 15000,
        updatedAt: new Date(),
      } as UserPointBalance);
      mockPointRepository.saveTransaction.mockResolvedValue({} as any);

      // when
      const result = await service.chargePoints(userId, chargeAmount);

      // then
      expect(result.balance).toBe(15000);
      expect(mockPointRepository.saveBalance).toHaveBeenCalled();
      expect(mockPointRepository.saveTransaction).toHaveBeenCalled();
    });

    it('잔액이 없는 유저에게 포인트를 충전한다 (신규 유저)', async () => {
      // given
      const userId = 'new-user';
      const chargeAmount = 10000;

      mockPointRepository.findBalanceByUserId.mockResolvedValue(null);
      mockPointRepository.saveBalance.mockResolvedValue({
        userId,
        balance: 10000,
        updatedAt: new Date(),
      } as UserPointBalance);
      mockPointRepository.saveTransaction.mockResolvedValue({} as any);

      // when
      const result = await service.chargePoints(userId, chargeAmount);

      // then
      expect(result.balance).toBe(10000);
    });

    it('충전 금액이 0 이하이면 에러를 던진다', async () => {
      // when & then
      await expect(service.chargePoints('user-1', 0)).rejects.toThrow();
      await expect(service.chargePoints('user-1', -1000)).rejects.toThrow();
    });
  });

  describe('getBalance', () => {
    it('유저의 포인트 잔액을 조회한다', async () => {
      // given
      const userId = 'user-1';
      const balance: UserPointBalance = {
        userId,
        balance: 50000,
        updatedAt: new Date(),
      } as UserPointBalance;

      mockPointRepository.findBalanceByUserId.mockResolvedValue(balance);

      // when
      const result = await service.getBalance(userId);

      // then
      expect(result.balance).toBe(50000);
      expect(result.userId).toBe(userId);
    });

    it('존재하지 않는 유저의 잔액을 조회하면 에러를 던진다', async () => {
      // given
      mockPointRepository.findBalanceByUserId.mockResolvedValue(null);

      // when & then
      await expect(service.getBalance('non-existent')).rejects.toThrow();
    });
  });

  describe('usePoints', () => {
    it('포인트를 정상적으로 사용(차감)한다', async () => {
      // given
      const userId = 'user-1';
      const useAmount = 30000;
      const paymentId = 'payment-1';
      const currentBalance: UserPointBalance = {
        userId,
        balance: 50000,
        updatedAt: new Date(),
      } as UserPointBalance;

      mockPointRepository.findBalanceByUserId.mockResolvedValue(currentBalance);
      mockPointRepository.saveBalance.mockResolvedValue({
        userId,
        balance: 20000,
        updatedAt: new Date(),
      } as UserPointBalance);
      mockPointRepository.saveTransaction.mockResolvedValue({} as any);

      // when
      await service.usePoints(userId, useAmount, paymentId);

      // then
      expect(mockPointRepository.saveBalance).toHaveBeenCalled();
      expect(mockPointRepository.saveTransaction).toHaveBeenCalled();
    });

    it('잔액이 부족하면 에러를 던진다', async () => {
      // given
      const currentBalance: UserPointBalance = {
        userId: 'user-1',
        balance: 1000,
        updatedAt: new Date(),
      } as UserPointBalance;

      mockPointRepository.findBalanceByUserId.mockResolvedValue(currentBalance);

      // when & then
      await expect(
        service.usePoints('user-1', 50000, 'payment-1'),
      ).rejects.toThrow();
    });
  });
});
