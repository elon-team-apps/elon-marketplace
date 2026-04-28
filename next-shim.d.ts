declare module "next" {
  import type { IncomingMessage, ServerResponse } from "http";

  export interface NextApiRequest extends IncomingMessage {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
  }

  export interface NextApiResponse<T = unknown> extends ServerResponse {
    status: (statusCode: number) => NextApiResponse<T>;
    json: (body: T) => NextApiResponse<T>;
    setHeader: (name: string, value: string | string[]) => this;
    end: () => this;
  }
}
