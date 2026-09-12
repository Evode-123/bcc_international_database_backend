import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  // TypeORM's DataSource takes these as discrete fields directly --
  // no need to assemble a connection-string URL ourselves.
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
  },

  jwtSecret: required('JWT_ACCESS_SECRET'),
  jwtExpiresIn: process.env.JWT_ACCESS_EXPIRES || '1d',

  superAdmin: {
    email: required('SUPER_ADMIN_EMAIL'),
    fullName: process.env.SUPER_ADMIN_FULL_NAME || 'Super Admin',
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromAddress: process.env.SMTP_FROM || 'no-reply@bcc-disciples.org',
  },

  corsOrigin: process.env.CORS_ORIGIN || process.env.CLIENT_URL || '*',
};