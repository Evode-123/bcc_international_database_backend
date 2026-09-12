import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Country } from './Country';

@Entity('continents')
export class Continent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @OneToMany(() => Country, (country) => country.continent)
  countries!: Country[];
}
