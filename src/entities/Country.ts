import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Continent } from './Continent';
import { Center } from './Center';

@Entity('countries')
export class Country {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 150, unique: true })
  name!: string;

  @Column({ name: 'continent_id' })
  @Index()
  continentId!: number;

  @ManyToOne(() => Continent, (continent) => continent.countries)
  @JoinColumn({ name: 'continent_id' })
  continent!: Continent;

  @OneToMany(() => Center, (center) => center.country)
  centers!: Center[];
}