const TestSequencer = require('@jest/test-sequencer').default;

/**
 * explain-analysis 테스트를 마지막에 실행하는 커스텀 시퀀서.
 * 벌크 데이터 삽입이 다른 테스트의 성능에 영향을 주지 않도록 합니다.
 */
class CustomSequencer extends TestSequencer {
  sort(tests: any[]): any[] {
    return [...tests].sort((a: any, b: any) => {
      const aIsExplain = a.path.includes('explain-analysis') ? 1 : 0;
      const bIsExplain = b.path.includes('explain-analysis') ? 1 : 0;
      if (aIsExplain !== bIsExplain) return aIsExplain - bIsExplain;
      return a.path.localeCompare(b.path);
    });
  }
}

module.exports = CustomSequencer;
