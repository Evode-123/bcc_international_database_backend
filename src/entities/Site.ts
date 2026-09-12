import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { Center } from './Center';
import { Disciple } from './Disciple';
import { Training } from './Training';

@Entity('sites')
@Unique(['name', 'centerId'])
export class Site {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'center_id' })
  @Index()
  centerId!: number;

  @ManyToOne(() => Center, (center) => center.sites)
  @JoinColumn({ name: 'center_id' })
  center!: Center;

  // true = this site was auto-created as the default when the center has no
  // separate sub-sites. The UI hides the site dropdown when only this
  // default site exists (is_default = true and it is the only site).
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Disciple, (disciple) => disciple.trainingSite)
  disciples!: Disciple[];

  @OneToMany(() => Training, (training) => training.trainingSite)
  trainings!: Training[];
}