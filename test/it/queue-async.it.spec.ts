import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { QueueService } from '../../src/queue/queue.service';
import Redis from 'ioredis';

describe('대기열 비동기 처리 통합 테스트', () => {
  let app: INestApplication;
  let queueService: QueueService;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    queueService = moduleRef.get(QueueService);
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    });
  });

  afterAll(async () => {
    await redis.quit();
    await app.close();
  });

  afterEach(async () => {
    // 테스트 간 Redis 대기열 데이터 격리
    const keys = await redis.keys('queue:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  // ──────────────────────────────────────────────
  // 1. 토큰 발급 및 WAITING 상태 확인
  // ──────────────────────────────────────────────
  describe('토큰 발급 및 대기열 관리', () => {
    it('토큰 발급 시 WAITING 상태로 생성된다', async () => {
      // when
      const token = await queueService.issueToken('user-1');

      // then
      expect(token.status).toBe('WAITING');
      expect(token.queuePosition).toBe(1);
      expect(token.tokenValue).toBeDefined();
    });

    it('여러 유저가 토큰을 발급하면 순서대로 대기열에 배치된다', async () => {
      // when
      const token1 = await queueService.issueToken('user-1');
      const token2 = await queueService.issueToken('user-2');
      const token3 = await queueService.issueToken('user-3');

      // then
      expect(token1.queuePosition).toBe(1);
      expect(token2.queuePosition).toBe(2);
      expect(token3.queuePosition).toBe(3);

      // WAITING Sorted Set 확인
      const waitingCount = await redis.zcard('queue:waiting');
      expect(waitingCount).toBe(3);
    });

    it('같은 유저가 중복 발급하면 기존 토큰을 반환한다', async () => {
      // given
      const first = await queueService.issueToken('user-1');

      // when
      const second = await queueService.issueToken('user-1');

      // then
      expect(second.tokenId).toBe(first.tokenId);
      expect(second.tokenValue).toBe(first.tokenValue);
    });
  });

  // ──────────────────────────────────────────────
  // 2. WAITING → ACTIVE 자동 전환
  // ──────────────────────────────────────────────
  describe('WAITING → ACTIVE 자동 전환', () => {
    it('activateTokens 호출 시 WAITING 토큰이 ACTIVE로 전환된다', async () => {
      // given: 3명의 유저가 대기열에 진입
      await queueService.issueToken('user-1');
      await queueService.issueToken('user-2');
      await queueService.issueToken('user-3');

      // when: 활성화 실행
      const activated = await queueService.activateTokens();

      // then
      expect(activated).toBe(3);

      // 각 토큰 상태 확인
      const status1 = await queueService.getQueueStatus(
        (await redis.get('queue:user:user-1'))!,
      );
      const status2 = await queueService.getQueueStatus(
        (await redis.get('queue:user:user-2'))!,
      );
      const status3 = await queueService.getQueueStatus(
        (await redis.get('queue:user:user-3'))!,
      );

      expect(status1.status).toBe('ACTIVE');
      expect(status1.position).toBe(0);
      expect(status2.status).toBe('ACTIVE');
      expect(status3.status).toBe('ACTIVE');

      // WAITING Set은 비어있어야 함
      const waitingCount = await redis.zcard('queue:waiting');
      expect(waitingCount).toBe(0);

      // ACTIVE Set에 3개
      const activeCount = await redis.zcard('queue:active');
      expect(activeCount).toBe(3);
    });

    it('MAX_ACTIVE_TOKENS(50)를 초과하면 나머지는 WAITING 상태를 유지한다', async () => {
      // given: 60명의 유저가 대기열에 진입
      for (let i = 1; i <= 60; i++) {
        await queueService.issueToken(`user-${i}`);
      }

      const waitingBefore = await redis.zcard('queue:waiting');
      expect(waitingBefore).toBe(60);

      // when: 활성화 실행 (최대 50명만 활성화)
      const activated = await queueService.activateTokens();

      // then
      expect(activated).toBe(50);

      const activeCount = await redis.zcard('queue:active');
      expect(activeCount).toBe(50);

      const waitingAfter = await redis.zcard('queue:waiting');
      expect(waitingAfter).toBe(10);
    });

    it('ACTIVE 토큰이 만료되면 새로운 WAITING 토큰이 활성화된다', async () => {
      // given: 60명 진입 후 50명 활성화
      for (let i = 1; i <= 60; i++) {
        await queueService.issueToken(`user-${i}`);
      }
      await queueService.activateTokens();

      // user-1 토큰 만료
      const user1TokenValue = await redis.get('queue:user:user-1');
      await queueService.expireToken(user1TokenValue!);

      // when: 다시 활성화 (1자리 비었으므로 1명 활성화)
      const activated = await queueService.activateTokens();

      // then
      expect(activated).toBe(1);

      const activeCount = await redis.zcard('queue:active');
      // 만료된 1개 제거 + 새로 1개 추가 = 50
      expect(activeCount).toBe(50);
    });
  });

  // ──────────────────────────────────────────────
  // 3. ACTIVE 토큰 검증
  // ──────────────────────────────────────────────
  describe('ACTIVE 토큰 검증', () => {
    it('ACTIVE 상태의 토큰은 validateToken을 통과한다', async () => {
      // given
      const token = await queueService.issueToken('user-1');
      await queueService.activateTokens();

      // when
      const validated = await queueService.validateToken(token.tokenValue);

      // then
      expect(validated.status).toBe('ACTIVE');
    });

    it('WAITING 상태의 토큰은 validateToken에서 거부된다', async () => {
      // given: 51명 진입 → 50명만 활성화 → user-51은 WAITING
      for (let i = 1; i <= 51; i++) {
        await queueService.issueToken(`user-${i}`);
      }
      await queueService.activateTokens();

      const user51TokenValue = await redis.get('queue:user:user-51');

      // when & then
      await expect(
        queueService.validateToken(user51TokenValue!),
      ).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────
  // 4. 대량 동시 토큰 발급 테스트
  // ──────────────────────────────────────────────
  describe('동시성 테스트', () => {
    it('100명이 동시에 토큰을 발급해도 정확히 100개의 토큰이 생성된다', async () => {
      // when
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          queueService.issueToken(`concurrent-user-${i}`),
        ),
      );

      // then
      const waitingCount = await redis.zcard('queue:waiting');
      expect(waitingCount).toBe(100);
    });
  });
});
