import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PaymentStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('payment')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  paymentId: string;

  @Column({ unique: true })
  reservationId: string;

  @Column()
  userId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: PaymentStatus })
  status: PaymentStatus;

  @Column({ nullable: true })
  paidAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
