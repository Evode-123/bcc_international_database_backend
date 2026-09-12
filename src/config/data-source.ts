import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env';

import { Continent } from '../entities/Continent';
import { Country } from '../entities/Country';
import { Center } from '../entities/Center';
import { Site } from '../entities/Site';
import { Language } from '../entities/Language';
import { Role } from '../entities/Role';
import { Permission } from '../entities/Permission';
import { RolePermission } from '../entities/RolePermission';
import { AdminUser } from '../entities/AdminUser';
import { Disciple } from '../entities/Disciple';
import { Training } from '../entities/Training';
import { RepeatAttendance } from '../entities/RepeatAttendance';
import { LoginAttempt } from '../entities/LoginAttempt';
import { PasswordResetToken } from '../entities/PasswordResetToken';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.db.host,
  port: env.db.port,
  username: env.db.user,
  password: env.db.password,
  database: env.db.name,

  entities: [
    Continent,
    Country,
    Center,
    Site,
    Language,
    Role,
    Permission,
    RolePermission,
    AdminUser,
    Disciple,
    Training,
    RepeatAttendance,
    LoginAttempt,
    PasswordResetToken,
  ],

  synchronize: true,

  logging: env.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
});