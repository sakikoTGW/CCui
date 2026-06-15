export type ComputerUseInputAPI = Record<string, unknown>
export type ComputerUseInput = { isSupported: false } | { isSupported: true } & ComputerUseInputAPI

const stub: ComputerUseInput = { isSupported: false }
export default stub
