import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AdminUser } from './AdminUser';

/**
 * A single-use password reset token. The token itself is never stored in
 * plaintext -- only its SHA-256 hash -- so that even direct database
 * access doesn't expose a usable token (same principle as password_hash
 * on AdminUser). The plaintext token only ever exists in the reset email
 * and briefly in memory while it's being generated/verified.
 */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'admin_user_id' })
  @Index()
  adminUserId!: number;

  @ManyToOne(() => AdminUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: AdminUser;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  @Index({ unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
