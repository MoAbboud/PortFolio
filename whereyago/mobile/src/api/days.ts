/** Day (itinerary) endpoints. */
import type { Day, DayCreate } from "../types";
import { request } from "./client";

export const daysApi = {
  discover: () => request<Day[]>("/days/discover"),

  list: (token: string) => request<Day[]>("/days", { token }),

  get: (id: number, token: string) => request<Day>(`/days/${id}`, { token }),

  create: (body: DayCreate, token: string) =>
    request<Day>("/days", { method: "POST", body, token }),

  remove: (id: number, token: string) =>
    request<void>(`/days/${id}`, { method: "DELETE", token }),
};
