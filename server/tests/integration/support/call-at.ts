import {
  type CallOptions,
  type CallResult,
  type RouteDescriptor,
  call as harnessCall,
  route,
} from "./http";

/** Harness `call` that can also target a concrete URL: `path` (query string included) overrides the route template. */
export type CallAtOptions = CallOptions & {
  /** Concrete URL, e.g. `/api/v1/properties/<id>/reservations?q=x` (the /api/v1 prefix is optional). */
  path?: string;
  /** HTTP method when it differs from the descriptor's. */
  method?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON in assertions
export function call<T = any>(
  target: RouteDescriptor,
  options: CallAtOptions = {},
): Promise<CallResult<T>> {
  const { path, method, ...rest } = options;
  const verb = method ?? target.method;
  if (!path) return harnessCall<T>(route(verb, target.path), rest);
  return harnessCall<T>(route(verb, path.replace(/^\/api\/v1(?=\/)/, "")), rest);
}
