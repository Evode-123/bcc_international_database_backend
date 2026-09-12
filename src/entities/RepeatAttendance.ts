import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Disciple } from './Disciple';
import { Training } from './Training';

/**
 * A disciple returning to STUDY a training they already graduated from,
 * without graduating again. Kept separate from Training (which always
 * represents an actual graduation) so graduation_year on Training never
 * has to mean anything other than "this person graduated this year."
 */
@Entity('repeat_attendances')
export class RepeatAttendance {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'disciple_id' })
  @Index()
  discipleId!: number;

  @ManyToOne(() => Disciple, (disciple) => disciple.repeatAttendances, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'disciple_id' })
  disciple!: Disciple;

  // Always required: a repeat is always tied to the exact training program
  // the disciple originally graduated from.
  @Column({ name: 'training_id' })
  @Index()
  trainingId!: number;

  @ManyToOne(() => Training, (training) => training.repeatAttendances, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'training_id' })
  training!: Training;

  @Column({ name: 'attendance_year', type: 'smallint' })
  attendanceYear!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
