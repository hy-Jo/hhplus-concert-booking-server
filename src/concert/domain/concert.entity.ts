import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { ConcertSchedule } from './concert-schedule.entity';

@Entity('concert')
export class Concert {
  @PrimaryGeneratedColumn('uuid')
  concertId: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => ConcertSchedule, (schedule) => schedule.concert)
  schedules: ConcertSchedule[];
}
