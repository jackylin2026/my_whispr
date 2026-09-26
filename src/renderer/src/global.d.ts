import type { MyWhisprApi } from "../../shared/types";

declare global {
  interface Window {
    myWhispr: MyWhisprApi;
  }
}

export {};
