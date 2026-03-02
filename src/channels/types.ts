export interface Channel {
  name: string;
  start(onMessage: (text: string) => Promise<string>): Promise<void>;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
}
