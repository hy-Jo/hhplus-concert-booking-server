export interface SoldOutRankingResponse {
  rank: number;
  scheduleId: string;
  concertTitle: string;
  concertDate: string;
  soldOutDurationSec: number;
}

export interface PopularRankingResponse {
  rank: number;
  scheduleId: string;
  concertTitle: string;
  concertDate: string;
  reservationCount: number;
}
