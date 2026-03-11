export interface MessageImage {
  /** Base64-encoded image data */
  data: string;
  /** MIME type, e.g. "image/jpeg" */
  mediaType: string;
}

export interface Channel {
  name: string;
  start(onMessage: (text: string, images?: MessageImage[]) => Promise<string>): Promise<void>;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
}
