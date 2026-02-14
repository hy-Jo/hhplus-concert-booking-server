import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ConcertSchedule } from './concert-schedule.entity';

@Entity('seat')
export class Seat {
  @PrimaryGeneratedColumn('uuid')
  seatId: string;

  @Column()
  scheduleId: string;

  @Column()
  seatNo: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => ConcertSchedule, (schedule) => schedule.seats)
  @JoinColumn({ name: 'scheduleId' })
  schedule: ConcertSchedule;
}
