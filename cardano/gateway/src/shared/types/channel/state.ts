export enum ChannelState {
  Uninitialized = 'Uninitialized',
  Init = 'Init',
  TryOpen = 'TryOpen',
  Open = 'Open',
  Close = 'Close',
  Flushing = 'Flushing',
  FlushComplete = 'FlushComplete',
}
