import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Site } from './Site';
import { AdminUser } from './AdminUser';
import { Training } from './Training';
import { RepeatAttendance } from './RepeatAttendance';

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
}

@Entity('disciples')
export class Disciple {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'family_name', type: 'varchar', length: 150 })
  @Index()
  familyName!: string;

  @Column({ name: 'other_names', type: 'varchar', length: 150, nullable: true })
  otherNames?: string;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender?: Gender;

  // Replaces the old `age` smallint column. Storing date of birth instead
  // of a raw age means the value never goes stale -- age can always be
  // computed on demand (see DiscipleViewModal.js on the frontend) rather
  // than needing to be re-entered every year.
  //
  // TypeORM normalizes 'date' columns to a 'YYYY-MM-DD' string both when
  // writing (accepts either a JS Date or a string) and when reading back,
  // which is exactly the format an <input type="date"> expects/returns.
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phoneNumber?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string;

  // Current city (free text — no FK needed)
  @Column({ type: 'varchar', length: 150, nullable: true })
  city?: string;

  // The local church/congregation where this disciple fellowships.
  // Free text — not a FK to Centers because this is their personal
  // home church, which may not be a BCC training center at all.
  @Column({ name: 'fellowship_church', type: 'varchar', length: 200, nullable: true })
  fellowshipChurch?: string;

  // Single FK that gives us site → center → country → continent.
  // Country and center are derived via joins; never stored redundantly here.
  @Column({ name: 'training_site_id', nullable: true })
  @Index()
  trainingSiteId?: number | null;

  @ManyToOne(() => Site, (site) => site.disciples, { nullable: true })
  @JoinColumn({ name: 'training_site_id' })
  trainingSite?: Site | null;

  // ---- Audit trail ----
  @Column({ name: 'created_by', nullable: true })
  createdById?: number | null;

  @ManyToOne(() => AdminUser, (adminUser) => adminUser.createdDisciples, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by' })
  createdBy?: AdminUser | null;

  @Column({ name: 'updated_by', nullable: true })
  updatedById?: number | null;

  @ManyToOne(() => AdminUser, (adminUser) => adminUser.updatedDisciples, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'updated_by' })
  updatedBy?: AdminUser | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Training, (training) => training.disciple)
  trainings!: Training[];

  @OneToMany(() => RepeatAttendance, (repeatAttendance) => repeatAttendance.disciple)
  repeatAttendances!: RepeatAttendance[];
}