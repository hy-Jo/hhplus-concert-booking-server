import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Concert } from './concert.entity';
import { Seat } from './seat.entity';

@Entity('concert_schedule')
export class ConcertSchedule {
  @PrimaryGeneratedColumn('uuid')
  scheduleId: string;

  @Column()
  concertId: string;

  @Column({ type: 'date' })
  concertDate: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Concert, (concert) => concert.schedules)
  @JoinColumn({ name: 'concertId' })
  concert: Concert;

  @OneToMany(() => Seat, (seat) => seat.schedule)
  seats: Seat[];
}
