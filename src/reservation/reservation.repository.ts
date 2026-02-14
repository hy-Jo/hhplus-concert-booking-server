import { Reservation } from './domain/reservation.entity';

export interface ReservationRepository {
  save(reservation: Reservation): Promise<Reservation>;
  findById(reservationId: string): Promise<Reservation | null>;
  findBySeatIdAndStatusHeld(seatId: string): Promise<Reservation | null>;
  updateStatus(reservationId: string, status: string): Promise<void>;
  findExpiredHeldReservations(now: Date): Promise<Reservation[]>;
}
