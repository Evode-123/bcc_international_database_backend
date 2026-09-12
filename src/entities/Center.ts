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
import { Country } from './Country';
import { Site } from './Site';
import { Training } from './Training';

@Entity('centers')
@Unique(['name', 'countryId'])
export class Center {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'country_id' })
  @Index()
  countryId!: number;

  @ManyToOne(() => Country, (country) => country.centers)
  @JoinColumn({ name: 'country_id' })
  country!: Country;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Site, (site) => site.center)
  sites!: Site[];

  @OneToMany(() => Training, (training) => training.trainingSite)
  trainings!: Training[];
}