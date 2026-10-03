import type { BusinessDateView } from "@/modules/business-date/business-date.types";
import type { UpdatePropertyConfigurationInput } from "@/modules/properties/properties.schema";
import type { PropertyConfigurationView } from "@/modules/properties/properties.types";
import type {
  CreateFloorInput,
  CreateRoomsInput,
  CreateRoomTypeInput,
  CreateTaxInput,
  UpdateFloorInput,
  UpdateRoomInput,
  UpdateRoomTypeInput,
  UpdateTaxInput,
} from "@/modules/setup/setup.schema";
import type { PropertySetupView } from "@/modules/setup/setup.types";
import type { ApiSuccess } from "@/types/api";
import { baseApi } from "../baseApi";

/**
 * Property setup (room types, floors, rooms, taxes), operational settings and
 * go-live. Every write returns the whole setup view, so the page shows exactly
 * what the server stored. Room changes also change what can be sold.
 */

type WithProperty<T> = { propertyId: string } & T;

// Rooms and room types feed the room board, availability, rate screens and front desk.
const setupTags = (propertyId: string) => [
  { type: "PropertySetup" as const, id: propertyId },
  { type: "Availability" as const, id: propertyId },
  "Room" as const,
  "RoomStatus" as const,
  "RoomType" as const,
  "RatePlan" as const,
  "AuditLog" as const,
];

export const setupApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    propertySetup: build.query<PropertySetupView, string>({
      query: (propertyId) => `/properties/${propertyId}/setup`,
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      providesTags: (_r, _e, propertyId) => [{ type: "PropertySetup", id: propertyId }],
    }),
    createRoomType: build.mutation<PropertySetupView, WithProperty<{ body: CreateRoomTypeInput }>>({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/setup/room-types`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    updateRoomType: build.mutation<
      PropertySetupView,
      WithProperty<{ roomTypeId: string; body: UpdateRoomTypeInput }>
    >({
      query: ({ propertyId, roomTypeId, body }) => ({
        url: `/properties/${propertyId}/setup/room-types/${roomTypeId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    createFloor: build.mutation<PropertySetupView, WithProperty<{ body: CreateFloorInput }>>({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/setup/floors`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    updateFloor: build.mutation<
      PropertySetupView,
      WithProperty<{ floorId: string; body: UpdateFloorInput }>
    >({
      query: ({ propertyId, floorId, body }) => ({
        url: `/properties/${propertyId}/setup/floors/${floorId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    createRooms: build.mutation<PropertySetupView, WithProperty<{ body: CreateRoomsInput }>>({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/setup/rooms`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    updateRoom: build.mutation<
      PropertySetupView,
      WithProperty<{ roomId: string; body: UpdateRoomInput }>
    >({
      query: ({ propertyId, roomId, body }) => ({
        url: `/properties/${propertyId}/setup/rooms/${roomId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    createTax: build.mutation<PropertySetupView, WithProperty<{ body: CreateTaxInput }>>({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/setup/taxes`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    updateTax: build.mutation<
      PropertySetupView,
      WithProperty<{ taxRuleId: string; body: UpdateTaxInput }>
    >({
      query: ({ propertyId, taxRuleId, body }) => ({
        url: `/properties/${propertyId}/setup/taxes/${taxRuleId}`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertySetupView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => setupTags(propertyId),
    }),
    propertyConfiguration: build.query<PropertyConfigurationView, string>({
      query: (propertyId) => `/properties/${propertyId}/configuration`,
      transformResponse: (response: ApiSuccess<PropertyConfigurationView>) => response.data,
      providesTags: (_r, _e, propertyId) => [{ type: "PropertyConfiguration", id: propertyId }],
    }),
    updatePropertyConfiguration: build.mutation<
      PropertyConfigurationView,
      WithProperty<{ body: UpdatePropertyConfigurationInput }>
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/configuration`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<PropertyConfigurationView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => [
        { type: "PropertyConfiguration", id: propertyId },
        "AuditLog",
      ],
    }),
    /** Go-live: opens the property's first business date (once). */
    initializeBusinessDate: build.mutation<
      BusinessDateView,
      WithProperty<{ body: { date: string; reason: string } }>
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/business-date/initialize`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<BusinessDateView>) => response.data,
      invalidatesTags: (_r, _e, { propertyId }) => [
        { type: "BusinessDate", id: propertyId },
        { type: "PropertySetup", id: propertyId },
        "AuditLog",
      ],
    }),
  }),
});

export const {
  usePropertySetupQuery,
  useCreateRoomTypeMutation,
  useUpdateRoomTypeMutation,
  useCreateFloorMutation,
  useUpdateFloorMutation,
  useCreateRoomsMutation,
  useUpdateRoomMutation,
  useCreateTaxMutation,
  useUpdateTaxMutation,
  usePropertyConfigurationQuery,
  useUpdatePropertyConfigurationMutation,
  useInitializeBusinessDateMutation,
} = setupApi;
