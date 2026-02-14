import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PointTxType {
  CHARGE = 'CHARGE',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
}

@Entity('point_tx')
export class PointTransaction {
  @PrimaryGeneratedColumn('uuid')
  txId: string;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: PointTxType })
  txType: PointTxType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  balanceAfter: number;

  @Column({ nullable: true })
  refPaymentId: string;

  @CreateDateColumn()
  createdAt: Date;
}
