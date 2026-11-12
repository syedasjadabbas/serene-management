import { handle, handleProperty } from "@/lib/controller";
import {
  createProperty,
  getOrganization,
  getProperty,
  getPropertyConfiguration,
  listAccessibleProperties,
  updatePropertyConfiguration,
} from "./properties.service";
import { copyPropertySetup } from "./property-setup.service";

export const getOrganizationView = handle((req) => getOrganization(req.ctx));
export const list = handle((req) => listAccessibleProperties(req.ctx));
export const create = handle((req) => createProperty(req.ctx, req.body), { status: 201 });
export const get = handleProperty((req) => getProperty(req.ctx));
export const getConfiguration = handleProperty((req) => getPropertyConfiguration(req.ctx));
export const updateConfiguration = handleProperty((req) =>
  updatePropertyConfiguration(req.ctx, req.body),
);
export const copySetup = handleProperty((req) =>
  copyPropertySetup(req.ctx, req.ctx.propertyId, req.params.sourceId, req.body),
);
