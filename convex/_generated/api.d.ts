/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as api_ from "../api.js";
import type * as appUsers from "../appUsers.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as domain from "../domain.js";
import type * as model from "../model.js";
import type * as participantLinks from "../participantLinks.js";
import type * as participants from "../participants.js";
import type * as rosters from "../rosters.js";
import type * as server from "../server.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  api: typeof api_;
  appUsers: typeof appUsers;
  attendance: typeof attendance;
  auth: typeof auth;
  domain: typeof domain;
  model: typeof model;
  participantLinks: typeof participantLinks;
  participants: typeof participants;
  rosters: typeof rosters;
  server: typeof server;
  sessions: typeof sessions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
