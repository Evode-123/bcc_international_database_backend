import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Disciple } from './Disciple';
import { Site } from './Site';
import { Language } from './Language';
import { RepeatAttendance } from './RepeatAttendance';

export enum TrainingMode {
  ONLINE = 'Online',
  IN_PERSON = 'In-person',
}

@Entity('trainings')
export class Training {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'disciple_id' })
  @Index()
  discipleId!: number;

  @ManyToOne(() => Disciple, (disciple) => disciple.trainings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'disciple_id' })
  disciple!: Disciple;

  @Column({ name: 'graduation_year', type: 'smallint' })
  @Index()
  graduationYear!: number;

  @Column({ name: 'training_mode', type: 'enum', enum: TrainingMode, nullable: true })
  trainingMode?: TrainingMode;

  @Column({ name: 'training_language_id', nullable: true })
  @Index()
  trainingLanguageId?: number | null;

  @ManyToOne(() => Language, (language) => language.trainings, { nullable: true })
  @JoinColumn({ name: 'training_language_id' })
  trainingLanguage?: Language | null;

  // Single FK: site → center → country → continent.
  // Center and country are always derivable via joins; never stored here.
  @Column({ name: 'training_site_id', nullable: true })
  @Index()
  trainingSiteId?: number | null;

  @ManyToOne(() => Site, (site) => site.trainings, { nullable: true })
  @JoinColumn({ name: 'training_site_id' })
  trainingSite?: Site | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => RepeatAttendance, (repeatAttendance) => repeatAttendance.training)
  repeatAttendances!: RepeatAttendance[];
}