/** Adventure (itinerary) endpoints. */
import type { Adventure, AdventureCreate } from "../types";
import { request } from "./client";

export const adventuresApi = {
  discover: () => request<Adventure[]>("/adventures/discover"),

  list: (token: string) => request<Adventure[]>("/adventures", { token }),

  get: (id: number, token: string) => request<Adventure>(`/adventures/${id}`, { token }),

  create: (body: AdventureCreate, token: string) =>
    request<Adventure>("/adventures", { method: "POST", body, token }),

  remove: (id: number, token: string) =>
    request<void>(`/adventures/${id}`, { method: "DELETE", token }),
};
