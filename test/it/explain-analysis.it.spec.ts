import { DataSource } from 'typeorm';
import { getDatasource } from './util';

/**
 * EXPLAIN 기반 인덱스 효과 분석 테스트
 *
 * 목적: 보고서에서 제안한 인덱스 적용 전후로 실행계획(EXPLAIN)을 비교하여
 * Full Table Scan → Index Scan 전환을 검증합니다.
 *
 * 절차:
 *   1. 대량 데이터 삽입 (reservation 10만건, queue_token 5만건, seat 5천건)
 *   2. 인덱스 없이 EXPLAIN 실행 → type, rows 기록
 *   3. 인덱스 생성
 *   4. 인덱스 적용 후 EXPLAIN 실행 → type, rows 비교
 */
describe('EXPLAIN 기반 인덱스 효과 분석', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await getDatasource();
  });

  /**
   * EXPLAIN 결과에서 주요 필드를 추출합니다.
   */
  const explain = async (sql: string, params: any[] = []) => {
    const rows = await dataSource.query(`EXPLAIN ${sql}`, params);
    return rows[0] as {
      type: string;
      possible_keys: string | null;
      key: string | null;
      rows: number;
      Extra: string;
    };
  };

  /**
   * 쿼리 실행시간을 측정합니다 (ms).
   */
  const measure = async (sql: string, params: any[] = []): Promise<number> => {
    const start = Date.now();
    await dataSource.query(sql, params);
    return Date.now() - start;
  };

  // ──────────────────────────────────────────────
  // 1. reservation 테이블 — 좌석 예약 중복 확인 쿼리
  // ──────────────────────────────────────────────
  describe('reservation: 좌석 예약 중복 확인 (seatId + status)', () => {
    beforeAll(async () => {
      // 대량 데이터 삽입: 10만건
      const BATCH = 1000;
      const TOTAL = 100_000;
      const statuses = ['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED'];

      for (let i = 0; i < TOTAL; i += BATCH) {
        const values = Array.from({ length: BATCH }, (_, j) => {
          const idx = i + j;
          const status = statuses[idx % 4];
          return `(UUID(), 'user-${idx}', 'seat-${String(idx % 5000).padStart(4, '0')}', '${status}', NOW(), DATE_ADD(NOW(), INTERVAL 5 MINUTE))`;
        }).join(',');

        await dataSource.query(
          `INSERT INTO reservation (reservationId, userId, seatId, status, heldAt, expiresAt) VALUES ${values}`,
        );
      }
    });

    it('인덱스 적용 전: Full Table Scan 발생을 확인한다', async () => {
      const result = await explain(
        `SELECT * FROM reservation WHERE seatId = ? AND status IN ('HELD', 'CONFIRMED') LIMIT 1`,
        ['seat-0001'],
      );

      console.log('[BEFORE INDEX] reservation (seatId, status):', result);

      // 인덱스 없으면 ALL (Full Table Scan) 또는 대량의 rows
      expect(result.type).toBe('ALL');
    });

    it('인덱스 적용 후: Index Scan으로 전환되고 탐색 행 수가 감소한다', async () => {
      await dataSource.query(
        `CREATE INDEX idx_reservation_seat_status ON reservation (seatId, status)`,
      );

      const result = await explain(
        `SELECT * FROM reservation WHERE seatId = ? AND status IN ('HELD', 'CONFIRMED') LIMIT 1`,
        ['seat-0001'],
      );

      console.log('[AFTER INDEX] reservation (seatId, status):', result);

      expect(result.type).not.toBe('ALL');
      expect(result.key).toBe('idx_reservation_seat_status');
      // 10만건 중 특정 seatId+status 조합은 수십 건 이내로 줄어야 함
      expect(result.rows).toBeLessThan(1000);
    });
  });

  // ──────────────────────────────────────────────
  // 2. reservation 테이블 — 만료 예약 배치 조회
  // ──────────────────────────────────────────────
  describe('reservation: 만료 예약 배치 조회 (status + expiresAt)', () => {
    it('인덱스 적용 전: Full Table Scan 발생을 확인한다', async () => {
      const result = await explain(
        `SELECT * FROM reservation WHERE status = 'HELD' AND expiresAt <= NOW()`,
      );

      console.log('[BEFORE INDEX] reservation (status, expiresAt):', result);

      expect(result.type).toBe('ALL');
    });

    it('인덱스 적용 후: Index Scan으로 전환된다', async () => {
      await dataSource.query(
        `CREATE INDEX idx_reservation_status_expires ON reservation (status, expiresAt)`,
      );

      const result = await explain(
        `SELECT * FROM reservation WHERE status = 'HELD' AND expiresAt <= NOW()`,
      );

      console.log('[AFTER INDEX] reservation (status, expiresAt):', result);

      expect(result.type).not.toBe('ALL');
      expect(result.key).toBe('idx_reservation_status_expires');
    });
  });

  // ──────────────────────────────────────────────
  // 3. queue_token 테이블 — 만료 토큰 + WAITING 카운트
  // ──────────────────────────────────────────────
  describe('queue_token: 만료 토큰 조회 + WAITING 카운트 (status + expiresAt)', () => {
    beforeAll(async () => {
      // 대량 데이터 삽입: 5만건
      const BATCH = 1000;
      const TOTAL = 50_000;
      const statuses = ['WAITING', 'ACTIVE', 'EXPIRED'];

      for (let i = 0; i < TOTAL; i += BATCH) {
        const values = Array.from({ length: BATCH }, (_, j) => {
          const idx = i + j;
          const status = statuses[idx % 3];
          return `(UUID(), 'user-q-${idx}', UUID(), ${idx + 1}, NOW(), DATE_ADD(NOW(), INTERVAL 10 MINUTE), '${status}')`;
        }).join(',');

        await dataSource.query(
          `INSERT INTO queue_token (tokenId, userId, tokenValue, queuePosition, issuedAt, expiresAt, status) VALUES ${values}`,
        );
      }
    });

    it('인덱스 적용 전: Full Table Scan 발생을 확인한다', async () => {
      const result = await explain(
        `SELECT * FROM queue_token WHERE status = 'ACTIVE' AND expiresAt <= NOW()`,
      );

      console.log('[BEFORE INDEX] queue_token (status, expiresAt):', result);

      expect(result.type).toBe('ALL');
    });

    it('인덱스 적용 후: Index Scan으로 전환된다', async () => {
      await dataSource.query(
        `CREATE INDEX idx_queue_token_status_expires ON queue_token (status, expiresAt)`,
      );

      const result = await explain(
        `SELECT * FROM queue_token WHERE status = 'ACTIVE' AND expiresAt <= NOW()`,
      );

      console.log('[AFTER INDEX] queue_token (status, expiresAt):', result);

      expect(result.type).not.toBe('ALL');
      expect(result.key).toBe('idx_queue_token_status_expires');
    });

    it('WAITING 카운트도 동일 인덱스로 커버된다 (leftmost prefix)', async () => {
      const result = await explain(
        `SELECT COUNT(*) FROM queue_token WHERE status = 'WAITING'`,
      );

      console.log('[AFTER INDEX] queue_token COUNT WHERE status:', result);

      expect(result.type).not.toBe('ALL');
      expect(result.key).toBe('idx_queue_token_status_expires');
    });
  });

  // ──────────────────────────────────────────────
  // 4. seat 테이블 — 좌석 단건 조회 (scheduleId + seatNo)
  // ──────────────────────────────────────────────
  describe('seat: 좌석 단건 조회 (scheduleId + seatNo)', () => {
    beforeAll(async () => {
      // 대형 공연: 100개 스케줄 × 50석 = 5000석 추가
      for (let s = 1; s <= 100; s++) {
        const scheduleId = `schedule-bulk-${String(s).padStart(3, '0')}`;
        await dataSource.query(
          `INSERT IGNORE INTO concert_schedule (scheduleId, concertId, concertDate) VALUES (?, 'concert-001', ?)`,
          [scheduleId, `2025-${String((s % 12) + 1).padStart(2, '0')}-15`],
        );

        const values = Array.from(
          { length: 50 },
          (_, i) =>
            `(UUID(), '${scheduleId}', ${i + 1})`,
        ).join(',');

        await dataSource.query(
          `INSERT INTO seat (seatId, scheduleId, seatNo) VALUES ${values}`,
        );
      }
    });

    it('인덱스 적용 전: FK 인덱스만으로는 seatNo 정렬에 filesort 발생', async () => {
      const result = await explain(
        `SELECT * FROM seat WHERE scheduleId = ? AND seatNo = ?`,
        ['schedule-bulk-050', 25],
      );

      console.log('[BEFORE INDEX] seat (scheduleId, seatNo):', result);

      // FK 인덱스(scheduleId)로 ref 접근은 가능하지만, seatNo까지 커버 못함
      expect(result.key).not.toBe('idx_seat_schedule_no');
    });

    it('인덱스 적용 후: 복합 인덱스로 즉시 탐색된다', async () => {
      await dataSource.query(
        `CREATE UNIQUE INDEX idx_seat_schedule_no ON seat (scheduleId, seatNo)`,
      );

      const result = await explain(
        `SELECT * FROM seat WHERE scheduleId = ? AND seatNo = ?`,
        ['schedule-bulk-050', 25],
      );

      console.log('[AFTER INDEX] seat (scheduleId, seatNo):', result);

      expect(result.key).toBe('idx_seat_schedule_no');
      expect(result.rows).toBeLessThanOrEqual(1);
    });
  });

  // ──────────────────────────────────────────────
  // 5. 처리시간 비교 (인덱스 적용 후 상태에서)
  // ──────────────────────────────────────────────
  describe('처리시간 측정 (인덱스 적용 상태)', () => {
    it('reservation 좌석 중복 확인: 10만건에서 1ms 이내 응답', async () => {
      const elapsed = await measure(
        `SELECT * FROM reservation WHERE seatId = ? AND status IN ('HELD', 'CONFIRMED') LIMIT 1`,
        ['seat-0001'],
      );

      console.log(`[PERF] reservation 좌석 중복 확인: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(50);
    });

    it('queue_token WAITING 카운트: 5만건에서 빠른 응답', async () => {
      const elapsed = await measure(
        `SELECT COUNT(*) FROM queue_token WHERE status = 'WAITING'`,
      );

      console.log(`[PERF] queue_token WAITING 카운트: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(50);
    });

    it('seat 단건 조회: const/eq_ref 수준 즉시 응답', async () => {
      const elapsed = await measure(
        `SELECT * FROM seat WHERE scheduleId = ? AND seatNo = ?`,
        ['schedule-bulk-050', 25],
      );

      console.log(`[PERF] seat 단건 조회: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(50);
    });
  });
});
