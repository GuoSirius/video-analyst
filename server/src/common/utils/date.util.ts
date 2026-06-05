import dayjs from 'dayjs'

/** YYYY-MM-DD format (filesystem-safe date) */
export const formatDate = () => dayjs().format('YYYY-MM-DD')

/** YYYY-MM-DD_HH-mm-ss format (filesystem-safe timestamp) */
export const formatTimestamp = () => dayjs().format('YYYY-MM-DD_HH-mm-ss')

/** YYYY-MM-DD HH:mm:ss format (display) */
export const formatDisplay = () => dayjs().format('YYYY-MM-DD HH:mm:ss')

/** Numeric timestamp (milliseconds since epoch) */
export const nowMs = () => dayjs().valueOf()
