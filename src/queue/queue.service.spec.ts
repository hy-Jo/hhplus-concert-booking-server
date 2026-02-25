import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueRepository } from './queue.repository';
import { QueueToken, QueueTokenStatus } from './domain/queue-token.entity';

const createToken = (overrides: Partial<QueueToken> = {}): QueueToken => {
  const token = new QueueToken();
  Object.assign(token, {
    tokenId: 'token-1',
    userId: 'user-1',
    tokenValue: 'abc-123',
    queuePosition: 1,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    status: QueueTokenStatus.ACTIVE,
    ...overrides,
  });
  return token;
};

describe('QueueService', () => {
  let service: QueueService;
  let mockQueueRepository: jest.Mocked<QueueRepository>;

  beforeEach(() => {
    mockQueueRepository = {
      save: jest.fn(),
      findByTokenValue: jest.fn(),
      findByUserId: jest.fn(),
      countWaiting: jest.fn(),
      countActive: jest.fn(),
      findExpiredTokens: jest.fn(),
      updateStatus: jest.fn(),
      activateNextTokens: jest.fn(),
    };

    service = new QueueService(mockQueueRepository);
  });

  describe('issueToken', () => {
    it('유저에게 대기열 토큰을 발급한다', async () => {
      // given
      const userId = 'user-1';
      mockQueueRepository.findByUserId.mockResolvedValue(null);
      mockQueueRepository.countWaiting.mockResolvedValue(5);
      mockQueueRepository.save.mockImplementation(async (token) => {
        token.tokenId = 'token-1';
        return token;
      });

      // when
      const result = await service.issueToken(userId);

      // then
      expect(result.userId).toBe(userId);
      expect(result.status).toBe(QueueTokenStatus.WAITING);
      expect(result.tokenValue).toBeDefined();
      expect(result.queuePosition).toBe(6); // 기존 5명 + 1
      expect(mockQueueRepository.save).toHaveBeenCalled();
    });

    it('이미 유효한 토큰이 있는 유저는 기존 토큰을 반환한다', async () => {
      // given
      const existingToken = createToken({ status: QueueTokenStatus.WAITING });
      mockQueueRepository.findByUserId.mockResolvedValue(existingToken);

      // when
      const result = await service.issueToken('user-1');

      // then
      expect(result.tokenId).toBe('token-1');
      expect(mockQueueRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('validateToken', () => {
    it('ACTIVE 상태이고 만료되지 않은 토큰을 검증 통과시킨다', async () => {
      // given
      const token = createToken();
      mockQueueRepository.findByTokenValue.mockResolvedValue(token);

      // when
      const result = await service.validateToken('abc-123');

      // then
      expect(result.status).toBe(QueueTokenStatus.ACTIVE);
      expect(result.tokenValue).toBe('abc-123');
    });

    it('존재하지 않는 토큰이면 NotFoundException을 던진다', async () => {
      // given
      mockQueueRepository.findByTokenValue.mockResolvedValue(null);

      // when & then
      await expect(
        service.validateToken('invalid-token'),
      ).rejects.toThrow(NotFoundException);
    });

    it('만료된 토큰이면 ForbiddenException을 던진다', async () => {
      // given
      const expiredToken = createToken({
        expiresAt: new Date(Date.now() - 1000),
        status: QueueTokenStatus.EXPIRED,
      });
      mockQueueRepository.findByTokenValue.mockResolvedValue(expiredToken);

      // when & then
      await expect(
        service.validateToken('abc-123'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('WAITING 상태의 토큰이면 ForbiddenException을 던진다', async () => {
      // given
      const waitingToken = createToken({ status: QueueTokenStatus.WAITING });
      mockQueueRepository.findByTokenValue.mockResolvedValue(waitingToken);

      // when & then
      await expect(
        service.validateToken('abc-123'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getQueueStatus', () => {
    it('대기 중인 토큰의 현재 위치와 상태를 반환한다', async () => {
      // given
      const token = createToken({ status: QueueTokenStatus.WAITING, queuePosition: 3 });
      mockQueueRepository.findByTokenValue.mockResolvedValue(token);

      // when
      const result = await service.getQueueStatus('abc-123');

      // then
      expect(result.position).toBe(3);
      expect(result.status).toBe(QueueTokenStatus.WAITING);
    });

    it('ACTIVE 토큰의 상태를 반환한다 (position 0)', async () => {
      // given
      const token = createToken({ status: QueueTokenStatus.ACTIVE });
      mockQueueRepository.findByTokenValue.mockResolvedValue(token);

      // when
      const result = await service.getQueueStatus('abc-123');

      // then
      expect(result.position).toBe(0);
      expect(result.status).toBe(QueueTokenStatus.ACTIVE);
    });

    it('존재하지 않는 토큰이면 NotFoundException을 던진다', async () => {
      // given
      mockQueueRepository.findByTokenValue.mockResolvedValue(null);

      // when & then
      await expect(
        service.getQueueStatus('invalid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('expireToken', () => {
    it('토큰을 만료 처리한다', async () => {
      // given
      const token = createToken();
      mockQueueRepository.findByTokenValue.mockResolvedValue(token);

      // when
      await service.expireToken('abc-123');

      // then
      expect(mockQueueRepository.updateStatus).toHaveBeenCalledWith(
        'token-1',
        QueueTokenStatus.EXPIRED,
      );
    });

    it('존재하지 않는 토큰이면 NotFoundException을 던진다', async () => {
      // given
      mockQueueRepository.findByTokenValue.mockResolvedValue(null);

      // when & then
      await expect(
        service.expireToken('invalid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('activateTokens', () => {
    it('ACTIVE 수가 MAX 미만이면 빈 자리만큼 WAITING 토큰을 활성화한다', async () => {
      // given: 현재 ACTIVE 30개 → 빈 자리 20개
      mockQueueRepository.countActive.mockResolvedValue(30);
      mockQueueRepository.activateNextTokens.mockResolvedValue(20);

      // when
      const activated = await service.activateTokens();

      // then
      expect(activated).toBe(20);
      expect(mockQueueRepository.activateNextTokens).toHaveBeenCalledWith(20);
    });

    it('ACTIVE 수가 MAX에 도달하면 활성화하지 않는다', async () => {
      // given: 현재 ACTIVE 50개 (MAX)
      mockQueueRepository.countActive.mockResolvedValue(50);

      // when
      const activated = await service.activateTokens();

      // then
      expect(activated).toBe(0);
      expect(mockQueueRepository.activateNextTokens).not.toHaveBeenCalled();
    });

    it('WAITING 토큰이 없으면 0을 반환한다', async () => {
      // given
      mockQueueRepository.countActive.mockResolvedValue(10);
      mockQueueRepository.activateNextTokens.mockResolvedValue(0);

      // when
      const activated = await service.activateTokens();

      // then
      expect(activated).toBe(0);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('만료된 토큰을 EXPIRED 상태로 변경한다', async () => {
      // given
      const expiredTokens = [
        createToken({ tokenId: 'token-1', status: QueueTokenStatus.WAITING }),
        createToken({ tokenId: 'token-2', status: QueueTokenStatus.WAITING }),
      ];
      mockQueueRepository.findExpiredTokens.mockResolvedValue(expiredTokens);

      // when
      const cleaned = await service.cleanupExpiredTokens();

      // then
      expect(cleaned).toBe(2);
      expect(mockQueueRepository.updateStatus).toHaveBeenCalledTimes(2);
      expect(mockQueueRepository.updateStatus).toHaveBeenCalledWith('token-1', QueueTokenStatus.EXPIRED);
      expect(mockQueueRepository.updateStatus).toHaveBeenCalledWith('token-2', QueueTokenStatus.EXPIRED);
    });

    it('만료된 토큰이 없으면 0을 반환한다', async () => {
      // given
      mockQueueRepository.findExpiredTokens.mockResolvedValue([]);

      // when
      const cleaned = await service.cleanupExpiredTokens();

      // then
      expect(cleaned).toBe(0);
      expect(mockQueueRepository.updateStatus).not.toHaveBeenCalled();
    });
  });
});
