import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum ReservationStatus {
  HELD = 'HELD',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

@Entity('reservation')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  reservationId: string;

  @Column()
  userId: string;

  @Column()
  seatId: string;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.HELD })
  status: ReservationStatus;

  @Column()
  heldAt: Date;

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
