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
import { Role } from './Role';
import { Disciple } from './Disciple';
import { Site } from './Site';

@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'full_name', type: 'varchar', length: 150, nullable: true })
  fullName?: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  @Index()
  email!: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phoneNumber?: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'role_id' })
  @Index()
  roleId!: number;

  @ManyToOne(() => Role, (role) => role.adminUsers)
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  // Only set for "site-scoped" roles (i.e. any role other than admin/
  // super_admin -- see utils/roleScope.util.ts). Ties this user to exactly
  // one Site, so their view of disciples/dashboard/reports can be
  // restricted to that site instead of the whole system. Always NULL for
  // admin/super_admin, who see everything.
  @Column({ name: 'site_id', nullable: true })
  @Index()
  siteId?: number | null;

  @ManyToOne(() => Site, { nullable: true })
  @JoinColumn({ name: 'site_id' })
  site?: Site | null;

  @Column({ name: 'must_change_password', type: 'boolean', default: true })
  mustChangePassword!: boolean;

  @Column({ name: 'profile_completed', type: 'boolean', default: false })
  profileCompleted!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // Self-referencing: every admin user is created by another admin user,
  // except the auto-seeded first super_admin, where this stays NULL.
  @Column({ name: 'created_by', nullable: true })
  createdById?: number | null;

  @ManyToOne(() => AdminUser, (adminUser) => adminUser.createdUsers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by' })
  createdBy?: AdminUser | null;

  @OneToMany(() => AdminUser, (adminUser) => adminUser.createdBy)
  createdUsers!: AdminUser[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Disciple, (disciple) => disciple.createdBy)
  createdDisciples!: Disciple[];

  @OneToMany(() => Disciple, (disciple) => disciple.updatedBy)
  updatedDisciples!: Disciple[];
}