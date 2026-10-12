import * as dotenv from 'dotenv';

dotenv.config();

// Both application state and imported chain history live in the Gateway database.
export function gatewayPostgresConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    connectionString: env.GATEWAY_DB_URL,
    host: env.GATEWAY_DB_HOST,
    port: Number(env.GATEWAY_DB_PORT || 5432),
    database: env.GATEWAY_DB_NAME,
    user: env.GATEWAY_DB_USERNAME,
    password: env.GATEWAY_DB_PASSWORD,
  };
}
