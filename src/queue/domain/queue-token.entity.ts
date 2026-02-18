import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum QueueTokenStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
}

@Entity('queue_token')
export class QueueToken {
  @PrimaryGeneratedColumn('uuid')
  tokenId: string;

  @Column()
  userId: string;

  @Column({ unique: true })
  tokenValue: string;

  @Column({ nullable: true })
  queuePosition: number;

  @Column()
  issuedAt: Date;

  @Column()
  expiresAt: Date;

  @Column({ type: 'enum', enum: QueueTokenStatus, default: QueueTokenStatus.WAITING })
  status: QueueTokenStatus;

  isExpired(): boolean {
    return this.status === QueueTokenStatus.EXPIRED || new Date() > this.expiresAt;
  }

  isActive(): boolean {
    return this.status === QueueTokenStatus.ACTIVE && new Date() <= this.expiresAt;
  }
}
