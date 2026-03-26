import { anyApi, type ApiFromModules } from "convex/server";
import type * as attendance from "./attendance";
import type * as rosters from "./rosters";
import type * as sessions from "./sessions";

type AppApi = ApiFromModules<{
  attendance: typeof attendance;
  rosters: typeof rosters;
  sessions: typeof sessions;
}>;

export const api = anyApi as unknown as AppApi;
