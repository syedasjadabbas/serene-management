import { handleProperty } from "@/lib/controller";
import {
  createFloor,
  createRoomType,
  createRooms,
  createTax,
  getPropertySetup,
  updateFloor,
  updateRoom,
  updateRoomType,
  updateTax,
} from "./setup.service";

export const get = handleProperty((req) => getPropertySetup(req.ctx));

export const addFloor = handleProperty((req) => createFloor(req.ctx, req.body), { status: 201 });
export const editFloor = handleProperty((req) =>
  updateFloor(req.ctx, req.params.floorId, req.body),
);
export const addRoomType = handleProperty((req) => createRoomType(req.ctx, req.body), {
  status: 201,
});
export const editRoomType = handleProperty((req) =>
  updateRoomType(req.ctx, req.params.roomTypeId, req.body),
);
export const addRooms = handleProperty((req) => createRooms(req.ctx, req.body), { status: 201 });
export const editRoom = handleProperty((req) => updateRoom(req.ctx, req.params.roomId, req.body));
export const addTax = handleProperty((req) => createTax(req.ctx, req.body), { status: 201 });
export const editTax = handleProperty((req) => updateTax(req.ctx, req.params.taxRuleId, req.body));
