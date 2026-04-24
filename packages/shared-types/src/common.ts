export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UUID = Brand<string, "UUID">;
export type ISOTimestamp = Brand<string, "ISOTimestamp">;

export function asUUID(value: string): UUID {
  return value as UUID;
}

export function asISOTimestamp(value: string): ISOTimestamp {
  return value as ISOTimestamp;
}

export interface PipelineError {
  status: "error";
  error: string;
  retryable: boolean;
  code?: string;
}

export type PipelineResult<Ok> = Ok | PipelineError;
