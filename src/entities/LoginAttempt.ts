import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One row per login attempt, successful or not. Kept as its own table
 * (rather than a column on AdminUser) because it's an unbounded, ever-
 * growing log of EVENTS, not a property of a user -- and because failed
 * attempts may reference an email that doesn't even correspond to a real
 * account (someone guessing emails too), which AdminUser can't represent.
 */
@Entity('login_attempts')
export class LoginAttempt {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 150 })
  @Index()
  email!: string;

  @Column({ type: 'boolean' })
  successful!: boolean;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent?: string;

  // Short machine-readable reason for failures: 'user_not_found',
  // 'wrong_password', 'account_deactivated'. Null for successful attempts.
  @Column({ name: 'failure_reason', type: 'varchar', length: 50, nullable: true })
  failureReason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Index()
  createdAt!: Date;
}
