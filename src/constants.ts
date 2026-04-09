const isDev = process.env['OPENFOX_DEV'] === 'true'
export const VERSION = isDev ? `${process.env['OPENFOX_VERSION']}-dev` : process.env['OPENFOX_VERSION'] ?? 'unknown'