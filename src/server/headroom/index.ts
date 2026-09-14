export {
  DEFAULT_HEADROOM_URL,
  getHeadroomProxyUrl,
  isHeadroomEnabled,
  toHeadroomMessages,
  fromHeadroomMessages,
  checkHeadroomCli,
  checkHeadroomProxy,
  checkHeadroomAvailability,
  compressMessagesWithHeadroom,
} from './client.js'

export type {
  HeadroomOpenAIMessage,
  HeadroomCompressResponse,
  HeadroomCompressResult,
  HeadroomStatus,
  CompressMessagesOptions,
} from './client.js'
