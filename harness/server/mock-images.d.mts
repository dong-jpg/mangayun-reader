export function makePng(seed: string, width?: number, height?: number): Buffer
export function hit(path: string): number
export function mockServerPlugin(): {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureServer(server: any): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configurePreviewServer(server: any): void
}
