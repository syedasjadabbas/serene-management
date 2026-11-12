import type { CursorPageMeta } from "@serene/shared/types/api";

export type {
  ApiSuccess,
  CursorPage,
  CursorPageMeta,
  OffsetPage,
  OffsetPageMeta,
} from "@serene/shared/types/api";
export type { ApiErrorEnvelope, ClientApiError } from "../errors";

/** Success envelope reduced by `baseApi` (`unwrapEnvelope`): `{ data, meta? }`. */
export interface UnwrappedResult<T, M = undefined> {
  data: T;
  meta?: M;
}

/** A keyset-paginated list as the endpoints expose it to components. */
export type Page<T> = { items: T[]; meta: CursorPageMeta };
